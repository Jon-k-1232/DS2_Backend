'use strict';
const fs=require('fs'),path=require('path');const harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const names=fs.readdirSync(path.join(__dirname,'../../migrations')).filter(f=>/^0(2[89]|3[0-6])\./.test(f)).sort();
describe('H1 entity migrations 028–036',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h1_${process.pid}`;
 // Verify this historical chain on its own schema era; H4 appends view columns.
 before(()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name,{through:36});db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 for(const name of names)it(`${name} is transaction-safe plain SQL`,()=>{expect(()=>assertPlainSql(fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8'),name)).not.to.throw();});
 it('reruns the complete chain without changing original source rows or duplicating evidence',async()=>{
  const original=await db('customers').orderBy('customer_id');
  const run=async()=>{for(const name of names)await db.transaction(t=>t.raw(fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8')));};
  await run();const events=await db('audit_events').orderBy('event_id');await run();expect(await db('audit_events').orderBy('event_id')).to.deep.equal(events);expect(await db('customers').orderBy('customer_id')).to.deep.equal(original);
 });
 it('guards direct SQL financial writes without an explicit business, atomically',async()=>{
  const before=await db('audit_events').count({n:'*'}).first();let error;
  try{await db('customer_payments').insert({account_id:1,customer_id:1,payment_amount:-10,payment_date:'2026-09-01',form_of_payment:'Cash',created_by_user_id:1});}catch(e){error=e;}
  expect(error?.code).to.equal('P0400');expect(await db('audit_events').count({n:'*'}).first()).to.deep.equal(before);
 });
 it('normalizes only exact spellings and retains an active default',async()=>{
  const e=await db('billing_entities').where({account_id:1,is_default:true}).first();expect(e.active).to.equal(true);
  const result=(await db.raw("SELECT ds2_normalize_entity(?) AS n,ds2_entity_match(?,?) AS ids",['  J.F.  KIMMEL, INC. ',1,e.name])).rows[0];expect(result.n).to.equal('jf kimmel inc');expect(result.ids).to.deep.equal([e.billing_entity_id]);
  const before=await db('audit_events').count({n:'*'}).first();let error;try{await db('billing_entities').where({billing_entity_id:e.billing_entity_id}).update({active:false});}catch(e2){error=e2;}expect(error).to.exist;expect(await db('audit_events').count({n:'*'}).first()).to.deep.equal(before);
 });
 it('has append-only capture and same-account keys for all new financial evidence',async()=>{
  for(const table of ['billing_cutovers','legacy_financial_entity_attributions','billing_entity_reviews','billing_entity_resolutions','billing_cutover_positions','billing_cutover_links','billing_cutover_allocations','billing_cutover_allocation_links','billing_credit_transfers','financial_requests']){
   const rows=(await db.raw("SELECT tgname FROM pg_trigger WHERE tgrelid=?::regclass AND NOT tgisinternal",[table])).rows.map(r=>r.tgname);
   expect(rows,table).to.include.members(['ds2_audit_capture','ds2_audit_immutable','ds2_audit_no_truncate']);
  }
  expect((await db.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true);
 });
});
