const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');

// source_file retains the legacy per-receipt dedup token. Physical file
// identity strips only its reserved trailing duplicate suffix, including old rows.
const DUPLICATE_SUFFIX = /#dup[0-9]+(?:-ref.*)?$/;
const canonicalSourceFile = value => String(value || '').replace(DUPLICATE_SUFFIX, '');
const SOURCE_FILE_SQL = "regexp_replace(source_file, '#dup[0-9]+(-ref.*){0,1}$', '')";

const PAYMENTS_PENDING_PREFIX = 'James_F__Kimmel___Associates/payments/processing_pending';
const PAYMENTS_PROCESSED_PREFIX = 'James_F__Kimmel___Associates/payments/processed_payments';

// review/full-audit-2026-09 finding 3 (pendingPayments): both prefixes above
// are a single, hardcoded, account-1-specific location — they exist because
// exactly one production Lambda (DS2_Lambdas/Process_Payment_Images) polls
// this exact S3_PENDING_PREFIX and writes to this exact S3_BASE_PREFIX (see
// its config.py: no per-account templating exists there today, and
// account-router.js's own comment notes DS2 is "effectively single-tenant"
// in production). There is no account-scoped variant of this feature to
// hand other accounts instead: an account that "successfully" uploaded here
// would get a false positive for a PDF nothing will ever pick up (an orphan
// S3 object with no DB row, since only that Lambda ever inserts into
// customer_payments_processed) — silent data loss, worse than a clear
// refusal. pendingPayments-router.js's upload route gates on this constant
// and 403s every other account rather than pretending to accept their file.
const PAYMENTS_AUTOMATION_ACCOUNT_ID = 1;

const buildBaseQuery = (db, accountID) => {
   return db
      .select('customer_payments_processed.*')
      .select(db.raw(`${SOURCE_FILE_SQL} as source_file`))
      .select('customer_payments_processed.source_file as source_reference')
      .from('customer_payments_processed')
      .where('customer_payments_processed.account_id', accountID);
};

const applySearchFilter = (query, searchTerm) => {
   if (!searchTerm) return;
   const normalized = String(searchTerm).trim().toLowerCase();
   if (!normalized.length) return;
   const likeTerm = `%${normalized}%`;
   query.andWhere(builder => {
      builder
         .whereRaw('LOWER(customer_payments_processed.customer_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments_processed.matched_customer_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments_processed.source_file) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments_processed.form_of_payment) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments_processed.payment_reference_number) LIKE ?', [likeTerm])
         .orWhereRaw("TO_CHAR(customer_payments_processed.payment_date, 'YYYY-MM-DD') LIKE ?", [`%${searchTerm}%`]);
   });
};

const pendingPaymentsService = {
   async getPendingPaymentsPaginated(db, accountID, { limit, offset, searchTerm, status, month, year }) {
      const baseQuery = buildBaseQuery(db, accountID);

      // Status filter
      if (status === 'new') {
         baseQuery.andWhere('is_payment_processed', false).andWhere('deleted', false);
      } else if (status === 'processed') {
         baseQuery.andWhere('is_payment_processed', true).andWhere('deleted', false);
      } else if (status === 'all') {
         baseQuery.andWhere('deleted', false);
      }

      // Month filter
      if (month && year) {
         baseQuery.andWhereRaw('EXTRACT(MONTH FROM payment_date) = ?', [month]);
         baseQuery.andWhereRaw('EXTRACT(YEAR FROM payment_date) = ?', [year]);
      }

      applySearchFilter(baseQuery, searchTerm);

      const countResult = await baseQuery.clone().clearSelect().count({ count: '*' }).first();
      const payments = await baseQuery.clone()
         .orderBy('customer_payments_processed.created_at', 'desc')
         .limit(limit)
         .offset(offset);
      const totalCount = Number(countResult?.count || 0);

      return { payments, totalCount };
   },

   async getTabCounts(db, accountID) {
      const [newCount] = await db('customer_payments_processed')
         .where({ account_id: accountID, is_payment_processed: false, deleted: false })
         .count({ count: '*' });

      const [processedCount] = await db('customer_payments_processed')
         .where({ account_id: accountID, is_payment_processed: true, deleted: false })
         .count({ count: '*' });

      const [allCount] = await db('customer_payments_processed')
         .where({ account_id: accountID, deleted: false })
         .count({ count: '*' });

      return {
         newPayments: Number(newCount?.count || 0),
         processed: Number(processedCount?.count || 0),
         all: Number(allCount?.count || 0)
      };
   },

   getSinglePendingPayment(db, paymentID, accountID) {
      return db('customer_payments_processed')
         .where({ payment_id: paymentID, account_id: accountID })
         .first();
   },

   softDeletePendingPayment(db, paymentID, accountID) {
      return db('customer_payments_processed')
         .where({ payment_id: paymentID, account_id: accountID, is_payment_processed: false, deleted: false })
         .update({ deleted: true })
         .returning('*')
         .then(rows => rows[0]);
   },

   // `extra` lets the one-step approval record which ledger row it posted.
   markAsProcessed(db, paymentID, accountID, extra = {}) {
      return db('customer_payments_processed')
         .where({ payment_id: paymentID, account_id: accountID })
         .update({
            ...extra,
            is_payment_processed: true,
            date_processed: db.fn.now()
         })
         .returning('*')
         .then(rows => rows[0]);
   },

   /** Pending row locked FOR UPDATE — serializes concurrent approvals of the same row. */
   getPendingPaymentForUpdate(trx, paymentID, accountID) {
      return trx('customer_payments_processed').where({ payment_id: paymentID, account_id: accountID }).forUpdate().first();
   },

   /** Ledger payment already posted from this pending row (note marker written by the approval). */
   findPostedPaymentForPending(db, pendingPaymentID, accountID) {
      return db('customer_payments')
         .select('payment_id')
         .where('account_id', accountID)
         .andWhere('note', 'like', `%[pending_payment:${Number(pendingPaymentID)}]%`)
         .first();
   },

   lockSourceFile(trx, sourceFile, accountID) {
      return trx('customer_payments_processed').whereRaw(`${SOURCE_FILE_SQL} = ?`, [canonicalSourceFile(sourceFile)]).where({ account_id: accountID }).orderBy('payment_id').forUpdate();
   },

   softDeleteBySourceFile(db, sourceFile, accountID) {
      return db('customer_payments_processed')
         .whereRaw(`${SOURCE_FILE_SQL} = ?`, [canonicalSourceFile(sourceFile)]).where({ account_id: accountID, is_payment_processed: false })
         .update({ deleted: true })
         .returning('*');
   },

   async hasProcessedPaymentsForFile(db, sourceFile, accountID) {
      const [result] = await db('customer_payments_processed')
         .whereRaw(`${SOURCE_FILE_SQL} = ?`, [canonicalSourceFile(sourceFile)]).where({ account_id: accountID, is_payment_processed: true })
         .count({ count: '*' });
      return Number(result?.count || 0) > 0;
   },

   async getDistinctSourceFiles(db, accountID) {
      return db('customer_payments_processed')
         .select(db.raw(`${SOURCE_FILE_SQL} as source_file`))
         .select(db.raw('MIN(created_at) as uploaded_at'))
         .select(db.raw('COUNT(*) as payment_count'))
         .select(db.raw('SUM(CASE WHEN is_payment_processed = true THEN 1 ELSE 0 END) as processed_count'))
         .select(db.raw('bool_or(is_payment_processed) as has_processed'))
         .where({ account_id: accountID, deleted: false })
         .whereNot('source_file', '')
         .groupByRaw(SOURCE_FILE_SQL)
         .orderBy('uploaded_at', 'desc');
   },

   /**
    * review/full-audit-2026-09 finding 3: DELETE /pending-payments/file and
    * GET /pending-payments/file-preview both took a client-supplied filename
    * and built an S3 key from it (under the single shared prefixes above)
    * with NO check that the requesting account had anything to do with that
    * file — any authenticated account could delete or read back any other
    * account's uploaded/processed PDF just by guessing or learning its name.
    * The S3 object itself carries no per-account partition (see
    * PAYMENTS_AUTOMATION_ACCOUNT_ID above), so the DB is the only source of
    * truth for "does this account own this file": a row in
    * customer_payments_processed only ever gets created by this account's
    * own upload being picked up by the Lambda (or, today, exactly account
    * 1's), so a match here is exactly "this account's file," in either the
    * pending or the processed state, deleted or not — a soft-deleted row
    * still proves the account is the one who owns (owned) the file, and the
    * caller-facing delete/preview routes apply their own is_payment_processed
    * / deleted business rules on top of this ownership gate, not instead of
    * it. Returns false for BOTH "no such file" and "someone else's file" —
    * deliberately indistinguishable, so a 404 built on this never tells a
    * caller which case they hit.
    */
   async accountOwnsSourceFile(db, sourceFile, accountID, { includeDeleted = true } = {}) {
      const query = db('customer_payments_processed')
         .select('payment_id')
         .whereRaw(`${SOURCE_FILE_SQL} = ?`, [canonicalSourceFile(sourceFile)]).where({ account_id: accountID });
      if (!includeDeleted) query.andWhere('deleted', false);
      return Boolean(await query.first());
   }
};

module.exports = { canonicalSourceFile, pendingPaymentsService, PAYMENTS_PENDING_PREFIX, PAYMENTS_PROCESSED_PREFIX, PAYMENTS_AUTOMATION_ACCOUNT_ID };
