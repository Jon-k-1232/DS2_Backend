'use strict';
// H5 read-only census: compare original columns with the preserved pre-H5 digests.
// The retained reference database is deliberately never connected.
const fs=require('fs'),path=require('path'),{Client}=require(path.resolve('node_modules/pg'));
const before=JSON.parse(fs.readFileSync(path.join(__dirname,'account1-before.json')));
const reference={customers:338,customer_transactions:39052,customer_payments:1005,customer_writeoffs:657,customer_invoices:2253,timesheet_entries:28255,users:23};
const added=['cost_rate_snapshot','cost_rate_source','cost_snapshot_at','actual_duration_minutes','duration_source','billing_rate_snapshot','standard_value_snapshot','source_timesheet_entry_id'];
const client=new Client({host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',ssl:false});
const write=(name,data)=>fs.writeFileSync(path.join(__dirname,name),JSON.stringify(data,null,2)+'\n');
(async()=>{await client.connect();try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const after={},populated={};
 for(const table of Object.keys(before)){
  if(!/^[a-z_]+$/.test(table))throw Error('Unexpected table');
  const cols=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table])).rows.map(r=>r.column_name);
  const newCols=['customer_transactions','timesheet_entries'].includes(table)?cols.filter(c=>added.includes(c)):[];
  const oldCols=cols.filter(c=>!newCols.includes(c)).map(c=>'"'+c+'"').join(',');
  after[table]=(await client.query(`SELECT count(*)::int count,md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) digest FROM (SELECT ${oldCols} FROM ${table} WHERE account_id=1) t`)).rows[0];
  if(newCols.length)populated[table]=(await client.query(`SELECT count(*)::int n FROM ${table} WHERE account_id=1 AND (${newCols.map(c=>c+' IS NOT NULL').join(' OR ')})`)).rows[0].n;
 }
 const estimates=(await client.query('SELECT table_name,cost_rate_source,duration_source,count(*)::int count FROM legacy_work_cost_estimates WHERE account_id=1 GROUP BY 1,2,3 ORDER BY 1,2,3')).rows;
 const audits=(await client.query('SELECT entity,action,actor_name,actor_user_id,source,reason,count(*)::int count FROM audit_events WHERE account_id=1 AND event_id>(SELECT max(event_id) FROM (SELECT event_id FROM audit_events WHERE account_id=1 ORDER BY event_id LIMIT $1) p) GROUP BY 1,2,3,4,5,6 ORDER BY 1',[before.audit_events.count])).rows;
 const priorAudit=(await client.query("SELECT count(*)::int count,md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) digest FROM (SELECT * FROM audit_events WHERE account_id=1 ORDER BY event_id LIMIT $1) t",[before.audit_events.count])).rows[0];
 const audit=(await client.query('SELECT ds2_verify_audit(1) v')).rows[0].v;
 const attribution=(await client.query("SELECT table_name,reporting_basis,reporting_entity_id,count(*)::int count FROM legacy_billing_scopes WHERE account_id=1 GROUP BY 1,2,3 ORDER BY 1,2,3")).rows;
 const mismatches=Object.keys(reference).filter(t=>after[t].count!==reference[t]);
 const changes=Object.keys(before).filter(t=>t!=='audit_events' && JSON.stringify(before[t])!==JSON.stringify(after[t]));
 const estimateCount=estimates.reduce((n,r)=>n+r.count,0),newAuditCount=audits.reduce((n,r)=>n+r.count,0);
 const valid=!mismatches.length && !changes.length && Object.values(populated).every(n=>n===0) && estimateCount===67307 && newAuditCount===67307 && audits.every(r=>r.entity==='legacy_work_cost_estimates' && r.action==='insert' && r.actor_user_id===null && r.actor_name==='system' && r.source==='migration/045.work_cost_snapshots') && JSON.stringify(priorAudit)===JSON.stringify(before.audit_events) && audit.valid;
 const report={checked_at:new Date().toISOString(),valid,connection:'127.0.0.1:5433/ds2_local',reference_basis:'Retained H2-H4 census; ds2_ref_20260922 never connected',reference_counts:reference,reference_mismatches:mismatches,original_column_changes:changes,new_source_columns_populated:populated,estimates,estimate_count:estimateCount,new_audit_groups:audits,new_audit_count:newAuditCount,prior_audit_unchanged:JSON.stringify(priorAudit)===JSON.stringify(before.audit_events),audit,legacy_reporting_attribution:attribution};
 await client.query('ROLLBACK');write('account1-after.json',after);write('account1-verification.json',report);console.log(JSON.stringify(report,null,2));if(!valid)process.exitCode=1;
}finally{await client.end();}})().catch(e=>{console.error(e);process.exitCode=1;});
