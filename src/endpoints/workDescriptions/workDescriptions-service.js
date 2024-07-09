const workDescriptionService = {
   getActiveWorkDescriptions(db, accountID) {
      return db.select().from('customer_general_work_descriptions').where('account_id', accountID).where('is_general_work_description_active', true).orderBy('general_work_description', 'asc');
   },

   getSingleWorkDescription(db, workDescriptionID) {
      return db.select().from('customer_general_work_descriptions').where('general_work_description_id', workDescriptionID);
   },

   createWorkDescription(db, newWorkDescription) {
      return db.insert(newWorkDescription).into('customer_general_work_descriptions');
   },

   updateWorkDescription(db, updatedWorkDescription) {
      return db.update(updatedWorkDescription).into('customer_general_work_descriptions').where('general_work_description_id', '=', updatedWorkDescription.general_work_description_id);
   },

   deleteWorkDescription(db, workDescriptionID) {
      return db.delete().from('customer_general_work_descriptions').where('general_work_description_id', '=', workDescriptionID);
   }
};

module.exports = workDescriptionService;
