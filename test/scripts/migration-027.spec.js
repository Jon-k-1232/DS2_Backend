'use strict';
const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
describe('027 immutable audit presentation types and evidence archives',function(){
 this.timeout(60000);const name=`ds2_mig_test_027_${process.pid}`;let db;
 const sql=fs.readFileSync(path.join(__dirname,'../../migrations/027.audit_record_presentations.sql'),'utf8');
 before(()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name);db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 const row=()=>({record_id:randomUUID(),account_id:1,customer_id:1,generated_by:2,generated_by_name:'Ada Admin',storage_key:randomUUID()+'.pdf',document_sha256:'a'.repeat(64),content_sha256:'b'.repeat(64),chain_hash:'0'.repeat(64),byte_length:1});
 it('is plain SQL, idempotent, and preserves existing rows, activation and chain evidence',async()=>{
  expect(()=>assertPlainSql(sql,'027')).not.to.throw();
  const [legacy]=await db('audit_records').insert(row()).returning('*');expect(legacy.record_type).to.equal('full_evidence');expect(legacy.evidence_storage_key).to.equal(null);
  const policy=await db('audit_policy').first(),events=await db('audit_events').orderBy('event_id');
  await db.transaction(t=>t.raw(sql));await db.transaction(t=>t.raw(sql));
  expect(await db('audit_policy').first()).to.deep.equal(policy);expect(await db('audit_events').orderBy('event_id')).to.deep.equal(events);
  expect(await db('audit_records').where({record_id:legacy.record_id}).first()).to.deep.equal(legacy);
 });
 it('validates record types and complete evidence identities atomically',async()=>{
  for(const extra of [{record_type:'invalid'},{evidence_storage_key:'x'},{evidence_sha256:'x'},{evidence_byte_length:1},{evidence_storage_key:'x',evidence_sha256:'x',evidence_byte_length:0}]){
   const before=await db('audit_events').count({n:'*'}).first();let error;try{await db('audit_records').insert({...row(),...extra});}catch(e){error=e;}
   expect(error?.code).to.equal('23514');expect(await db('audit_events').count({n:'*'}).first()).to.deep.equal(before);
  }
 });
 it('captures and locks the type and archive metadata, with duplicate archive keys refused',async()=>{
  const [saved]=await db('audit_records').insert({...row(),record_type:'client',evidence_storage_key:'unique.json',evidence_sha256:'c'.repeat(64),evidence_byte_length:123}).returning('*');
  for(const values of [{record_type:'full_evidence'},{evidence_sha256:'d'.repeat(64)}]){let error;try{await db('audit_records').where({record_id:saved.record_id}).update(values);}catch(e){error=e;}expect(error?.code).to.equal('P0409');}
  let error;try{await db('audit_records').insert({...row(),evidence_storage_key:saved.evidence_storage_key,evidence_sha256:saved.evidence_sha256,evidence_byte_length:123});}catch(e){error=e;}expect(error?.code).to.equal('23505');
  expect((await db.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true);
 });
});
