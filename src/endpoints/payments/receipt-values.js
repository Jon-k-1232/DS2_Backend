'use strict';
const {ruleError}=require('./ledger-helpers');
const today=require('../invoice/billingDate').billingDateToday;
function cents(value,{signed=false,zero=false}={}){
 if(!['string','number'].includes(typeof value) || !(signed?/^-?\d+(\.\d{1,2})?$/:/^\d+(\.\d{1,2})?$/).test(String(value)))throw ruleError('Enter an amount with at most two decimal places.',400);
 const n=Math.round(Number(value)*100);
 if(!Number.isSafeInteger(n) || Math.abs(n)>9999999999 || (!zero && n===0) || (!signed && n<0))throw ruleError('Amount must be positive and at most 99,999,999.99.',400);
 return n;
}
const dollars=n=>(n/100).toFixed(2);
function date(value,{future=false}={}){
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)throw ruleError('Enter a valid calendar date (YYYY-MM-DD).',400);
 if(!future && value>today())throw ruleError('The date cannot be in the future.',400);
 return value;
}
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
function utcTimestamp(value){
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw ruleError('Recorded through must be a valid UTC timestamp.',400);
 // Preserve PostgreSQL microseconds; Date is used only to validate the calendar
 // and clock components, never to round the supplied knowledge boundary.
 return value;
}
function cutoffs(options={}){
 const asOf=date(options.asOf || today());
 const recordedThrough=utcTimestamp(options.recordedThrough || new Date().toISOString());
 return {asOf,recordedThrough};
}
function fifo(obligations,amount){let left=amount;return obligations.flatMap(o=>{const applied=Math.min(left,o.openCents);left-=applied;return applied>0?[{obligationId:o.obligation_id,amount:dollars(applied)}]:[];});}
async function databaseCutoffs(db,options={}){
 const result=cutoffs(options);
 if(!options.recordedThrough)result.recordedThrough=(await db.raw(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff`)).rows[0].cutoff;
 return result;
}
module.exports={cents,dollars,date,day,today,utcTimestamp,cutoffs,databaseCutoffs,fifo};
