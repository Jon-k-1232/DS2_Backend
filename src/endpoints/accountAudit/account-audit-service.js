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

   async getAuditableCustomers(
      db,
      accountId,
      {
         search = '',
         limit = 25,
         offset = 0,
         filter = null,
         sort = null,
         direction = 'asc',
         hideZeroAppBalance = true
      } = {}
   ) {
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
      } else {
         // Default gate: hide customers with nothing to audit (no outstanding
         // invoice and no unbilled billable activity).  Lifted when the user
         // searches by name/ID so they can still pull up any specific account.
         base.andWhere(builder => {
            builder
               .whereExists(
                  db('customer_invoices as ci')
                     .where('ci.customer_id', db.ref('c.customer_id'))
                     .andWhere('ci.account_id', accountId)
                     .andWhere(db.raw('ci.remaining_balance_on_invoice > 0'))
                     .andWhere('ci.is_invoice_paid_in_full', false)
                     .whereNull('ci.parent_invoice_id')
                     .select(db.raw('1'))
               )
               .orWhereExists(
                  db('customer_transactions as ct')
                     .where('ct.customer_id', db.ref('c.customer_id'))
                     .andWhere('ct.account_id', accountId)
                     .andWhere('ct.is_transaction_billable', true)
                     .whereNull('ct.customer_invoice_id')
                     .select(db.raw('1'))
               );
         });
      }

      // ── Quick filters ──────────────────────────────────────────────────────
      // billing_ready: has at least one open parent invoice with remaining > 0.
      // Queries live invoice data directly so it always reflects current state.
      if (filter === 'billing_ready') {
         base.whereExists(
            db('customer_invoices as ci')
               .where('ci.customer_id', db.ref('c.customer_id'))
               .andWhere('ci.account_id', accountId)
               .andWhere(db.raw('ci.remaining_balance_on_invoice > 0'))
               .andWhere('ci.is_invoice_paid_in_full', false)
               .whereNull('ci.parent_invoice_id')
               .select(db.raw('1'))
         );
      }

      // needs_audit: customer has at least one transaction created after their
      // most recent completed audit (or any transaction at all if never audited).
      // Excludes zero-activity accounts that would be a waste to audit.
      if (filter === 'needs_audit') {
         base.whereExists(
            db('customer_transactions as ct')
               .where('ct.customer_id', db.ref('c.customer_id'))
               .andWhereRaw(
                  `ct.created_at > COALESCE(
                     (SELECT MAX(aa.created_at)
                      FROM account_audits aa
                      WHERE aa.customer_id = c.customer_id
                        AND aa.account_id = ?
                        AND aa.status = 'completed'),
                     '1970-01-01'::timestamptz
                  )`,
                  [accountId]
               )
               .select(db.raw('1'))
         );
      }

      // Audit join is required for matched/mismatched filters and for sorting
      // by audit-derived columns, so build a single "with audit" query that
      // both count and data queries derive from.
      const applyAuditJoin = q =>
         q.leftJoin(
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
         );

      // matched / mismatched: compare last audit's audit_balance vs app_invoice_total.
      // Customers with no completed audit are excluded from both — neither matched
      // nor mismatched applies until at least one audit has run.
      const matchTolerance = 0.01;
      const applyMatchFilter = q => {
         if (filter === 'matched') {
            q.whereNotNull('la.last_audit_at')
               .whereNotNull('la.last_audit_balance')
               .whereNotNull('la.last_app_invoice_total')
               .whereRaw('ABS(la.last_audit_balance - la.last_app_invoice_total) < ?', [matchTolerance]);
         } else if (filter === 'mismatched') {
            q.whereNotNull('la.last_audit_at')
               .whereNotNull('la.last_audit_balance')
               .whereNotNull('la.last_app_invoice_total')
               .whereRaw('ABS(la.last_audit_balance - la.last_app_invoice_total) >= ?', [matchTolerance]);
         }
      };

      // Toggle: hideZeroAppBalance — drop customers whose last app_invoice_total
      // is ~$0.  Default is true (on page load) so auditors see active balances.
      const applyToggles = q => {
         if (hideZeroAppBalance) {
            q.whereNotNull('la.last_app_invoice_total').whereRaw('ABS(la.last_app_invoice_total) >= ?', [matchTolerance]);
         }
      };

      // Count query — same joins/filters, no order/limit.
      const countQuery = applyAuditJoin(base.clone());
      applyMatchFilter(countQuery);
      applyToggles(countQuery);
      const [{ count }] = await countQuery.clearSelect().clearOrder().count({ count: '*' });
      const totalCount = Number(count) || 0;

      // Whitelist sort columns to safe SQL expressions to prevent injection.
      // Audit-derived columns (last_audit_*) sort NULLS LAST in both directions
      // so customers who have never been audited stay at the bottom of any sort.
      const SORT_MAP = {
         customer_id: { expr: 'c.customer_id', nulls: false },
         display_name: { expr: 'c.display_name', nulls: false },
         last_audit_at: { expr: 'la.last_audit_at', nulls: true },
         last_audit_balance: { expr: 'la.last_audit_balance', nulls: true },
         last_app_invoice_total: { expr: 'la.last_app_invoice_total', nulls: true },
         last_balance_difference: { expr: 'ABS(la.last_audit_balance - la.last_app_invoice_total)', nulls: true }
      };
      const dir = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      const sortConfig = sort && SORT_MAP[sort] ? SORT_MAP[sort] : { expr: 'c.display_name', nulls: false };
      const orderClause = sortConfig.nulls
         ? `${sortConfig.expr} ${dir} NULLS LAST, c.customer_id ASC`
         : `${sortConfig.expr} ${dir}, c.customer_id ASC`;

      const dataQuery = applyAuditJoin(base.clone());
      applyMatchFilter(dataQuery);
      applyToggles(dataQuery);
      const rows = await dataQuery
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
         .clearOrder()
         .orderByRaw(orderClause)
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
