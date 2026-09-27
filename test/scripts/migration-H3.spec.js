'use strict';
const fs=require('fs'),path=require('path'),harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const file=path.join(__dirname,'../../migrations/042.invoice_corrections.sql');
describe('H3 migration 042',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h3_${process.pid}`;
 before(()=>{if(!harness.isAvailable())throw Error('Authorized local sandbox is required');harness.dropDb(name);db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 it('is transaction-safe plain SQL',()=>expect(()=>assertPlainSql(fs.readFileSync(file,'utf8'),file)).not.to.throw());
 it('is idempotent and changes no source records or audit events',async()=>{const tables=['customer_invoices','customer_transactions','customer_payments','audit_events'],before={};for(const t of tables)before[t]=await db(t).select('*');for(let n=0;n<2;n++)await db.transaction(trx=>trx.raw(fs.readFileSync(file,'utf8')));for(const t of tables)expect(await db(t).select('*')).to.deep.equal(before[t]);});
 for(const table of ['credit_memos','credit_memo_lines','credit_memo_reversals','invoice_voids','rebill_links','client_refunds','correction_postings'])it(`${table} has immutable audit and ownership guards`,async()=>{const triggers=(await db.raw('SELECT tgname FROM pg_trigger WHERE tgrelid=?::regclass AND NOT tgisinternal',[table])).rows.map(r=>r.tgname);expect(triggers).to.include.members(['ds2_audit_capture','ds2_audit_immutable','ds2_audit_no_truncate','ds2_ar_scope_guard']);});
 it('keeps the account audit chain valid',async()=>expect((await db.raw('SELECT ds2_verify_audit(1) AS v')).rows[0].v.valid).to.equal(true));
});
