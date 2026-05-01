const { processEntries } = require('./auto-ingest-orchestrator');

const FLAG_OFF = 'off';
const FLAG_TEST = 'test';
const FLAG_ON = 'on';

const _isAccountAllowed = accountId => {
   const flag = process.env.TIME_TRACKER_AI_FEATURE_FLAG || FLAG_OFF;
   if (flag === FLAG_ON) return true;
   if (flag === FLAG_TEST) {
      const list = (process.env.TIME_TRACKER_AI_TEST_ACCOUNT_IDS || '')
         .split(',')
         .map(s => s.trim())
         .filter(Boolean)
         .map(Number);
      return list.includes(Number(accountId));
   }
   return false;
};

const kickOffAutoIngestForEntryIds = ({ db, accountId, userId, entryIds }) => {
   if (!db || !accountId || !userId || !Array.isArray(entryIds) || !entryIds.length) return;
   if (!_isAccountAllowed(accountId)) return;
   setImmediate(async () => {
      try {
         const result = await processEntries({ db, accountId, userId, entryIds });
         console.info(
            `[${new Date().toISOString()}] [auto-ingest] account=${accountId} user=${userId} processed=${result.processed} auto=${result.autoInserted} held=${result.held} totalCost=$${result.totalCostUsd.toFixed(4)}`
         );
      } catch (err) {
         console.error(`[${new Date().toISOString()}] [auto-ingest] fatal: ${err.message}`);
      }
   });
};

module.exports = {
   kickOffAutoIngestForEntryIds,
   _isAccountAllowed
};
