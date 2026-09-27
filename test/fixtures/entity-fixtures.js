'use strict';
// Existing single-business scenarios explicitly select their fixture's default.
// This helper affects fixture INSERTs only, never HTTP/application writes, and
// must be enabled on a local test client. New missing-entity tests use raw SQL.
const Builder=require('knex/lib/query/querybuilder');
const original=Builder.prototype.insert;
const tableOriginal=Builder.prototype.table;
const tables=new Set(['timesheet_entries','customer_transactions','customer_payments','customer_writeoffs','customer_retainers_and_prepayments','customer_invoices','retainer_events','invoice_issues','recurring_customers','customer_quotes']);
if(!Builder.prototype.__entityFixtureInsert){
 Builder.prototype.__entityFixtureInsert=true;
 Builder.prototype.table=Builder.prototype.into=function(...args){
  const result=tableOriginal.apply(this,args);
  if(this._single.insert) this.insert(this._single.insert);
  return result;
 };
 Builder.prototype.insert=function(data,...rest){
  const ctx=require('../../src/utils/auditContext').storage.getStore();
  if(this.client.config.entityFixtures && !ctx?.request && !ctx?.billingScope && tables.has(String(this._single.table).replace(/^public\./,''))){
   const complete=row=>row && row.account_id && row.billing_entity_id==null && !(String(this._single.table)==='timesheet_entries' && Object.hasOwn(row,'entity'))?{...row,billing_entity_id:this.client.raw('(SELECT billing_entity_id FROM public.billing_entities WHERE account_id=? AND is_default)',[row.account_id])}:row;
   data=Array.isArray(data)?data.map(complete):complete(data);
  }
  return original.call(this,data,...rest);
 };
}
module.exports=db=>{db.client.config.entityFixtures=true;return db;};
