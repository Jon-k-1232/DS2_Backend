/* eslint-disable no-console */
/*
   For each of the mismatched customers, re-run BOTH the audit engine and the
   app's calculateInvoices engine right now and print a side-by-side breakdown
   so we can tell which side is wrong (or whether the mismatch in the stored
   audit was stale).
*/

require('dotenv').config({ path: '.env.prod' });
const knex = require('knex')({
   client: 'pg',
   connection: {
      host: process.env.DB_PROD_HOST,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: 'ds2_prod',
      port: 5432,
      ssl: { rejectUnauthorized: false }
   },
   pool: { min: 0, max: 4 }
});

const auditSvc = require('../src/endpoints/accountAudit/account-audit-service');
const { auditCustomerLedger } = require('../src/endpoints/accountAudit/account-audit-logic');
const { fetchInitialQueryItems } = require('../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');

const ACCOUNT_ID = 1;

const CUSTOMERS = [
   { id: 2, name: 'Tomo Buncic' },
   { id: 171, name: 'Caroline Hernandez' },
   { id: 266, name: 'SJSRKS Holdings' },
   { id: 196, name: 'Chris Poorten' },
   { id: 257, name: 'Wayne Greenholtz' },
   { id: 6, name: 'Kimmel Financial Partners' },
   { id: 5, name: 'James F Kimmel & Associates' },
   { id: 194, name: 'Marjorie Wilford' },
   { id: 195, name: 'Mesquite Electric' },
   { id: 43, name: 'LTDFH III' },
   { id: 51, name: 'LTDFH TOO' },
   { id: 59, name: 'Red Rock Windows and Doors' },
   { id: 80, name: 'Wild West Jeep Tours' }
];

const fmt = n => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = d => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
   for (const { id, name } of CUSTOMERS) {
      console.log(`\n========== ${name} (cid=${id}) ==========`);

      // Pull raw data
      const customer = await auditSvc.getCustomer(knex, ACCOUNT_ID, id);
      const [invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
         auditSvc.getInvoices(knex, ACCOUNT_ID, id),
         auditSvc.getPayments(knex, ACCOUNT_ID, id),
         auditSvc.getWriteoffs(knex, ACCOUNT_ID, id),
         auditSvc.getTransactions(knex, ACCOUNT_ID, id),
         auditSvc.getRetainers(knex, ACCOUNT_ID, id)
      ]);

      // Audit
      const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });

      // App engine
      const map = { [id]: { customer_id: id, showWriteOffs: false } };
      const qd = await fetchInitialQueryItems(knex, map, ACCOUNT_ID);
      const calc = calculateInvoices([{ customer_id: id, showWriteOffs: false }], qd);
      const appTotal = Number(calc[0]?.invoiceTotal || 0);
      const appOutstanding = Number(calc[0]?.outstandingInvoices?.outstandingInvoiceTotal || 0);
      const appTxTotal = Number(calc[0]?.transactions?.transactionsTotal || 0);
      const appPaymentTotal = Number(calc[0]?.payments?.paymentTotal || 0);
      const appWriteOffTotal = Number(calc[0]?.writeOffs?.writeOffTotal || 0);

      console.log(`AUDIT  balance: ${fmt(audit.totals.audit_balance)}  = outstanding ${fmt(audit.totals.outstanding_invoices)} + unbilled_net ${fmt(audit.totals.unbilled_billable_net)} - unbilled_pay ${fmt(audit.totals.unbilled_payments)}`);
      console.log(`APP    total:   ${fmt(appTotal)}  = outstanding ${fmt(appOutstanding)} + transactions ${fmt(appTxTotal)} - payments ${fmt(appPaymentTotal)} - writeoffs ${fmt(appWriteOffTotal)}`);
      console.log(`DIFF:   ${fmt(audit.totals.audit_balance - appTotal)}`);

      // Show open parent invoices
      const openParents = invoices.filter(i => !i.parent_invoice_id && Number(i.remaining_balance_on_invoice) > 0);
      console.log(`Open parents (${openParents.length}):`);
      openParents.forEach(p => console.log(`  ${p.invoice_number}  ${fmtDate(p.invoice_date)}  bb=${fmt(p.beginning_balance)} chg=${fmt(p.total_charges)} rem=${fmt(p.remaining_balance_on_invoice)} paid=${p.is_invoice_paid_in_full}`));

      // Show unbilled billable transactions
      const unbilled = transactions.filter(t => !t.customer_invoice_id && t.is_transaction_billable);
      console.log(`Unbilled billable transactions (${unbilled.length}):`);
      unbilled.forEach(t => console.log(`  tx#${t.transaction_id}  ${fmtDate(t.transaction_date)}  ${fmt(t.total_transaction)}  job=${t.customer_job_id}  ${(t.detailed_work_description || '').slice(0, 60)}`));

      // Show unbilled job-level write-offs
      const unbilledWO = writeoffs.filter(w => !w.customer_invoice_id && w.customer_job_id);
      if (unbilledWO.length) {
         console.log(`Unbilled job-level write-offs (${unbilledWO.length}):`);
         unbilledWO.forEach(w => console.log(`  wo#${w.writeoff_id}  ${fmtDate(w.writeoff_date)}  ${fmt(w.writeoff_amount)}  job=${w.customer_job_id}  ${(w.writeoff_reason || '').slice(0, 60)}`));
      }

      // Show unbilled payments
      const unbilledPmt = payments.filter(p => !p.customer_invoice_id);
      if (unbilledPmt.length) {
         console.log(`Unbilled payments (${unbilledPmt.length}):`);
         unbilledPmt.forEach(p => console.log(`  pmt#${p.payment_id}  ${fmtDate(p.payment_date)}  ${fmt(p.payment_amount)}  ${p.form_of_payment || ''}`));
      }
   }
   await knex.destroy();
})().catch(e => {
   console.error(e);
   process.exit(1);
});
