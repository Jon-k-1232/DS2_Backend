/**
 * Shared helpers for ledger mutations (payments, write-offs, retainers,
 * pending-payment approval).
 *
 * This module deliberately requires nothing from the endpoint modules so
 * payment-logic, writeOffs-logic, retainer-logic and the transactions code can
 * all depend on it without creating a require cycle. The few queries it runs
 * are plain knex against the ledger tables.
 */

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const RETAINERS_TABLE = 'customer_retainers_and_prepayments';
const PAYMENTS_TABLE = 'customer_payments';

/**
 * Run `fn(trx)` inside a knex transaction. When the caller already holds a
 * transaction it is reused, so the cores compose (e.g. pending-payment
 * approval runs createPaymentCore inside its own transaction).
 */
const withTransaction = (db, fn) => (db && db.isTransaction ? fn(db) : db.transaction(fn));

/**
 * created_at for rows written under the ledger lock. clock_timestamp() is the
 * wall clock at INSERT time (after the lock was granted), so rows sort in the
 * order the locks were acquired. now() would be the transaction's BEGIN time,
 * and a transaction that began first but waited on the lock would stamp its
 * snapshot earlier than the snapshot it was built on.
 */
const ledgerNow = db => db.raw('clock_timestamp()');

/**
 * A business-rule refusal (as opposed to an unexpected failure). Routers that
 * speak real HTTP status codes use `statusCode`; the legacy routers keep
 * answering HTTP 200 with `{ status: 500, message }`. `code` (optional) is a
 * stable machine-readable reason for callers that branch on the refusal.
 */
const ruleError = (message, statusCode = 422, code = undefined) => {
   const err = new Error(message);
   err.statusCode = statusCode;
   err.isLedgerRule = true;
   if (code) err.code = code;
   return err;
};

/**
 * Serialize ledger mutations per customer: SELECT … FOR NO KEY UPDATE on the
 * customer row. Every payment / write-off / retainer / transaction mutation and
 * the finalize run take this lock first, so two requests for the same customer
 * can never both build a new snapshot on the same "latest" row. Also verifies
 * the customer belongs to the account (tenancy) and returns the numeric id.
 *
 * Lock MODE matters: FOR NO KEY UPDATE conflicts with itself, FOR UPDATE and
 * FOR SHARE (so all ledger writers still serialize) but NOT with the FOR KEY
 * SHARE lock a foreign-key check takes on the referenced customer/account row.
 * Ingestion claims write `timesheet_entries.suggested_customer_id` (an FK to
 * customers) before entering the ledger path, and every INSERT into a table
 * with an account_id FK key-shares the accounts row; with FOR UPDATE, two such
 * transactions for one customer deadlock and a payment posted during finalize
 * deadlocks against the accounts lock. Never switch this back to forUpdate().
 */
const lockCustomerLedger = async (trx, accountId, customerId) => {
   const id = Number(customerId);
   if (!Number.isInteger(id) || id <= 0) throw ruleError('No customer selected.', 400);
   const row = await trx('customers').select('customer_id').where({ account_id: Number(accountId), customer_id: id }).forNoKeyUpdate().first();
   if (!row) throw ruleError('Customer not found for this account.', 404);
   return id;
};

/**
 * Lock the ledger of the customer that owns a stored row (payment, write-off,
 * retainer). The customer is always taken from the STORED row, never from the
 * request body. Throws `notFoundMessage` when the row does not exist.
 */
const lockCustomerLedgerForRow = async (trx, accountId, table, idColumn, id, notFoundMessage) => {
   const rowId = Number(id);
   if (!Number.isInteger(rowId) || rowId <= 0) throw ruleError(notFoundMessage, 404);
   const row = await trx(table)
      .select('customer_id')
      .where({ account_id: Number(accountId), [idColumn]: rowId })
      .first();
   if (!row) throw ruleError(notFoundMessage, 404);
   const customer = await lockCustomerLedger(trx, accountId, row.customer_id);
   if (table === RETAINERS_TABLE) await require('../invoice/sentInvoiceLocks').assertUnlocked(trx, accountId, table, rowId);
   return customer;
};

// ── billed gate (statement membership) ───────────────────────────────────────

const toMs = value => (value == null ? NaN : new Date(value).getTime());

/**
 * MILLISECOND-precision comparison of two JS timestamps: `createdAt` at or
 * before `newestParent.created_at`.
 *
 * NOT a billed gate. node-postgres parses `timestamp` columns into JS Dates,
 * which drop the microseconds Postgres stores, so a row written in the same
 * millisecond as the statement — but after it — compares as covered here while
 * the billing engine (which compares in SQL) still bills it next time. Ledger
 * immutability checks use isLedgerRowBilled, which compares inside Postgres.
 * Kept for callers that only need an approximate ordering.
 */
const isCoveredByStatement = (createdAt, newestParent) => {
   if (!newestParent || !newestParent.created_at || createdAt == null) return false;
   return toMs(createdAt) <= toMs(newestParent.created_at);
};

/** Ledger tables the billed gate can anchor on, keyed to their primary key. */
const LEDGER_ROW_KEYS = Object.freeze({
   customer_invoices: 'customer_invoice_id',
   customer_payments: 'payment_id',
   customer_writeoffs: 'writeoff_id',
   customer_retainers_and_prepayments: 'retainer_id'
});

/**
 * The billed-gate query for one ledger row: `row.created_at <= newest parent
 * created_at`, both columns read by exact row id and compared INSIDE Postgres.
 * Exposed separately so its shape can be unit-tested without a database.
 */
const ledgerRowBilledQuery = (db, accountId, { table, id }, newestParentId) => {
   const key = LEDGER_ROW_KEYS[table];
   if (!key) throw new Error(`Unsupported ledger table for the billed gate: ${table}`);
   return db.raw(
      'SELECT COALESCE(r.created_at <= np.created_at, false) AS billed ' +
         'FROM ?? AS r ' +
         'JOIN customer_invoices AS np ON np.account_id = r.account_id AND np.customer_invoice_id = ? ' +
         'WHERE r.account_id = ? AND ?? = ?',
      [table, Number(newestParentId), Number(accountId), `r.${key}`, Number(id)]
   );
};

/**
 * True when the ledger event recorded by row `anchor` ({ table, id }) is
 * already reflected on the customer's newest statement `newestParent` (the
 * parent invoice row the billing engine uses as its statement marker): the
 * row was written at or before that parent row.
 *
 * Evaluated in SQL so a microsecond tie is decided exactly like the engine's
 * statement gate — `created_at > (SELECT created_at FROM customer_invoices
 * WHERE customer_invoice_id = <newest parent id>)` is still pending the next
 * bill; everything else is billed and immutable. A customer with no statement
 * (newestParent missing) has nothing billed.
 */
const isLedgerRowBilled = async (db, accountId, anchor, newestParent) => {
   if (!anchor || !LEDGER_ROW_KEYS[anchor.table]) throw new Error(`Unsupported ledger table for the billed gate: ${anchor && anchor.table}`);
   const parentId = Number(newestParent && newestParent.customer_invoice_id);
   const rowId = Number(anchor.id);
   if (!Number.isInteger(parentId) || parentId <= 0 || !Number.isInteger(rowId) || rowId <= 0) return false;
   const result = await ledgerRowBilledQuery(db, accountId, anchor, parentId);
   const rows = result && Array.isArray(result.rows) ? result.rows : result;
   return Boolean(Array.isArray(rows) && rows[0] && rows[0].billed === true);
};

// ── note markers ─────────────────────────────────────────────────────────────

const appendNoteMarker = (note, marker) => (note ? `${note} ${marker}` : marker);

const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remove every copy of `marker` (and the space before it); null when nothing is left. */
const removeNoteMarker = (note, marker) => {
   if (note == null) return null;
   const next = String(note)
      .replace(new RegExp(`\\s?${escapeRegExp(marker)}`, 'g'), '')
      .trim();
   return next.length ? next : null;
};

const PREPAYMENT_RETAINER_RE = /\[prepayment_retainer:(\d+)\]/;
/** Retainer id banked from an overpayment split, recorded on the payment note. */
const parsePrepaymentRetainerId = note => {
   const match = PREPAYMENT_RETAINER_RE.exec(note || '');
   return match ? Number(match[1]) : null;
};

const RETAINER_DRAW_RE = /\[retainer_draw:(\d+)\]/;
/**
 * `[retainer_draw:<retainer_id>]` — the exact draw-down snapshot a
 * retainer-funded payment created. Append it to the payment note in the same
 * transaction that writes the draw.
 */
const retainerDrawMarker = retainerId => `[retainer_draw:${Number(retainerId)}]`;
/** Draw snapshot id recorded on a payment note, or null (legacy payment). */
const parseRetainerDrawId = note => {
   const match = RETAINER_DRAW_RE.exec(note || '');
   return match ? Number(match[1]) : null;
};

const CANCELLED_BY_REVERSAL_RE = /\[cancelled by reversal of payment #(\d+)\]/;
/**
 * `[cancelled by reversal of payment #<id>]` — stamped on an overpayment
 * prepayment retainer that an NSF reversal of payment <id> zeroed out.
 */
const cancelledByReversalMarker = paymentId => `[cancelled by reversal of payment #${Number(paymentId)}]`;
/** Payment id whose reversal cancelled this retainer, or null. */
const parseCancelledByReversal = note => {
   const match = CANCELLED_BY_REVERSAL_RE.exec(note || '');
   return match ? Number(match[1]) : null;
};

const OVERPAYMENT_SPLIT_RE = /\[overpayment split: \$[\d,.]+ to [^,\]]+, \$([\d,.]+) to prepayment\]/;
/** Excess amount banked by a legacy overpayment split (no retainer id marker). */
const parseOverpaymentExcess = note => {
   const match = OVERPAYMENT_SPLIT_RE.exec(note || '');
   return match ? round2(Number(match[1].replace(/,/g, ''))) : null;
};

const REVERSAL_OF_RE = /^\[reversal of payment #(\d+)\]\s?/;
/** `{ paymentId, reason }` for a reversal row's note, or null. */
const parseReversalOf = note => {
   const match = REVERSAL_OF_RE.exec(note || '');
   return match ? { paymentId: Number(match[1]), reason: note.slice(match[0].length) } : null;
};

/**
 * Remove the `[reversed YYYY-MM-DD: <reason>]` marker reversePayment appended
 * to an original payment's note. Prefers the exact reason (a reason may itself
 * contain `]`); falls back to the first generic marker. Returns null when
 * nothing else remains, restoring an originally empty note.
 */
const stripReversedMarker = (note, reason) => {
   if (!note) return note == null ? null : note;
   const generic = /\s?\[reversed \d{4}-\d{2}-\d{2}: [^\]]*\]/;
   const exact = reason ? new RegExp(`\\s?\\[reversed \\d{4}-\\d{2}-\\d{2}: ${escapeRegExp(reason)}\\]`) : null;
   const next = note.replace(exact && exact.test(note) ? exact : generic, '');
   return next.length ? next : null;
};

// Link markers point one ledger row at another by id. Only the server writes
// them; a copy typed into a note by a user could re-point a delete/restore at
// someone else's row, so client-supplied ones are dropped.
const LINK_MARKER_PATTERNS = Object.freeze({
   overpayment_split: 'overpayment split: [^\\]]*',
   overpayment_excess: 'overpayment excess from payment on [^\\]]*',
   retainer_draw: 'retainer_draw:\\d+',
   prepayment_retainer: 'prepayment_retainer:\\d+',
   pending_payment: 'pending_payment:\\d+',
   reversal_of: 'reversal of payment #\\d+',
   cancelled_by_reversal: 'cancelled by reversal of payment #\\d+'
});
const ALL_LINK_MARKER_KINDS = Object.freeze(Object.keys(LINK_MARKER_PATTERNS));
const linkMarkerRe = kinds => new RegExp(`\\s*\\[(?:${kinds.map(kind => LINK_MARKER_PATTERNS[kind]).join('|')})\\]`, 'g');

/**
 * Drop link markers (every kind, or only `kinds`) from a CLIENT-supplied note.
 * undefined stays undefined (column untouched); a note left empty becomes null.
 *
 * Strips to a FIXED POINT (repeat until a pass removes nothing) rather than a
 * single pass. A single pass only removes markers present in the ORIGINAL
 * text; deleting an inner bracket pair can unmask an outer one that only
 * becomes a well-formed marker once the inner text is gone — e.g.
 * `[prepayment_[retainer_draw:1]retainer:N]` loses its inner
 * `[retainer_draw:1]` on pass one, which collapses the surrounding text into
 * `[prepayment_retainer:N]` — now itself a real link marker that a
 * single-pass strip would leave behind untouched and executable.
 *
 * Also strips CLIENT-written reversed-STATUS text — `[reversed ...]` — every
 * pass, `kinds` notwithstanding. reversePayment refuses a payment whose note
 * merely CONTAINS `[reversed ` (checkIfPaymentIsAttachedToInvoice / the
 * `[reversed ` include-check in payment-logic), so a client typing that
 * prefix — with or without a closing bracket — must never reach storage; a
 * GENUINE stored `[reversed YYYY-MM-DD: reason]` marker is restored
 * afterward by preserveSystemMarkers, which reads it from the STORED note,
 * never from this stripped client text.
 */
const stripLinkMarkers = (note, kinds = ALL_LINK_MARKER_KINDS) => {
   if (note === undefined) return undefined;
   if (note === null) return null;
   const text = String(note);
   let next = text;
   let previous;
   do {
      previous = next;
      next = next.replace(linkMarkerRe(kinds), '');
      // reversePayment trusts this prefix even without a closing bracket.
      next = next.replace(/\s*\[reversed [^\]]*(?:\]|$)/g, '');
   } while (next !== previous);
   if (next === text) return text;
   const trimmed = next.trim();
   return trimmed.length ? trimmed : null;
};

// System markers that link ledger rows together or record what the server did.
// A user editing a payment / write-off / retainer note must not be able to drop them.
const SYSTEM_MARKER_RE =
   /\[(?:reversed \d{4}-\d{2}-\d{2}: [^\]]*|reversal of payment #\d+|prepayment_retainer:\d+|retainer_draw:\d+|pending_payment:\d+|cancelled by reversal of payment #\d+|overpayment split: [^\]]*|overpayment excess from payment on [^\]]*|applied to [^\]]*)\]/g;

/**
 * Note edit that keeps every system marker of the stored note (re-appended
 * when the new text dropped it) and refuses to ADD link markers the stored
 * note does not carry.
 *
 * Strips every link marker out of the incoming text to a FIXED POINT first
 * (stripLinkMarkers — see its comment: a single pass can unmask a nested
 * marker instead of removing it), THEN restores only the trusted markers this
 * row's STORED note actually carries. This can never manufacture a marker the
 * stored note didn't already have, however deeply the client's text nests one.
 */
const preserveSystemMarkers = (storedNote, newNote) => {
   const stored = String(storedNote || '');
   const markers = stored.match(SYSTEM_MARKER_RE) || [];
   let next = stripLinkMarkers(newNote) || '';
   markers.forEach(marker => {
      if (!next.includes(marker)) next = next ? `${next} ${marker}` : marker;
   });
   return next.length ? next : null;
};

// ── retainer draw ↔ payment linkage ──────────────────────────────────────────

/** Root id of the retainer chain `retainerId` belongs to, or null when that row is gone. */
const retainerChainRootId = async (db, accountId, retainerId) => {
   const id = Number(retainerId);
   if (!Number.isInteger(id) || id <= 0) return null;
   const row = await db(RETAINERS_TABLE).select('retainer_id', 'parent_retainer_id').where({ account_id: Number(accountId), retainer_id: id }).first();
   return row ? Number(row.parent_retainer_id || row.retainer_id) : null;
};

/**
 * LEGACY draw candidates for a retainer-funded payment written before the
 * `[retainer_draw:<id>]` marker existed: CHILD rows of the payment's retainer
 * chain (never a root — a null chain id rendered as `IS NULL` once matched
 * every root retainer on the account), owned by the payment's customer,
 * written within one second of the payment row, and not claimed by another
 * payment's `[retainer_draw:<id>]` marker. Returns EVERY candidate, oldest
 * first; resolveRetainerDrawForPayment accepts the result only when exactly
 * one row matches — it never picks the "closest" one.
 */
const legacyRetainerDrawCandidatesQuery = (db, accountId, { rootRetainerId, customerId, paymentId }) =>
   db
      .select('r.*')
      .from(`${RETAINERS_TABLE} as r`)
      .join(`${PAYMENTS_TABLE} as p`, function () {
         this.on('p.account_id', '=', 'r.account_id').andOn('p.customer_id', '=', 'r.customer_id');
      })
      .where('r.account_id', Number(accountId))
      .andWhere('r.customer_id', Number(customerId))
      .andWhere('r.parent_retainer_id', Number(rootRetainerId))
      .andWhere('p.payment_id', Number(paymentId))
      .andWhereRaw(`r.created_at BETWEEN p.created_at - interval '1 second' AND p.created_at + interval '1 second'`)
      .whereNotExists(function () {
         this.select(db.raw('1'))
            .from(`${PAYMENTS_TABLE} as claimed`)
            .whereRaw('claimed.account_id = r.account_id')
            .andWhereRaw('claimed.payment_id <> p.payment_id')
            .andWhereRaw(`claimed.note LIKE ('%[retainer_draw:' || r.retainer_id || ']%')`);
      })
      .orderBy([
         { column: 'r.created_at', order: 'asc' },
         { column: 'r.retainer_id', order: 'asc' }
      ]);

const drawError = (code, message) => ruleError(message, 422, code);

/**
 * resolveRetainerDrawForPayment(trx, accountId, paymentRow) → Promise<row | null>
 *
 * The retainer draw-down snapshot (a CHILD row of customer_retainers_and_prepayments)
 * that a retainer-funded payment created. Call it inside the transaction that
 * holds the customer's ledger lock (lockCustomerLedger / lockCustomerLedgerForRow).
 *
 *  - `paymentRow` is the STORED customer_payments row (payment_id, customer_id,
 *    retainer_id, note, created_at) — never a request body.
 *  - Resolves null when `paymentRow.retainer_id` is null (not retainer-funded).
 *  - Exact path: the `[retainer_draw:<retainer_id>]` marker on the payment note.
 *    createPaymentCore writes it; any other code that inserts a draw together
 *    with a payment (e.g. transaction-created 'Retainer' payments) should append
 *    `retainerDrawMarker(draw.retainer_id)` to that payment's note in the same
 *    transaction. The marked row must still be a draw of the payment's retainer
 *    chain owned by the payment's customer.
 *  - Legacy path (no marker): the ±1 s window of legacyRetainerDrawCandidatesQuery,
 *    accepted ONLY when exactly one candidate exists.
 *  - Nothing is ever guessed: when the draw cannot be identified exactly it
 *    throws a ruleError (statusCode 422, isLedgerRule) whose `code` is
 *      'RETAINER_DRAW_MISMATCH'  the marked row is missing or is not a draw of this chain/customer,
 *      'RETAINER_DRAW_NOT_FOUND' legacy payment, no candidate in the window,
 *      'RETAINER_DRAW_AMBIGUOUS' legacy payment, several candidates in the window.
 */
const resolveRetainerDrawForPayment = async (trx, accountId, paymentRow) => {
   if (!paymentRow || !paymentRow.retainer_id) return null;
   const account = Number(accountId);
   const paymentId = Number(paymentRow.payment_id);
   const knownRootId = await retainerChainRootId(trx, account, paymentRow.retainer_id);
   const rootId = knownRootId || Number(paymentRow.retainer_id);

   const markedId = parseRetainerDrawId(paymentRow.note);
   if (markedId) {
      const draw = await trx(RETAINERS_TABLE).where({ account_id: account, retainer_id: markedId }).first();
      let problem = null;
      if (!draw) problem = 'no longer exists';
      else if (!draw.parent_retainer_id) problem = 'is a retainer, not a draw-down entry';
      else if (Number(draw.customer_id) !== Number(paymentRow.customer_id)) problem = 'belongs to a different customer';
      else if (knownRootId && Number(draw.parent_retainer_id) !== knownRootId) problem = `is not a draw on retainer #${knownRootId}`;
      if (problem) {
         throw drawError(
            'RETAINER_DRAW_MISMATCH',
            `Payment #${paymentId} records retainer draw #${markedId}, but that row ${problem}. The retainer balance cannot be adjusted automatically — contact an administrator to reconcile retainer #${rootId}.`
         );
      }
      return draw;
   }

   const candidates = await legacyRetainerDrawCandidatesQuery(trx, account, { rootRetainerId: rootId, customerId: paymentRow.customer_id, paymentId });
   if (candidates.length === 1) return candidates[0];
   if (!candidates.length) {
      throw drawError(
         'RETAINER_DRAW_NOT_FOUND',
         `Could not find the retainer draw recorded with payment #${paymentId}, so the retainer balance cannot be adjusted automatically. Contact an administrator to reconcile retainer #${rootId}.`
      );
   }
   throw drawError(
      'RETAINER_DRAW_AMBIGUOUS',
      `Payment #${paymentId} was recorded before retainer draws were linked to their payments, and ${candidates.length} draws on retainer #${rootId} ` +
         `(${candidates.map(c => `#${c.retainer_id}`).join(', ')}) were written within a second of it, so the draw that belongs to this payment cannot be determined. ` +
         `Nothing was changed — contact an administrator to reconcile retainer #${rootId}.`
   );
};

// ── value parsing for the object mappers ─────────────────────────────────────

/**
 * String column value or null. `String(x) || null` turned null/undefined into
 * the literal strings 'null' / 'undefined' (a non-empty string is truthy);
 * those literals are treated as null here so they never propagate again.
 */
const nullableString = value => {
   if (value === undefined || value === null) return null;
   const s = String(value);
   if (s === '' || s === 'null' || s === 'undefined') return null;
   return s;
};

/**
 * Boolean column value. `Boolean(x) || true` was always true; this honours an
 * explicit false and falls back to `defaultValue` only when the value is absent
 * or unrecognizable.
 */
const parseBoolean = (value, defaultValue) => {
   if (value === undefined || value === null || value === '') return defaultValue;
   if (typeof value === 'boolean') return value;
   if (typeof value === 'number') return value !== 0;
   const s = String(value).trim().toLowerCase();
   if (['true', 't', '1', 'yes', 'y'].includes(s)) return true;
   if (['false', 'f', '0', 'no', 'n'].includes(s)) return false;
   return defaultValue;
};

const positiveIntOrNull = value => {
   const n = Number(value);
   return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = {
   round2,
   withTransaction,
   ledgerNow,
   ruleError,
   lockCustomerLedger,
   lockCustomerLedgerForRow,
   isCoveredByStatement,
   LEDGER_ROW_KEYS,
   ledgerRowBilledQuery,
   isLedgerRowBilled,
   appendNoteMarker,
   removeNoteMarker,
   escapeRegExp,
   parsePrepaymentRetainerId,
   retainerDrawMarker,
   parseRetainerDrawId,
   cancelledByReversalMarker,
   parseCancelledByReversal,
   parseOverpaymentExcess,
   parseReversalOf,
   stripReversedMarker,
   stripLinkMarkers,
   preserveSystemMarkers,
   retainerChainRootId,
   legacyRetainerDrawCandidatesQuery,
   resolveRetainerDrawForPayment,
   nullableString,
   parseBoolean,
   positiveIntOrNull
};
