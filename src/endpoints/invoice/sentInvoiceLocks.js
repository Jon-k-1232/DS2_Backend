'use strict';
const { ruleError } = require('../payments/ledger-helpers');
const { committedFallback } = require('../../utils/committedResponse');
const TABLE_KEYS = Object.freeze({ customer_invoices: 'customer_invoice_id', customer_transactions: 'transaction_id',
   customer_payments: 'payment_id', customer_writeoffs: 'writeoff_id', customer_retainers_and_prepayments: 'retainer_id' });
const lockedMessage = number => `locked: part of sent invoice ${number}`;
async function lockNumber(db, accountId, table, id) {
   if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
   const result = await db.raw('SELECT ds2_locked_invoice(?::text, ?::integer, ?::integer) AS number', [table, Number(id), Number(accountId)]);
   return result.rows[0].number;
}
async function assertUnlocked(db, accountId, table, id) {
   const number = await lockNumber(db, accountId, table, id);
   if (number) throw ruleError(lockedMessage(number), 409, 'SENT_INVOICE_LOCKED');
}
async function historyEvent(trx, issue, actor, event, detail, exceptionId = null) {
   await trx('invoice_history').insert({ account_id: issue.account_id, invoice_id: issue.invoice_id, actor_id: actor,
      event, detail: JSON.stringify(detail), exception_id: exceptionId });
}
async function captureIssue(trx, parent, payload, actor) {
   const issue = { account_id: parent.account_id, invoice_id: parent.customer_invoice_id, customer_id: parent.customer_id,
      invoice_number: parent.invoice_number, issued_by: actor, artifact_key: parent.invoice_file_location,
      credit_selection_reason: payload?.includeCreditStatement === true && Number(parent.total_amount_due) < 0
         ? payload.issueReason || 'Finalize explicitly selected credit statement (sent and locked).' : null,
      payload: JSON.stringify(payload || { original: parent, legacy: true }) };
   if (!payload) {
      issue.issued_at = trx.raw('(SELECT created_at FROM customer_invoices WHERE customer_invoice_id=?)', [parent.customer_invoice_id]);
      issue.issued_by = parent.created_by_user_id || actor;
   }
   const [saved] = await trx('invoice_issues').insert(issue).returning('*');
   // The statement includes this customer's ledger basis through the issuance
   // boundary, plus stamped work. Pending, unbilled work remains editable.
   for (const [table, key] of Object.entries(TABLE_KEYS)) {
      const q = trx(table).where({ account_id: parent.account_id, customer_id: parent.customer_id });
      if (table === 'customer_transactions') q.whereNotNull('customer_invoice_id');
      else if (payload) q.whereRaw('created_at <= (SELECT issued_at FROM invoice_issues WHERE account_id=? AND invoice_id=?)', [parent.account_id, parent.customer_invoice_id]);
      else q.whereRaw('created_at <= (SELECT created_at FROM customer_invoices WHERE customer_invoice_id=?)', [parent.customer_invoice_id]);
      const rows = await q;
      if (rows.length) await trx('invoice_statement_members').insert(rows.map(row => ({ account_id: parent.account_id,
         invoice_id: parent.customer_invoice_id, table_name: table, record_id: row[key], snapshot: JSON.stringify(row) })));
   }
   const events = await trx('retainer_events').where({account_id:parent.account_id,customer_id:parent.customer_id})
      .whereRaw('created_at <= (SELECT issued_at FROM invoice_issues WHERE account_id=? AND invoice_id=?)',[parent.account_id,parent.customer_invoice_id]);
   if(events.length) await trx('invoice_statement_members').insert(events.map(row=>({account_id:parent.account_id,invoice_id:parent.customer_invoice_id,table_name:'retainer_events',record_id:row.event_id,snapshot:JSON.stringify(row)})));
   await trx('invoice_revisions').insert({ account_id: saved.account_id, invoice_id: saved.invoice_id, revision: 0,
      artifact_key: saved.artifact_key, payload: issue.payload, issued_amount: parent.total_amount_due, created_by: actor });
   await historyEvent(trx, saved, actor, payload ? 'issued' : 'legacy_issue_recorded', { invoice_number: saved.invoice_number, artifact_key: saved.artifact_key, legacy: !payload, reason: payload?.issueReason || 'Record legacy issuance evidence.', credit_statement_selected: !!saved.credit_selection_reason, before: null, after: { total_amount_due: parent.total_amount_due, invoice_id: parent.customer_invoice_id } });
   return saved;
}
// Legacy routers have their own catches/envelopes. Normalize the database's
// lock refusal before JSON serialization, preserving other legacy contracts.
function lockResponseMiddleware(req, res, next) {
   const send = res.send;
   const json = res.json;
   res.json = function(body) {
      const match = typeof body?.message === 'string' && body.message.match(/locked: part of sent invoice [^\n]+/);
      if (match) { res.status(409); body = { message:match[0], status:409, code:'SENT_INVOICE_LOCKED' }; }
      return body && typeof body === 'object' ? this.send(body) : json.call(this, body);
   };
   res.send = function (body) {
      if (body && typeof body === 'object' && typeof body.message === 'string') {
         const match = body.message.match(/locked: part of sent invoice [^\n]+/);
         if (match) { res.status(409); body = { message: match[0], status: 409, code: 'SENT_INVOICE_LOCKED' }; }
      }
      // Hard audit snapshots and field-change objects must remain exact; their
      // nested before/after values are not live ledger rows to decorate.
      if (!req.originalUrl.startsWith('/auditRecord/') && req.user && body && typeof body === 'object' && !Buffer.isBuffer(body) && !body.message?.includes('locked:')) {
         const records = new Map();
         const seen = new Set();
         const walk = o => {
            if (!o || typeof o !== 'object' || seen.has(o) || o instanceof Date) return;
            seen.add(o);
            let table;
            if (o.transaction_id && o.total_transaction != null) table = 'customer_transactions';
            else if (o.payment_id && o.payment_amount != null) table = 'customer_payments';
            else if (o.writeoff_id) table = 'customer_writeoffs';
            else if (o.retainer_id && o.current_amount != null) table = 'customer_retainers_and_prepayments';
            else if (o.customer_invoice_id && o.invoice_number && o.total_amount_due != null) table = 'customer_invoices';
            if (table) {
               const key = `${table}:${o[TABLE_KEYS[table]]}`;
               if (!records.has(key)) records.set(key, { table, id: Number(o[TABLE_KEYS[table]]), objects: [] });
               records.get(key).objects.push(o);
            }
            Object.values(o).forEach(walk);
         };
         walk(body);
         if (records.size) {
            const data = [...records.values()];
            req.app.get('db').raw(`SELECT t, id, ds2_locked_invoice(t,id,?::integer) AS number,
               ARRAY(SELECT duplicate_id FROM duplicate_flags d WHERE d.account_id=?::integer AND d.status='open'
                 AND (d.record_id=x.id OR d.canonical_id=x.id) AND d.kind=CASE x.t WHEN 'customer_transactions' THEN 'transaction' WHEN 'customer_payments' THEN 'payment' WHEN 'customer_writeoffs' THEN 'writeoff' WHEN 'customer_retainers_and_prepayments' THEN 'retainer' END) AS duplicate_ids
               FROM jsonb_to_recordset(?::jsonb) AS x(t text,id integer)`,
               [Number(req.user.account_id), Number(req.user.account_id), JSON.stringify(data.map(r => ({ t:r.table, id:r.id })))])
               .then(async result => {
                  const numbers = [...new Set(result.rows.map(r => r.number).filter(Boolean))];
                  const roots = numbers.length ? await req.app.get('db')('customer_invoices').where({ account_id:Number(req.user.account_id) }).whereNull('parent_invoice_id').whereIn('invoice_number', numbers).select('invoice_number','customer_invoice_id') : [];
                  const rootIds = new Map(roots.map(r => [r.invoice_number, r.customer_invoice_id]));
                  result.rows.forEach(r => records.get(`${r.t}:${r.id}`).objects.forEach(o => {
                     o.duplicate_ids = r.duplicate_ids || []; o.possible_duplicate = o.duplicate_ids.length > 0;
                     o.sent_locked = !!r.number; o.locked_invoice_number = r.number; o.locked_invoice_id = rootIds.get(r.number) || null;
                  }));
                  json.call(res, body);
               }).catch(error => {
                  const committed = res.locals?.ds2CommittedOutcome;
                  if (!committed && body.committed !== true) return next(error);
                  console.error('Committed mutation: lock-status refresh failed', error);
                  // Do not expose undecorated rows as editable or invite a
                  // duplicate submission of an already committed mutation.
                  res.status(200);
                  const outcome = committedFallback(committed?.message || body.message);
                  // Preserve finalized-batch controls: the UI must retain
                  // skipped customers' drafts and the saved download link.
                  if (typeof body.fileLocation === 'string') outcome.fileLocation = body.fileLocation;
                  if (Array.isArray(body.skippedCustomers)) outcome.skippedCustomers = body.skippedCustomers;
                  if (Array.isArray(body.committedInvoices)) {
                     outcome.committedInvoices = body.committedInvoices.map(({ customer_invoice_id, customer_id, invoice_number }) =>
                        ({ customer_invoice_id, customer_id, invoice_number }));
                  }
                  return json.call(res, outcome);
               });
            return res;
         }
      }
      return body && typeof body === 'object' && !Buffer.isBuffer(body) ? json.call(this, body) : send.call(this, body);
   };
   next();
}
async function annotateRows(db, accountId, table, rows) {
   if (!rows.length) return rows;
   const key = TABLE_KEYS[table];
   const ids = [...new Set(rows.map(r => Number(r[key])).filter(Number.isSafeInteger))];
   if (!ids.length) return rows;
   const result = await db.raw('SELECT id, ds2_locked_invoice(?::text, id, ?::integer) AS number FROM unnest(?::integer[]) id', [table, Number(accountId), ids]);
   const numbers = new Map(result.rows.map(r => [r.id, r.number]));
   return rows.map(row => ({ ...row, locked_invoice_number: numbers.get(Number(row[key])) || null,
      sent_locked: !!numbers.get(Number(row[key])) }));
}
module.exports = { TABLE_KEYS, lockNumber, assertUnlocked, captureIssue, historyEvent, annotateRows, lockedMessage, lockResponseMiddleware };
