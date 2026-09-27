'use strict';
const context=require('./entity-context');
const {ruleError}=require('../payments/ledger-helpers');
async function resolve(db,accountId,entry){
 const {rows}=await db.raw("SELECT public.ds2_effective_entity(?, 'timesheet_entries', ?, ?) AS assigned,public.ds2_entity_match(?,?) AS matches",[accountId,entry.timesheet_entry_id,entry.billing_entity_id || null,accountId,entry.entity || '']);
 const found=rows[0],entityId=found.assigned || (found.matches.length===1?found.matches[0]:null);
 if(!entityId)throw ruleError('Resolve this entry in Business assignments before applying it.',409,'ENTITY_UNRESOLVED');
 await context.requireEntity(db,accountId,entityId);
 return entityId;
}
module.exports={resolve};
