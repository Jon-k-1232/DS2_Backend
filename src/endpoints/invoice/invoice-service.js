const invoiceService = {
   // Must stay desc, used in finding if an invoice has to be created
   getInvoices(db, accountID) {
      return db
         .select('customer_invoices.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
         .from('customer_invoices')
         .join('customers', 'customer_invoices.customer_id', 'customers.customer_id')
         .join('users', 'customer_invoices.created_by_user_id', 'users.user_id')
         .where('customer_invoices.account_id', accountID)
         .orderBy('customer_invoices.invoice_date', 'desc');
   },

   deleteInvoice(db, customerInvoiceID) {
      return db('customer_invoices').where('customer_invoice_id', customerInvoiceID).del();
   },

   // find most recent invoice and return the remaining balance
   // commented out 4/10/24 - fixing bug on invoice viewing, around invoice-router line 212
   // getRemainingInvoiceAmount(db, accountID, invoiceID) {
   //    return db.select('remaining_balance_on_invoice').from('customer_invoices').where('account_id', accountID).andWhere('parent_invoice_id', invoiceID).orderBy('created_at', 'desc').first();
   // },
   getRemainingInvoiceAmount(db, accountID, invoiceID) {
      return db
         .select('remaining_balance_on_invoice')
         .from('customer_invoices')
         .where('account_id', accountID)
         .andWhere(builder => {
            builder.where('parent_invoice_id', invoiceID).orWhere(qb => {
               qb.where('customer_invoice_id', invoiceID).andWhere('parent_invoice_id', null);
            });
         })
         .orderBy('created_at', 'desc')
         .first();
   },

   getOutstandingInvoicesBetweenDates(db, accountID, start_date, end_date) {
      return db
         .select('customer_invoices.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
         .from('customer_invoices')
         .join('customers', 'customer_invoices.customer_id', 'customers.customer_id')
         .join('users', 'customer_invoices.created_by_user_id', 'users.user_id')
         .where('customer_invoices.account_id', accountID)
         .andWhere('customer_invoices.is_invoice_paid_in_full', false)
         .andWhere('customer_invoices.remaining_balance_on_invoice', '>', 0)
         .andWhere('customer_invoices.invoice_date', '>=', start_date)
         .andWhere('customer_invoices.invoice_date', '<', end_date)
         .orderBy('customer_invoices.invoice_date', 'desc');
   },

   getCustomerInvoiceByID(db, accountID, customerID) {
      return db.select('*').from('customer_invoices').where('account_id', accountID).andWhere('customer_id', customerID).orderBy('invoice_date', 'asc');
   },

   getInvoiceByInvoiceRowID(db, accountID, invoiceRowID) {
      return db
         .select(
            'customer_invoices.*',
            db.raw('customers.display_name as customer_name'),
            'customer_information.customer_street',
            'customer_information.customer_city',
            'customer_information.customer_state',
            'customer_information.customer_zip',
            'customer_information.customer_email',
            'customer_information.customer_phone'
         )
         .from('customer_invoices')
         .join('customers', 'customer_invoices.customer_id', 'customers.customer_id')
         .join('customer_information', 'customer_invoices.customer_info_id', 'customer_information.customer_info_id')
         .where('customer_invoices.account_id', accountID)
         .andWhere('customer_invoices.customer_invoice_id', invoiceRowID);
   },

   async getLastInvoiceNumber(db, accountID) {
      return db.select('invoice_number').from('customer_invoices').where('account_id', accountID).orderBy('invoice_number', 'desc').first();
   },

   createInvoice(db, invoice) {
      return db
         .insert(invoice)
         .into('customer_invoices')
         .returning('*')
         .then(rows => rows[0]);
   },

   // Returns an object vs array.
   getAccountPayToInfo(db, accountID) {
      return db
         .select(
            'accounts.*',
            'account_information.account_street',
            'account_information.account_city',
            'account_information.account_state',
            'account_information.account_zip',
            'account_information.account_email',
            'account_information.account_phone'
         )
         .from('accounts')
         .leftJoin('account_information', function () {
            this.on('accounts.account_id', '=', 'account_information.account_id')
               .andOn('account_information.is_account_mailing_address', db.raw('?', [true]))
               .andOn('account_information.is_this_address_active', db.raw('?', [true]));
         })
         .where('accounts.account_id', accountID)
         .then(rows => rows[0]);
   },

   async getLastInvoiceDatesByCustomerID(db, accountID, customerIDs) {
      const data = await db
         .select('customer_id')
         .max('created_at as last_invoice_date')
         .from('customer_invoices')
         .where('account_id', accountID)
         .whereIn('customer_id', customerIDs)
         .andWhere(function () {
            this.whereNull('parent_invoice_id').orWhereRaw('parent_invoice_id = customer_invoice_id');
         })
         .groupBy('customer_id')
         .orderBy('last_invoice_date', 'desc');

      return data.reduce((result, { customer_id, last_invoice_date }) => ({ ...result, [customer_id]: last_invoice_date }), {});
   },

   getCustomerInvoicesByCustomerID(db, customerID, accountID) {
      return db
         .select('*')
         .from('customer_invoices')
         .where('account_id', accountID)
         .where('customer_id', customerID)
         .andWhere('is_invoice_paid_in_full', false)
         .andWhere('remaining_balance_on_invoice', '>', 0)
         .orderBy('created_at', 'desc');
   },

   async getCustomerInformation(db, accountID, customerIDs) {
      const data = await db
         .from('customers')
         .join('customer_information', 'customers.customer_id', '=', 'customer_information.customer_id')
         .select('customers.*', 'customer_information.*')
         .whereIn('customers.customer_id', customerIDs)
         .where({
            'customers.account_id': accountID,
            'customer_information.is_customer_mailing_address': true,
            'customer_information.is_this_address_active': true,
            'customer_information.account_id': accountID
         });

      return data.reduce((result, { customer_id, ...info }) => ({ ...result, [customer_id]: info }), {});
   },

   // Based off the last date, finds all transactions
   async getTransactionsByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_transactions')
         .join('customer_jobs', 'customer_jobs.customer_job_id', '=', 'customer_transactions.customer_job_id')
         .join('customer_job_types', 'customer_job_types.job_type_id', '=', 'customer_jobs.job_type_id')
         .select('customer_transactions.*', 'customer_jobs.*', 'customer_job_types.*')
         .where({
            'customer_transactions.account_id': accountID
         })
         .andWhere(builder => {
            customerIDs.forEach(id => {
               // Handles query if there is a id in the lastBillDateLookup
               if (lastBillDateLookup[id]) {
                  builder.orWhere(subQuery => {
                     subQuery
                        .where('customer_transactions.customer_id', id)
                        .andWhere('customer_transactions.created_at', '>=', lastBillDateLookup[id])
                        .whereNull('customer_transactions.customer_invoice_id');
                  });
                  // Handles query if there is no id in the lastBillDateLookup
               } else {
                  builder.orWhere('customer_transactions.customer_id', id);
               }
            });
         });

      return data.reduce((result, transaction) => {
         const { customer_id } = transaction;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(transaction);
         return result;
      }, {});
   },

   async getPaymentsByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_payments')
         // switched to left join to include payments that are not attached to an invoice through a transaction. was just a 'join'.
         .leftJoin('customer_invoices', 'customer_invoices.customer_invoice_id', '=', 'customer_payments.customer_invoice_id')
         .select('customer_payments.*', 'customer_invoices.*')
         .where({
            'customer_payments.account_id': accountID
         })
         .andWhere(builder => {
            customerIDs.forEach(id => {
               // Handles query if there is an ID in the lastBillDateLookup
               if (lastBillDateLookup[id]) {
                  builder.orWhere(subQuery => {
                     // Changed payment date to created_at from payment date since created_at has the time stamp.
                     subQuery.where('customer_payments.customer_id', id).andWhere('customer_payments.created_at', '>=', lastBillDateLookup[id]);
                  });
                  // Handles query if there is no ID in the lastBillDateLookup
               } else {
                  builder.orWhere('customer_payments.customer_id', id);
               }
            });
         });

      return data.reduce((result, payment) => {
         const { customer_id } = payment;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(payment);
         return result;
      }, {});
   },

   async getWriteOffsByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_writeoffs')
         .leftJoin('customer_invoices', 'customer_invoices.customer_invoice_id', '=', 'customer_writeoffs.customer_invoice_id')
         .leftJoin('customer_jobs', 'customer_jobs.customer_job_id', '=', 'customer_writeoffs.customer_job_id')
         .leftJoin('customer_job_types', 'customer_job_types.job_type_id', '=', 'customer_jobs.job_type_id')
         .select('customer_writeoffs.*', 'customer_jobs.job_type_id', 'customer_job_types.job_description')
         .where({
            'customer_writeoffs.account_id': accountID
         })
         .andWhere(builder => {
            customerIDs.forEach(id => {
               // Handles query if there is a id in the lastBillDateLookup
               if (lastBillDateLookup[id]) {
                  builder.orWhere(subQuery => {
                     subQuery.where('customer_writeoffs.customer_id', id).andWhere('customer_writeoffs.created_at', '>=', lastBillDateLookup[id]);
                  });
                  // Handles query if there is no id in the lastBillDateLookup
               } else {
                  builder.orWhere('customer_writeoffs.customer_id', id);
               }
            });
         });

      return data.reduce((result, writeoff) => {
         const { customer_id } = writeoff;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(writeoff);
         return result;
      }, {});
   },

   async getRetainersByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_retainers_and_prepayments')
         .select('customer_retainers_and_prepayments.*')
         .where('customer_retainers_and_prepayments.account_id', accountID)
         .andWhere(builder => {
            customerIDs.forEach(id => {
               if (lastBillDateLookup[id]) {
                  builder.orWhere(subQuery => {
                     subQuery.where('customer_retainers_and_prepayments.customer_id', id).andWhere('customer_retainers_and_prepayments.created_at', '>=', lastBillDateLookup[id]);
                  });
               } else {
                  builder.orWhere('customer_retainers_and_prepayments.customer_id', id);
               }
            });
         });

      return data.reduce((result, retainer) => {
         const { customer_id } = retainer;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(retainer);
         return result;
      }, {});
   },

   /**
    * Requirements-
    * Include parent invoices that do not have children and have a remaining balance.
    * Include parent invoices along with all their children where at least one of the children still has a remaining balance.
    * Include parent invoices along with all their children where a payment has been made after the last invoice date, regardless of the remaining balance.
    */
   async getOutstandingInvoices(db, accountID, customerIDs, lastBillDateLookup) {
      const outstandingInvoices = {};

      // Fetch all parent invoices
      const parentInvoices = await db
         .select('*')
         .from('customer_invoices')
         .where('account_id', accountID)
         .whereIn('customer_id', customerIDs)
         .andWhere('parent_invoice_id', null)
         .orderBy('created_at', 'desc');

      // Function to handle the children of each parent
      const handleChildren = async parentInvoice => {
         const children = await db.select('*').from('customer_invoices').where('parent_invoice_id', parentInvoice.customer_invoice_id).orderBy('created_at', 'desc');
         const lastBillDate = lastBillDateLookup[parentInvoice.customer_id];

         if (!outstandingInvoices[parentInvoice.customer_id]) outstandingInvoices[parentInvoice.customer_id] = [];

         // Include parent invoices that do not have children and have a remaining balance
         if (Number(parentInvoice.remaining_balance_on_invoice) > 0 && !children.length) {
            outstandingInvoices[parentInvoice.customer_id].push(parentInvoice);
            return;
         }

         // Include parent invoices along with all their children where at least one of the children still has a remaining balance
         if (children.some(child => Number(child.remaining_balance_on_invoice) > 0)) {
            outstandingInvoices[parentInvoice.customer_id].push(...children, parentInvoice);
            return;
         }

         // Include parent invoices along with all their children where a payment has been made after the last invoice date, regardless of the remaining balance
         const paymentAfterLastBillDate = children.some(child => Number(child.remaining_balance_on_invoice) === 0 && new Date(child.created_at) > new Date(lastBillDate));

         if (paymentAfterLastBillDate) {
            outstandingInvoices[parentInvoice.customer_id].push(...children, parentInvoice);
            return;
         }
      };

      await Promise.all(parentInvoices.map(handleChildren));

      return outstandingInvoices;
   }
};

module.exports = invoiceService;
