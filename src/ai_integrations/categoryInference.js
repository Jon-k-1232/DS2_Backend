const { invokeBedrockClaude } = require('./bedrock');

const HAIKU_MODEL = process.env.BEDROCK_MODEL_TIMETRACKER_FAST || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET_MODEL = process.env.BEDROCK_MODEL_TIMETRACKER || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const ESCALATE_THRESHOLD = Number(process.env.CATEGORY_ESCALATION_THRESHOLD || 0.75);
const MAX_REF_JOB_TYPES = Number(process.env.MAX_JOB_TYPES_IN_PROMPT || 150);

const SYSTEM_PROMPT = [
   'You categorize one timesheet entry. Output ONLY a JSON object matching this schema:',
   '{',
   '  "suggested_general_work_description_id": number | null,',
   '  "suggested_job_category_id": number | null,',
   '  "suggested_job_type_id": number | null,',
   '  "suggested_category_label": string | null,',
   '  "category_confidence": number,',
   '  "ai_reason": string',
   '}',
   'Rules:',
   '- Pick IDs ONLY from the provided reference arrays. NEVER invent an ID.',
   '- The notes describe what the employee actually did. The category_freetext is the human\'s loose self-tag and is often inaccurate.',
   '  When the notes describe a concrete activity (e.g. "Meeting with Jim", "Conference with Eliza", "Handover"), prefer the description',
   '  that matches the notes over the description that matches the category_freetext. Treat synonyms ("meeting", "conference",',
   '  "handover", "call") as the same kind of work.',
   '- Two rows whose notes describe semantically equivalent work should receive the same suggested_general_work_description_id,',
   '  even if their category_freetext differs.',
   '- ADMIN/BACK-OFFICE WORK: when notes describe internal admin work — processing payments, depositing checks, verifying invoices,',
   '  scanning + filing, emailing internal billing staff (Kati, Kasi, Jim, Marsha, Kennedy, Eliza), posting bank transactions —',
   '  pick a generic "Administrative" or "Filing" or similar back-office work description. These are typically NOT client-facing',
   '  deliverables; do NOT pick "Tax Return Preparation", "Phone Call", or "Client Meeting" for them.',
   '- If no acceptable match exists, return null IDs and category_confidence <= 0.4 with a reason that names the missing concept.',
   '- If notes are too sparse to decide, return null IDs and category_confidence <= 0.3.',
   '- Prefer returning a sensible general_work_description match for billable rows.',
   '- ai_reason must be <= 200 characters.',
   '- Do not echo the input. No prose outside the JSON object.'
].join('\n');

const _truncateRefData = refData => {
   const out = { ...refData };
   if (Array.isArray(out.job_types) && out.job_types.length > MAX_REF_JOB_TYPES) {
      out.job_types = out.job_types.slice(0, MAX_REF_JOB_TYPES);
   }
   return out;
};

const _buildUserPrompt = ({ redactedRow, refData, fewShots, customerPatterns }) => {
   const truncated = _truncateRefData(refData);
   const fewShotBlock =
      fewShots && fewShots.length
         ? '\nRecent reviewer-corrected examples (for calibration):\n' +
           fewShots
              .map(
                 ex =>
                    `- notes "${ex.sanitized_notes}" duration ${ex.duration_minutes ?? '?'}min → final_general_work_description "${ex.final_general_work_description || ex.final_category}"`
              )
              .join('\n')
         : '';

   // Per-customer history: list the customer's actual parent jobs and their typical
   // (notes, work_desc) patterns. This collapses the search space dramatically — JKA
   // has 8 jobs, not the 150 in the account-wide catalog — and shows the AI what
   // "looks like" billable work for THIS customer.
   const customerBlock = customerPatterns ? (() => {
      const lines = ['', 'For THIS customer specifically:'];
      if (customerPatterns.parentJobs && customerPatterns.parentJobs.length) {
         lines.push(`- Active parent jobs (prefer one of these for customer_job_id): ${
            JSON.stringify(customerPatterns.parentJobs.map(pj => ({ id: pj.customer_job_id, label: pj.job_description })))
         }`);
      }
      if (customerPatterns.fewShots && customerPatterns.fewShots.length) {
         lines.push('- Past examples for this customer (notes → general_work_description that was actually billed):');
         for (const ex of customerPatterns.fewShots) {
            lines.push(`  - "${ex.dwd}" → "${ex.work_desc_label}"`);
         }
      }
      return lines.join('\n');
   })() : '';

   return [
      'Timesheet row (PII redacted; CUSTOMER_42 / EMPLOYEE_42 are opaque tokens):',
      JSON.stringify(redactedRow),
      '',
      'Reference data for this account:',
      `- general_work_descriptions: ${JSON.stringify(truncated.general_work_descriptions || [])}`,
      `- job_categories: ${JSON.stringify(truncated.job_categories || [])}`,
      `- job_types: ${JSON.stringify(truncated.job_types || [])}`,
      fewShotBlock,
      customerBlock,
      '',
      'Output the JSON object now.'
   ].join('\n');
};

const _validateSuggestion = (json, refData) => {
   if (!json || typeof json !== 'object') return null;
   const idsValid = ['suggested_general_work_description_id', 'suggested_job_category_id', 'suggested_job_type_id'].every(field => {
      const v = json[field];
      if (v == null) return true;
      if (typeof v !== 'number' || !Number.isInteger(v)) return false;
      const collection =
         field === 'suggested_general_work_description_id'
            ? refData.general_work_descriptions
            : field === 'suggested_job_category_id'
               ? refData.job_categories
               : refData.job_types;
      return Array.isArray(collection) && collection.some(item => (item.id || item.general_work_description_id || item.job_type_id || item.customer_job_category_id) === v);
   });
   if (!idsValid) return null;
   const conf = typeof json.category_confidence === 'number' ? json.category_confidence : 0;
   return {
      suggested_general_work_description_id: json.suggested_general_work_description_id ?? null,
      suggested_job_category_id: json.suggested_job_category_id ?? null,
      suggested_job_type_id: json.suggested_job_type_id ?? null,
      suggested_category_label: json.suggested_category_label || null,
      category_confidence: Math.max(0, Math.min(1, conf)),
      ai_reason: typeof json.ai_reason === 'string' ? json.ai_reason.slice(0, 200) : ''
   };
};

const inferCategorization = async ({
   redactedRow,
   refData,
   fewShots = [],
   customerPatterns = null,
   accountId,
   userId = null,
   timesheetEntryId = null,
   db = null,
   bedrockInvoker = invokeBedrockClaude
}) => {
   const userPrompt = _buildUserPrompt({ redactedRow, refData, fewShots, customerPatterns });
   const messages = [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }];

   let totalCost = 0;
   let lastError = null;
   let modelUsed = null;

   try {
      const haikuResult = await bedrockInvoker({
         modelId: HAIKU_MODEL,
         system: SYSTEM_PROMPT,
         messages,
         maxTokens: 400,
         accountId,
         userId,
         timesheetEntryId,
         feature: 'category_haiku',
         db
      });
      totalCost += haikuResult.cost || 0;
      modelUsed = HAIKU_MODEL;
      const validated = _validateSuggestion(haikuResult.json, refData);
      if (validated && validated.category_confidence >= ESCALATE_THRESHOLD) {
         return { suggestion: validated, modelUsed, totalCost, escalated: false };
      }
   } catch (err) {
      lastError = err;
      // Don't escalate to Sonnet on auth / permission errors — Sonnet will
      // fail the same way and we'd waste an InvokeModel call. Same for
      // ResourceNotFound (model not enabled). Throttling DOES escalate
      // because Haiku-specific throttle quotas can run out independently.
      const msg = String(err && err.message || '');
      const fatal = /AccessDeniedException|UnrecognizedClientException|InvalidSignatureException|not authorized|AuthFailure|ResourceNotFoundException|ValidationException/i.test(msg);
      if (fatal) {
         return { suggestion: null, modelUsed: HAIKU_MODEL, totalCost, escalated: false, error: err.message };
      }
   }

   try {
      const sonnetResult = await bedrockInvoker({
         modelId: SONNET_MODEL,
         system: SYSTEM_PROMPT,
         messages,
         maxTokens: 400,
         accountId,
         userId,
         timesheetEntryId,
         feature: 'category_sonnet',
         db
      });
      totalCost += sonnetResult.cost || 0;
      modelUsed = SONNET_MODEL;
      const validated = _validateSuggestion(sonnetResult.json, refData);
      if (validated) {
         return { suggestion: validated, modelUsed, totalCost, escalated: true };
      }
      lastError = lastError || new Error('sonnet_returned_invalid_suggestion');
   } catch (err) {
      lastError = err;
   }

   return {
      suggestion: null,
      modelUsed,
      totalCost,
      escalated: true,
      error: lastError ? lastError.message : 'unknown_error'
   };
};

module.exports = {
   inferCategorization,
   SYSTEM_PROMPT,
   _buildUserPrompt,
   _validateSuggestion,
   ESCALATE_THRESHOLD,
   HAIKU_MODEL,
   SONNET_MODEL
};
