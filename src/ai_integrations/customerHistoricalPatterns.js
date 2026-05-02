// Per-customer historical signal pulled from customer_transactions to give
// the AI guardrails and to feed a deterministic post-AI job assignment.
//
// Why this exists: notes alone are not always enough to pick the right
// general_work_description / customer_job. But each customer has a long
// history of (work_desc, job) pairings that captures how their work is
// actually billed. For high-volume customers (JKA, KFP) this signal is
// dramatically stronger than the AI's best guess.
//
// IMPORTANT: detailed_work_description is the real notes column on
// customer_transactions. The `note` column is empty legacy.

const FEW_SHOT_LIMIT = Number(process.env.CUSTOMER_FEWSHOT_LIMIT || 8);
const HISTORICAL_LOOKBACK_DAYS = Number(process.env.CUSTOMER_HISTORY_LOOKBACK_DAYS || 365);
const MIN_DETERMINISTIC_COUNT = Number(process.env.MIN_DETERMINISTIC_JOB_COUNT || 5);

const _isRealText = s => typeof s === 'string' && s.trim().length > 0 && s.trim().toLowerCase() !== 'undefined';

const _loadParentJobs = async (db, accountId, customerId) => {
   const rows = await db('customer_jobs as cj')
      .leftJoin('customer_job_types as cjt', 'cjt.job_type_id', 'cj.job_type_id')
      .where({ 'cj.account_id': accountId, 'cj.customer_id': customerId, 'cj.is_job_complete': false })
      .whereNull('cj.parent_job_id')
      .select('cj.customer_job_id', 'cj.job_type_id', 'cjt.job_description');
   return rows.map(r => ({
      customer_job_id: r.customer_job_id,
      job_type_id: r.job_type_id,
      job_description: r.job_description || null
   }));
};

// For each (work_desc_id), find the customer_job_id that's been paired with
// it most often historically. Returns a map keyed by work_desc_id with the
// top job and its count. Counts give us a confidence proxy.
const _loadWorkDescToJobMap = async (db, accountId, customerId) => {
   const rows = await db('customer_transactions')
      .where({ account_id: accountId, customer_id: customerId })
      .whereNotNull('general_work_description_id')
      .whereNotNull('customer_job_id')
      .groupBy('general_work_description_id', 'customer_job_id')
      .select('general_work_description_id', 'customer_job_id')
      .count({ n: '*' });

   const top = new Map();
   for (const r of rows) {
      const wdId = r.general_work_description_id;
      const n = Number(r.n);
      const cur = top.get(wdId);
      if (!cur || n > cur.count) {
         top.set(wdId, { customer_job_id: r.customer_job_id, count: n });
      }
   }
   return top;
};

// For each (work_desc_id), historical billable counts. Used to decide
// is_transaction_billable on auto-insert when the regex-based admin pattern
// doesn't match. e.g. retainer clients where every Tax Return Preparation
// row is historically non-billable (covered by retainer flat-fee).
const _loadWorkDescToBillableMap = async (db, accountId, customerId) => {
   const rows = await db('customer_transactions')
      .where({ account_id: accountId, customer_id: customerId })
      .whereNotNull('general_work_description_id')
      .groupBy('general_work_description_id', 'is_transaction_billable')
      .select('general_work_description_id', 'is_transaction_billable')
      .count({ n: '*' });

   const map = new Map();
   for (const r of rows) {
      const wdId = r.general_work_description_id;
      const cur = map.get(wdId) || { billable: 0, nonBillable: 0 };
      if (r.is_transaction_billable === false) cur.nonBillable += Number(r.n);
      else cur.billable += Number(r.n);
      map.set(wdId, cur);
   }
   return map;
};

// Pull the most recent N (detailed_work_description, work_desc) examples for
// this customer. These get injected as customer-scoped few-shots in the AI
// prompt to bias the AI toward this customer's actual patterns.
const _loadCustomerFewShots = async (db, accountId, customerId, gwdMap) => {
   const cutoff = new Date();
   cutoff.setUTCDate(cutoff.getUTCDate() - HISTORICAL_LOOKBACK_DAYS);
   const rows = await db('customer_transactions as t')
      .leftJoin('customer_general_work_descriptions as g', 'g.general_work_description_id', 't.general_work_description_id')
      .where('t.account_id', accountId)
      .where('t.customer_id', customerId)
      .whereNotNull('t.general_work_description_id')
      .where('t.transaction_date', '>=', cutoff.toISOString().slice(0, 10))
      .whereNotNull('t.detailed_work_description')
      .where('t.detailed_work_description', '<>', '')
      .where('t.detailed_work_description', '<>', 'undefined')
      .select('t.detailed_work_description', 'g.general_work_description as work_desc_label', 't.general_work_description_id', 't.transaction_date')
      .orderBy('t.transaction_date', 'desc')
      .limit(FEW_SHOT_LIMIT * 4); // overfetch so we can dedupe

   // Dedupe by (work_desc_id) so the AI sees variety, not 8 copies of "Administrative"
   const seen = new Set();
   const out = [];
   for (const r of rows) {
      if (!_isRealText(r.detailed_work_description)) continue;
      const key = r.general_work_description_id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
         dwd: r.detailed_work_description.slice(0, 200),
         work_desc_label: r.work_desc_label
      });
      if (out.length >= FEW_SHOT_LIMIT) break;
   }
   return out;
};

const loadCustomerHistoricalPatterns = async (db, accountId, customerId, { gwdMap = null } = {}) => {
   if (!customerId) return null;
   const [parentJobs, workDescToJobMap, workDescToBillableMap, fewShots] = await Promise.all([
      _loadParentJobs(db, accountId, customerId),
      _loadWorkDescToJobMap(db, accountId, customerId),
      _loadWorkDescToBillableMap(db, accountId, customerId),
      _loadCustomerFewShots(db, accountId, customerId, gwdMap)
   ]);
   return { parentJobs, workDescToJobMap, workDescToBillableMap, fewShots };
};

// Pick the customer_job_id for a given (customer, work_desc) using historical
// pairings. Returns { customer_job_id, count, source } or null. Caller decides
// whether to fall back to other heuristics if this returns null.
const pickJobFromHistory = (patterns, workDescId, { minCount = MIN_DETERMINISTIC_COUNT } = {}) => {
   if (!patterns || !workDescId) return null;
   const hit = patterns.workDescToJobMap.get(Number(workDescId));
   if (!hit) return null;
   if (hit.count < minCount) return { ...hit, source: 'history_low_confidence' };
   const stillValid = patterns.parentJobs.some(pj => pj.customer_job_id === hit.customer_job_id);
   if (!stillValid) return null;
   return { ...hit, source: 'history' };
};

// Decide is_transaction_billable from historical (customer, work_desc) pattern.
// Returns:
//   true  — historically billable (>= BILLABLE_RATE_HIGH and >= MIN_SAMPLE)
//   false — historically non-billable (>= NONBILLABLE_RATE_HIGH and >= MIN_SAMPLE)
//   null  — insufficient signal; caller should fall back to other heuristics
const NONBILLABLE_RATE_THRESHOLD = 0.7;
const BILLABLE_RATE_THRESHOLD = 0.7; // applies to billable rate (= 1 - nonBillableRate)
const MIN_BILLABLE_SAMPLE = 5;

const pickBillableFromHistory = (patterns, workDescId, { minSample = MIN_BILLABLE_SAMPLE } = {}) => {
   if (!patterns || !patterns.workDescToBillableMap || !workDescId) return null;
   const hit = patterns.workDescToBillableMap.get(Number(workDescId));
   if (!hit) return null;
   const total = hit.billable + hit.nonBillable;
   if (total < minSample) return null;
   const nbRate = hit.nonBillable / total;
   if (nbRate >= NONBILLABLE_RATE_THRESHOLD) return false;
   if (nbRate <= 1 - BILLABLE_RATE_THRESHOLD) return true;
   return null; // mixed
};

module.exports = {
   loadCustomerHistoricalPatterns,
   pickJobFromHistory,
   pickBillableFromHistory,
   FEW_SHOT_LIMIT,
   HISTORICAL_LOOKBACK_DAYS,
   MIN_DETERMINISTIC_COUNT,
   MIN_BILLABLE_SAMPLE
};
