// Resolve submitted references using the authenticated account. Individual FKs
// alone cannot prove that two rows belong to the same tenant.
const requireAccountRow = async (db, table, idColumn, id, accountId, label) => {
   const numericId = Number(id);
   const row = Number.isInteger(numericId) && numericId > 0
      ? await db(table).where({ [idColumn]: numericId, account_id: Number(accountId) }).first()
      : null;
   if (!row) {
      const error = new Error(`${label} not found in this account.`);
      error.status = error.statusCode = 422;
      throw error;
   }
   return row;
};

const requireCustomerJob = async (db, fields) => {
   await requireAccountRow(db, 'customers', 'customer_id', fields.customer_id, fields.account_id, 'Customer');
   const job = await requireAccountRow(db, 'customer_jobs', 'customer_job_id', fields.customer_job_id, fields.account_id, 'Job');
   if (Number(job.customer_id) !== Number(fields.customer_id)) {
      const error = new Error('Job does not belong to this customer.');
      error.status = error.statusCode = 422;
      throw error;
   }
};

module.exports = { requireAccountRow, requireCustomerJob };
