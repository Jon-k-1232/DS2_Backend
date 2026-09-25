const { auditCustomerLedger } = require('../../../src/endpoints/accountAudit/account-audit-logic');
it('F14 audit current balance excludes future work while lifetime diagnostics retain it', () => {
   const result = auditCustomerLedger({ customer: { customer_id: 900101 }, invoices: [], payments: [], writeoffs: [], retainers: [], transactions: [
      { customer_id: 900101, customer_job_id: 900201, transaction_date: '2000-01-01', is_transaction_billable: true, total_transaction: 50 },
      { customer_id: 900101, customer_job_id: 900201, transaction_date: '2058-01-01', is_transaction_billable: true, total_transaction: 100 }
   ] });
   expect(result.totals.audit_balance).to.equal(50);
   expect(result.totals.total_billable_transactions).to.equal(150);
});
