/**
 * Fix 4: createCustomer must take account_id / created_by_user_id from the
 * authenticated request (URL account, session user), never the body, and the
 * customers + customer_information (+ recurring_customers) inserts must be
 * atomic. Fix 5: deleteCustomer must also refuse when the customer has
 * write-offs (previously checked jobs/retainers/invoices/payments/
 * transactions/recurring but not write-offs), and deactivating a customer
 * with an open balance or unbilled billable work must return `warnings`
 * rather than block.
 *
 * Driven through the real Express app against the sandbox DB fixture account
 * 9001. Every customer this spec creates is removed in `after`. Skipped when
 * the sandbox DB is unreachable (see _setup.requireDb).
 */
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('../../integration/_setup');
const jwt = require('jsonwebtoken');
const supertest = global.supertest || require('supertest');
const app = require('../../../src/app');
const config = require('../../../config');

const A = TEST_ACCOUNT_ID; // 9001
const ADMIN_ID = TEST_ADMIN_USER_ID; // 90013
const ADMIN_EMAIL = 'admin+test@example.com';
const OTHER_USER_ID = 90012; // Bob Jones — used as a bogus "created_by_user_id" the body tries to inject
const GWD_ID = 90031; // 'Tax Return Preparation' work description (seed.sql)
const JOB_TYPE_ID = 900201; // '1040 Individual Return'

describe('integration: customer CRUD defects (fixes 4 & 5)', function () {
   this.timeout(30_000);

   let db;
   let token;
   const createdCustomerIds = [];

   const authed = req => req.set('Authorization', `Bearer ${token}`);
   const post = (url, body) => authed(supertest(app).post(url)).send(body);
   const put = (url, body) => authed(supertest(app).put(url)).send(body);
   const del = url => authed(supertest(app).delete(url));

   const baseCustomerBody = overrides => ({
      customerBusinessName: null,
      customerFirstName: 'Fixture',
      customerLastName: `Customer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isCommercialCustomer: false,
      isCustomerActive: true,
      isCustomerBillable: true,
      isCustomerRecurring: false,
      customerStreet: '1 Fixture Way',
      customerCity: 'Phoenix',
      customerState: 'AZ',
      customerZip: '85001',
      customerEmail: 'fixture@example.com',
      customerPhone: '5551234567',
      isCustomerAddressActive: true,
      isCustomerPhysicalAddress: true,
      isCustomerBillingAddress: true,
      isCustomerMailingAddress: true,
      ...overrides
   });
   // customerObjects.js derives display_name from customerBusinessName ||
   // customerName — customerName itself is only set server-side from
   // customerFirstName/LastName by the frontend's own post-object builder, so
   // this spec sets `customerName` directly (mirroring the mapper's actual
   // read: `customer.customerName`).
   const uniqueCustomerBody = overrides => {
      const body = baseCustomerBody(overrides);
      body.customerName = body.customerLastName;
      return body;
   };

   before(async function () {
      db = await requireDb.call(this);
      app.set('db', db);
      // See roleGates.integration.spec.js for why this line is needed: when
      // running as part of the full test:unit sweep, config.js can be cached
      // with a stale/empty JWT_SECRET by an earlier-loaded spec file.
      config.JWT_SECRET = process.env.JWT_SECRET || config.JWT_SECRET;
      token = jwt.sign({ user_id: ADMIN_ID }, config.JWT_SECRET, { subject: ADMIN_EMAIL, expiresIn: '2h', algorithm: 'HS256' });
   });

   after(async () => {
      if (db) {
         for (const id of createdCustomerIds) {
            await db('customer_writeoffs').where({ account_id: A, customer_id: id }).del();
            await db('customer_transactions').where({ account_id: A, customer_id: id }).del();
            await db('customer_jobs').where({ account_id: A, customer_id: id }).del();
            await db('recurring_customers').where({ account_id: A, customer_id: id }).del();
            await db('customer_information').where({ account_id: A, customer_id: id }).del();
            await db('customers').where({ account_id: A, customer_id: id }).del();
         }
      }
      await closeDb();
   });

   describe('POST /customer/createCustomer — trusted account_id / created_by_user_id (fix 4)', () => {
      it('ignores an accountID the body tries to inject and uses the URL account instead', async () => {
         const body = uniqueCustomerBody({ accountID: 999999 });
         const res = await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: body });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);

         const row = await db('customers').where({ account_id: A, display_name: body.customerName }).first();
         expect(row, 'customer row must exist under the URL account, not the injected one').to.exist;
         expect(Number(row.account_id)).to.equal(A);
         createdCustomerIds.push(row.customer_id);
      });

      it('ignores a userID the body tries to inject for created_by_user_id and uses the authenticated caller instead', async () => {
         const body = uniqueCustomerBody({ userID: OTHER_USER_ID });
         const res = await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: body });
         expect(res.status).to.equal(200);

         const customerRow = await db('customers').where({ account_id: A, display_name: body.customerName }).first();
         createdCustomerIds.push(customerRow.customer_id);
         const infoRow = await db('customer_information').where({ account_id: A, customer_id: customerRow.customer_id }).first();
         expect(Number(infoRow.created_by_user_id), 'created_by_user_id must be the authenticated caller (90013), not the injected 90012').to.equal(ADMIN_ID);
      });
   });

   describe('POST /customer/createCustomer — atomic transaction (fix 4)', () => {
      it('rolls back the customers row when the recurring_customers insert fails (no orphan left behind)', async () => {
         const body = uniqueCustomerBody({
            isCustomerRecurring: true,
            subscriptionFrequency: 'Monthly',
            // billingCycle deliberately omitted -> Number(undefined) = NaN ->
            // recurring_customers.bill_on_date (integer NOT NULL) insert fails.
            recurringAmount: 100
         });

         const res = await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: body });
         expect(res.status).to.equal(200); // this app always answers HTTP 200 with {status:500} in the body on failure
         expect(res.body.status).to.equal(500);

         const orphanCustomer = await db('customers').where({ account_id: A, display_name: body.customerName }).first();
         expect(orphanCustomer, 'customers row must NOT exist after a failed atomic create').to.not.exist;
         const orphanInfo = await db('customer_information')
            .join('customers', 'customers.customer_id', 'customer_information.customer_id')
            .where({ 'customers.account_id': A, 'customers.display_name': body.customerName })
            .first();
         expect(orphanInfo, 'customer_information row must NOT exist either').to.not.exist;
      });
   });

   describe('customerObjects update mapper — created_by_user_id survives an edit (fix 4, HTTP-level)', () => {
      it('PUT /customer/updateCustomer does not change customer_information.created_by_user_id even though the body carries the editor\'s own userID', async () => {
         const createBody = uniqueCustomerBody({});
         const createRes = await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: createBody });
         const customerRow = await db('customers').where({ account_id: A, display_name: createBody.customerName }).first();
         createdCustomerIds.push(customerRow.customer_id);
         const infoBefore = await db('customer_information').where({ account_id: A, customer_id: customerRow.customer_id }).first();
         expect(createRes.status).to.equal(200);
         expect(Number(infoBefore.created_by_user_id)).to.equal(ADMIN_ID);

         const updateBody = uniqueCustomerBody({
            customerID: customerRow.customer_id,
            accountID: A,
            customerInfoID: infoBefore.customer_info_id,
            userID: OTHER_USER_ID, // the "editor" — must NOT overwrite created_by_user_id
            customerStreet: '2 Updated Ave'
         });
         const updateRes = await put(`/customer/updateCustomer/${A}/${ADMIN_ID}`, { customer: updateBody });
         expect(updateRes.status).to.equal(200);

         const infoAfter = await db('customer_information').where({ account_id: A, customer_id: customerRow.customer_id }).first();
         expect(infoAfter.customer_street).to.equal('2 Updated Ave');
         expect(Number(infoAfter.created_by_user_id), 'created_by_user_id must be unchanged by the edit').to.equal(ADMIN_ID);
      });
   });

   describe('DELETE /customer/deleteCustomer — write-offs guard (fix 5)', () => {
      it('refuses to delete a customer that has a write-off (previously not checked at all)', async () => {
         const createBody = uniqueCustomerBody({});
         await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: createBody });
         const customerRow = await db('customers').where({ account_id: A, display_name: createBody.customerName }).first();
         createdCustomerIds.push(customerRow.customer_id);

         await db('customer_writeoffs').insert({
            customer_id: customerRow.customer_id,
            account_id: A,
            writeoff_date: new Date(),
            writeoff_amount: -10,
            transaction_type: 'Write Off',
            writeoff_reason: 'Courtesy adjustment',
            created_by_user_id: ADMIN_ID
         });

         const res = await del(`/customer/deleteCustomer/${customerRow.customer_id}/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200); // body-level failure convention
         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.match(/write-offs/i);

         const stillThere = await db('customers').where({ customer_id: customerRow.customer_id }).first();
         expect(stillThere, 'customer must not have been deleted').to.exist;
      });
   });

   describe('PUT /customer/updateCustomer — deactivation warnings, not a block (fix 5)', () => {
      it('deactivates successfully AND reports a warning when the customer has unbilled billable work', async () => {
         const createBody = uniqueCustomerBody({});
         await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: createBody });
         const customerRow = await db('customers').where({ account_id: A, display_name: createBody.customerName }).first();
         createdCustomerIds.push(customerRow.customer_id);

         const [job] = await db('customer_jobs')
            .insert({
               account_id: A,
               customer_id: customerRow.customer_id,
               job_type_id: JOB_TYPE_ID,
               is_quote: false,
               created_by_user_id: ADMIN_ID
            })
            .returning('*');
         await db('customer_transactions').insert({
            account_id: A,
            customer_id: customerRow.customer_id,
            customer_job_id: job.customer_job_id,
            logged_for_user_id: ADMIN_ID,
            general_work_description_id: GWD_ID,
            transaction_date: new Date(),
            transaction_type: 'Time',
            quantity: 1,
            unit_cost: 100,
            total_transaction: 100,
            is_transaction_billable: true,
            is_excess_to_subscription: false,
            created_by_user_id: ADMIN_ID
            // customer_invoice_id left NULL -> unbilled
         });

         const infoRow = await db('customer_information').where({ account_id: A, customer_id: customerRow.customer_id }).first();
         const updateBody = uniqueCustomerBody({
            customerID: customerRow.customer_id,
            accountID: A,
            customerInfoID: infoRow.customer_info_id,
            userID: ADMIN_ID,
            isCustomerActive: false
         });
         const res = await put(`/customer/updateCustomer/${A}/${ADMIN_ID}`, { customer: updateBody });

         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200, 'deactivation must NOT be blocked');
         expect(res.body.warnings, 'response must carry a warnings array').to.be.an('array').with.length.greaterThan(0);
         expect(res.body.warnings.join(' ')).to.match(/unbilled billable/i);

         const deactivated = await db('customers').where({ customer_id: customerRow.customer_id }).first();
         expect(deactivated.is_customer_active).to.equal(false);
      });

      it('returns an empty warnings array when deactivating a customer with no open balance or unbilled work', async () => {
         const createBody = uniqueCustomerBody({});
         await post(`/customer/createCustomer/${A}/${ADMIN_ID}`, { customer: createBody });
         const customerRow = await db('customers').where({ account_id: A, display_name: createBody.customerName }).first();
         createdCustomerIds.push(customerRow.customer_id);
         const infoRow = await db('customer_information').where({ account_id: A, customer_id: customerRow.customer_id }).first();

         const updateBody = uniqueCustomerBody({
            customerID: customerRow.customer_id,
            accountID: A,
            customerInfoID: infoRow.customer_info_id,
            userID: ADMIN_ID,
            isCustomerActive: false
         });
         const res = await put(`/customer/updateCustomer/${A}/${ADMIN_ID}`, { customer: updateBody });
         expect(res.status).to.equal(200);
         expect(res.body.warnings).to.deep.equal([]);
      });
   });
});
