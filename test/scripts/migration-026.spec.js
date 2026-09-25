'use strict';
const fs=require('fs'),path=require('path');
const harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
describe('026 universal append-only audit ledger',function(){
   this.timeout(60000);const name=`ds2_mig_test_026_${process.pid}`;let db;
   const sql=fs.readFileSync(path.join(__dirname,'../../migrations/026.audit_ledger.sql'),'utf8');
   before(async()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name);db=harness.knexFor(name);});
   after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
   it('is plain SQL, idempotent and preserves all existing evidence and activation time',async()=>{
      expect(()=>assertPlainSql(sql,'026')).not.to.throw();
      const policy=await db('audit_policy').first(),events=await db('audit_events').orderBy('event_id');
      await db.transaction(t=>t.raw(sql));await db.transaction(t=>t.raw(sql));
      expect(await db('audit_policy').first()).to.deep.equal(policy);expect(await db('audit_events').orderBy('event_id')).to.deep.equal(events);
      expect(events.length).to.be.above(0);
   });
   it('captures raw imports as system, exact field changes, deletion and explicit actor name snapshots',async()=>{
      await db.transaction(async t=>{
         await t.raw("SELECT set_config('app.actor_user_id','2',true),set_config('app.audit_source','test/import',true),set_config('app.correlation_id','migration-026',true)");
         await t('customers').where({account_id:1,customer_id:1}).update({display_name:'Changed by Ada'});
      });
      const event=await db('audit_events').where({correlation_id:'migration-026'}).first();
      expect(event.actor_user_id).to.equal(2);expect(event.actor_name).to.equal('Ada Admin');
      expect(event.changes.display_name).to.deep.equal({before:'Alice Anderson',after:'Changed by Ada'});
      await db('users').where({user_id:2}).update({display_name:'New Ada'});
      expect((await db('audit_events').where({event_id:event.event_id}).first()).actor_name).to.equal('Ada Admin');
      const last=await db('audit_events').orderBy('event_id','desc').first();expect(last.actor_name).to.equal('system');expect(last.source).to.contain('database/');
      await db('customer_quotes').insert({account_id:1,customer_id:1,amount_quoted:7,is_quote_active:true,created_by_user_id:2});
      await db('customer_quotes').where({account_id:1,customer_id:1}).del();
      expect((await db('audit_events').where({entity:'customer_quotes',action:'delete'}).first()).before_value.amount_quoted).to.equal(7);
   });
   it('preserves the authenticated actor during self-deletion and subsequent cascade work',async()=>{
      const before=await db('audit_events').count({n:'*'}).first();
      await db.transaction(async t=>{
         const [user]=await t('users').insert({account_id:1,email:'self-delete@audit.test',display_name:'Departing Admin',job_title:'Admin',access_level:'Admin'}).returning('*');
         await t.raw("SELECT set_config('app.actor_user_id',?,true),set_config('app.actor_name',?,true),set_config('app.correlation_id','self-delete',true)",[String(user.user_id),user.display_name]);
         await t('users').where({user_id:user.user_id}).del();
         await t('customers').where({customer_id:1}).update({display_name:'After actor deletion'});
         const events=await t('audit_events').where({correlation_id:'self-delete'}).orderBy('event_id');
         expect(events).to.have.length(2);
         for(const event of events){expect(event.actor_user_id).to.equal(user.user_id);expect(event.actor_name).to.equal('Departing Admin');}
         expect((await t.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true);
         await t.rollback();
      });
      expect(await db('audit_events').count({n:'*'}).first()).to.deep.equal(before);
   });
   for(const table of ['audit_events','audit_records','audit_actions','audit_policy','audit_chain_heads']) {
      it(`refuses ${table} UPDATE, DELETE and TRUNCATE`,async()=>{
         for(const command of [`UPDATE ${table} SET ${table==='audit_chain_heads'?'event_hash=event_hash':table==='audit_policy'?'singleton=singleton':table==='audit_events'?'event_hash=event_hash':table==='audit_actions'?'action=action':'storage_key=storage_key'}`,`DELETE FROM ${table}`,`TRUNCATE ${table}`]) {
            // Empty tables still have a statement-level TRUNCATE guard. UPDATE /
            // DELETE row guards are proven on event/policy/head populated tables.
            const rows=await db(table).count({n:'*'}).first();
            if(Number(rows.n)===0 && !command.startsWith('TRUNCATE'))continue;
            let error;try{await db.raw(command);}catch(e){error=e;}expect(error,command).to.exist;expect(error.code).to.equal('P0409');
         }
      });
   }
   it('rolls back data and evidence together and verifies a concurrent chain',async()=>{
      const count=await db('audit_events').count({n:'*'}).first();
      try{await db.transaction(async t=>{await t('customers').where({customer_id:1}).update({display_name:'rollback'});throw Error('rollback');});}catch(e){expect(e.message).to.equal('rollback');}
      expect(await db('audit_events').count({n:'*'}).first()).to.deep.equal(count);
      await Promise.all([1,2,3].map(customer_id=>db('customers').where({customer_id}).update({display_name:'Concurrent '+customer_id})));
      expect((await db.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true);
   });
   it('detects privileged tampering, missing interior rows and deletion of the chain tail',async()=>{
      // ds2_clean is the harness throwaway database, never ds2_local/reference.
      expect((await db.raw('select current_database() db')).rows[0].db).to.equal('ds2_clean');
      for(const tamper of ["UPDATE audit_events SET actor_name='forged' WHERE event_id=(SELECT min(event_id) FROM audit_events WHERE account_id=1)",
         'DELETE FROM audit_events WHERE event_id=(SELECT min(event_id) FROM audit_events WHERE account_id=1)',
         'DELETE FROM audit_events WHERE event_id=(SELECT max(event_id) FROM audit_events WHERE account_id=1)']) {
         await db.transaction(async t=>{
            await t.raw('ALTER TABLE audit_events DISABLE TRIGGER ds2_audit_immutable');await t.raw(tamper);
            expect((await t.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(false);
            await t.rollback();
         });
      }
      expect((await db.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true);
   });
});
