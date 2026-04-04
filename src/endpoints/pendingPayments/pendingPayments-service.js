const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');

const PAYMENTS_PENDING_PREFIX = 'James_F__Kimmel___Associates/payments/processing_pending';
const PAYMENTS_PROCESSED_PREFIX = 'James_F__Kimmel___Associates/payments/processed_payments';

const buildBaseQuery = (db, accountID) => {
   return db
      .select('customer_payments_processed.*')
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
         .where({ payment_id: paymentID, account_id: accountID })
         .update({ deleted: true })
         .returning('*')
         .then(rows => rows[0]);
   },

   markAsProcessed(db, paymentID, accountID) {
      return db('customer_payments_processed')
         .where({ payment_id: paymentID, account_id: accountID })
         .update({
            is_payment_processed: true,
            date_processed: db.fn.now()
         })
         .returning('*')
         .then(rows => rows[0]);
   },

   softDeleteBySourceFile(db, sourceFile, accountID) {
      return db('customer_payments_processed')
         .where({ source_file: sourceFile, account_id: accountID, is_payment_processed: false })
         .update({ deleted: true })
         .returning('*');
   },

   async hasProcessedPaymentsForFile(db, sourceFile, accountID) {
      const [result] = await db('customer_payments_processed')
         .where({ source_file: sourceFile, account_id: accountID, is_payment_processed: true })
         .count({ count: '*' });
      return Number(result?.count || 0) > 0;
   },

   async getDistinctSourceFiles(db, accountID) {
      return db('customer_payments_processed')
         .select('source_file')
         .select(db.raw('MIN(created_at) as uploaded_at'))
         .select(db.raw('COUNT(*) as payment_count'))
         .select(db.raw('SUM(CASE WHEN is_payment_processed = true THEN 1 ELSE 0 END) as processed_count'))
         .select(db.raw('bool_or(is_payment_processed) as has_processed'))
         .where({ account_id: accountID, deleted: false })
         .whereNot('source_file', '')
         .groupBy('source_file')
         .orderBy('uploaded_at', 'desc');
   }
};

module.exports = { pendingPaymentsService, PAYMENTS_PENDING_PREFIX, PAYMENTS_PROCESSED_PREFIX };
