'use strict';
const fs=require('fs'),path=require('path'),harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const names=fs.readdirSync(path.join(__dirname,'../../migrations')).filter(f=>/^0(3[7-9]|4[01])\./.test(f)).sort();
describe('H2 migrations 037–041',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h2_${process.pid}`;
 before(()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name);db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 for(const name of names)it(`${name} is transaction-safe plain SQL`,()=>expect(()=>assertPlainSql(fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8'),name)).not.to.throw());
 it('reruns without altering sources or duplicating audit events',async()=>{const original=await db('customers').orderBy('customer_id');for(const name of names)await db.transaction(t=>t.raw(fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8')));const before=await db('audit_events').orderBy('event_id');for(const name of names)await db.transaction(t=>t.raw(fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8')));expect(await db('audit_events').orderBy('event_id')).to.deep.equal(before);expect(await db('customers').orderBy('customer_id')).to.deep.equal(original);});
 it('captures every new table, forbids edits and preserves the audit chain',async()=>{for(const table of ['billing_cutover_amendments','legacy_billing_scopes','ar_derivations','ar_obligations','payment_receipts','ar_applications','client_credit_lots','client_credit_events','receipt_events','ar_obligation_carriers']){const triggers=(await db.raw('SELECT tgname FROM pg_trigger WHERE tgrelid=?::regclass AND NOT tgisinternal',[table])).rows.map(r=>r.tgname);expect(triggers,table).to.include.members(['ds2_audit_capture','ds2_audit_immutable','ds2_audit_no_truncate']);}expect((await db.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true);});
 it('rejects a manual receipt without matching applications or credit at commit',async()=>{const entity=(await db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;const before=await db('audit_events').count({n:'*'}).first();let error;try{await db.transaction(t=>t('payment_receipts').insert({account_id:1,customer_id:1,billing_entity_id:entity,amount:10,receipt_date:'2026-09-01',method:'cash'}));}catch(e){error=e;}expect(error).to.exist;expect(await db('audit_events').count({n:'*'}).first()).to.deep.equal(before);});
});
