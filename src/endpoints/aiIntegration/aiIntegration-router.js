const express = require('express');
const https = require('https');
const { URL } = require('url');
const aiIntegrationRouter = express.Router();
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const aiIntegrationService = require('./aiIntegration-service');
const { encryptApiKey, decryptApiKey, hasStoredApiKey, generateSecret } = require('../../utils/aiSecrets');
const { requireAdmin } = require('../auth/jwt-auth');
const { OPENAI_API_BASE_URL } = require('../../../config');
const { uploadWeeklyForAccount } = require('../../automations/automationScripts/aiTrainingUploader');

const KNOWN_COST_HINTS = {
   'gpt-3.5-turbo': 'cheap',
   'gpt-4o-mini': 'less cheap',
   'gpt-4o': 'average',
   'gpt-4.1': 'more expensive',
   'gpt-4.1-pro': 'expensive'
};

const deriveCostTier = modelId => {
   if (!modelId) return '';
   if (KNOWN_COST_HINTS[modelId]) return KNOWN_COST_HINTS[modelId];

   if (/gpt-3\.5/i.test(modelId)) return 'cheap';
   if (/mini/i.test(modelId)) return 'less cheap';
   if (/gpt-4o/i.test(modelId)) return 'average';
   if (/gpt-4\.1-pro/i.test(modelId)) return 'expensive';
   if (/gpt-4\.1/i.test(modelId)) return 'more expensive';
   if (/gpt-4/i.test(modelId)) return 'expensive';

   return 'unknown';
};

const buildModelsPayload = async (integration, accountId) => {
   if (!integration || !integration.api_key_encrypted) {
      throw new Error('No API key stored. Connect before fetching models.');
   }

   if (!integration.encryption_secret) {
      throw new Error('AI integration secret missing for this account. Reconnect the API key.');
   }

   const apiKey = decryptApiKey(integration.api_key_encrypted, integration.encryption_secret);
   const models = await fetchOpenAiModels(apiKey, accountId);

   if (!models.length) {
      throw new Error('OpenAI returned an empty model list.');
   }

   return models;
};

const buildOpenAiRequestOptions = endpointPath => {
   const base = new URL(OPENAI_API_BASE_URL || 'https://api.openai.com');
   const resolved = new URL(endpointPath, base);

   const options = {
      protocol: resolved.protocol,
      hostname: resolved.hostname,
      path: `${resolved.pathname}${resolved.search}`
   };

   if (resolved.port) {
      options.port = resolved.port;
   }

   return options;
};

const fetchOpenAiModels = (apiKey, accountId) =>
   new Promise((resolve, reject) => {
      const endpoint = buildOpenAiRequestOptions('/v1/models');
      const requestOptions = {
         ...endpoint,
         method: 'GET',
         headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
         }
      };

      console.info(`AI Integration [${accountId}] -> Requesting OpenAI models at ${requestOptions.hostname}${requestOptions.path}`);

      const req = https.request(requestOptions, res => {
         const chunks = [];
         res.on('data', chunk => chunks.push(chunk));
         res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode >= 400) {
               const error = new Error(`OpenAI responded with status ${res.statusCode}`);
               error.statusCode = res.statusCode;
               error.responseBody = body;
               error.code = 'OPENAI_REQUEST_FAILED';
               console.error(`AI Integration [${accountId}] -> OpenAI request failed with status ${res.statusCode}. Body: ${body}`);
               return reject(error);
            }

            try {
               const parsed = JSON.parse(body);
               const rawModels = Array.isArray(parsed?.data) ? parsed.data : [];
               const seen = new Set();
               const filtered = rawModels
                  .map(entry => {
                     const id = entry?.id;
                     if (typeof id !== 'string') return null;
                     if (!/^gpt-/i.test(id)) return null;
                     if (seen.has(id)) return null;
                     seen.add(id);
                     return {
                        value: id,
                        label: id,
                        costTier: deriveCostTier(id),
                        ownedBy: entry?.owned_by || null
                     };
                  })
                  .filter(Boolean)
                  .sort((a, b) => a.label.localeCompare(b.label));

               console.info(`AI Integration [${accountId}] -> Retrieved ${filtered.length} models from OpenAI.`);
               resolve(filtered);
            } catch (parseError) {
               parseError.code = 'OPENAI_RESPONSE_PARSE_FAILED';
               console.error(`AI Integration [${accountId}] -> Failed to parse OpenAI response. Error: ${parseError.message}`);
               reject(parseError);
            }
         });
      });

      req.on('error', error => {
         error.code = error.code || 'OPENAI_REQUEST_FAILED';
         console.error(`AI Integration [${accountId}] -> Network error calling OpenAI: ${error.message}`);
         reject(error);
      });

      req.setTimeout(10000, () => {
         console.error(`AI Integration [${accountId}] -> OpenAI request timed out after 10s.`);
         req.destroy(new Error('OpenAI request timed out.'));
      });

      req.end();
   });

const formatIntegrationResponse = record => {
   if (!record) return null;
   return {
      aiIntegrationId: record.ai_integration_id,
      accountId: record.account_id,
      isEnabled: record.is_enabled,
      model: record.model,
      modelCostTier: record.model_cost_tier,
      hasApiKey: hasStoredApiKey(record.api_key_encrypted),
      updatedAt: record.updated_at
   };
};

aiIntegrationRouter
   .route('/:accountId/:userId/upload-training')
   .all(requireAdmin)
   .post(async (req, res) => {
      const { accountId } = req.params;
      try {
         const result = await uploadWeeklyForAccount(Number(accountId));
         return res.status(200).json({ status: 200, ...result });
      } catch (error) {
         return res.status(500).json({ status: 500, message: error.message || 'Upload failed' });
      }
   });

aiIntegrationRouter
   .route('/:accountId/:userId/models')
   .all(requireAdmin)
   .get(async (req, res, next) => {
      const db = req.app.get('db');
      const { accountId } = req.params;

      try {
         console.info(`AI Integration [${accountId}] -> Fetching model list.`);
         const integration = await aiIntegrationService.getIntegrationByAccount(db, accountId);

         if (!integration) {
            console.info(`AI Integration [${accountId}] -> No integration record found.`);
            return res.status(200).json({
               status: 200,
               models: [],
               connected: false,
               message: 'AI integration is not configured for this account.'
            });
         }

         try {
            const models = await buildModelsPayload(integration, accountId);
            return res.status(200).json({
               status: 200,
               models,
               connected: true,
               message: 'Connected to OpenAI successfully.'
            });
         } catch (error) {
            return res.status(502).json({
               status: 502,
               connected: false,
               models: [],
               message: error.message
            });
         }
      } catch (error) {
         console.error(`AI Integration [${accountId}] -> Error fetching models: ${error.message}`);
         return res.status(500).json({
            status: 500,
            connected: false,
            models: [],
            message: error?.message || 'Unable to load models from OpenAI.'
         });
      }
   });

aiIntegrationRouter
   .route('/:accountId/:userId')
   .all(requireAdmin)
   .get(async (req, res, next) => {
      const db = req.app.get('db');
      const { accountId } = req.params;
      try {
         const integration = await aiIntegrationService.getIntegrationByAccount(db, accountId);
         return res.status(200).json({
            status: 200,
            integration: formatIntegrationResponse(integration)
         });
      } catch (error) {
         next(error);
      }
   })
   .post(jsonParser, async (req, res, next) => {
      const db = req.app.get('db');
      const { accountId } = req.params;

      try {
         console.info(`AI Integration [${accountId}] -> Creating integration.`);
         const existing = await aiIntegrationService.getIntegrationByAccount(db, accountId);
         if (existing) {
            return res.status(409).json({
               status: 409,
               message: 'AI integration already exists for this account.'
            });
         }

         const payload = sanitizeFields(req.body.integration || {});
         const { isEnabled, apiKey, model, modelCostTier } = payload;

         if (typeof isEnabled !== 'boolean') {
            return res.status(400).json({ status: 400, message: 'isEnabled must be provided as a boolean.' });
         }

         const record = {
            account_id: Number(accountId),
            is_enabled: isEnabled,
            model: model || null,
            model_cost_tier: modelCostTier || null,
            api_key_encrypted: null,
            encryption_secret: null
         };

         if (apiKey) {
            const secret = generateSecret();
            record.encryption_secret = secret;
            record.api_key_encrypted = encryptApiKey(apiKey, secret);
         }

         const created = await aiIntegrationService.createIntegration(db, record);
         console.info(`AI Integration [${accountId}] -> Integration created.`);

         let models = [];
         let connected = false;
         let modelsMessage = 'API key saved.';

         // Attempt to fetch models only to enhance UX, but do not block create if it fails
         if (created.api_key_encrypted && created.encryption_secret) {
            try {
               models = await buildModelsPayload(created, accountId);
               connected = true;
               modelsMessage = 'Connected to OpenAI successfully.';
            } catch (error) {
               console.error(`AI Integration [${accountId}] -> Error fetching models after create: ${error.message}`);
               connected = false;
               models = [];
               modelsMessage = error.message || 'Unable to fetch models from OpenAI.';
            }
         }

         return res.status(201).json({
            status: 201,
            message: 'AI integration created.',
            integration: formatIntegrationResponse(created),
            models,
            connected,
            modelsMessage
         });
      } catch (error) {
         console.error(`AI Integration [${accountId}] -> Error creating integration:`, error);
         if (error?.message?.includes('secret')) {
            return res.status(500).json({
               status: 500,
               message: error.message
            });
         }
         next(error);
      }
   })
   .put(jsonParser, async (req, res, next) => {
      const db = req.app.get('db');
      const { accountId } = req.params;

      try {
         console.info(`AI Integration [${accountId}] -> Updating integration.`);
         const existing = await aiIntegrationService.getIntegrationByAccount(db, accountId);
         if (!existing) {
            return res.status(404).json({
               status: 404,
               message: 'AI integration not found for this account.'
            });
         }

         const payload = sanitizeFields(req.body.integration || {});
         const updates = {};

         if (typeof payload.isEnabled === 'boolean') {
            updates.is_enabled = payload.isEnabled;
         }

         if (typeof payload.model === 'string') {
            const trimmedModel = payload.model.trim();
            updates.model = trimmedModel || null;
         }

         if (typeof payload.modelCostTier === 'string') {
            const normalizedCostTier = payload.modelCostTier.trim();
            updates.model_cost_tier = normalizedCostTier || null;
         } else if (payload.modelCostTier === null) {
            updates.model_cost_tier = null;
         }

         let encryptionSecret = existing.encryption_secret;

         if (payload.removeApiKey === true) {
            updates.api_key_encrypted = null;
            updates.encryption_secret = null;
         } else if (typeof payload.apiKey === 'string' && payload.apiKey.length) {
            if (!encryptionSecret) {
               encryptionSecret = generateSecret();
               updates.encryption_secret = encryptionSecret;
            }
            updates.api_key_encrypted = encryptApiKey(payload.apiKey, encryptionSecret);
         }

         if (!Object.keys(updates).length) {
            return res.status(400).json({
               status: 400,
               message: 'No valid fields supplied for update.'
            });
         }

         const updated = await aiIntegrationService.updateIntegration(db, accountId, updates);
         console.info(`AI Integration [${accountId}] -> Integration updated.`);

         let models = [];
         let connected = false;
         let modelsMessage = 'API key removed.';

         // Attempt to fetch models only to enhance UX, but do not block updates if it fails
         if (updated.api_key_encrypted && updated.encryption_secret) {
            try {
               models = await buildModelsPayload(updated, accountId);
               connected = true;
               modelsMessage = 'Connected to OpenAI successfully.';
            } catch (error) {
               console.error(`AI Integration [${accountId}] -> Error fetching models after update: ${error.message}`);
               connected = false;
               models = [];
               modelsMessage = error.message || 'Unable to fetch models from OpenAI.';
            }
         }

         return res.status(200).json({
            status: 200,
            message: 'AI integration updated.',
            integration: formatIntegrationResponse(updated),
            models,
            connected,
            modelsMessage
         });
      } catch (error) {
         console.error(`AI Integration [${accountId}] -> Error updating integration:`, error);
         if (error?.message?.includes('secret')) {
            return res.status(500).json({
               status: 500,
               message: error.message
            });
         }
         next(error);
      }
   })
   .delete(async (req, res, next) => {
      const db = req.app.get('db');
      const { accountId } = req.params;

      try {
         console.info(`AI Integration [${accountId}] -> Removing integration.`);
         const deleted = await aiIntegrationService.deleteIntegration(db, accountId);
         if (!deleted) {
            return res.status(404).json({
               status: 404,
               message: 'AI integration not found for this account.'
            });
         }

         return res.status(200).json({
            status: 200,
            message: 'AI integration removed.'
         });
      } catch (error) {
         console.error(`AI Integration [${accountId}] -> Error removing integration: ${error.message}`);
         next(error);
      }
   });

aiIntegrationRouter
   .route('/:accountId/:userId/reveal')
   .all(requireAdmin)
   .get(async (req, res, next) => {
      const db = req.app.get('db');
      const { accountId } = req.params;
      try {
         const integration = await aiIntegrationService.getIntegrationByAccount(db, accountId);
         if (!integration || !integration.api_key_encrypted) {
            return res.status(404).json({
               status: 404,
               message: 'No AI API key stored for this account.'
            });
         }

         if (!integration.encryption_secret) {
            return res.status(500).json({
               status: 500,
               message: 'AI integration secret missing for this account. Reconnect the API key.'
            });
         }

         const apiKey = decryptApiKey(integration.api_key_encrypted, integration.encryption_secret);
         return res.status(200).json({
            status: 200,
            apiKey
         });
      } catch (error) {
         if (error?.message?.includes('secret')) {
            return res.status(500).json({
               status: 500,
               message: error.message
            });
         }
         next(error);
      }
   });

module.exports = aiIntegrationRouter;
