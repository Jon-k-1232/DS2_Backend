const accountAuditService = {
   getCustomer(db, accountId, customerId) {
      return db('customers')
         .where({ account_id: accountId, customer_id: customerId })
         .first();
   },

   getInvoices(db, accountId, customerId) {
      return db('customer_invoices')
         .where({ account_id: accountId, customer_id: customerId })
         .orderBy([{ column: 'invoice_date', order: 'asc' }, { column: 'customer_invoice_id', order: 'asc' }]);
   },

   getPayments(db, accountId, customerId) {
      return db('customer_payments')
         .where({ account_id: accountId, customer_id: customerId })
         .orderBy([{ column: 'payment_date', order: 'asc' }, { column: 'payment_id', order: 'asc' }]);
   },

   getWriteoffs(db, accountId, customerId) {
      return db('customer_writeoffs')
         .where({ account_id: accountId, customer_id: customerId })
         .orderBy([{ column: 'writeoff_date', order: 'asc' }, { column: 'writeoff_id', order: 'asc' }]);
   },

   getTransactions(db, accountId, customerId) {
      return db('customer_transactions')
         .where({ account_id: accountId, customer_id: customerId })
         .orderBy([{ column: 'transaction_date', order: 'asc' }, { column: 'transaction_id', order: 'asc' }]);
   },

   getRetainers(db, accountId, customerId) {
      return db('customer_retainers_and_prepayments')
         .where({ account_id: accountId, customer_id: customerId })
         .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'retainer_id', order: 'asc' }]);
   },

   async getAuditableCustomers(db, accountId, { search = '', limit = 25, offset = 0 } = {}) {
      const trimmed = (search || '').trim();
      const base = db('customers as c')
         .where('c.account_id', accountId)
         .andWhere('c.is_customer_active', true);

      if (trimmed) {
         const term = `%${trimmed.toLowerCase()}%`;
         base.andWhere(builder => {
            builder
               .whereRaw('LOWER(c.display_name) LIKE ?', [term])
               .orWhereRaw('LOWER(c.customer_name) LIKE ?', [term])
               .orWhereRaw('LOWER(c.business_name) LIKE ?', [term])
               .orWhereRaw('CAST(c.customer_id AS TEXT) = ?', [trimmed]);
         });
      }

      const [{ count }] = await base.clone().clearSelect().clearOrder().count({ count: '*' });
      const totalCount = Number(count) || 0;

      const rows = await base
         .clone()
         .leftJoin(
            db.raw(
               `(SELECT DISTINCT ON (customer_id)
                    customer_id,
                    audit_id AS last_audit_id,
                    created_at AS last_audit_at,
                    audit_balance AS last_audit_balance,
                    app_invoice_total AS last_app_invoice_total,
                    discrepancy_count AS last_discrepancy_count
                 FROM account_audits
                 WHERE account_id = ? AND status = 'completed'
                 ORDER BY customer_id, created_at DESC, audit_id DESC) la`,
               [accountId]
            ),
            'la.customer_id',
            'c.customer_id'
         )
         .select(
            'c.customer_id',
            'c.display_name',
            'c.customer_name',
            'c.business_name',
            'c.is_commercial_customer',
            'la.last_audit_at',
            'la.last_audit_id',
            'la.last_audit_balance',
            'la.last_app_invoice_total',
            'la.last_discrepancy_count'
         )
         .orderBy([{ column: 'c.display_name', order: 'asc' }, { column: 'c.customer_id', order: 'asc' }])
         .limit(limit)
         .offset(offset);

      return { totalCount, rows };
   },

   insertAudit(db, audit) {
      return db('account_audits').insert(audit).returning('*');
   },

   getAuditById(db, accountId, auditId) {
      return db('account_audits')
         .where({ account_id: accountId, audit_id: auditId })
         .first();
   },

   getAuditsForCustomer(db, accountId, customerId) {
      return db('account_audits')
         .where({ account_id: accountId, customer_id: customerId })
         .orderBy('created_at', 'desc');
   }
};

module.exports = accountAuditService;
