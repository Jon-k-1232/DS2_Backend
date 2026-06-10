/**
 * Accounts Receivable aging.
 *
 * Rolling-balance view: each customer's outstanding = the remaining_balance on
 * their MOST RECENT unpaid parent invoice.  This is the same interpretation
 * the Create Invoice page and the Account Audit use, so all three views agree
 * on what each customer owes.  Older parent invoices whose balance was
 * absorbed via beginning_balance on a newer invoice are NOT double-counted.
 *
 * Bucket = age of that most-recent unpaid parent invoice:
 *   - 0–30:   billed within last 30 days
 *   - 31–60:  billed 31–60 days ago
 *   - 61–90:  billed 61–90 days ago
 *   - >90:    billed > 90 days ago
 *
 * Customers whose most recent parent invoice is paid in full are excluded —
 * they owe nothing per the system of record.
 *
 * Sort: whitelisted column → SQL expression.  Default sort is by oldest_days
 * DESC (most overdue first) — kept as the resting state when no sort selected.
 *
 * Age filter: keyed off the customer's single bucket (days since last invoice).
 *   - '30'        → 0–30 day bucket
 *   - '60'        → 31–60 day bucket
 *   - '90_plus'   → 61+ days (61–90 and >90 columns combined)
 */

// Whitelist sort columns to SQL expressions to prevent injection.
// nulls=true → sort NULLS LAST in both directions (never-paid customers stay
// at the bottom when sorting by last_payment_date, etc).
const SORT_MAP = {
   business_name: { expr: 'c.business_name', nulls: true },
   customer_name: { expr: 'c.customer_name', nulls: true },
   display_name: { expr: 'c.display_name', nulls: true },
   bucket_0_30: { expr: 'ca.bucket_0_30', nulls: false },
   bucket_31_60: { expr: 'ca.bucket_31_60', nulls: false },
   bucket_61_90: { expr: 'ca.bucket_61_90', nulls: false },
   bucket_over_90: { expr: 'ca.bucket_over_90', nulls: false },
   total_outstanding: { expr: 'ca.total_outstanding', nulls: false },
   last_payment_date: { expr: 'lp.payment_date', nulls: true },
   has_work_since_last_payment: { expr: 'has_work_since_last_payment', nulls: false },
   oldest_days: { expr: 'ca.oldest_days', nulls: false }
};

const ageFilterFragment = filter => {
   if (filter === '30') return 'AND ca.oldest_days <= 30';
   if (filter === '60') return 'AND ca.oldest_days BETWEEN 31 AND 60';
   if (filter === '90') return 'AND ca.oldest_days BETWEEN 61 AND 90';
   if (filter === 'over_90') return 'AND ca.oldest_days > 90';
   return '';
};

const accountsReceivableService = {
   async getAging(db, accountId, { search = '', limit = 50, offset = 0, filter = null, sort = null, direction = 'desc', excludeIds = [] } = {}) {
      const trimmed = (search || '').trim();
      const hasSearch = trimmed.length > 0;
      const term = hasSearch ? `%${trimmed.toLowerCase()}%` : null;

      // Exclude customers (firm's own entities) — same injection-safe integer
      // inline used by the analytics service, so the year-end packet's AR CSV
      // matches the other three reports.
      const cleanExclude = (excludeIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 2147483647);
      const excludeFragment = cleanExclude.length ? `AND customer_id NOT IN (${cleanExclude.join(',')})` : '';

      const searchSqlFragment = hasSearch
         ? `AND (
            LOWER(c.display_name) LIKE :term
            OR LOWER(c.customer_name) LIKE :term
            OR LOWER(c.business_name) LIKE :term
            OR CAST(c.customer_id AS TEXT) = :rawTerm
         )`
         : '';

      const filterFragment = ageFilterFragment(filter);

      // Build ORDER BY safely.  Default: most overdue first.  Custom sort
      // appends customer_id ASC as a tiebreaker so paging is stable.
      const dir = String(direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const sortConfig = sort && SORT_MAP[sort] ? SORT_MAP[sort] : null;
      const orderClause = sortConfig
         ? sortConfig.nulls
            ? `${sortConfig.expr} ${dir} NULLS LAST, c.customer_id ASC`
            : `${sortConfig.expr} ${dir}, c.customer_id ASC`
         : 'ca.oldest_days DESC NULLS LAST, ca.total_outstanding DESC';

      const dataSql = `
         WITH latest_parent AS (
            SELECT DISTINCT ON (customer_id)
               customer_id,
               invoice_date,
               remaining_balance_on_invoice::numeric AS remaining,
               is_invoice_paid_in_full,
               EXTRACT(DAY FROM (NOW() - invoice_date))::int AS days_old
            FROM customer_invoices
            WHERE account_id = :accountId
              AND parent_invoice_id IS NULL
              ${excludeFragment}
            ORDER BY customer_id, invoice_date DESC, customer_invoice_id DESC
         ),
         customer_aging AS (
            SELECT
               customer_id,
               remaining AS total_outstanding,
               CASE WHEN days_old <= 30 THEN remaining ELSE 0 END AS bucket_0_30,
               CASE WHEN days_old BETWEEN 31 AND 60 THEN remaining ELSE 0 END AS bucket_31_60,
               CASE WHEN days_old BETWEEN 61 AND 90 THEN remaining ELSE 0 END AS bucket_61_90,
               CASE WHEN days_old > 90 THEN remaining ELSE 0 END AS bucket_over_90,
               days_old AS oldest_days,
               invoice_date AS most_recent_invoice_date
            FROM latest_parent
            WHERE is_invoice_paid_in_full = false
              AND remaining > 0
         ),
         last_payment AS (
            SELECT DISTINCT ON (customer_id)
               customer_id,
               payment_date,
               ABS(payment_amount) AS payment_amount
            FROM customer_payments
            WHERE account_id = :accountId
            ORDER BY customer_id, payment_date DESC, payment_id DESC
         )
         SELECT
            c.customer_id,
            c.display_name,
            c.business_name,
            c.customer_name,
            c.is_commercial_customer,
            ca.total_outstanding::numeric AS total_outstanding,
            ca.bucket_0_30::numeric AS bucket_0_30,
            ca.bucket_31_60::numeric AS bucket_31_60,
            ca.bucket_61_90::numeric AS bucket_61_90,
            ca.bucket_over_90::numeric AS bucket_over_90,
            ca.oldest_days,
            ca.most_recent_invoice_date,
            lp.payment_date AS last_payment_date,
            lp.payment_amount AS last_payment_amount,
            EXISTS (
               SELECT 1 FROM customer_transactions ct
               WHERE ct.customer_id = c.customer_id
                 AND ct.account_id = :accountId
                 AND ct.is_transaction_billable = true
                 AND (lp.payment_date IS NULL OR ct.transaction_date > lp.payment_date)
            ) AS has_work_since_last_payment
         FROM customers c
         JOIN customer_aging ca ON ca.customer_id = c.customer_id
         LEFT JOIN last_payment lp ON lp.customer_id = c.customer_id
         WHERE c.account_id = :accountId
           AND c.is_customer_active = true
           ${searchSqlFragment}
           ${filterFragment}
         ORDER BY ${orderClause}
         LIMIT :limit OFFSET :offset
      `;

      const countSql = `
         WITH latest_parent AS (
            SELECT DISTINCT ON (customer_id)
               customer_id,
               is_invoice_paid_in_full,
               remaining_balance_on_invoice::numeric AS remaining,
               EXTRACT(DAY FROM (NOW() - invoice_date))::int AS days_old
            FROM customer_invoices
            WHERE account_id = :accountId
              AND parent_invoice_id IS NULL
              ${excludeFragment}
            ORDER BY customer_id, invoice_date DESC, customer_invoice_id DESC
         ),
         customer_aging AS (
            SELECT customer_id, days_old AS oldest_days
            FROM latest_parent
            WHERE is_invoice_paid_in_full = false
              AND remaining > 0
         )
         SELECT COUNT(*)::int AS count
         FROM customers c
         JOIN customer_aging ca ON ca.customer_id = c.customer_id
         WHERE c.account_id = :accountId
           AND c.is_customer_active = true
           ${searchSqlFragment}
           ${filterFragment}
      `;

      const bindings = { accountId, limit, offset };
      if (hasSearch) {
         bindings.term = term;
         bindings.rawTerm = trimmed;
      }

      const [dataResult, countResult] = await Promise.all([
         db.raw(dataSql, bindings),
         db.raw(countSql, bindings)
      ]);

      const totalCount = Number(countResult.rows[0]?.count || 0);

      const rows = dataResult.rows.map(r => ({
         ...r,
         total_outstanding: Number(r.total_outstanding || 0),
         bucket_0_30: Number(r.bucket_0_30 || 0),
         bucket_31_60: Number(r.bucket_31_60 || 0),
         bucket_61_90: Number(r.bucket_61_90 || 0),
         bucket_over_90: Number(r.bucket_over_90 || 0),
         last_payment_amount: r.last_payment_amount == null ? null : Number(r.last_payment_amount)
      }));

      return { rows, totalCount };
   }
};

module.exports = accountsReceivableService;
