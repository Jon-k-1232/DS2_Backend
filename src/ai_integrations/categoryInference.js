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

const _buildUserPrompt = ({ redactedRow, refData, fewShots }) => {
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
   return [
      'Timesheet row (PII redacted; CUSTOMER_42 / EMPLOYEE_42 are opaque tokens):',
      JSON.stringify(redactedRow),
      '',
      'Reference data for this account:',
      `- general_work_descriptions: ${JSON.stringify(truncated.general_work_descriptions || [])}`,
      `- job_categories: ${JSON.stringify(truncated.job_categories || [])}`,
      `- job_types: ${JSON.stringify(truncated.job_types || [])}`,
      fewShotBlock,
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
   accountId,
   userId = null,
   timesheetEntryId = null,
   db = null,
   bedrockInvoker = invokeBedrockClaude
}) => {
   const userPrompt = _buildUserPrompt({ redactedRow, refData, fewShots });
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
