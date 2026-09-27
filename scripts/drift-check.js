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

const runEngine = async (knex,ids) => {
  if (!ids.length) return new Map();
  const invoicesToCreateMap = {};
  ids.forEach(id => { invoicesToCreateMap[id] = { customer_id: id, showWriteOffs: false, invoiceNote: null }; });
  const queryData = await fetchInitialQueryItems(knex, invoicesToCreateMap, ACCOUNT_ID);
  const engineRows = calculateInvoices(ids.map(id => ({ customer_id: id, showWriteOffs: false })), queryData);
  return new Map(
    engineRows.map(r => [
      Number(r.customer_id),
      { invoiceTotal: round2(r.preCreditInvoiceTotal ?? r.invoiceTotal), outstanding: round2(r.outstandingInvoices?.outstandingInvoiceTotal) }
    ])
  );
};

const runAudit = async (knex,customerId) => {
  const [customer, invoices, payments, writeoffs, transactions, retainers, retainerEvents, corrections] = await Promise.all([
    auditSvc.getCustomer(knex, ACCOUNT_ID, customerId),
    auditSvc.getInvoices(knex, ACCOUNT_ID, customerId),
    auditSvc.getPayments(knex, ACCOUNT_ID, customerId),
    auditSvc.getWriteoffs(knex, ACCOUNT_ID, customerId),
    auditSvc.getTransactions(knex, ACCOUNT_ID, customerId),
    auditSvc.getRetainers(knex, ACCOUNT_ID, customerId),
    auditSvc.getRetainerEvents(knex, ACCOUNT_ID, customerId),
    auditSvc.getCorrections(knex, ACCOUNT_ID, customerId)
  ]);
  return auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers, retainerEvents, corrections });
};

const ctx=require('../src/endpoints/billingEntities/entity-context');
(async()=>{
 const result=await ctx.run(null,()=>knex.transaction(async db=>{
  await db.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const customers=await db('customers').where({account_id:ACCOUNT_ID}).orderBy('customer_id');
  const entities=await ctx.entities(db,ACCOUNT_ID), rows=[];
  for(const entity of entities)await ctx.run(entity.billing_entity_id,async()=>{
   const ar=(await accountsReceivableService.getAging(db,ACCOUNT_ID,{limit:1000000})).rows;
   const engine=await runEngine(db,customers.map(c=>c.customer_id));
   for(const c of customers){
    const a=await runAudit(db,c.customer_id),e=engine.get(c.customer_id),r=ar.find(r=>r.customer_id===c.customer_id);
    rows.push({customer_id:c.customer_id,name:c.display_name,billing_entity_id:entity.billing_entity_id,business:entity.name,
     engine:e.invoiceTotal,audit:a.totals.audit_balance,engine_outstanding:e.outstanding,audit_outstanding:a.totals.outstanding_invoices,ar_outstanding:round2(r?.total_outstanding),
     diff:round2(a.totals.audit_balance-e.invoiceTotal),ar_diff:round2((r?.total_outstanding || 0)-e.outstanding),audit_billed_diff:round2(a.totals.outstanding_invoices-e.outstanding)});
   }
  });
  const total=group=>Object.fromEntries(['engine','audit','engine_outstanding','audit_outstanding','ar_outstanding'].map(k=>[k,round2(group.reduce((sum,r)=>sum+r[k],0))]));
  const allAr=await accountsReceivableService.getAging(db,ACCOUNT_ID,{limit:1000000});
  const totals=total(rows),aggregateDiff=round2(allAr.rows.reduce((n,r)=>n+r.total_outstanding,0)-totals.engine_outstanding);
  const mismatches=rows.filter(r=>r.diff || r.ar_diff || r.audit_billed_diff);
  return {account_id:ACCOUNT_ID,compared:rows.length,customers:customers.length,entities:entities.map(e=>({...e,totals:total(rows.filter(r=>r.billing_entity_id===e.billing_entity_id))})),totals,aggregateDiff,drift:mismatches.length+(aggregateDiff?1:0),mismatches,rows};
 }));
 require('fs').writeFileSync(process.argv[2] || '/tmp/drift-snapshot.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({compared:result.compared,entities:result.entities.map(e=>({name:e.name,totals:e.totals})),totals:result.totals,drift:result.drift,mismatches:result.mismatches.slice(0,10)},null,2));
 await knex.destroy();if(result.drift)process.exitCode=1;
})().catch(async e=>{console.error(e);await knex.destroy();process.exitCode=1;});
