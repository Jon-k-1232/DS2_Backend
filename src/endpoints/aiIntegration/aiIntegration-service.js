const AI_INTEGRATION_TABLE = 'ai_integrations';

const aiIntegrationService = {
   getIntegrationByAccount(db, accountId) {
      return db(AI_INTEGRATION_TABLE).where({ account_id: accountId }).first();
   },

   createIntegration(db, integration) {
      return db(AI_INTEGRATION_TABLE)
         .insert({ ...integration, updated_at: db.raw('NOW()') })
         .returning('*')
         .then(rows => rows[0]);
   },

   updateIntegration(db, accountId, updates) {
      return db(AI_INTEGRATION_TABLE)
         .where({ account_id: accountId })
         .update({ ...updates, updated_at: db.raw('NOW()') })
         .returning('*')
         .then(rows => rows[0]);
   },

   deleteIntegration(db, accountId) {
      return db(AI_INTEGRATION_TABLE).where({ account_id: accountId }).del();
   }
};

module.exports = aiIntegrationService;
