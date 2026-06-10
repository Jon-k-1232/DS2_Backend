// Engine-vs-audit agreement across ALL active customers (read-only).
require('dotenv').config({ path: '.env.dev' });
const knex = require('knex')({ client: 'postgres', connection: { host: process.env.DB_DEV_HOST, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: 'ds2_dev', ssl: { rejectUnauthorized: false } }, pool: { min: 0, max: 4 } });
const auditSvc = require('../src/endpoints/accountAudit/account-audit-service');
const { auditCustomerLedger } = require('../src/endpoints/accountAudit/account-audit-logic');
const { fetchInitialQueryItems } = require('../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');

(async () => {
  const customers = await knex('customers').where({ account_id: 1, is_customer_active: true }).select('customer_id', 'display_name').orderBy('customer_id');
  const ids = customers.map(c => c.customer_id);
  const invoicesToCreateMap = {};
  ids.forEach(id => { invoicesToCreateMap[id] = { customer_id: id, showWriteOffs: false, invoiceNote: null }; });
  const queryData = await fetchInitialQueryItems(knex, invoicesToCreateMap, 1);
  const engineRows = calculateInvoices(ids.map(id => ({ customer_id: id, showWriteOffs: false })), queryData);
  const engineById = new Map(engineRows.map(r => [r.customer_id, r.invoiceTotal]));

  const out = {};
  for (const c of customers) {
    const [customer, invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
      auditSvc.getCustomer(knex, 1, c.customer_id),
      auditSvc.getInvoices(knex, 1, c.customer_id),
      auditSvc.getPayments(knex, 1, c.customer_id),
      auditSvc.getWriteoffs(knex, 1, c.customer_id),
      auditSvc.getTransactions(knex, 1, c.customer_id),
      auditSvc.getRetainers(knex, 1, c.customer_id)
    ]);
    const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });
    const engine = Math.round((engineById.get(c.customer_id) || 0) * 100) / 100;
    const diff = Math.round((audit.totals.audit_balance - engine) * 100) / 100;
    out[c.customer_id] = { name: c.display_name, audit: audit.totals.audit_balance, engine, diff };
  }
  const mismatched = Object.values(out).filter(r => Math.abs(r.diff) >= 0.01);
  console.log(JSON.stringify({ total: customers.length, mismatched: mismatched.length, details: mismatched.slice(0, 25) }, null, 1));
  require('fs').writeFileSync(process.argv[2] || '/tmp/drift-snapshot.json', JSON.stringify(out, null, 1));
  await knex.destroy();
})().catch(e => { console.error('ERR', e); process.exit(1); });
