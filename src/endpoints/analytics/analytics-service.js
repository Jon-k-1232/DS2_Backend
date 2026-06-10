/**
 * Billing & time analytics.
 *
 * Built on customer_transactions as the source of truth for performed work:
 *   - transaction_type 'Time': quantity = hours, total_transaction = USD
 *   - other types (Charge, …): fixed-fee amounts; excluded from hourly-rate math
 * Sign/storage conventions per the DS2 schema: writeoffs stored negative
 * (ABS()-ed here), timesheet_entries.duration is minutes.
 *
 * Effective hourly rate = time billings ÷ time hours, per customer per year.
 * That's the number the firm actually realized — independent of book rates.
 */

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => Number(v) || 0;

// Build a SQL "NOT IN (...)" fragment from a list of customer ids to exclude.
// Ids are coerced to integers and non-integers dropped, so the values are safe
// to inline (no injection surface). Empty list → no clause.
const excludeFrag = (excludeIds, column) => {
   const clean = (excludeIds || []).map(Number).filter(Number.isInteger);
   return clean.length ? ` AND ${column} NOT IN (${clean.join(',')})` : '';
};

// Customers the firm filters out of analytics by default — its own related
// entities, whose internal bookkeeping would otherwise swamp client metrics.
// Matched by display-name pattern so new same-family customers are caught too.
const DEFAULT_EXCLUDE_NAME_PATTERNS = ['LTDFH%', 'James F%Kimmel%Associate%', 'Kimmel Financial Partner%', 'Jim Kimmel Insurance Agenc%'];

const median = values => {
   if (!values.length) return null;
   const sorted = [...values].sort((a, b) => a - b);
   const mid = Math.floor(sorted.length / 2);
   return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
};

const analyticsService = {
   /**
    * Per-customer, per-year billing history with firm-wide reference stats.
    * Returns every client that had billable activity in the window — the page
    * itself is the cross-client comparison.
    */
   async getClientRates(db, accountId, { yearsBack = 6, excludeIds = [] } = {}) {
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - Math.max(1, Math.min(yearsBack, 15)) + 1;

      const [{ rows }, { rows: agreementRows }] = await Promise.all([
         db.raw(
            `
            WITH yearly AS (
               SELECT ct.customer_id,
                      EXTRACT(YEAR FROM ct.transaction_date)::int AS year,
                      COALESCE(SUM(ct.quantity) FILTER (WHERE ct.transaction_type = 'Time'), 0) AS hours,
                      COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.transaction_type = 'Time'), 0) AS time_billed,
                      COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.transaction_type <> 'Time'), 0) AS charges_billed,
                      COALESCE(SUM(ct.total_transaction), 0) AS total_billed,
                      -- What the time cost the firm: hours × the employee's cost_rate.
                      COALESCE(SUM(ct.quantity * COALESCE(u.cost_rate, 0)) FILTER (WHERE ct.transaction_type = 'Time'), 0) AS labor_cost,
                      COUNT(*)::int AS entries
               FROM customer_transactions ct
               LEFT JOIN users u ON u.user_id = ct.logged_for_user_id
               WHERE ct.account_id = :accountId
                 AND ct.is_transaction_billable = true
                 AND ct.transaction_date >= make_date(:startYear, 1, 1)${excludeFrag(excludeIds, 'ct.customer_id')}
               GROUP BY 1, 2
            ),
            wo AS (
               SELECT customer_id,
                      EXTRACT(YEAR FROM writeoff_date)::int AS year,
                      SUM(ABS(writeoff_amount)) AS writeoffs
               FROM customer_writeoffs
               WHERE account_id = :accountId
                 AND writeoff_date >= make_date(:startYear, 1, 1)
               GROUP BY 1, 2
            )
            SELECT y.customer_id, y.year, y.hours, y.time_billed, y.charges_billed, y.total_billed, y.labor_cost, y.entries,
                   COALESCE(w.writeoffs, 0) AS writeoffs,
                   c.display_name, c.is_commercial_customer, c.is_customer_active
            FROM yearly y
            LEFT JOIN wo w ON w.customer_id = y.customer_id AND w.year = y.year
            JOIN customers c ON c.customer_id = y.customer_id
            ORDER BY c.display_name, y.year
            `,
            { accountId, startYear }
         ),
         db.raw(
            `SELECT customer_id, agreement_year, agreed_rate, notes
             FROM customer_rate_agreements
             WHERE account_id = :accountId AND agreement_year >= :startYear`,
            { accountId, startYear }
         )
      ]);

      const agreementsByCustomer = new Map();
      agreementRows.forEach(a => {
         if (!agreementsByCustomer.has(a.customer_id)) agreementsByCustomer.set(a.customer_id, {});
         agreementsByCustomer.get(a.customer_id)[a.agreement_year] = { agreed_rate: round2(num(a.agreed_rate)), notes: a.notes };
      });

      const clientsById = new Map();
      const ratesByYear = new Map(); // year -> [{customer_id, rate}]

      rows.forEach(r => {
         if (!clientsById.has(r.customer_id)) {
            clientsById.set(r.customer_id, {
               customer_id: r.customer_id,
               display_name: r.display_name,
               is_commercial: r.is_commercial_customer,
               is_active: r.is_customer_active,
               years: {}
            });
         }
         const hours = round2(num(r.hours));
         const timeBilled = round2(num(r.time_billed));
         const totalBilled = round2(num(r.total_billed));
         const writeoffs = round2(num(r.writeoffs));
         const laborCost = round2(num(r.labor_cost));
         const effectiveRate = hours > 0 ? round2(timeBilled / hours) : null;
         const agreement = agreementsByCustomer.get(r.customer_id)?.[r.year] || null;
         // Margin: what the client paid (net of write-offs) minus what the time
         // cost the firm. Fixed charges count as revenue with no labor cost here.
         const margin = round2(totalBilled - writeoffs - laborCost);

         clientsById.get(r.customer_id).years[r.year] = {
            hours,
            time_billed: timeBilled,
            charges_billed: round2(num(r.charges_billed)),
            total_billed: totalBilled,
            writeoffs,
            realization_pct: totalBilled > 0 ? round2(((totalBilled - writeoffs) / totalBilled) * 100) : null,
            entries: r.entries,
            effective_rate: effectiveRate,
            labor_cost: laborCost,
            margin,
            margin_pct: totalBilled > 0 ? round2((margin / totalBilled) * 100) : null,
            agreed_rate: agreement?.agreed_rate ?? null,
            rate_variance: agreement && effectiveRate !== null ? round2(effectiveRate - agreement.agreed_rate) : null
         };

         // Require a meaningful sample before a client's rate shapes firm stats.
         if (effectiveRate !== null && hours >= 1) {
            if (!ratesByYear.has(r.year)) ratesByYear.set(r.year, []);
            ratesByYear.get(r.year).push({ customer_id: r.customer_id, rate: effectiveRate });
         }
      });

      // Firm-wide stats per year + per-client percentile ranks.
      const firmYears = {};
      ratesByYear.forEach((entries, year) => {
         const rates = entries.map(e => e.rate);
         firmYears[year] = {
            clients: entries.length,
            median_rate: median(rates),
            avg_rate: round2(rates.reduce((a, b) => a + b, 0) / rates.length)
         };
         const sorted = [...rates].sort((a, b) => a - b);
         entries.forEach(({ customer_id, rate }) => {
            const below = sorted.filter(x => x < rate).length;
            const pct = Math.round((below / sorted.length) * 100);
            const yearRow = clientsById.get(customer_id).years[year];
            if (yearRow) yearRow.firm_percentile = pct;
         });
      });

      // Suggested current-year rate: the client's last full-year realized rate
      // grown by the firm's median year-over-year rate growth. Transparent and
      // simple — a starting point for the conversation, not an oracle.
      const lastFullYear = currentYear - 1;
      const priorYear = currentYear - 2;
      const yoyGrowths = [];
      clientsById.forEach(client => {
         const a = client.years[priorYear]?.effective_rate;
         const b = client.years[lastFullYear]?.effective_rate;
         if (a && b && a > 0) yoyGrowths.push((b - a) / a);
      });
      const firmMedianYoY = yoyGrowths.length ? median(yoyGrowths) : 0;

      const clients = [...clientsById.values()].map(client => {
         const lastRate = client.years[lastFullYear]?.effective_rate ?? null;
         const priorRate = client.years[priorYear]?.effective_rate ?? null;
         const currentRate = client.years[currentYear]?.effective_rate ?? null;
         return {
            ...client,
            last_full_year_rate: lastRate,
            current_year_rate: currentRate,
            yoy_pct: lastRate && priorRate ? round2(((lastRate - priorRate) / priorRate) * 100) : null,
            suggested_rate: lastRate ? round2(lastRate * (1 + firmMedianYoY)) : null
         };
      });

      const years = [];
      for (let y = startYear; y <= currentYear; y++) years.push(y);

      return {
         clients,
         years,
         firm: {
            years: firmYears,
            median_yoy_pct: round2(firmMedianYoY * 100),
            last_full_year: lastFullYear,
            suggestion_formula: `last full-year realized rate (${lastFullYear}) × (1 + firm median YoY rate growth ${round2(firmMedianYoY * 100)}%)`
         }
      };
   },

   /**
    * Where the year's time actually went: billable client work vs
    * administrative and everything else, by work description, employee,
    * customer, and month. Includes the raw tracker view (timesheet_entries)
    * so held/unprocessed rows still show up in the end-of-year picture.
    */
   async getTimeAllocation(db, accountId, { year, excludeIds = [] } = {}) {
      const y = Number(year) || new Date().getFullYear();
      const bounds = { accountId, start: `${y}-01-01`, end: `${y}-12-31` };
      const exTxn = excludeFrag(excludeIds, 'customer_id');
      const exCt = excludeFrag(excludeIds, 'ct.customer_id');

      const [summaryRes, byWorkDescRes, byCustomerRes, monthlyRes, trackerRes, yearsRes] = await Promise.all([
         db.raw(
            `
            SELECT COALESCE(SUM(quantity) FILTER (WHERE transaction_type = 'Time'), 0) AS total_hours,
                   COALESCE(SUM(quantity) FILTER (WHERE transaction_type = 'Time' AND is_transaction_billable), 0) AS billable_hours,
                   COALESCE(SUM(quantity) FILTER (WHERE transaction_type = 'Time' AND NOT is_transaction_billable), 0) AS nonbillable_hours,
                   COALESCE(SUM(total_transaction) FILTER (WHERE is_transaction_billable), 0) AS billed_amount,
                   COUNT(*)::int AS entries
            FROM customer_transactions
            WHERE account_id = :accountId AND transaction_date BETWEEN :start AND :end${exTxn}
            `,
            bounds
         ),
         db.raw(
            `
            SELECT gwd.general_work_description AS work_description,
                   COALESCE(SUM(ct.quantity) FILTER (WHERE ct.transaction_type = 'Time'), 0) AS hours,
                   COALESCE(SUM(ct.quantity) FILTER (WHERE ct.transaction_type = 'Time' AND ct.is_transaction_billable), 0) AS billable_hours,
                   COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable), 0) AS billed_amount,
                   COUNT(*)::int AS entries
            FROM customer_transactions ct
            JOIN customer_general_work_descriptions gwd ON gwd.general_work_description_id = ct.general_work_description_id
            WHERE ct.account_id = :accountId AND ct.transaction_date BETWEEN :start AND :end${exCt}
            GROUP BY 1
            ORDER BY hours DESC, billed_amount DESC
            `,
            bounds
         ),
         db.raw(
            `
            SELECT c.display_name AS customer,
                   COALESCE(SUM(ct.quantity) FILTER (WHERE ct.transaction_type = 'Time'), 0) AS hours,
                   COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable), 0) AS billed_amount
            FROM customer_transactions ct
            JOIN customers c ON c.customer_id = ct.customer_id
            WHERE ct.account_id = :accountId AND ct.transaction_date BETWEEN :start AND :end${exCt}
            GROUP BY 1
            ORDER BY hours DESC
            LIMIT 20
            `,
            bounds
         ),
         db.raw(
            `
            SELECT EXTRACT(MONTH FROM transaction_date)::int AS month,
                   COALESCE(SUM(quantity) FILTER (WHERE transaction_type = 'Time' AND is_transaction_billable), 0) AS billable_hours,
                   COALESCE(SUM(quantity) FILTER (WHERE transaction_type = 'Time' AND NOT is_transaction_billable), 0) AS nonbillable_hours,
                   COALESCE(SUM(total_transaction) FILTER (WHERE is_transaction_billable), 0) AS billed_amount
            FROM customer_transactions
            WHERE account_id = :accountId AND transaction_date BETWEEN :start AND :end${exTxn}
            GROUP BY 1
            ORDER BY 1
            `,
            bounds
         ),
         db.raw(
            `
            SELECT COALESCE(NULLIF(TRIM(category), ''), '(uncategorized)') AS category,
                   ROUND(SUM(duration) / 60.0, 2) AS hours,
                   COUNT(*)::int AS entries
            FROM timesheet_entries
            WHERE account_id = :accountId AND date BETWEEN :start AND :end AND is_deleted = false
            GROUP BY 1
            ORDER BY hours DESC
            `,
            bounds
         ),
         db.raw(
            `
            SELECT DISTINCT EXTRACT(YEAR FROM transaction_date)::int AS year
            FROM customer_transactions
            WHERE account_id = :accountId
            ORDER BY year DESC
            `,
            { accountId }
         )
      ]);

      const s = summaryRes.rows[0] || {};
      const totalHours = round2(num(s.total_hours));
      const billableHours = round2(num(s.billable_hours));

      // A handful of transactions carry typo'd future dates (2027–2058 in dev
      // data) — keep them out of the year picker. They remain reachable by
      // querying the year directly, and they're flagged for cleanup.
      const maxSaneYear = new Date().getFullYear() + 1;

      return {
         year: y,
         availableYears: yearsRes.rows.map(r => r.year).filter(yr => yr <= maxSaneYear),
         summary: {
            total_hours: totalHours,
            billable_hours: billableHours,
            nonbillable_hours: round2(num(s.nonbillable_hours)),
            billable_pct: totalHours > 0 ? round2((billableHours / totalHours) * 100) : null,
            billed_amount: round2(num(s.billed_amount)),
            entries: s.entries || 0
         },
         byWorkDescription: byWorkDescRes.rows.map(r => ({
            work_description: r.work_description,
            hours: round2(num(r.hours)),
            billable_hours: round2(num(r.billable_hours)),
            nonbillable_hours: round2(num(r.hours) - num(r.billable_hours)),
            billed_amount: round2(num(r.billed_amount)),
            entries: r.entries
         })),
         byCustomer: byCustomerRes.rows.map(r => ({
            customer: r.customer,
            hours: round2(num(r.hours)),
            billed_amount: round2(num(r.billed_amount))
         })),
         monthly: monthlyRes.rows.map(r => ({
            month: r.month,
            billable_hours: round2(num(r.billable_hours)),
            nonbillable_hours: round2(num(r.nonbillable_hours)),
            billed_amount: round2(num(r.billed_amount))
         })),
         trackerByCategory: trackerRes.rows.map(r => ({
            category: r.category,
            hours: round2(num(r.hours)),
            entries: r.entries
         }))
      };
   },

   /** Record (or update) the agreed rate for a client-year. One row per pair. */
   upsertRateAgreement(db, accountId, { customerId, year, agreedRate, notes, userId }) {
      return db.raw(
         `
         INSERT INTO customer_rate_agreements (account_id, customer_id, agreement_year, agreed_rate, notes, created_by_user_id)
         VALUES (:accountId, :customerId, :year, :agreedRate, :notes, :userId)
         ON CONFLICT (account_id, customer_id, agreement_year)
         DO UPDATE SET agreed_rate = EXCLUDED.agreed_rate, notes = EXCLUDED.notes
         RETURNING *
         `,
         { accountId, customerId, year, agreedRate, notes: notes || null, userId }
      ).then(r => r.rows[0]);
   },

   /**
    * Work performed but never billed, aged from the transaction date. The
    * billing engine bills every unbilled transaction regardless of age (the
    * Wild West fix), so anything old here is money waiting on a billing run —
    * or a candidate for write-off.
    */
   async getWipAging(db, accountId, { excludeIds = [] } = {}) {
      const { rows } = await db.raw(
         `
         SELECT c.customer_id, c.display_name, c.is_customer_active,
                COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable), 0) AS unbilled_amount,
                COALESCE(SUM(ct.quantity) FILTER (WHERE ct.transaction_type = 'Time' AND ct.is_transaction_billable), 0) AS unbilled_hours,
                COUNT(*) FILTER (WHERE ct.is_transaction_billable)::int AS entries,
                MIN(ct.transaction_date) FILTER (WHERE ct.is_transaction_billable) AS oldest_date,
                COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable AND ct.transaction_date >= CURRENT_DATE - 30), 0) AS bucket_0_30,
                COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable AND ct.transaction_date < CURRENT_DATE - 30 AND ct.transaction_date >= CURRENT_DATE - 60), 0) AS bucket_31_60,
                COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable AND ct.transaction_date < CURRENT_DATE - 60 AND ct.transaction_date >= CURRENT_DATE - 90), 0) AS bucket_61_90,
                COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable AND ct.transaction_date < CURRENT_DATE - 90), 0) AS bucket_over_90
         FROM customer_transactions ct
         JOIN customers c ON c.customer_id = ct.customer_id
         WHERE ct.account_id = :accountId
           AND ct.customer_invoice_id IS NULL${excludeFrag(excludeIds, 'ct.customer_id')}
         GROUP BY c.customer_id, c.display_name, c.is_customer_active
         HAVING COALESCE(SUM(ct.total_transaction) FILTER (WHERE ct.is_transaction_billable), 0) > 0
         ORDER BY oldest_date ASC
         `,
         { accountId }
      );
      return rows.map(r => ({
         customer_id: r.customer_id,
         display_name: r.display_name,
         is_active: r.is_customer_active,
         unbilled_amount: round2(num(r.unbilled_amount)),
         unbilled_hours: round2(num(r.unbilled_hours)),
         entries: r.entries,
         oldest_date: r.oldest_date,
         days_old: r.oldest_date ? Math.floor((Date.now() - new Date(r.oldest_date).getTime()) / 86400000) : null,
         bucket_0_30: round2(num(r.bucket_0_30)),
         bucket_31_60: round2(num(r.bucket_31_60)),
         bucket_61_90: round2(num(r.bucket_61_90)),
         bucket_over_90: round2(num(r.bucket_over_90))
      }));
   },

   /**
    * Budget vs actual per parent job. Actual = the latest child's running
    * total (rolling-job pattern) or the parent's own when no children exist.
    */
   async getJobBudgets(db, accountId, { excludeIds = [] } = {}) {
      const { rows } = await db.raw(
         `
         SELECT cj.customer_job_id, cj.agreed_job_amount, cj.is_job_complete,
                c.customer_id, c.display_name AS customer_name,
                cjt.job_description,
                COALESCE(latest_child.current_job_total, cj.current_job_total, 0) AS actual_total
         FROM customer_jobs cj
         JOIN customers c ON c.customer_id = cj.customer_id
         LEFT JOIN customer_job_types cjt ON cjt.job_type_id = cj.job_type_id
         LEFT JOIN LATERAL (
            SELECT current_job_total
            FROM customer_jobs child
            WHERE child.parent_job_id = cj.customer_job_id
            ORDER BY child.customer_job_id DESC
            LIMIT 1
         ) latest_child ON true
         WHERE cj.account_id = :accountId
           AND cj.parent_job_id IS NULL
           AND cj.agreed_job_amount IS NOT NULL
           AND cj.agreed_job_amount > 0${excludeFrag(excludeIds, 'c.customer_id')}
         ORDER BY c.display_name, cjt.job_description
         `,
         { accountId }
      );
      return rows.map(r => {
         const budget = round2(num(r.agreed_job_amount));
         const actual = round2(num(r.actual_total));
         return {
            customer_job_id: r.customer_job_id,
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            job_description: r.job_description,
            budget,
            actual,
            consumed_pct: budget > 0 ? round2((actual / budget) * 100) : null,
            remaining: round2(budget - actual),
            is_complete: !!r.is_job_complete
         };
      });
   },

   /**
    * Tax-season staffing view: hours per employee per ISO week for Jan 1 –
    * Apr 15 of the requested year and the prior year, side by side.
    */
   async getTaxSeasonCapacity(db, accountId, { year, excludeIds = [] } = {}) {
      const y = Number(year) || new Date().getFullYear();
      const exCt = excludeFrag(excludeIds, 'ct.customer_id');
      const seasonFor = async seasonYear => {
         const { rows } = await db.raw(
            `
            SELECT u.display_name AS employee,
                   EXTRACT(WEEK FROM ct.transaction_date)::int AS week,
                   COALESCE(SUM(ct.quantity) FILTER (WHERE ct.transaction_type = 'Time'), 0) AS hours
            FROM customer_transactions ct
            JOIN users u ON u.user_id = ct.logged_for_user_id
            WHERE ct.account_id = :accountId
              AND ct.transaction_date BETWEEN make_date(:seasonYear, 1, 1) AND make_date(:seasonYear, 4, 15)${exCt}
            GROUP BY 1, 2
            ORDER BY 1, 2
            `,
            { accountId, seasonYear }
         );
         return rows.map(r => ({ employee: r.employee, week: r.week, hours: round2(num(r.hours)) }));
      };
      const [current, prior] = await Promise.all([seasonFor(y), seasonFor(y - 1)]);
      return { year: y, current, prior };
   },

   /**
    * The customer list for the analytics exclude filter, plus the ids excluded
    * by default (the firm's own related entities, matched by name pattern).
    */
   async getExcludableCustomers(db, accountId) {
      const likeClauses = DEFAULT_EXCLUDE_NAME_PATTERNS.map((_, i) => `display_name ILIKE :p${i}`).join(' OR ');
      const patternBindings = DEFAULT_EXCLUDE_NAME_PATTERNS.reduce((acc, p, i) => ({ ...acc, [`p${i}`]: p }), {});

      const [{ rows: customers }, { rows: defaults }] = await Promise.all([
         // Active customers plus any default-excluded entity (which may be
         // inactive) — so every pre-selected default is a valid picker option.
         db.raw(
            `SELECT customer_id, display_name FROM customers
             WHERE account_id = :accountId AND (is_customer_active = true OR ${likeClauses})
             ORDER BY display_name`,
            { accountId, ...patternBindings }
         ),
         db.raw(`SELECT customer_id FROM customers WHERE account_id = :accountId AND (${likeClauses})`, { accountId, ...patternBindings })
      ]);

      return {
         customers: customers.map(c => ({ customer_id: c.customer_id, display_name: c.display_name })),
         defaultExcludedIds: defaults.map(r => r.customer_id)
      };
   }
};

module.exports = analyticsService;
