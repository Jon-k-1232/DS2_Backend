const dayjs = require('dayjs');
const https = require('https');
const { URL } = require('url');
const db = require('../../utils/db');
const { OPENAI_API_BASE_URL, OPENAI_VECTOR_STORE_ID } = require('../../../config');
const aiIntegrationService = require('../../endpoints/aiIntegration/aiIntegration-service');
const { decryptApiKey } = require('../../utils/aiSecrets');
const trainingService = require('../../endpoints/aiIntegration/ai-category-training-service');

// Upload a JSONL file of training examples to OpenAI Files and attach to a Vector Store
async function uploadToVectorStore({ apiKey, records }) {
   if (!OPENAI_VECTOR_STORE_ID) {
      throw new Error('OPENAI_VECTOR_STORE_ID is not configured.');
   }

   // Build JSONL content: one JSON object per line with sanitized fields
   const jsonl = records
      .map(r =>
         JSON.stringify({
            training_id: r.training_id,
            timesheet_entry_id: r.timesheet_entry_id,
            transaction_id: r.transaction_id,
            original_category: r.original_category,
            suggested_category: r.suggested_category,
            final_category: r.final_category,
            ai_reason: r.ai_reason,
            ai_confidence: r.ai_confidence,
            sanitized_notes: r.sanitized_notes,
            duration_minutes: r.duration_minutes,
            entity: r.entity,
            created_at: r.created_at
         })
      )
      .join('\n');

   const base = new URL(OPENAI_API_BASE_URL || 'https://api.openai.com');

   // Helper to perform HTTPS request
   const httpRequest = (options, bodyBuffer) =>
      new Promise((resolve, reject) => {
         const req = https.request(options, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
               const text = Buffer.concat(chunks).toString('utf8');
               if (res.statusCode >= 400) {
                  const err = new Error(`OpenAI request failed (${res.statusCode}): ${text}`);
                  err.statusCode = res.statusCode;
                  return reject(err);
               }
               try {
                  const parsed = JSON.parse(text);
                  resolve(parsed);
               } catch (e) {
                  resolve(text);
               }
            });
         });
         req.on('error', reject);
         req.setTimeout(20000, () => req.destroy(new Error('OpenAI request timed out')));
         if (bodyBuffer) req.write(bodyBuffer);
         req.end();
      });

   // 1) Create a file with purpose 'assistants'
   const boundary = '----ds2FormBoundary' + Math.random().toString(16).slice(2);
   const CRLF = '\r\n';
   const parts = [];
   // purpose field
   parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="purpose"${CRLF}${CRLF}assistants${CRLF}`));
   // file content; name must be 'file'
   parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="training.jsonl"${CRLF}Content-Type: application/json${CRLF}${CRLF}`));
   parts.push(Buffer.from(jsonl, 'utf8'));
   parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
   const body = Buffer.concat(parts);

   const filesEndpoint = new URL('/v1/files', base);
   const fileResp = await httpRequest(
      {
         protocol: filesEndpoint.protocol,
         hostname: filesEndpoint.hostname,
         path: filesEndpoint.pathname,
         method: 'POST',
         headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
         }
      },
      body
   );

   const fileId = fileResp?.id;
   if (!fileId) throw new Error('OpenAI files API did not return a file id.');

   // 2) Attach the file to the vector store
   const attachEndpoint = new URL(`/v1/vector_stores/${OPENAI_VECTOR_STORE_ID}/files`, base);
   const attachPayload = Buffer.from(JSON.stringify({ file_id: fileId }), 'utf8');
   await httpRequest(
      {
         protocol: attachEndpoint.protocol,
         hostname: attachEndpoint.hostname,
         path: attachEndpoint.pathname,
         method: 'POST',
         headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': attachPayload.length
         }
      },
      attachPayload
   );

   // If we got here, consider all records uploaded
   return records.map(r => r.training_id);
}

async function uploadWeeklyForAccount(accountId) {
   // Ensure AI integration is enabled
   const integration = await aiIntegrationService.getIntegrationByAccount(db, accountId);
   if (!integration || !integration.is_enabled) {
      console.info(`[${new Date().toISOString()}] AI integration disabled for account ${accountId}; skipping training upload.`);
      return { uploaded: 0 };
   }

   if (!integration.api_key_encrypted || !integration.encryption_secret) {
      console.info(`[${new Date().toISOString()}] AI integration missing API key for account ${accountId}; skipping training upload.`);
      return { uploaded: 0 };
   }

   // Fetch unuploaded records (new since last upload)
   const unuploaded = await trainingService.getUnuploadedSince(db, accountId);
   if (!unuploaded.length) {
      console.log(`[${new Date().toISOString()}] No new AI training examples for account ${accountId}.`);
      return { uploaded: 0 };
   }

   // Only send minimal non-PII payload
   const payload = unuploaded.map(row => ({
      training_id: row.training_id,
      account_id: row.account_id,
      timesheet_entry_id: row.timesheet_entry_id,
      transaction_id: row.transaction_id,
      original_category: row.original_category,
      suggested_category: row.suggested_category,
      final_category: row.final_category,
      ai_reason: row.ai_reason,
      ai_confidence: row.ai_confidence,
      sanitized_notes: row.sanitized_notes,
      duration_minutes: row.duration_minutes,
      entity: row.entity,
      created_at: row.created_at
   }));

   try {
      const apiKey = decryptApiKey(integration.api_key_encrypted, integration.encryption_secret);
      const uploadedIds = await uploadToVectorStore({ apiKey, records: payload });
      if (uploadedIds && uploadedIds.length) {
         await trainingService.markUploaded(db, accountId, uploadedIds, dayjs().toDate());
         console.log(`[${new Date().toISOString()}] Uploaded ${uploadedIds.length} AI training example(s) for account ${accountId}.`);
         return { uploaded: uploadedIds.length };
      }
      return { uploaded: 0 };
   } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to upload AI training examples for account ${accountId}: ${error.message}`);
      return { uploaded: 0, error: error.message };
   }
}

module.exports = { uploadWeeklyForAccount };
