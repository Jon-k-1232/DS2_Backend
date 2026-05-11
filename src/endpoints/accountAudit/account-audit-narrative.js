// Optional Bedrock-generated executive summary for an audit run.
// Returns null (and logs) on any failure — the audit itself is not blocked.
const { invokeBedrockClaude } = require('../../ai_integrations/bedrock');

const DEFAULT_MODEL =
   process.env.BEDROCK_MODEL_AUDIT ||
   process.env.BEDROCK_MODEL_TIMETRACKER_FAST ||
   'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const FALLBACK_MODEL =
   process.env.BEDROCK_MODEL_TIMETRACKER ||
   'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

// Trim the audit payload before sending — full ledgers can be hundreds of
// rows. The narrative only needs totals, breakdown summaries, and the
// detected discrepancies.
const buildPrompt = result => {
   const compact = {
      customer: result.customer,
      totals: result.totals,
      methodology: result.methodology,
      invoice_breakdown: (result.invoice_breakdown || []).map(b => ({
         invoice_number: b.invoice_number,
         invoice_date: b.invoice_date,
         total: b.parent_total_amount_due,
         paid_against: b.paid_against_invoice,
         writeoffs_against: b.writeoffs_against_invoice,
         expected_remaining: b.expected_remaining,
         actual_remaining: b.actual_remaining_used,
         drift: Math.round((b.expected_remaining - b.actual_remaining_used) * 100) / 100,
         is_paid_in_full_db: b.is_paid_in_full_db
      })),
      discrepancies: result.discrepancies
   };
   return JSON.stringify(compact);
};

const SYSTEM = `You are an independent accounting auditor reviewing one customer's billing ledger.
You will receive a JSON audit payload with totals, per-invoice breakdown, and detected discrepancies.

Write a plain-English executive summary for the accounting team. Be specific with dollar amounts and invoice numbers when they matter. Do NOT speculate about causes you cannot see in the data.

Return STRICT JSON only, no prose outside the object. Schema:
{
  "narrative": "2-4 sentences. Lead with whether the account is clean or has issues, then the actual balance picture in plain terms, then any standout concern.",
  "key_findings": ["short bullet 1", "short bullet 2", ...],   // 2-6 bullets, each under 25 words. Include specific dollar amounts and invoice numbers.
  "recommended_actions": ["actionable bullet 1", ...]          // 1-5 bullets. Concrete next steps (e.g. "Update parent invoice INV-... remaining to $X").
}

Use $ formatting with two decimals. Do not include any other keys.`;

const generateAuditNarrative = async ({ auditResult, accountId, userId, db }) => {
   const payload = buildPrompt(auditResult);
   const messages = [
      {
         role: 'user',
         content: [
            { type: 'text', text: `Audit payload:\n${payload}` }
         ]
      }
   ];

   const attempt = async modelId => {
      const out = await invokeBedrockClaude({
         modelId,
         system: SYSTEM,
         messages,
         maxTokens: 900,
         temperature: 0.1,
         accountId,
         userId,
         feature: 'account_audit_narrative',
         db
      });
      return out;
   };

   try {
      const out = await attempt(DEFAULT_MODEL);
      return shapeResponse(out, DEFAULT_MODEL);
   } catch (firstErr) {
      console.warn(`[audit-narrative] primary model failed (${DEFAULT_MODEL}): ${firstErr.message}. Trying fallback.`);
      try {
         const out = await attempt(FALLBACK_MODEL);
         return shapeResponse(out, FALLBACK_MODEL);
      } catch (secondErr) {
         console.warn(`[audit-narrative] fallback model also failed: ${secondErr.message}`);
         return null;
      }
   }
};

const shapeResponse = (bedrockOut, modelId) => {
   const j = bedrockOut?.json || {};
   const narrative = typeof j.narrative === 'string' ? j.narrative.trim() : null;
   const findings = Array.isArray(j.key_findings) ? j.key_findings.filter(s => typeof s === 'string') : [];
   const actions = Array.isArray(j.recommended_actions) ? j.recommended_actions.filter(s => typeof s === 'string') : [];
   if (!narrative) return null;
   return {
      narrative,
      findings,
      actions,
      model: modelId,
      cost: bedrockOut?.cost ?? 0,
      requestId: bedrockOut?.requestId ?? null
   };
};

module.exports = { generateAuditNarrative };
