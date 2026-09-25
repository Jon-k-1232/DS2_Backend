const { bootHttp } = require('./_http');
const fixture = require('./_review-fixture');
const { restoreDataTypesTransactionsTableOnCreate } = require('../../src/endpoints/transactions/transactionsObjects');
const auditService = require('../../src/endpoints/accountAudit/account-audit-service');
const { buildStatementData } = require('../../src/endpoints/customer/customer-statement');

describe('F27 customer statement snapshot', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   it('never mixes a charge read before commit with its payment read after commit', async () => {
      const c = await f.customer(), j = await f.job(c);
      const oldTransactions = auditService.getTransactions, oldPayments = auditService.getPayments;
      let release;
      const committed = new Promise(r => { release = r; });
      auditService.getTransactions = async (...args) => {
         const rows = await oldTransactions(...args);
         try {
            await h.db.transaction(async trx => {
               await trx('customer_transactions').insert(restoreDataTypesTransactionsTableOnCreate(f.body(c, j)));
               await trx('customer_payments').insert({ account_id: 9001, customer_id: c.customer_id, payment_amount: -100,
                  payment_date: '2026-09-01', form_of_payment: 'Retainer', created_by_user_id: 90013 });
            });
         } finally { release(); }
         return rows;
      };
      auditService.getPayments = async (...args) => { await committed; return oldPayments(...args); };
      try {
         const before = await buildStatementData(h.db, 9001, c.customer_id, { end: '2026-09-24' });
         expect(before.closingBalance).to.equal(0);
         expect(before.events).to.have.length(0);
      } finally { auditService.getTransactions = oldTransactions; auditService.getPayments = oldPayments; }
      const after = await buildStatementData(h.db, 9001, c.customer_id, { end: '2026-09-24' });
      expect(after.closingBalance).to.equal(0);
      expect(after.events).to.have.length(2);
   });
});
