const { scoreCandidates, normalize, canonicalNameKey, sharedNameTokenCount, conflictingLegalForms } = require('../utils/fuzzyMatch');
const { invokeBedrockClaude } = require('./bedrock');

const MATCH_THRESHOLD = Number(process.env.CUSTOMER_MATCH_THRESHOLD || 0.62);
const LLM_SKIP_THRESHOLD = Number(process.env.CUSTOMER_LLM_SKIP_THRESHOLD || 0.90);
// A fuzzy auto-match must beat the runner-up by this much...
const MIN_AUTO_MARGIN = Number(process.env.CUSTOMER_MATCH_MIN_MARGIN || 0.08);
// ...AND agree with the searched name on at least this many identifying name
// tokens (legal suffixes / "and" don't count). WRatio scores ANY two names that
// share one token at ~0.95 ("Wallace Illsley" vs "Donald Illsley", "Smith" vs
// "Smith, Jane"), so a score on its own is not a safe auto-bill signal.
const MIN_SHARED_NAME_TOKENS = Number(process.env.CUSTOMER_MATCH_MIN_SHARED_TOKENS || 2);
const SONNET_MODEL = process.env.BEDROCK_MODEL_TIMETRACKER || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

// Returned when a name resolves to more than one plausible customer, or to a
// candidate that doesn't clear the auto-match guard. customerId is ALWAYS null
// on this tier so nothing downstream can bill it; the orchestrator holds the
// entry (hold_reason ambiguous_customer_match) and keeps the candidate IDs.
const NEEDS_REVIEW_TIER = 'needs_review';

const _normalizedDisplay = value => normalize(value || '').toLowerCase();

const _exactMatches = (target, customers) => {
   const normalized = _normalizedDisplay(target);
   if (!normalized) return [];
   return (customers || []).filter(c => c && _normalizedDisplay(c.display_name) === normalized);
};

// Back-compat helper: the unique exact display-name match, or null.
const _exactMatch = (target, customers) => {
   const matches = _exactMatches(target, customers);
   return matches.length === 1 ? matches[0] : null;
};

const _canonicalMatches = (target, customers) => {
   const key = canonicalNameKey(target);
   if (!key) return [];
   // canonicalNameKey() drops legal suffixes entirely (so a bare name still
   // canonically matches ANY legal form of itself), which used to let 'Acme
   // LLC' canonically match a catalog's 'Acme Inc' at tier=exact/score=1 with
   // no review and no margin/token safeguards. A name that explicitly names a
   // DIFFERENT legal form than the candidate must never be treated as the same
   // canonical spelling of one entity — exclude it here so it falls through to
   // fuzzy scoring (and from there to needs_review via _hasNameAgreement below).
   return (customers || []).filter(c => c && canonicalNameKey(c.display_name) === key && !conflictingLegalForms(target, c.display_name));
};

const _hasNameAgreement = (searchName, candidateLabel) => {
   // Explicit, conflicting legal forms (Inc vs LLC) are never "the same name"
   // for billing purposes, even when they share every other name token or
   // canonicalize identically once suffixes are stripped. Same-form spelling
   // variants (Corp/Corporation) and a bare name with no legal form at all are
   // unaffected — see LEGAL_SUFFIX_CANON / conflictingLegalForms.
   if (conflictingLegalForms(searchName, candidateLabel)) return false;
   if (sharedNameTokenCount(searchName, candidateLabel) >= MIN_SHARED_NAME_TOKENS) return true;
   const key = canonicalNameKey(searchName);
   return key !== '' && key === canonicalNameKey(candidateLabel);
};

const _asCandidate = (customer, score) => ({ id: customer.customer_id, label: customer.display_name, score });

const _needsReview = ({ reason, candidates = [], score = 0 }) => ({
   customerId: null,
   displayName: null,
   score,
   tier: NEEDS_REVIEW_TIER,
   candidates,
   reason
});

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

/**
 * Resolve a tracker's free-text customer name to a customer.
 *
 * Tiers (first hit wins):
 *   exact          unique case/whitespace-insensitive display_name match
 *   exact          unique canonical match (order / punctuation / legal-suffix
 *                  insensitive: "Smith, John" == "John Smith",
 *                  "Acme Corporation" == "Acme Corp") — reason canonical_name_match
 *   confirmed_alias  reviewers have repeatedly (and only ever) billed this exact
 *                  search name to one customer, that customer is among the
 *                  near-tied fuzzy leaders, and it shares >= 2 name tokens
 *   fuzzy_high     WRatio >= llmSkipThreshold AND beats the runner-up by
 *                  >= MIN_AUTO_MARGIN AND shares >= MIN_SHARED_NAME_TOKENS tokens
 *   llm_tiebreak   fuzzy top < llmSkipThreshold; Bedrock picked a candidate that
 *                  shares >= MIN_SHARED_NAME_TOKENS tokens with the search
 *   needs_review   anything ambiguous (duplicates, ties, single shared token,
 *                  LLM pick that fails the token rule) — customerId null => HELD
 *
 * `reason` is always a fixed code. The LLM's free-text reason is intentionally
 * NOT returned: it routinely echoes customer names and the match result is
 * persisted into ai_payload, which must stay PII-free.
 *
 * @param {Map<string, number>} [confirmedAliases] canonicalNameKey(searchName) -> customer_id
 */
const matchCustomer = async ({
   searchName,
   customerCatalog,
   accountId,
   userId = null,
   timesheetEntryId = null,
   db = null,
   bedrockInvoker = invokeBedrockClaude,
   matchThreshold = MATCH_THRESHOLD,
   llmSkipThreshold = LLM_SKIP_THRESHOLD,
   minMargin = MIN_AUTO_MARGIN,
   confirmedAliases = null
}) => {
   const trimmed = (searchName || '').toString().trim();
   if (!trimmed) {
      return { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'empty_search' };
   }
   const catalog = Array.isArray(customerCatalog) ? customerCatalog : [];

   const exactMatches = _exactMatches(trimmed, catalog);
   if (exactMatches.length === 1) {
      const exact = exactMatches[0];
      return {
         customerId: exact.customer_id,
         displayName: exact.display_name,
         score: 1.0,
         tier: 'exact',
         candidates: [_asCandidate(exact, 1.0)],
         reason: 'exact_display_name'
      };
   }
   if (exactMatches.length > 1) {
      return _needsReview({ reason: 'duplicate_display_name', candidates: exactMatches.map(c => _asCandidate(c, 1.0)), score: 1.0 });
   }

   const canonicalMatches = _canonicalMatches(trimmed, catalog);
   if (canonicalMatches.length === 1) {
      const hit = canonicalMatches[0];
      return {
         customerId: hit.customer_id,
         displayName: hit.display_name,
         score: 1.0,
         tier: 'exact',
         candidates: [_asCandidate(hit, 1.0)],
         reason: 'canonical_name_match'
      };
   }
   if (canonicalMatches.length > 1) {
      return _needsReview({ reason: 'duplicate_canonical_name', candidates: canonicalMatches.map(c => _asCandidate(c, 1.0)), score: 1.0 });
   }

   const fuzzyCandidates = scoreCandidates(
      trimmed,
      catalog.map(c => ({ id: c.customer_id, label: c.display_name })),
      { limit: 5, scoreCutoff: Math.round(matchThreshold * 100) }
   );

   if (!fuzzyCandidates.length) {
      return { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'no_candidates' };
   }

   const top = fuzzyCandidates[0];
   const runnerUp = fuzzyCandidates[1] || null;
   const margin = top.score - (runnerUp ? runnerUp.score : 0);

   // Reviewer-confirmed alias as a tie-breaker between near-equal leaders
   // (e.g. "Kimmel Financial Advisors" ties "Kimmel Financial Partners" and
   // "Jonathon and Kathy Kimmel" at 0.95; reviewers have only ever billed it to
   // the former). Never overrides the token rule, never reaches past a
   // candidate the fuzzy scorer clearly prefers.
   const aliasCustomerId = confirmedAliases && typeof confirmedAliases.get === 'function' ? confirmedAliases.get(canonicalNameKey(trimmed)) : null;
   if (aliasCustomerId != null) {
      // Evaluated against EVERY candidate that clears the score cutoff, not
      // just the top-5 `fuzzyCandidates` the UI/LLM prompt displays — with a
      // wide tie (six-plus candidates at the same score), the alias's
      // customer can land outside the displayed top five depending on
      // sort/catalog order, and truncating before this lookup used to make
      // the match decision (confirmed_alias vs needs_review) depend on that
      // order. Only the REPORTED candidate list stays capped at 5.
      const allQualifyingCandidates = scoreCandidates(
         trimmed,
         catalog.map(c => ({ id: c.customer_id, label: c.display_name })),
         { limit: 0, scoreCutoff: Math.round(matchThreshold * 100) }
      );
      const aliasCandidate = allQualifyingCandidates.find(c => c.id === aliasCustomerId && top.score - c.score < minMargin);
      if (aliasCandidate && _hasNameAgreement(trimmed, aliasCandidate.label)) {
         return {
            customerId: aliasCandidate.id,
            displayName: aliasCandidate.label,
            score: aliasCandidate.score,
            tier: 'confirmed_alias',
            candidates: fuzzyCandidates,
            reason: 'reviewer_confirmed_alias'
         };
      }
   }

   if (top.score >= llmSkipThreshold) {
      const topAgrees = _hasNameAgreement(trimmed, top.label);
      if (topAgrees && margin >= minMargin) {
         return {
            customerId: top.id,
            displayName: top.label,
            score: top.score,
            tier: 'fuzzy_high',
            candidates: fuzzyCandidates,
            reason: 'high_confidence_fuzzy'
         };
      }
      return _needsReview({
         reason: topAgrees ? 'ambiguous_fuzzy_margin' : 'insufficient_name_token_agreement',
         candidates: fuzzyCandidates,
         score: top.score
      });
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
            reason: 'llm_returned_null'
         };
      }
      const picked = catalog.find(c => c.customer_id === json.match_id) ||
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
      const pickedId = picked.customer_id || picked.id;
      const pickedLabel = picked.display_name || picked.label;
      if (!_hasNameAgreement(trimmed, pickedLabel)) {
         return _needsReview({ reason: 'llm_pick_insufficient_name_token_agreement', candidates: fuzzyCandidates, score: top.score });
      }
      return {
         customerId: pickedId,
         displayName: pickedLabel,
         score: typeof json.match_confidence === 'number' ? json.match_confidence : top.score,
         tier: 'llm_tiebreak',
         candidates: fuzzyCandidates,
         reason: 'llm_picked'
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

module.exports = {
   matchCustomer,
   MATCH_THRESHOLD,
   LLM_SKIP_THRESHOLD,
   MIN_AUTO_MARGIN,
   MIN_SHARED_NAME_TOKENS,
   NEEDS_REVIEW_TIER,
   _exactMatch,
   _hasNameAgreement
};
