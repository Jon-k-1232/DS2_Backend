const aiIntegrationService = require('../endpoints/aiIntegration/aiIntegration-service');
const { decryptApiKey } = require('../utils/aiSecrets');
const requestLogs = require('./request-logs-service');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');
const { OPENAI_API_BASE_URL } = require('../../config');

/**
 * The AI orchestrator centralizes how downstream features interact with AI providers.
 * It fetches the active integration, decrypts the stored credentials, and prepares the request payload.
 * The actual HTTP call to the AI vendor should be implemented where indicated.
 */
const executeAiRequest = async ({ db, accountId, userId, request }) => {
   if (!db) {
      throw new Error('Database instance is required to execute an AI request.');
   }

   if (!accountId) {
      throw new Error('accountId is required to execute an AI request.');
   }

   const integration = await aiIntegrationService.getIntegrationByAccount(db, accountId);
   if (!integration || !integration.is_enabled) {
      throw new Error('AI integration is disabled or not configured for this account.');
   }

   if (!integration.api_key_encrypted) {
      throw new Error('AI integration API key is missing.');
   }

   if (!integration.encryption_secret) {
      throw new Error('AI integration secret is missing. Reconnect the API key in settings.');
   }

   const apiKey = decryptApiKey(integration.api_key_encrypted, integration.encryption_secret);
   const resolvedModel = (request && request.model) || integration.model;

   if (!resolvedModel) {
      throw new Error('AI model is not configured.');
   }

   // Suppress verbose 'Prepared request' data logs per requirements

   // Audit log in DB (best-effort)
   let requestId = null;
   try {
      requestId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      const entries = Array.isArray(request?.entries) ? request.entries : [];
      const sampleIds = entries
         .slice(0, 10)
         .map(e => e?.timesheet_entry_id)
         .filter(Boolean);
      await requestLogs.insertLog(db, {
         request_id: requestId,
         account_id: integration.account_id,
         user_id: userId || null,
         provider: 'openai',
         feature: request?.feature || 'unknown',
         model: resolvedModel,
         model_cost_tier: integration.model_cost_tier || null,
         entries_count: entries.length || 0,
         sample_entry_ids: JSON.stringify(sampleIds),
         status: 'prepared'
      });
   } catch (auditErr) {
      // If the table isn't migrated yet or any other error occurs, continue silently
      console.warn(`[${new Date().toISOString()}] [AI] Audit log insert skipped: ${auditErr.message}`);
      requestId = null;
   }

   // TODO: Wire this stub to the chosen AI provider.
   // Build and send OpenAI Chat Completions request
   const buildMessages = req => {
      // Privacy-safe prompt; request strict JSON matching our schema
      const header = [
         'You are an assistant that helps categorize time tracker entries.',
         'Only respond with valid JSON matching this schema:',
         '{ "suggestions": [ {',
         '  "timesheet_entry_id": number,',
         '  "suggested_category": string | null,',
         '  "suggested_job_category_id": number | null,',
         '  "suggested_job_type_id": number | null,',
         '  "suggested_general_work_description_id": number | null,',
         '  "ai_confidence": number | null,',
         '  "ai_reason": string | null,',
         '  "ai_payload": string | null',
         '} ] }',
         'Do not include any PII. Choose IDs only from the provided context arrays when appropriate.'
      ].join(' ');
      const context = req?.context || {};
      const userContent = {
         feature: req?.feature || 'timesheet_categorization',
         entries: req?.entries || [],
         context
      };
      return [
         { role: 'system', content: header },
         { role: 'user', content: JSON.stringify(userContent) }
      ];
   };

   const buildRequestBody = () => ({
      model: resolvedModel,
      messages: buildMessages(request),
      temperature: 0.2,
      response_format: { type: 'json_object' }
   });

   const callOpenAiOnce = body =>
      new Promise((resolve, reject) => {
         const base = new URL(OPENAI_API_BASE_URL || 'https://api.openai.com');
         const endpoint = new URL('/v1/chat/completions', base);
         const payload = Buffer.from(JSON.stringify(body), 'utf8');

         const options = {
            protocol: endpoint.protocol,
            hostname: endpoint.hostname,
            path: endpoint.pathname + endpoint.search,
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               'Content-Length': payload.length,
               Authorization: `Bearer ${apiKey}`
            },
            timeout: 15000
         };

         const req = https.request(options, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
               const bodyText = Buffer.concat(chunks).toString('utf8');
               if (res.statusCode >= 400) {
                  const err = new Error(`OpenAI request failed with status ${res.statusCode}`);
                  err.statusCode = res.statusCode;
                  err.responseBody = bodyText;
                  return reject(err);
               }
               try {
                  const parsed = JSON.parse(bodyText);
                  resolve(parsed);
               } catch (e) {
                  e.message = `Failed to parse OpenAI response: ${e.message}`;
                  reject(e);
               }
            });
         });

         req.on('error', reject);
         req.setTimeout(15000, () => req.destroy(new Error('OpenAI request timed out')));
         req.write(payload);
         req.end();
      });

   const sleep = ms => new Promise(r => setTimeout(r, ms));
   const callOpenAi = async body => {
      const maxAttempts = 3;
      let attempt = 0;
      let lastErr = null;
      while (attempt < maxAttempts) {
         try {
            return await callOpenAiOnce(body);
         } catch (err) {
            lastErr = err;
            const status = err?.statusCode || 0;
            const retryable = status === 429 || (status >= 500 && status < 600) || /timed out/i.test(err?.message || '');
            if (!retryable) break;
            const backoff = Math.min(2000 * Math.pow(2, attempt), 8000) + Math.floor(Math.random() * 300);
            await sleep(backoff);
            attempt++;
         }
      }
      throw lastErr || new Error('OpenAI request failed');
   };

   try {
      const body = buildRequestBody();
      const totalEntries = Array.isArray(request?.entries) ? request.entries.length : 0;
      console.info(`[${new Date().toISOString()}] [AI] send: account=${integration.account_id} user=${userId || 'system'} entries=${totalEntries}`);
      const completion = await callOpenAi(body);
      console.info(`[${new Date().toISOString()}] [AI] processing: account=${integration.account_id} user=${userId || 'system'}`);
      const content = completion?.choices?.[0]?.message?.content || '';

      // Try to parse JSON if the model obeyed response_format; otherwise wrap as payload
      let modelJson = null;
      try {
         modelJson = JSON.parse(content);
      } catch {
         modelJson = null;
      }
      const suggestions = Array.isArray(modelJson?.suggestions)
         ? modelJson.suggestions
         : Array.isArray(request?.entries)
         ? request.entries.map(e => ({ timesheet_entry_id: e.timesheet_entry_id, ai_payload: content }))
         : [];

      const result = {
         status: 'ok',
         message: 'AI request executed.',
         payload: {
            accountId: integration.account_id,
            model: resolvedModel,
            modelCostTier: integration.model_cost_tier,
            suggestions
         },
         metadata: {
            executedBy: userId || null,
            requestId: requestId || null
         }
      };

      try {
         if (requestId) await requestLogs.markCompleted(db, requestId);
      } catch (auditCompleteErr) {
         console.warn(`[${new Date().toISOString()}] [AI] Audit log complete skipped: ${auditCompleteErr.message}`);
      }
      console.info(`[${new Date().toISOString()}] [AI] success: account=${integration.account_id} user=${userId || 'system'} processed=${Array.isArray(suggestions) ? suggestions.length : 0}`);
      return result;
   } catch (err) {
      console.error(`[${new Date().toISOString()}] [AI] failure: account=${integration?.account_id} user=${userId || 'system'} message=${err.message}`);
      try {
         if (requestId) await requestLogs.markFailed(db, requestId, err.message);
      } catch (auditErr) {
         console.warn(`[${new Date().toISOString()}] [AI] Audit log failed-state skipped: ${auditErr.message}`);
      }

      // Return a safe object so the orchestrator caller can proceed with fallback suggestions
      return {
         status: 'error',
         message: err.message,
         payload: {
            accountId: integration.account_id,
            model: resolvedModel,
            modelCostTier: integration.model_cost_tier,
            suggestions: []
         },
         metadata: {
            executedBy: userId || null,
            requestId: requestId || null
         }
      };
   }
};

module.exports = {
   executeAiRequest
};
