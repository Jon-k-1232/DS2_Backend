const workDescriptionService = {
   getActiveWorkDescriptions(db, accountID) {
      return db.select().from('customer_general_work_descriptions').where('account_id', accountID).where('is_general_work_description_active', true).orderBy('general_work_description', 'asc');
   },

   getSingleWorkDescription(db, workDescriptionID, accountID) {
      return db.select().from('customer_general_work_descriptions').where('general_work_description_id', workDescriptionID).andWhere('account_id', accountID);
   },

   createWorkDescription(db, newWorkDescription) {
      return db.insert(newWorkDescription).into('customer_general_work_descriptions');
   },

   updateWorkDescription(db, updatedWorkDescription, accountID) {
      return db
         .update(updatedWorkDescription)
         .into('customer_general_work_descriptions')
         .where('general_work_description_id', '=', updatedWorkDescription.general_work_description_id)
         .andWhere('account_id', accountID);
   },

   deleteWorkDescription(db, workDescriptionID, accountID) {
      return db.delete().from('customer_general_work_descriptions').where('general_work_description_id', '=', workDescriptionID).andWhere('account_id', accountID);
   }
};

module.exports = workDescriptionService;
