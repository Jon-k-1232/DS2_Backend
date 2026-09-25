const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const { restoreDataTypesCustomersOnCreate, restoreDataTypesCustomersInformationOnCreate } = require('../../src/endpoints/customer/customerObjects');
const { restoreDataTypesJobTableOnCreate } = require('../../src/endpoints/job/jobObjects');
const { restoreDataTypesTransactionsTableOnCreate } = require('../../src/endpoints/transactions/transactionsObjects');

// Foreign references are SELECT-only from the production copy. Every inserted,
// changed and deleted row is in fixture account 9001 and belongs to this run.
describe('F2 related IDs and creator attribution', function () {
   let h, c, c2, job, other = {};
   const tag = uniqueName('F2');
   const tracked = [];
   const insert = async (table, fields) => {
      const [row] = await h.db(table).insert({ ...fields, account_id: 9001 }).returning('*');
      tracked.push({ table, row });
      return row;
   };
   const keys = { customers: 'customer_id', customer_information: 'customer_info_id',
      customer_jobs: 'customer_job_id', customer_transactions: 'transaction_id',
      customer_job_types: 'job_type_id', customer_job_categories: 'customer_job_category_id',
      customer_general_work_descriptions: 'general_work_description_id',
      recurring_customers: 'recurring_customer_id', customer_quotes: 'customer_quote_id' };
   const txBody = overrides => ({ accountID: 9001, customerID: c.customer_id,
      customerJobID: job.customer_job_id, loggedForUserID: 90011, loggedByUserID: 90013,
      selectedGeneralWorkDescriptionID: 90031, transactionType: 'Time', transactionDate: '2026-09-01',
      quantity: 1, unitCost: 10, totalTransaction: 10, isTransactionBillable: false,
      detailedJobDescription: tag, ...overrides });
   const jobBody = overrides => ({ accountID: 9001, userID: 90012, customerID: c2.customer_id,
      jobTypeID: 900201, quoteAmount: 0, notes: tag, ...overrides });
   const recurringBody = overrides => ({ accountID: 9001, userID: 90012, customerID: c.customer_id,
      subscriptionFrequency: tag, billingCycle: 1, recurringAmount: 25, startDate: '2026-09-01', ...overrides });
   const quoteBody = overrides => ({ account_id: 9001, created_by_user_id: 90012,
      customer_id: c.customer_id, customer_job_id: job.customer_job_id, amount_quoted: 25,
      is_quote_active: true, notes: tag, ...overrides });
   before(async function () {
      h = await bootHttp.call(this);
      for (const [name, table] of Object.entries({ user: 'users', customer: 'customers', job: 'customer_jobs',
         type: 'customer_job_types', category: 'customer_job_categories', description: 'customer_general_work_descriptions' })) {
         other[name] = await h.db(table).where({ account_id: 1 }).first();
         expect(other[name], `read-only foreign ${name} fixture`).to.exist;
      }
      c = await insert('customers', restoreDataTypesCustomersOnCreate({ customerName: tag, isCustomerActive: true }));
      c2 = await insert('customers', restoreDataTypesCustomersOnCreate({ customerName: `${tag}-2`, isCustomerActive: true }));
      await insert('customer_information', restoreDataTypesCustomersInformationOnCreate({ customer_id: c.customer_id, userID: 90013, isCustomerAddressActive: true }));
      job = await insert('customer_jobs', restoreDataTypesJobTableOnCreate({ ...jobBody(), customerID: c.customer_id, userID: 90013 }));
   });
   after(async () => {
      if (!h) return;
      // Include rows a vulnerable endpoint accepted before the refusal assertion.
      for (const [table, column] of [['customer_transactions', 'detailed_work_description'], ['customer_quotes', 'notes'],
         ['recurring_customers', 'subscription_frequency'], ['customer_jobs', 'notes'],
         ['customer_job_types', 'job_description'], ['customer_job_categories', 'customer_job_category'],
         ['customer_general_work_descriptions', 'general_work_description']]) {
         await h.db(table).where({ account_id: 9001 }).where(column, 'like', `${tag}%`).del();
      }
      for (const { table, row } of tracked.reverse()) {
         await h.db(table).where({ account_id: 9001, [keys[table]]: row[keys[table]] }).del();
      }
      await h.close();
   });

   for (const field of ['loggedForUserID', 'selectedGeneralWorkDescriptionID']) {
      for (const action of ['create', 'update']) it(`refuses foreign transaction ${field} on ${action} before any writes`, async () => {
         const valid = txBody();
         const stored = action === 'update' ? await insert('customer_transactions', restoreDataTypesTransactionsTableOnCreate(valid)) : null;
         const beforeJobs = await h.db('customer_jobs').where({ account_id: 9001, customer_id: c.customer_id });
         const beforeTx = await h.db('customer_transactions').where({ account_id: 9001, customer_id: c.customer_id });
         const foreignID = field === 'loggedForUserID' ? other.user.user_id : other.description.general_work_description_id;
         const res = await h.as('admin')[action === 'create' ? 'post' : 'put'](`/transactions/${action}Transaction/9001/90013`)
            .send({ transaction: { ...valid, transactionID: stored && stored.transaction_id, [field]: foreignID } });
         expectEnvelopeRefused(res, /account|not found|belong/i);
         expect(await h.db('customer_jobs').where({ account_id: 9001, customer_id: c.customer_id })).to.deep.equal(beforeJobs);
         expect(await h.db('customer_transactions').where({ account_id: 9001, customer_id: c.customer_id })).to.deep.equal(beforeTx);
      });
   }
   for (const action of ['create', 'update']) {
      it(`refuses foreign job type on job ${action}`, async () => {
         const res = await h.as('admin')[action === 'create' ? 'post' : 'put'](`/jobs/${action}Job/9001/90013`)
            .send({ job: jobBody({ customerJobID: job.customer_job_id, customerID: c.customer_id, jobTypeID: other.type.job_type_id }) });
         expectEnvelopeRefused(res, /account|not found|belong/i);
      });
      it(`refuses foreign category on job-type ${action}`, async () => {
         const own = await insert('customer_job_types', { customer_job_category_id: 90001, job_description: `${tag}-${uniqueName()}`,
            book_rate: 10, estimated_straight_time: 1, is_job_type_active: true, created_by_user_id: 90013 });
         const res = await h.as('admin')[action === 'create' ? 'post' : 'put'](`/jobTypes/${action}JobType/9001/90013`)
            .send({ jobType: { jobTypeID: own.job_type_id, customerJobCategory: other.category.customer_job_category_id,
               jobDescription: `${tag}-${uniqueName()}`, bookRate: 10, estimatedStraightTime: 1, userID: 90013 } });
         expectEnvelopeRefused(res, /account|not found|belong/i);
      });
      for (const relation of ['customer', 'job', 'mismatched customer']) it(`refuses ${relation} on quote ${action}`, async () => {
         const stored = await insert('customer_quotes', { ...quoteBody(), created_by_user_id: 90013 });
         const overrides = relation === 'customer' ? { customer_id: other.customer.customer_id }
            : relation === 'job' ? { customer_job_id: other.job.customer_job_id } : { customer_id: c2.customer_id };
         const res = await h.as('admin')[action === 'create' ? 'post' : 'put'](`/quotes/${action}Quote`)
            .send({ quote: quoteBody({ customer_quote_id: stored.customer_quote_id, ...overrides }) });
         expectEnvelopeRefused(res, /account|not found|belong|customer/i);
      });
   }
   it('refuses a foreign customer before recurring creation', async () => {
      const res = await h.as('admin').post('/recurringCustomer/createRecurringCustomer/9001/90013')
         .send({ recurringCustomer: recurringBody({ customerID: other.customer.customer_id }) });
      expectEnvelopeRefused(res, /account|not found|belong/i);
   });

   const entities = [
      { name: 'job category', table: 'customer_job_categories', wrapper: 'jobCategory', create: '/jobCategories/createJobCategory/9001/21', update: '/jobCategories/updateJobCategory/9001/21',
         fields: () => ({ category: `${tag}-actor`, isActive: true, createdBy: 21 }), edit: r => ({ customerJobCategoryID: r.customer_job_category_id, selectedNewJobCategory: r.customer_job_category, isJobCategoryActive: true, createdByUserID: 90012 }) },
      { name: 'job type', table: 'customer_job_types', wrapper: 'jobType', create: '/jobTypes/createJobType/9001/21', update: '/jobTypes/updateJobType/9001/21',
         fields: () => ({ jobDescription: `${tag}-actor`, customerJobCategory: 90001, bookRate: 10, estimatedStraightTime: 1, userID: 21 }), edit: r => ({ jobTypeID: r.job_type_id, userID: 90012 }) },
      { name: 'work description', table: 'customer_general_work_descriptions', wrapper: 'workDescription', create: '/workDescriptions/createWorkDescription/9001/21', update: '/workDescriptions/updateWorkDescription/9001/21',
         fields: () => ({ generalWorkDescription: `${tag}-actor`, estimatedTime: 1 }), edit: r => ({ generalWorkDescriptionID: r.general_work_description_id, createdByUserID: 90012 }) },
      { name: 'job', table: 'customer_jobs', wrapper: 'job', create: '/jobs/createJob/9001/21', update: '/jobs/updateJob/9001/21',
         fields: () => jobBody({ jobTypeID: 900204, userID: 21 }), edit: r => ({ customerJobID: r.customer_job_id, userID: 90012 }) },
      { name: 'quote', table: 'customer_quotes', wrapper: 'quote', create: '/quotes/createQuote', update: '/quotes/updateQuote',
         fields: () => quoteBody({ created_by_user_id: 21 }), edit: r => ({ customer_quote_id: r.customer_quote_id, created_by_user_id: 90012 }) },
      { name: 'recurring customer', table: 'recurring_customers', wrapper: 'recurringCustomer', create: '/recurringCustomer/createRecurringCustomer/9001/21', update: '/recurringCustomer/updateRecurringCustomer',
         fields: () => recurringBody({ userID: 21 }), edit: r => ({ recurringCustomerID: r.recurring_customer_id, userID: 90012 }) }
   ];
   for (const e of entities) it(`uses the session creator and preserves it on ${e.name} edits`, async () => {
      const fields = e.fields();
      const before = (await h.db(e.table).where({ account_id: 9001 }).select(keys[e.table])).map(r => r[keys[e.table]]);
      expectEnvelopeOk(await h.as('admin').post(e.create).send({ [e.wrapper]: fields }));
      const row = await h.db(e.table).where({ account_id: 9001 }).whereNotIn(keys[e.table], before).first();
      expect(row).to.exist;
      expect(Number(row.created_by_user_id)).to.equal(90013);
      // Another account-9001 creator represents historical attribution.
      await h.db(e.table).where({ account_id: 9001, [keys[e.table]]: row[keys[e.table]] }).update({ created_by_user_id: 90011 });
      expectEnvelopeOk(await h.as('admin').put(e.update).send({ [e.wrapper]: { ...fields, ...e.edit(row) } }));
      const edited = await h.db(e.table).where({ account_id: 9001, [keys[e.table]]: row[keys[e.table]] }).first();
      expect(Number(edited.created_by_user_id)).to.equal(90011);
   });
   const customerBody = overrides => ({ accountID: 1, userID: 21, customerID: c.customer_id,
      customerName: c.display_name, isCustomerActive: true, isCustomerAddressActive: true,
      isCustomerRecurring: true, ...recurringBody(), ...overrides });
   it('uses and preserves the session creator for recurring changes embedded in a customer update', async () => {
      const contact = await h.db('customer_information').where({ account_id: 9001, customer_id: c.customer_id }).first();
      const before = (await h.db('recurring_customers').where({ account_id: 9001, customer_id: c.customer_id })).map(r => r.recurring_customer_id);
      const fields = customerBody({ customerInfoID: contact.customer_info_id, userID: 21 });
      expectEnvelopeOk(await h.as('admin').put('/customer/updateCustomer/9001/21').send({ customer: fields }));
      const row = await h.db('recurring_customers').where({ account_id: 9001, customer_id: c.customer_id }).whereNotIn('recurring_customer_id', before).first();
      expect(Number(row.created_by_user_id)).to.equal(90013);
      await h.db('recurring_customers').where({ account_id: 9001, recurring_customer_id: row.recurring_customer_id }).update({ created_by_user_id: 90011 });
      expectEnvelopeOk(await h.as('admin').put('/customer/updateCustomer/9001/21').send({ customer: { ...fields, recurringCustomerID: row.recurring_customer_id } }));
      expect(Number((await h.db('recurring_customers').where({ account_id: 9001, recurring_customer_id: row.recurring_customer_id }).first()).created_by_user_id)).to.equal(90011);
   });
   it('rejects another customer recurring ID before changing the customer or subscription', async () => {
      const row = await insert('recurring_customers', { customer_id: c2.customer_id, subscription_frequency: tag,
         bill_on_date: 1, recurring_bill_amount: 25, start_date: '2026-01-01', is_recurring_customer_active: true, created_by_user_id: 90013 });
      const before = await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id }).first();
      const res = await h.as('admin').put('/customer/updateCustomer/9001/21').send({ customer: customerBody({ recurringCustomerID: row.recurring_customer_id, customerName: `${tag}-tampered` }) });
      expectEnvelopeRefused(res, /belong.*customer/i);
      expect(await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id }).first()).to.deep.equal(before);
      expect(await h.db('recurring_customers').where({ account_id: 9001, recurring_customer_id: row.recurring_customer_id }).first()).to.deep.equal(row);
   });
   it('does not disclose labels through existing malformed relations', async () => {
      const t = await insert('customer_transactions', restoreDataTypesTransactionsTableOnCreate(txBody({ loggedForUserID: other.user.user_id, selectedGeneralWorkDescriptionID: other.description.general_work_description_id })));
      const j = await insert('customer_jobs', restoreDataTypesJobTableOnCreate(jobBody({ jobTypeID: other.type.job_type_id, userID: other.user.user_id })));
      const jt = await insert('customer_job_types', { customer_job_category_id: other.category.customer_job_category_id, job_description: `${tag}-legacy`, book_rate: 10, estimated_straight_time: 1, is_job_type_active: true, created_by_user_id: 90013 });
      const rc = await insert('recurring_customers', { customer_id: other.customer.customer_id, subscription_frequency: tag, bill_on_date: 1, recurring_bill_amount: 25, start_date: '2026-01-01', is_recurring_customer_active: true, created_by_user_id: 90013 });
      const transactions = await require('../../src/endpoints/transactions/transactions-service').getActiveTransactions(h.db, 9001);
      expect(transactions.find(r => r.transaction_id === t.transaction_id)).to.be.undefined;
      const jobs = await require('../../src/endpoints/job/job-service').getActiveJobs(h.db, 9001);
      expect(jobs.find(r => r.customer_job_id === j.customer_job_id)).to.be.undefined;
      const types = await require('../../src/endpoints/jobType/jobType-service').getActiveJobTypes(h.db, 9001);
      const type = types.find(r => r.job_type_id === jt.job_type_id);
      if (type) expect(type.customer_job_category).to.be.null;
      const recurring = await require('../../src/endpoints/recurringCustomer/recurringCustomer-service').getActiveRecurringCustomers(h.db, 9001);
      expect(recurring.find(r => r.recurring_customer_id === rc.recurring_customer_id)).to.be.undefined;
   });
});
