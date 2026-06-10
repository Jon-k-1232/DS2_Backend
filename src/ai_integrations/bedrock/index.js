const crypto = require('crypto');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client } = require('@aws-sdk/client-s3');
const { estimateCost } = require('./cost');
const { writeS3Log, writeDbLog } = require('./audit');
const { acquireSlot } = require('./rateLimiter');
const { _stringFallbackRedact } = require('../../utils/comprehend');

const REGION = process.env.BEDROCK_REGION || 'us-west-2';
const LLM_LOG_BUCKET = process.env.LLM_LOG_BUCKET || '';
// Off by default: the prompts/responses can contain client PII (names, notes,
// ledger detail). When false we persist only metadata + a content hash to the
// durable S3 log. When explicitly enabled (debugging), content is PII-redacted
// first. The DB log (ai_call_log) never stores raw content regardless.
const LLM_LOG_RAW = String(process.env.LLM_LOG_RAW).toLowerCase() === 'true';

let cachedBedrockClient = null;
let cachedS3Client = null;

const getBedrockClient = () => {
   if (!cachedBedrockClient) {
      cachedBedrockClient = new BedrockRuntimeClient({ region: REGION });
   }
   return cachedBedrockClient;
};

const getS3Client = () => {
   if (!LLM_LOG_BUCKET) return null;
   if (!cachedS3Client) {
      cachedS3Client = new S3Client({ region: REGION });
   }
   return cachedS3Client;
};

const _setClientsForTest = ({ bedrockClient, s3Client } = {}) => {
   cachedBedrockClient = bedrockClient || null;
   cachedS3Client = s3Client || null;
};

const _parseAnthropicJson = raw => {
   try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const content = parsed && parsed.content;
      if (!Array.isArray(content)) return null;
      const text = content
         .filter(c => c && c.type === 'text' && typeof c.text === 'string')
         .map(c => c.text)
         .join('\n')
         .trim();
      const inputTokens = (parsed.usage && parsed.usage.input_tokens) || 0;
      const outputTokens = (parsed.usage && parsed.usage.output_tokens) || 0;
      let json = null;
      if (text) {
         const start = text.indexOf('{');
         const end = text.lastIndexOf('}');
         if (start !== -1 && end !== -1 && end > start) {
            try {
               json = JSON.parse(text.slice(start, end + 1));
            } catch (e) {
               json = null;
            }
         }
      }
      return { text, json, inputTokens, outputTokens };
   } catch (e) {
      return null;
   }
};

const _invokeOnce = async ({ client, modelId, system, messages, maxTokens, temperature }) => {
   const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      temperature,
      system,
      messages
   });
   const response = await client.send(
      new InvokeModelCommand({
         modelId,
         contentType: 'application/json',
         accept: 'application/json',
         body
      })
   );
   const raw = Buffer.from(response.body).toString('utf8');
   return raw;
};

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const invokeBedrockClaude = async ({
   modelId,
   system,
   messages,
   maxTokens = 1024,
   temperature = 0,
   accountId,
   userId = null,
   feature,
   timesheetEntryId = null,
   db = null
}) => {
   const client = getBedrockClient();
   const requestId = crypto.randomUUID();
   const startedAt = Date.now();
   let raw = null;
   let parsed = null;
   let status = 'ok';
   let errorMessage = null;

   // Token-bucket gate: never exceed configured per-model RPM. Cheap when
   // we're under the limit; backpressures the call when we're at the cap.
   await acquireSlot(modelId);

   try {
      raw = await _invokeOnce({ client, modelId, system, messages, maxTokens, temperature });
   } catch (err) {
      const transient = err && (err.name === 'ThrottlingException' || err.$metadata?.httpStatusCode >= 500);
      if (transient) {
         await _sleep(500 + Math.floor(Math.random() * 250));
         await acquireSlot(modelId);  // re-spend a token on the retry
         try {
            raw = await _invokeOnce({ client, modelId, system, messages, maxTokens, temperature });
         } catch (err2) {
            status = 'error';
            errorMessage = err2.message || String(err2);
         }
      } else {
         status = 'error';
         errorMessage = err.message || String(err);
      }
   }

   const latencyMs = Date.now() - startedAt;
   if (raw) parsed = _parseAnthropicJson(raw);
   const inputTokens = parsed ? parsed.inputTokens : 0;
   const outputTokens = parsed ? parsed.outputTokens : 0;
   const costUsd = estimateCost(modelId, inputTokens, outputTokens);

   const promptText = JSON.stringify({ system, messages });
   const auditRecord = {
      request_id: requestId,
      account_id: accountId,
      user_id: userId,
      timesheet_entry_id: timesheetEntryId,
      provider: 'bedrock',
      feature,
      model_id: modelId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      status,
      error_message: errorMessage,
      created_at: new Date().toISOString(),
      // Content hash + sizes let us correlate/debug without persisting PII.
      prompt_sha256: crypto.createHash('sha256').update(promptText).digest('hex'),
      prompt_chars: promptText.length,
      response_chars: raw ? String(raw).length : 0
   };

   // Only persist raw prompt/response when explicitly enabled, and redact PII first.
   if (LLM_LOG_RAW) {
      auditRecord.raw_response = raw ? _stringFallbackRedact(String(raw)) : raw;
      auditRecord.request = {
         system: system ? _stringFallbackRedact(String(system)) : system,
         messages: _stringFallbackRedact(JSON.stringify(messages)),
         maxTokens,
         temperature
      };
   }

   let s3LogKey = null;
   try {
      const s3Client = getS3Client();
      if (s3Client && LLM_LOG_BUCKET) {
         s3LogKey = await writeS3Log({ s3Client, bucket: LLM_LOG_BUCKET, record: auditRecord });
      }
   } catch (e) {
      // Audit failure must never break the call — surface as console only.
      console.error('[bedrock] S3 audit log write failed:', e.message);
   }

   if (db) {
      try {
         await writeDbLog(db, { ...auditRecord, s3_log_key: s3LogKey });
      } catch (e) {
         console.error('[bedrock] DB audit log write failed:', e.message);
      }
   }

   if (status !== 'ok' || !parsed || !parsed.json) {
      const reason = status !== 'ok' ? errorMessage : !parsed ? 'response_unparseable' : 'no_json_object_in_response';
      const errorObj = new Error(reason || 'Bedrock invocation failed or returned malformed response');
      errorObj.requestId = requestId;
      errorObj.status = status === 'ok' ? 'malformed' : status;
      errorObj.latencyMs = latencyMs;
      throw errorObj;
   }

   return {
      json: parsed.json,
      text: parsed.text,
      raw,
      latencyMs,
      inputTokens,
      outputTokens,
      cost: costUsd,
      requestId,
      s3LogKey
   };
};

const smokeTest = async ({ modelId, accountId = null, db = null } = {}) => {
   const target = modelId || process.env.BEDROCK_MODEL_TIMETRACKER_FAST || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
   // Smoke test must NOT write a DB audit row — accountId would be invalid
   // FK on the accounts table at boot time. Pass db=null unconditionally.
   return invokeBedrockClaude({
      modelId: target,
      system: 'Reply with the JSON {"ok":true}.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      maxTokens: 32,
      accountId,
      feature: 'smoke_test',
      db: null
   });
};

module.exports = {
   invokeBedrockClaude,
   smokeTest,
   _setClientsForTest,
   _parseAnthropicJson
};
