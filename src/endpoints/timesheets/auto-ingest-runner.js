const { processEntries } = require('./auto-ingest-orchestrator');
const notificationsService = require('../notifications/notifications-service');

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

const _staffUserIds = async (db, accountId) => {
   const rows = await db('time_tracker_staff as tts')
      .join('users as u', 'u.user_id', 'tts.user_id')
      .where('tts.is_active', true)
      .andWhere('u.account_id', accountId)
      .andWhere('u.is_user_active', true)
      .select('u.user_id');
   return rows.map(r => r.user_id);
};

const _fanOutNotifications = async (db, { accountId, userId, result }) => {
   const staffUserIds = await _staffUserIds(db, accountId);
   const recipientIds = Array.from(new Set([userId, ...staffUserIds].filter(Boolean)));
   if (!recipientIds.length) return;

   const heldReasons = (result.perEntry || [])
      .filter(r => r.decision === 'hold')
      .map(r => r.reason);
   const newCustomerNeeded = heldReasons.includes('new_customer_needs_addition');
   const anyHeld = result.held > 0;

   const notifType = anyHeld
      ? newCustomerNeeded
         ? 'new_customer_needs_addition'
         : 'rows_held_for_review'
      : 'tracker_upload_processed';

   const title = anyHeld
      ? `${result.held} time-tracker row${result.held === 1 ? '' : 's'} need review`
      : `${result.autoInserted} rows auto-applied`;

   const body = `Auto-applied: ${result.autoInserted}. Held for review: ${result.held}. AI cost today so far: $${result.totalCostUsd.toFixed(4)}.`;

   try {
      await notificationsService.insertForUsers(db, {
         accountId,
         userIds: recipientIds,
         type: notifType,
         title,
         body,
         payload: { autoInserted: result.autoInserted, held: result.held, totalCostUsd: result.totalCostUsd }
      });
   } catch (e) {
      console.error('[auto-ingest] notification fan-out failed:', e.message);
   }
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
         await _fanOutNotifications(db, { accountId, userId, result });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] [auto-ingest] fatal: ${err.message}`);
      }
   });
};

module.exports = {
   kickOffAutoIngestForEntryIds,
   _isAccountAllowed
};
