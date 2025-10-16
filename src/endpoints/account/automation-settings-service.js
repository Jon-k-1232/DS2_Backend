const { AUTOMATION_DEFINITIONS, isValidAutomationKey } = require('../../automations/automationDefinitions');

const SETTINGS_TABLE = 'account_automation_settings';
const RECIPIENTS_TABLE = 'account_automation_recipients';

const automationSettingsService = {
   async ensureDefaultsForAccount(db, accountId) {
      if (!AUTOMATION_DEFINITIONS.length) return;
      const seedRows = AUTOMATION_DEFINITIONS.map(definition => ({
         account_id: accountId,
         automation_key: definition.key
      }));

      await db(SETTINGS_TABLE)
         .insert(seedRows)
         .onConflict(['account_id', 'automation_key'])
         .ignore();
   },

   async listAccountAutomations(db, accountId) {
      await this.ensureDefaultsForAccount(db, accountId);
      const [settingsRows, recipientRows] = await Promise.all([
         db(SETTINGS_TABLE).select('automation_key', 'is_enabled').where({ account_id: accountId }),
         db(RECIPIENTS_TABLE).select('automation_key', 'user_id').where({ account_id: accountId })
      ]);

      const settingsByKey = settingsRows.reduce((acc, row) => {
         acc[row.automation_key] = row.is_enabled;
         return acc;
      }, {});

      const recipientsByKey = recipientRows.reduce((acc, row) => {
         if (!acc[row.automation_key]) {
            acc[row.automation_key] = [];
         }
         acc[row.automation_key].push(row.user_id);
         return acc;
      }, {});

      return AUTOMATION_DEFINITIONS.map(definition => ({
         ...definition,
         isEnabled: Object.prototype.hasOwnProperty.call(settingsByKey, definition.key)
            ? settingsByKey[definition.key]
            : true,
         recipientUserIds: recipientsByKey[definition.key] || []
      }));
   },

   async getRecipientUserIds(db, accountId, automationKey) {
      const rows = await db(RECIPIENTS_TABLE)
         .select('user_id')
         .where({ account_id: accountId, automation_key: automationKey });
      return rows.map(row => row.user_id);
   },

   async replaceAutomationRecipients(db, accountId, automationKey, recipientUserIds = []) {
      if (!isValidAutomationKey(automationKey)) {
         const error = new Error('Invalid automation key.');
         error.status = 400;
         throw error;
      }

      const uniqueIds = Array.from(
         new Set(
            (recipientUserIds || [])
               .map(id => Number.parseInt(id, 10))
               .filter(id => Number.isInteger(id) && id > 0)
         )
      );

      await db(RECIPIENTS_TABLE)
         .where({ account_id: accountId, automation_key: automationKey })
         .del();

      if (!uniqueIds.length) {
         return [];
      }

      const validUsers = await db('users')
         .select('user_id')
         .where({ account_id: accountId, is_user_active: true })
         .whereIn('user_id', uniqueIds);

      if (validUsers.length !== uniqueIds.length) {
         const error = new Error('One or more selected users are invalid.');
         error.status = 400;
         throw error;
      }

      const rowsToInsert = validUsers.map(user => ({
         account_id: accountId,
         automation_key: automationKey,
         user_id: user.user_id
      }));

      await db(RECIPIENTS_TABLE).insert(rowsToInsert);

      return rowsToInsert.map(row => row.user_id);
   },

   async updateAutomationSetting(db, accountId, automationKey, updates = {}) {
      if (!isValidAutomationKey(automationKey)) {
         const error = new Error('Invalid automation key.');
         error.status = 400;
         throw error;
      }

      await this.ensureDefaultsForAccount(db, accountId);

      let latestSettings = null;

      if (Object.prototype.hasOwnProperty.call(updates, 'isEnabled')) {
         const isEnabled = Boolean(updates.isEnabled);
         const [row] = await db(SETTINGS_TABLE)
            .insert({
               account_id: accountId,
               automation_key: automationKey,
               is_enabled: isEnabled
            })
            .onConflict(['account_id', 'automation_key'])
            .merge({
               is_enabled: isEnabled,
               updated_at: db.fn.now()
            })
            .returning(['automation_key', 'is_enabled']);
         latestSettings = row;
      }

      let recipientUserIds;
      if (Object.prototype.hasOwnProperty.call(updates, 'recipientUserIds')) {
         recipientUserIds = await this.replaceAutomationRecipients(db, accountId, automationKey, updates.recipientUserIds);
      } else {
         recipientUserIds = await this.getRecipientUserIds(db, accountId, automationKey);
      }

      if (!latestSettings) {
         const [row] = await db(SETTINGS_TABLE)
            .select('automation_key', 'is_enabled')
            .where({ account_id: accountId, automation_key: automationKey })
            .limit(1);
         latestSettings = row || { automation_key: automationKey, is_enabled: true };
      }

      const definition = AUTOMATION_DEFINITIONS.find(item => item.key === automationKey);

      return {
         ...definition,
         isEnabled: latestSettings?.is_enabled ?? true,
         recipientUserIds
      };
   },

   async getEnabledAccountIds(db, automationKey) {
      if (!isValidAutomationKey(automationKey)) {
         const error = new Error('Invalid automation key.');
         error.status = 400;
         throw error;
      }

      const rows = await db('accounts as a')
         .leftJoin(`${SETTINGS_TABLE} as s`, function () {
            this.on('a.account_id', '=', 's.account_id').andOn('s.automation_key', '=', db.raw('?', [automationKey]));
         })
         .where('a.is_account_active', true)
         .where(builder => {
            builder.whereNull('s.account_automation_setting_id').orWhere('s.is_enabled', true);
         })
         .select('a.account_id');

      return rows.map(row => row.account_id);
   }
};

module.exports = automationSettingsService;
