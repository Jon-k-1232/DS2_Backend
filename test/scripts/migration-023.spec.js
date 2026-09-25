'use strict';
const fs = require('fs'); const path = require('path'); const harness = require('./helpers/pgHarness');
const { assertPlainSql } = require('../../scripts/migrate');
describe('023 sent invoice evidence migration',function(){
 this.timeout(30000); const name=`ds2_mig_test_023_${process.pid}`; let db;
 const sql=fs.readFileSync(path.join(__dirname,'../../migrations/023.sent_invoice_locks.sql'),'utf8');
 before(async function(){ if(!harness.isAvailable()) throw new Error('Authorized local database required'); harness.createThrowawayDb(name); db=harness.knexFor(name); });
 after(async()=>{if(db) await db.destroy(); harness.dropDb(name);});
 it('is plain SQL, applies atomically and reruns without moving its legacy boundary',async()=>{
   expect(()=>assertPlainSql(sql,'023')).not.to.throw();
   await db.transaction(t=>t.raw(sql)); const before=await db('invoice_lock_policy').first();
   await db.transaction(t=>t.raw(sql)); expect(await db('invoice_lock_policy').first()).to.deep.equal(before);
   for(const table of ['invoice_issues','invoice_statement_members','invoice_exceptions','invoice_exception_payments','invoice_revisions','invoice_history']) expect(await db.schema.hasTable(table)).to.equal(true);
   expect((await db('customers').count({n:'*'}).first()).n).to.equal('0');
 });
 it('installs guards on every ledger table and append-only evidence',async()=>{
   const {rows}=await db.raw("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('ds2_sent_record','ds2_sent_customer','ds2_sent_job','ds2_immutable')");
   expect(rows).to.have.length(11);
   expect((await db.raw("SELECT ds2_locked_invoice('customer_payments',999,9001) n")).rows[0].n).to.equal(null);
 });
});
