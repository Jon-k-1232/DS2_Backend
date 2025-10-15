const { AUTOMATION_DEFINITIONS, isValidAutomationKey } = require('../../automations/automationDefinitions');

const TABLE_NAME = 'account_automation_settings';

const automationSettingsService = {
   async ensureDefaultsForAccount(db, accountId) {
      if (!AUTOMATION_DEFINITIONS.length) return;
      const seedRows = AUTOMATION_DEFINITIONS.map(definition => ({
         account_id: accountId,
         automation_key: definition.key
      }));

      await db(TABLE_NAME)
         .insert(seedRows)
         .onConflict(['account_id', 'automation_key'])
         .ignore();
   },

   async listAccountAutomations(db, accountId) {
      await this.ensureDefaultsForAccount(db, accountId);
      const rows = await db(TABLE_NAME)
         .select('automation_key', 'is_enabled')
         .where({ account_id: accountId });

      const settingsByKey = rows.reduce((acc, row) => {
         acc[row.automation_key] = row.is_enabled;
         return acc;
      }, {});

      return AUTOMATION_DEFINITIONS.map(definition => ({
         ...definition,
         isEnabled: Object.prototype.hasOwnProperty.call(settingsByKey, definition.key)
            ? settingsByKey[definition.key]
            : true
      }));
   },

   async updateAutomationSetting(db, accountId, automationKey, isEnabled) {
      if (!isValidAutomationKey(automationKey)) {
         const error = new Error('Invalid automation key.');
         error.status = 400;
         throw error;
      }

      await this.ensureDefaultsForAccount(db, accountId);

      const [row] = await db(TABLE_NAME)
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

      const definition = AUTOMATION_DEFINITIONS.find(item => item.key === automationKey);

      return {
         ...definition,
         isEnabled: row?.is_enabled ?? isEnabled
      };
   },

   async getEnabledAccountIds(db, automationKey) {
      if (!isValidAutomationKey(automationKey)) {
         const error = new Error('Invalid automation key.');
         error.status = 400;
         throw error;
      }

      const rows = await db('accounts as a')
         .leftJoin('account_automation_settings as s', function () {
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
