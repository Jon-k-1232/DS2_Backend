const { PutObjectCommand } = require('@aws-sdk/client-s3');

const s3KeyForCall = ({ accountId, feature, requestId, when = new Date() }) => {
   const yyyy = when.getUTCFullYear();
   const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
   const dd = String(when.getUTCDate()).padStart(2, '0');
   const hhmmss = `${String(when.getUTCHours()).padStart(2, '0')}${String(when.getUTCMinutes()).padStart(2, '0')}${String(when.getUTCSeconds()).padStart(2, '0')}`;
   return `${yyyy}/${mm}/${dd}/${hhmmss}_acct${accountId}_${feature}_${requestId}.json`;
};

const writeS3Log = async ({ s3Client, bucket, record }) => {
   if (!bucket || !s3Client) return null;
   const key = s3KeyForCall({
      accountId: record.account_id,
      feature: record.feature,
      requestId: record.request_id,
      when: record.created_at ? new Date(record.created_at) : new Date()
   });
   await s3Client.send(
      new PutObjectCommand({
         Bucket: bucket,
         Key: key,
         Body: JSON.stringify(record, null, 2),
         ContentType: 'application/json'
      })
   );
   return key;
};

const writeDbLog = async (db, record) => {
   if (!db || !record || record.account_id == null) return null;
   const [row] = await db('ai_call_log')
      .insert({
         request_id: record.request_id,
         account_id: record.account_id,
         user_id: record.user_id || null,
         timesheet_entry_id: record.timesheet_entry_id || null,
         provider: record.provider || 'bedrock',
         feature: record.feature,
         model_id: record.model_id,
         input_tokens: record.input_tokens || null,
         output_tokens: record.output_tokens || null,
         cost_usd: record.cost_usd || null,
         latency_ms: record.latency_ms || null,
         status: record.status || 'ok',
         error_message: record.error_message || null,
         s3_log_key: record.s3_log_key || null
      })
      .returning('ai_call_log_id');
   return row && (row.ai_call_log_id || row);
};

module.exports = { s3KeyForCall, writeS3Log, writeDbLog };
