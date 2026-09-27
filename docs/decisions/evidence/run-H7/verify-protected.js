'use strict';
const fs=require('fs'),path=require('path');
const {Client}=require('../../../../node_modules/pg');
const expected={customers:338,customer_transactions:39052,customer_payments:1005,customer_writeoffs:657,customer_invoices:2253,timesheet_entries:28255,users:23};
(async()=>{
 const before=JSON.parse(fs.readFileSync(path.join(__dirname,'account1-before.json')));
 const db=new Client({host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'});
 await db.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const after={checked_at:new Date().toISOString(),tables:{}};
  for(const table of Object.keys(before.tables)){
   const result=await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${table} t WHERE account_id=1`);
   after.tables[table]=result.rows[0];
  }
  const changes=Object.keys(before.tables).filter(t=>JSON.stringify(before.tables[t])!==JSON.stringify(after.tables[t]));
  const mismatches=Object.keys(expected).filter(t=>after.tables[t].count!==expected[t]);
  const audit=(await db.query('SELECT ds2_verify_audit(1) AS verification')).rows[0].verification;
  await db.query('COMMIT');
  const report={checked_at:new Date().toISOString(),valid:changes.length===0 && mismatches.length===0 && audit.valid,connection:'127.0.0.1:5433/ds2_local',reference_basis:'Retained H2-H6 reference census; ds2_ref_20260922 never connected',reference_counts:expected,reference_mismatches:mismatches,changed_tables:changes,intended_migration_effects:[],audit};
  fs.writeFileSync(path.join(__dirname,'account1-after.json'),JSON.stringify(after,null,2)+'\n');
  fs.writeFileSync(path.join(__dirname,'account1-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(!report.valid)process.exitCode=1;
 }finally{await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
