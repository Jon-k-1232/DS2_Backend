/* eslint-disable no-console */
// Three-view agreement check (read-only):
//   1. engine vs audit — Create Invoice's invoiceTotal vs Account Audit's
//      audit_balance, for every ACTIVE customer (the long-standing baseline);
//   2. engine vs AR    — the engine's outstandingInvoiceTotal (what is owed on
//      the current statement(s)) vs Accounts Receivable's total_outstanding
//      (0 when the customer is not listed), for every active customer plus any
//      inactive customer AR lists because they still owe money.
//
//   DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json
const knex = require('./_db').makeDb({ envFile: '.env.dev', database: 'ds2_dev' });
const auditSvc = require('../src/endpoints/accountAudit/account-audit-service');
const { auditCustomerLedger } = require('../src/endpoints/accountAudit/account-audit-logic');
const accountsReceivableService = require('../src/endpoints/accountsReceivable/accounts-receivable-service');
const { fetchInitialQueryItems } = require('../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');

const ACCOUNT_ID = 1;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const runEngine = async ids => {
  if (!ids.length) return new Map();
  const invoicesToCreateMap = {};
  ids.forEach(id => { invoicesToCreateMap[id] = { customer_id: id, showWriteOffs: false, invoiceNote: null }; });
  const queryData = await fetchInitialQueryItems(knex, invoicesToCreateMap, ACCOUNT_ID);
  const engineRows = calculateInvoices(ids.map(id => ({ customer_id: id, showWriteOffs: false })), queryData);
  return new Map(
    engineRows.map(r => [
      Number(r.customer_id),
      { invoiceTotal: round2(r.invoiceTotal), outstanding: round2(r.outstandingInvoices?.outstandingInvoiceTotal) }
    ])
  );
};

const runAudit = async customerId => {
  const [customer, invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
    auditSvc.getCustomer(knex, ACCOUNT_ID, customerId),
    auditSvc.getInvoices(knex, ACCOUNT_ID, customerId),
    auditSvc.getPayments(knex, ACCOUNT_ID, customerId),
    auditSvc.getWriteoffs(knex, ACCOUNT_ID, customerId),
    auditSvc.getTransactions(knex, ACCOUNT_ID, customerId),
    auditSvc.getRetainers(knex, ACCOUNT_ID, customerId)
  ]);
  return auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });
};

(async () => {
  const customers = await knex('customers')
    .where({ account_id: ACCOUNT_ID, is_customer_active: true })
    .select('customer_id', 'display_name')
    .orderBy('customer_id');
  const activeIds = customers.map(c => Number(c.customer_id));

  // AR view, every row (the service pages; ask for more than can exist).
  const { rows: arRows, totalCount: arCount } = await accountsReceivableService.getAging(knex, ACCOUNT_ID, { limit: 1000000, offset: 0 });
  const arById = new Map(arRows.map(r => [Number(r.customer_id), r]));
  const inactiveArIds = arRows.map(r => Number(r.customer_id)).filter(id => !activeIds.includes(id));

  const engineById = await runEngine([...activeIds, ...inactiveArIds]);

  // 1. engine vs audit (active customers)
  const out = {};
  for (const c of customers) {
    const id = Number(c.customer_id);
    const audit = await runAudit(id);
    const engine = engineById.get(id) || { invoiceTotal: 0, outstanding: 0 };
    const ar = arById.get(id);
    out[id] = {
      name: c.display_name,
      audit: audit.totals.audit_balance,
      engine: engine.invoiceTotal,
      diff: round2(audit.totals.audit_balance - engine.invoiceTotal),
      audit_outstanding: audit.totals.outstanding_invoices,
      engine_outstanding: engine.outstanding,
      ar_outstanding: ar ? round2(ar.total_outstanding) : 0,
      ar_diff: round2((ar ? ar.total_outstanding : 0) - engine.outstanding)
    };
  }
  const mismatched = Object.entries(out)
    .filter(([, r]) => Math.abs(r.diff) >= 0.01)
    .map(([id, r]) => ({ customer_id: Number(id), ...r }));

  // 2. engine vs AR (active customers + inactive customers AR lists)
  const inactiveNames = new Map(arRows.map(r => [Number(r.customer_id), r.display_name]));
  for (const id of inactiveArIds) {
    const engine = engineById.get(id) || { invoiceTotal: 0, outstanding: 0 };
    const ar = arById.get(id);
    out[id] = {
      name: inactiveNames.get(id),
      inactive: true,
      engine: engine.invoiceTotal,
      engine_outstanding: engine.outstanding,
      ar_outstanding: round2(ar.total_outstanding),
      ar_diff: round2(ar.total_outstanding - engine.outstanding)
    };
  }
  const arMismatched = Object.entries(out)
    .filter(([, r]) => Math.abs(r.ar_diff) >= 0.01)
    .map(([id, r]) => ({ customer_id: Number(id), name: r.name, inactive: !!r.inactive, engine_outstanding: r.engine_outstanding, ar_outstanding: r.ar_outstanding, ar_diff: r.ar_diff }));

  console.log(
    JSON.stringify(
      {
        total: customers.length,
        mismatched: mismatched.length,
        details: mismatched.slice(0, 25),
        engine_vs_ar: {
          compared: activeIds.length + inactiveArIds.length,
          ar_rows: arCount,
          ar_inactive_rows: inactiveArIds.length,
          mismatched: arMismatched.length,
          details: arMismatched.slice(0, 25)
        }
      },
      null,
      1
    )
  );
  require('fs').writeFileSync(process.argv[2] || '/tmp/drift-snapshot.json', JSON.stringify(out, null, 1));
  await knex.destroy();
})().catch(e => { console.error('ERR', e); process.exit(1); });
