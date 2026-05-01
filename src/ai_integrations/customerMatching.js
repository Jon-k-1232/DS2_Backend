const { scoreCandidates, normalize } = require('../utils/fuzzyMatch');
const { invokeBedrockClaude } = require('./bedrock');

const MATCH_THRESHOLD = Number(process.env.CUSTOMER_MATCH_THRESHOLD || 0.62);
const LLM_SKIP_THRESHOLD = Number(process.env.CUSTOMER_LLM_SKIP_THRESHOLD || 0.90);
const SONNET_MODEL = process.env.BEDROCK_MODEL_TIMETRACKER || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

const _exactMatch = (target, customers) => {
   const normalized = normalize(target).toLowerCase();
   if (!normalized) return null;
   for (const c of customers) {
      if (!c) continue;
      const display = normalize(c.display_name || '').toLowerCase();
      if (display && display === normalized) return c;
   }
   return null;
};

const _buildLlmPrompt = ({ searchName, candidates }) => {
   const list = candidates
      .map((c, i) => `${i + 1}. id=${c.id} "${c.label}" (fuzzy_score=${c.score.toFixed(2)})`)
      .join('\n');
   return {
      system:
         'You match a free-text customer name from a timesheet to one of the candidate customer records. ' +
         'Rules: ' +
         '(a) prefer exact-spelling matches; ' +
         '(b) accept last-name-first format ("Smith, John" matches "John Smith"); ' +
         '(c) accept ALL CAPS variants and abbreviations (LLC/INC/CORP/PLLC); ' +
         '(d) if multiple candidates share a last name and the search has only a last name, return null (insufficient signal); ' +
         '(e) if no candidate is clearly correct, return null. ' +
         'Output ONLY a JSON object with this schema: { "match_id": number | null, "match_confidence": number, "reason": string }. ' +
         'No prose outside the JSON object.',
      user:
         `Search name: "${searchName}"\nCandidates:\n${list}\n\nReturn the JSON object now.`
   };
};

const matchCustomer = async ({
   searchName,
   customerCatalog,
   accountId,
   userId = null,
   timesheetEntryId = null,
   db = null,
   bedrockInvoker = invokeBedrockClaude,
   matchThreshold = MATCH_THRESHOLD,
   llmSkipThreshold = LLM_SKIP_THRESHOLD
}) => {
   const trimmed = (searchName || '').toString().trim();
   if (!trimmed) {
      return { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'empty_search' };
   }

   const exact = _exactMatch(trimmed, customerCatalog);
   if (exact) {
      return {
         customerId: exact.customer_id,
         displayName: exact.display_name,
         score: 1.0,
         tier: 'exact',
         candidates: [{ id: exact.customer_id, label: exact.display_name, score: 1.0 }],
         reason: 'exact_display_name'
      };
   }

   const fuzzyCandidates = scoreCandidates(
      trimmed,
      customerCatalog.map(c => ({ id: c.customer_id, label: c.display_name })),
      { limit: 5, scoreCutoff: Math.round(matchThreshold * 100) }
   );

   if (!fuzzyCandidates.length) {
      return { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'no_candidates' };
   }

   const top = fuzzyCandidates[0];
   if (top.score >= llmSkipThreshold) {
      return {
         customerId: top.id,
         displayName: top.label,
         score: top.score,
         tier: 'fuzzy_high',
         candidates: fuzzyCandidates,
         reason: 'high_confidence_fuzzy'
      };
   }

   const { system, user } = _buildLlmPrompt({ searchName: trimmed, candidates: fuzzyCandidates });
   try {
      const result = await bedrockInvoker({
         modelId: SONNET_MODEL,
         system,
         messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
         maxTokens: 200,
         accountId,
         userId,
         timesheetEntryId,
         feature: 'customer_match',
         db
      });
      const json = result && result.json;
      if (!json || json.match_id == null) {
         return {
            customerId: null,
            displayName: null,
            score: top.score,
            tier: 'llm_no_match',
            candidates: fuzzyCandidates,
            reason: (json && json.reason) || 'llm_returned_null'
         };
      }
      const picked = customerCatalog.find(c => c.customer_id === json.match_id) ||
         fuzzyCandidates.find(c => c.id === json.match_id);
      if (!picked) {
         return {
            customerId: null,
            displayName: null,
            score: top.score,
            tier: 'llm_invalid_id',
            candidates: fuzzyCandidates,
            reason: 'llm_returned_unknown_id'
         };
      }
      return {
         customerId: picked.customer_id || picked.id,
         displayName: picked.display_name || picked.label,
         score: typeof json.match_confidence === 'number' ? json.match_confidence : top.score,
         tier: 'llm_tiebreak',
         candidates: fuzzyCandidates,
         reason: json.reason || 'llm_picked'
      };
   } catch (err) {
      return {
         customerId: null,
         displayName: null,
         score: top.score,
         tier: 'llm_error',
         candidates: fuzzyCandidates,
         reason: `bedrock_error: ${err.message}`
      };
   }
};

module.exports = { matchCustomer, MATCH_THRESHOLD, LLM_SKIP_THRESHOLD, _exactMatch };
