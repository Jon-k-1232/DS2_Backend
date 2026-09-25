/**
 * Accounts Receivable aging.
 *
 * Rolling-balance view: each customer's outstanding = the latest-snapshot
 * remaining of EVERY parent chain dated on their newest statement date,
 * summed (each chain clamped at $0).  That is exactly the Create Invoice
 * engine's outstandingInvoiceTotal and the Account Audit's
 * outstanding_invoices, so all three views agree on what each customer owes:
 *   - latest snapshot, not the parent row: payments / write-offs insert child
 *     snapshots and only MIRROR remaining onto the parent, so a stale mirror
 *     must not decide the balance (the audit reports it as stale_parent_remaining);
 *     a chain with no snapshots falls back to the parent row;
 *   - all newest-date parents, not DISTINCT ON one: legacy same-day duplicate
 *     statements are summed as one statement by the engine and the audit.
 * Older parent invoices whose balance was absorbed via beginning_balance on a
 * newer invoice are NOT counted.
 *
 * AGE / BUCKETS = STATEMENT AGE: days since the newest statement date
 * (`statement_date`, also returned as `most_recent_invoice_date`):
 *   - 0–30:   billed within last 30 days
 *   - 31–60:  billed 31–60 days ago
 *   - 61–90:  billed 61–90 days ago
 *   - >90:    billed > 90 days ago
 * On balance-forward statements that is NOT the age of the debt — a customer
 * who has not paid for six months still gets a fresh statement every month.
 * `oldest_open_charge_date` / `oldest_open_charge_days` give the real receivable
 * age (best effort): the oldest billed charge still unpaid when credits are
 * applied oldest-first (FIFO, the balance-forward convention) — i.e. walking the
 * customer's billed billable charges newest-first, the charge at which they
 * cover the outstanding balance.  If the billed charges on file do not cover the
 * balance (opening balances, pre-DS2 history) it is the oldest charge on file,
 * a lower bound on the true age; NULL when no billed charge exists.
 *
 * Customers whose current statement(s) carry no positive remaining are
 * excluded — they owe nothing per the system of record.  Inactive customers
 * who still owe money ARE included (flagged by `is_customer_active`).
 *
 * Sort: whitelisted column → SQL expression.  Default sort is by oldest_days
 * DESC (most overdue first) — kept as the resting state when no sort selected.
 *
 * Age filter: keyed off the customer's statement-age bucket.
 *   - '30'        → 0–30 day bucket
 *   - '60'        → 31–60 day bucket
 *   - '90'        → 61–90 day bucket
 *   - 'over_90'   → >90 day bucket
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
   oldest_days: { expr: 'ca.oldest_days', nulls: false },
   statement_date: { expr: 'ca.statement_date', nulls: false },
   oldest_open_charge_date: { expr: 'oo.oldest_open_charge_date', nulls: true },
   is_customer_active: { expr: 'c.is_customer_active', nulls: false }
};

const ageFilterFragment = filter => {
   if (filter === '30') return 'AND ca.oldest_days <= 30';
   if (filter === '60') return 'AND ca.oldest_days BETWEEN 31 AND 60';
   if (filter === '90') return 'AND ca.oldest_days BETWEEN 61 AND 90';
   if (filter === 'over_90') return 'AND ca.oldest_days > 90';
   return '';
};

/**
 * CTEs shared by the data and count queries: one row per customer that owes
 * money on their current statement(s), with the statement-age buckets.
 */
const customerAgingCtes = excludeFragment => `
         current_chains AS (
            -- Every parent dated on the customer's newest statement date, with
            -- the chain's LATEST snapshot remaining (parent row when no snapshots).
            SELECT sp.customer_id,
                   sp.statement_date,
                   COALESCE(latest_child.remaining_balance_on_invoice, sp.remaining_balance_on_invoice)::numeric AS remaining
            FROM (
               SELECT ci.customer_id,
                      ci.customer_invoice_id,
                      ci.invoice_date,
                      ci.remaining_balance_on_invoice,
                      MAX(ci.invoice_date) OVER (PARTITION BY ci.customer_id) AS statement_date
               FROM customer_invoices ci
               WHERE ci.account_id = :accountId
                 AND ci.parent_invoice_id IS NULL
                 ${excludeFragment}
            ) sp
            LEFT JOIN LATERAL (
               SELECT ch.remaining_balance_on_invoice
               FROM customer_invoices ch
               WHERE ch.account_id = :accountId
                 AND ch.parent_invoice_id = sp.customer_invoice_id
               ORDER BY ch.created_at DESC, ch.customer_invoice_id DESC
               LIMIT 1
            ) latest_child ON true
            WHERE sp.invoice_date = sp.statement_date
         ),
         customer_balance AS (
            SELECT customer_id,
                   statement_date,
                   SUM(remaining) AS total_outstanding,
                   COUNT(*)::int AS statement_count,
                   EXTRACT(DAY FROM (NOW() - statement_date))::int AS days_old
            FROM current_chains
            GROUP BY customer_id, statement_date
            HAVING SUM(remaining) <> 0
         ),
         customer_aging AS (
            SELECT
               customer_id,
               total_outstanding,
               CASE WHEN days_old <= 30 THEN total_outstanding ELSE 0 END AS bucket_0_30,
               CASE WHEN days_old BETWEEN 31 AND 60 THEN total_outstanding ELSE 0 END AS bucket_31_60,
               CASE WHEN days_old BETWEEN 61 AND 90 THEN total_outstanding ELSE 0 END AS bucket_61_90,
               CASE WHEN days_old > 90 THEN total_outstanding ELSE 0 END AS bucket_over_90,
               days_old AS oldest_days,
               statement_date,
               statement_count
            FROM customer_balance
         )`;

const accountsReceivableService = {
   async getAging(db, accountId, { search = '', limit = 50, offset = 0, filter = null, sort = null, direction = 'desc', excludeIds = [] } = {}) {
      const trimmed = (search || '').trim();
      const hasSearch = trimmed.length > 0;
      const term = hasSearch ? `%${trimmed.toLowerCase()}%` : null;

      // Exclude customers (firm's own entities) — same injection-safe integer
      // inline used by the analytics service, so the year-end packet's AR CSV
      // matches the other three reports.
      const cleanExclude = (excludeIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 2147483647);
      const excludeFragment = cleanExclude.length ? `AND ci.customer_id NOT IN (${cleanExclude.join(',')})` : '';

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
         : 'ca.oldest_days DESC NULLS LAST, ca.total_outstanding DESC, c.customer_id ASC';

      const dataSql = `
         WITH ${customerAgingCtes(excludeFragment)},
         billed_charges AS (
            -- Billed billable charges, newest first, with the running total of
            -- this charge and every newer one (FIFO walk for the real age).
            SELECT ct.customer_id,
                   ct.transaction_date,
                   ct.total_transaction::numeric AS amount,
                   SUM(ct.total_transaction::numeric) OVER (
                      PARTITION BY ct.customer_id
                      ORDER BY ct.transaction_date DESC, ct.transaction_id DESC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) AS this_and_newer
            FROM customer_transactions ct
            JOIN customer_aging ca0 ON ca0.customer_id = ct.customer_id
            WHERE ct.account_id = :accountId
              AND ct.customer_invoice_id IS NOT NULL
              AND ct.is_transaction_billable = true
              AND ct.total_transaction > 0
         ),
         oldest_open AS (
            -- A charge is still (partly) unpaid under FIFO when the charges
            -- newer than it do not yet cover the outstanding balance.
            SELECT bc.customer_id, MIN(bc.transaction_date) AS oldest_open_charge_date
            FROM billed_charges bc
            JOIN customer_aging ca1 ON ca1.customer_id = bc.customer_id
            WHERE bc.this_and_newer - bc.amount < ca1.total_outstanding
            GROUP BY bc.customer_id
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
            c.is_customer_active,
            ca.total_outstanding::numeric AS total_outstanding,
            ca.bucket_0_30::numeric AS bucket_0_30,
            ca.bucket_31_60::numeric AS bucket_31_60,
            ca.bucket_61_90::numeric AS bucket_61_90,
            ca.bucket_over_90::numeric AS bucket_over_90,
            ca.oldest_days,
            ca.statement_date AS most_recent_invoice_date,
            ca.statement_date,
            ca.statement_count,
            oo.oldest_open_charge_date,
            CASE WHEN oo.oldest_open_charge_date IS NULL THEN NULL
                 ELSE EXTRACT(DAY FROM (NOW() - oo.oldest_open_charge_date))::int
            END AS oldest_open_charge_days,
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
         LEFT JOIN oldest_open oo ON oo.customer_id = c.customer_id
         LEFT JOIN last_payment lp ON lp.customer_id = c.customer_id
         WHERE c.account_id = :accountId
           ${searchSqlFragment}
           ${filterFragment}
         ORDER BY ${orderClause}
         LIMIT :limit OFFSET :offset
      `;

      const countSql = `
         WITH ${customerAgingCtes(excludeFragment)}
         SELECT COUNT(*)::int AS count
         FROM customers c
         JOIN customer_aging ca ON ca.customer_id = c.customer_id
         WHERE c.account_id = :accountId
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
         statement_count: Number(r.statement_count || 0),
         last_payment_amount: r.last_payment_amount == null ? null : Number(r.last_payment_amount)
      }));

      return { rows, totalCount };
   }
};

module.exports = accountsReceivableService;
