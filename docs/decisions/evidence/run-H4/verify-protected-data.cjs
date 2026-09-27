'use strict';
// Read only. Never connect to the retained reference database.
const fs=require('fs'),path=require('path');
const {Client}=require(path.resolve('node_modules/pg'));
const before=JSON.parse(fs.readFileSync(path.join(__dirname,'account1-before.json')));
const priorPlans=JSON.parse(fs.readFileSync(path.join(__dirname,'account1-plans-before.json')));
const reference={customers:338,customer_transactions:39052,customer_payments:1005,customer_writeoffs:657,customer_invoices:2253,timesheet_entries:28255,users:23};
const client=new Client({host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',ssl:false});
const write=(name,value)=>fs.writeFileSync(path.join(__dirname,name),JSON.stringify(value,null,2)+'\n');
(async()=>{await client.connect();try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const after={};for(const table of Object.keys(before)){
  if(!/^[a-z_]+$/.test(table))throw Error('Unexpected table');
  after[table]=(await client.query(`SELECT count(*)::integer AS count,md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${table} t WHERE account_id=1`)).rows[0];
 }
 const plans=(await client.query('SELECT * FROM recurring_customers WHERE account_id=1 ORDER BY recurring_customer_id')).rows;
 const cutovers=(await client.query('SELECT * FROM recurring_plan_cutovers WHERE account_id=1 ORDER BY plan_id')).rows;
 const changes=plans.map(p=>{const old=priorPlans.find(r=>r.recurring_customer_id===p.recurring_customer_id);if(!old)throw Error('Unexpected account-1 plan');return {planId:p.recurring_customer_id,customerId:p.customer_id,changes:Object.fromEntries(Object.entries(p).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(old[key])).map(([key,value])=>[key,{before:old[key]??null,after:value}]))};});
 const occurrenceCounts={};for(const table of ['recurring_charge_occurrences','recurring_occurrence_events'])occurrenceCounts[table]=(await client.query(`SELECT count(*)::integer AS n FROM ${table} WHERE account_id=1`)).rows[0].n;
 const audit=(await client.query('SELECT ds2_verify_audit(1) AS v')).rows[0].v;
 const priorAudit=(await client.query(`SELECT count(*)::integer AS count,md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) AS digest FROM (SELECT * FROM audit_events WHERE account_id=1 ORDER BY event_id LIMIT $1) t`,[before.audit_events.count])).rows[0];
 const newAudit=(await client.query('SELECT event_id,entity,action,actor_user_id,actor_name,source,reason FROM audit_events WHERE account_id=1 ORDER BY event_id OFFSET $1',[before.audit_events.count])).rows;
 await client.query('ROLLBACK');
 const protectedChanges=Object.keys(before).filter(t=>!['recurring_customers','audit_events'].includes(t) && JSON.stringify(before[t])!==JSON.stringify(after[t]));
 const mismatches=Object.keys(reference).filter(t=>after[t].count!==reference[t]);
 const allowed=new Set(['billing_entity_id','description','job_id','anchor_start_date','first_automated_period','version','review_status','cutover_date']);
 const unexpectedPlanChanges=changes.filter(p=>Object.keys(p.changes).some(k=>!allowed.has(k)));
 const valid=protectedChanges.length===0 && mismatches.length===0 && unexpectedPlanChanges.length===0 && plans.length===8 && cutovers.length===8 && Object.values(occurrenceCounts).every(n=>n===0) && JSON.stringify(priorAudit)===JSON.stringify(before.audit_events) && newAudit.length===16 && newAudit.every(e=>e.actor_user_id===null && e.actor_name==='system' && e.source==='migration/043.recurring_billing' && ['recurring_customers','recurring_plan_cutovers'].includes(e.entity)) && audit.valid;
 const report={checked_at:new Date().toISOString(),connection:'127.0.0.1:5433/ds2_local',valid,reference_basis:'Retained census from H2/H3; ds2_ref_20260922 was never connected.',reference_counts:reference,reference_mismatches:mismatches,protected_changes:protectedChanges,plan_changes:changes,unexpected_plan_changes:unexpectedPlanChanges,cutover_rows:cutovers.length,occurrence_rows:occurrenceCounts,prior_audit_unchanged:JSON.stringify(priorAudit)===JSON.stringify(before.audit_events),new_audit_events:newAudit,audit};
 write('account1-after.json',after);write('account1-plans-after.json',plans);write('account1-cutovers.json',cutovers);write('account1-verification.json',report);console.log(JSON.stringify(report,null,2));if(!valid)process.exitCode=1;
}finally{await client.end();}})().catch(e=>{console.error(e);process.exitCode=1;});
