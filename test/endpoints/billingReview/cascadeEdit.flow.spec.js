const { applyTransactionEdit, ERRORS } = require('../../../src/endpoints/billingReview/cascadeEdit');

/**
 * Builds a stub knex-like callable with chainable query builders.
 * Each call to `db('table_name')` returns a new builder that wraps the table's
 * stored rows. The builder supports the small subset of knex methods exercised
 * by cascadeEdit.js. Returned mutations update the in-memory store.
 */
const buildStubDb = ({ transactions = [], invoices = [], jobs = [], gwds = [], training = [] } = {}) => {
   const store = { customer_transactions: transactions, customer_invoices: invoices, customer_jobs: jobs, customer_general_work_descriptions: gwds, ai_category_training_examples: training };
   const _matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
   const _builder = table => {
      const state = { where: {}, select: null, sumField: null, sumAlias: null, _action: null };
      const builder = {};
      builder.where = obj => {
         if (typeof obj === 'object' && obj !== null) Object.assign(state.where, obj);
         return builder;
      };
      builder.first = async () => {
         const hit = store[table].find(r => _matches(r, state.where));
         return hit ? { ...hit } : undefined;
      };
      builder.select = (...fields) => { state.select = fields; return { first: async () => {
         const hit = store[table].find(r => _matches(r, state.where));
         return hit ? { ...hit } : undefined;
      } }; };
      builder.sum = obj => {
         const [alias, field] = Object.entries(obj)[0];
         state.sumField = field;
         state.sumAlias = alias;
         const matching = store[table].filter(r => _matches(r, state.where));
         const total = matching.reduce((a, r) => a + Number(r[field] || 0), 0);
         return Promise.resolve([{ [alias]: total }]);
      };
      builder.update = updates => {
         const target = store[table].filter(r => _matches(r, state.where));
         for (const t of target) Object.assign(t, updates);
         return Promise.resolve(target.length);
      };
      builder.insert = row => {
         const rows = Array.isArray(row) ? row : [row];
         for (const r of rows) store[table].push({ ...r });
         return { returning: () => Promise.resolve(rows.map((r, i) => ({ ...r, id: store[table].length - rows.length + i + 1 }))) };
      };
      return builder;
   };
   const db = table => _builder(table);
   db.transaction = async cb => {
      const trxBuilder = table => _builder(table);
      trxBuilder.transaction = db.transaction;
      return cb(trxBuilder);
   };
   db._store = store;
   return db;
};

describe('cascadeEdit applyTransactionEdit (flow)', () => {
   const baseTxn = {
      transaction_id: 1,
      account_id: 9001,
      customer_id: 100,
      customer_job_id: 200,
      customer_invoice_id: 300,
      logged_for_user_id: 7,
      general_work_description_id: 50,
      detailed_work_description: '',
      transaction_date: '2026-04-15',
      transaction_type: 'time',
      quantity: 1,
      unit_cost: 100,
      total_transaction: 100,
      is_transaction_billable: true,
      note: ''
   };

   const baseInvoice = {
      customer_invoice_id: 300,
      account_id: 9001,
      customer_id: 100,
      beginning_balance: 0,
      total_payments: 0,
      total_charges: 100,
      total_write_offs: 0,
      total_retainers: 0,
      total_amount_due: 100,
      remaining_balance_on_invoice: 100,
      is_invoice_paid_in_full: false,
      start_date: '2026-04-01',
      end_date: '2026-04-30'
   };

   const baseJob = { customer_job_id: 200, account_id: 9001, customer_id: 100, current_job_total: 100 };
   const baseGwd1 = { general_work_description_id: 50, general_work_description: 'Old Description' };
   const baseGwd2 = { general_work_description_id: 51, general_work_description: 'New Description' };

   it('returns no-op when nothing actually changes', async () => {
      const db = buildStubDb({ transactions: [{ ...baseTxn }], invoices: [{ ...baseInvoice }], jobs: [{ ...baseJob }] });
      const result = await applyTransactionEdit({
         db,
         accountId: 9001,
         transactionId: 1,
         updates: { customer_id: 100, note: '' },
         editingUserId: 7
      });
      expect(result.diff).to.deep.equal({});
      expect(result.sideEffects).to.deep.equal([]);
   });

   it('rejects total_transaction edits when invoice is paid in full', async () => {
      const db = buildStubDb({
         transactions: [{ ...baseTxn }],
         invoices: [{ ...baseInvoice, is_invoice_paid_in_full: true }],
         jobs: [{ ...baseJob }]
      });
      let caught = null;
      try {
         await applyTransactionEdit({
            db,
            accountId: 9001,
            transactionId: 1,
            updates: { total_transaction: 200 },
            editingUserId: 7
         });
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.code).to.equal(ERRORS.INVOICE_LOCKED);
      expect(caught.invoiceId).to.equal(300);
      expect(db._store.customer_transactions[0].total_transaction).to.equal(100);
   });

   it('rejects customer_id changes without confirm flag', async () => {
      const db = buildStubDb({ transactions: [{ ...baseTxn }], invoices: [{ ...baseInvoice }], jobs: [{ ...baseJob }] });
      let caught = null;
      try {
         await applyTransactionEdit({
            db,
            accountId: 9001,
            transactionId: 1,
            updates: { customer_id: 999 },
            confirmCustomerChange: false,
            editingUserId: 7
         });
      } catch (e) {
         caught = e;
      }
      expect(caught.code).to.equal(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM);
   });

   it('rejects retainer_id edits via this endpoint', async () => {
      const db = buildStubDb({ transactions: [{ ...baseTxn }], invoices: [{ ...baseInvoice }], jobs: [{ ...baseJob }] });
      let caught = null;
      try {
         await applyTransactionEdit({
            db,
            accountId: 9001,
            transactionId: 1,
            updates: { retainer_id: 5 },
            editingUserId: 7
         });
      } catch (e) {
         caught = e;
      }
      expect(caught.code).to.equal(ERRORS.RETAINER_NOT_EDITABLE_HERE);
   });

   it('rejects transaction_date when it falls outside the linked invoice period', async () => {
      const db = buildStubDb({ transactions: [{ ...baseTxn }], invoices: [{ ...baseInvoice }], jobs: [{ ...baseJob }] });
      let caught = null;
      try {
         await applyTransactionEdit({
            db,
            accountId: 9001,
            transactionId: 1,
            updates: { transaction_date: '2026-06-15' },
            editingUserId: 7
         });
      } catch (e) {
         caught = e;
      }
      expect(caught.code).to.equal(ERRORS.DATE_OUTSIDE_INVOICE);
   });

   it('on amount change recomputes invoice and job totals and reports sideEffects', async () => {
      const db = buildStubDb({ transactions: [{ ...baseTxn }], invoices: [{ ...baseInvoice }], jobs: [{ ...baseJob }] });
      const result = await applyTransactionEdit({
         db,
         accountId: 9001,
         transactionId: 1,
         updates: { total_transaction: 250 },
         editingUserId: 7
      });
      const invoiceEffect = result.sideEffects.find(s => s.type === 'invoice_recalculated');
      const jobEffect = result.sideEffects.find(s => s.type === 'old_job_recalculated');
      expect(invoiceEffect.totalCharges).to.equal(250);
      expect(jobEffect.total).to.equal(250);
      expect(db._store.customer_invoices[0].total_charges).to.equal(250);
      expect(db._store.customer_jobs[0].current_job_total).to.equal(250);
   });

   it('writes a training-example row when general_work_description_id changes', async () => {
      const db = buildStubDb({
         transactions: [{ ...baseTxn }],
         invoices: [{ ...baseInvoice }],
         jobs: [{ ...baseJob }],
         gwds: [{ ...baseGwd1 }, { ...baseGwd2 }]
      });
      const result = await applyTransactionEdit({
         db,
         accountId: 9001,
         transactionId: 1,
         updates: { general_work_description_id: 51 },
         editingUserId: 7
      });
      const trainingEffect = result.sideEffects.find(s => s.type === 'training_example_written');
      expect(trainingEffect).to.exist;
      const trainingRows = db._store.ai_category_training_examples;
      expect(trainingRows).to.have.lengthOf(1);
      expect(trainingRows[0].original_category).to.equal('Old Description');
      expect(trainingRows[0].final_category).to.equal('New Description');
      expect(trainingRows[0].ai_source).to.equal('reviewer_edit');
   });

   it('on customer_id change with confirm clears invoice + job FKs', async () => {
      const db = buildStubDb({
         transactions: [{ ...baseTxn }],
         invoices: [{ ...baseInvoice }],
         jobs: [{ ...baseJob }]
      });
      const result = await applyTransactionEdit({
         db,
         accountId: 9001,
         transactionId: 1,
         updates: { customer_id: 999 },
         confirmCustomerChange: true,
         editingUserId: 7
      });
      const updated = db._store.customer_transactions[0];
      expect(updated.customer_id).to.equal(999);
      expect(updated.customer_invoice_id).to.equal(null);
      expect(updated.customer_job_id).to.equal(null);
      expect(result.sideEffects.some(s => s.type === 'old_invoice_recalculated_after_customer_change')).to.equal(true);
   });
});
