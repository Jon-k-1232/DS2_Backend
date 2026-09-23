const express = require('express');
const billingReviewRouter = require('../../../src/endpoints/billingReview/billingReview-router');
const billingReviewService = require('../../../src/endpoints/billingReview/billingReview-service');
const { ERRORS, MESSAGES } = require('../../../src/endpoints/billingReview/cascadeEdit');
const { buildStubDb } = require('./_stubDb');

const ACCOUNT = 9001;

const makeApp = db => {
   const app = express();
   app.set('db', db);
   app.use((req, res, next) => {
      req.user = { account_id: ACCOUNT, user_id: 7, access_level: 'admin' };
      next();
   });
   app.use('/billing-review', billingReviewRouter);
   return app;
};

const ledgerDb = (invoiceOverrides = {}) =>
   buildStubDb({
      customer_transactions: [
         {
            transaction_id: 1,
            account_id: ACCOUNT,
            customer_id: 100,
            customer_job_id: 200,
            customer_invoice_id: 300,
            retainer_id: null,
            general_work_description_id: 50,
            transaction_date: '2026-04-15',
            quantity: '1.00',
            unit_cost: '100.00',
            total_transaction: '100.00',
            is_transaction_billable: true,
            note: ''
         }
      ],
      customer_invoices: [
         {
            customer_invoice_id: 300,
            parent_invoice_id: null,
            account_id: ACCOUNT,
            customer_id: 100,
            invoice_number: 'INV-2026-00300',
            invoice_date: '2026-04-30',
            total_payments: '0.00',
            total_charges: '100.00',
            total_amount_due: '100.00',
            remaining_balance_on_invoice: '100.00',
            is_invoice_paid_in_full: false,
            created_at: new Date('2026-04-30T18:00:00Z'),
            start_date: '2026-04-01',
            end_date: '2026-04-30',
            notes: null,
            ...invoiceOverrides
         }
      ],
      customer_jobs: [{ customer_job_id: 200, account_id: ACCOUNT, customer_id: 100 }],
      customers: [
         { customer_id: 100, account_id: ACCOUNT },
         { customer_id: 999, account_id: ACCOUNT }
      ],
      customer_general_work_descriptions: [],
      ai_reviewer_corrections: [],
      ai_category_training_examples: []
   });

describe('billingReview-router', () => {
   describe('PUT /transaction/:transactionID (cascade edit)', () => {
      const put = (db, body) => supertest(makeApp(db)).put(`/billing-review/transaction/1/${ACCOUNT}/7`).send(body);

      it('200 + side effects on a delta edit', async () => {
         const res = await put(ledgerDb(), { updates: { total_transaction: 150 } });
         expect(res.status).to.equal(200);
         expect(res.body.sideEffects.find(s => s.type === 'invoice_recalculated')).to.include({ delta: 50, remainingBalance: 150 });
      });

      it('409 with the rolled-forward guidance for an absorbed statement', async () => {
         const res = await put(ledgerDb({ notes: '[absorbed_by:INV-2026-00400@2026-05-31]' }), { updates: { total_transaction: 150 } });
         expect(res.status).to.equal(409);
         expect(res.body).to.include({ code: ERRORS.INVOICE_LOCKED, message: MESSAGES.ABSORBED, invoiceId: 300, invoiceNumber: 'INV-2026-00300' });
      });

      it('400 job_required_for_customer_change with a readable message', async () => {
         const res = await put(ledgerDb(), { updates: { customer_id: 999 }, confirmCustomerChange: true });
         expect(res.status).to.equal(400);
         expect(res.body).to.include({ code: ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE, message: MESSAGES.JOB_MISSING_FOR_CUSTOMER_CHANGE, field: 'customer_job_id' });
      });

      it("treats confirmCustomerChange: 'false' (string) as NOT confirmed", async () => {
         const res = await put(ledgerDb(), { updates: { customer_id: 999 }, confirmCustomerChange: 'false' });
         expect(res.status).to.equal(409);
         expect(res.body.code).to.equal(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM);
      });

      it('400 invalid_field_value for a blank amount', async () => {
         const res = await put(ledgerDb(), { updates: { quantity: null } });
         expect(res.status).to.equal(400);
         expect(res.body).to.include({ code: ERRORS.INVALID_FIELD_VALUE, field: 'quantity' });
      });

      it('500s never echo a raw driver error code, and fall back to a generic message', async () => {
         const db = ledgerDb();
         const failing = name => {
            const b = db(name);
            b.first = async () => {
               const e = new Error('');
               e.code = '57P01'; // pg admin_shutdown
               throw e;
            };
            return b;
         };
         failing.transaction = db.transaction;
         const res = await put(failing, { updates: { note: 'x' } });
         expect(res.status).to.equal(500);
         expect(res.body.message).to.equal('The transaction could not be updated.');
         expect(res.body).to.not.have.property('code');
      });
   });

   describe('POST /reprocess-with-overrides/:entryID', () => {
      let real;
      const prevFlag = process.env.TIME_TRACKER_AI_FEATURE_FLAG;
      beforeEach(() => {
         real = billingReviewService.reprocessHeldEntryWithOverrides;
         process.env.TIME_TRACKER_AI_FEATURE_FLAG = 'on';
      });
      afterEach(() => {
         billingReviewService.reprocessHeldEntryWithOverrides = real;
         if (prevFlag === undefined) delete process.env.TIME_TRACKER_AI_FEATURE_FLAG;
         else process.env.TIME_TRACKER_AI_FEATURE_FLAG = prevFlag;
      });

      it('409 when the entry was already applied', async () => {
         billingReviewService.reprocessHeldEntryWithOverrides = async () => {
            throw Object.assign(new Error('This time entry was already applied as transaction #900.'), { code: 'ENTRY_ALREADY_APPLIED', transactionId: 900 });
         };
         const res = await supertest(makeApp(buildStubDb())).post(`/billing-review/reprocess-with-overrides/21/${ACCOUNT}/7`).send({ overrides: {} });
         expect(res.status).to.equal(409);
         expect(res.body).to.include({ code: 'ENTRY_ALREADY_APPLIED', transactionId: 900, decision: 'error' });
      });
   });

   describe('PUT /:entryID (manual apply)', () => {
      let real;
      beforeEach(() => {
         real = billingReviewService.applyHeldEntry;
      });
      afterEach(() => {
         billingReviewService.applyHeldEntry = real;
      });

      it('400 INVALID_FIELD passes the field + message through', async () => {
         billingReviewService.applyHeldEntry = async () => {
            throw Object.assign(new Error('Duration must be greater than zero minutes.'), { code: 'INVALID_FIELD', field: 'duration_minutes' });
         };
         const res = await supertest(makeApp(buildStubDb())).put(`/billing-review/11/${ACCOUNT}/7`).send({});
         expect(res.status).to.equal(400);
         expect(res.body).to.include({ code: 'INVALID_FIELD', field: 'duration_minutes', message: 'Duration must be greater than zero minutes.' });
      });

      it('500 hides unexpected errors behind clientSafeMessage', async () => {
         billingReviewService.applyHeldEntry = async () => {
            throw new Error('');
         };
         const res = await supertest(makeApp(buildStubDb())).put(`/billing-review/11/${ACCOUNT}/7`).send({});
         expect(res.status).to.equal(500);
         expect(res.body.message).to.equal('The held entry could not be applied.');
      });

      // C5-2 (DEFECT fix): the actor passed to applyHeldEntry() must be the
      // AUTHENTICATED caller (req.user.user_id, fixed at 7 by makeApp above),
      // never the URL :userID — which a real caller could name as anyone.
      // makeApp's req.user.user_id (7) is intentionally left DIFFERENT from
      // the URL's :userID (99, a "worker"/forged id) below, and the stub
      // captures whichever value the route actually forwarded.
      it("records the AUTHENTICATED caller as the actor, never the URL :userID (worker id 99 != authenticated id 7)", async () => {
         let capturedActor = null;
         billingReviewService.applyHeldEntry = async (db, accountId, entryId, edits, editingUserId) => {
            capturedActor = editingUserId;
            return { transaction_id: 500 };
         };
         const res = await supertest(makeApp(buildStubDb())).put(`/billing-review/11/${ACCOUNT}/99`).send({});
         expect(res.status).to.equal(200);
         expect(capturedActor, 'actor forwarded to the service').to.equal(7);
         expect(capturedActor).to.not.equal(99);
      });
   });
});
