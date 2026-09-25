const { round2, ruleError, withTransaction, ledgerNow, lockCustomerLedger, parseCancelledByReversal } = require('../payments/ledger-helpers');
const service = require('./retainer-service');
const { id, text, reason, actionContext } = require('../../utils/ledgerAction');
const { lockNumber } = require('../invoice/sentInvoiceLocks');
const TABLE = 'customer_retainers_and_prepayments';
function validate(body = {}) {
   if (!['refund','adjustment'].includes(body.kind)) throw ruleError('Choose refund or adjustment.',400);
   const direction = body.kind === 'refund' ? 'decrease' : body.direction;
   if (!['increase','decrease'].includes(direction) || (body.kind === 'refund' && body.direction && body.direction !== 'decrease')) throw ruleError('Choose increase or decrease; refunds decrease credit.',400);
   if (!['string','number'].includes(typeof body.amount) || !/^\d+(\.\d{1,2})?$/.test(String(body.amount)) || Number(body.amount) <= 0 || Number(body.amount) > 99999999.99) throw ruleError('Amount must be between 0.01 and 99,999,999.99 with at most two decimal places.',400);
   if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || body.date < '1900-01-01' || body.date > '9999-12-31' || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0,10) !== body.date) throw ruleError('A valid calendar date (YYYY-MM-DD) is required.',400);
   return { kind:body.kind, direction, amount:round2(body.amount), event_date:body.date, reason:reason(body.reason),
      method:text(body.method,'Method',50,body.kind === 'refund'), reference:text(body.reference,'Reference',100,body.kind === 'refund') };
}
async function load(db, accountId, retainerId) {
   const row = await db(TABLE).where({ account_id:accountId, retainer_id:id(retainerId) }).first();
   if (!row) throw ruleError('Retainer not found.',404);
   const chain = await service.getRetainerChain(db,accountId,row.parent_retainer_id || row.retainer_id);
   const root = chain.find(r => r.retainer_id === (row.parent_retainer_id || row.retainer_id));
   if (!root || chain.some(r => r.customer_id !== row.customer_id)) throw ruleError('Retainer chain is inconsistent; review the account before adjusting.',409);
   return { root, latest:chain[chain.length-1] };
}
async function history(db, accountId, retainerId) {
   return withTransaction(db, async trx => {
      const { root,latest } = await load(trx,accountId,retainerId);
      await lockCustomerLedger(trx,accountId,root.customer_id);
      const current = await load(trx,accountId,retainerId);
      const events = await trx('retainer_events').where({account_id:accountId,root_retainer_id:root.retainer_id}).orderBy('event_id');
      const lockedInvoice = await lockNumber(trx,accountId,TABLE,root.retainer_id);
      return { ...current, available:round2(-Number(current.latest.current_amount)), events, lockedInvoice };
   });
}
async function createEvent(db,{accountId,actorId,retainerId,body}) {
   const fields = validate(body);
   id(retainerId);
   return withTransaction(db,async trx => {
      const first = await load(trx,accountId,retainerId);
      await lockCustomerLedger(trx,accountId,first.root.customer_id);
      const {root,latest} = await load(trx,accountId,retainerId);
      if (parseCancelledByReversal(root.note) || parseCancelledByReversal(latest.note)) throw ruleError('This prepayment was cancelled by a payment reversal. It cannot be adjusted.',409);
      const before = round2(-Number(latest.current_amount));
      if (before < 0 || (!latest.is_retainer_active && before > 0)) throw ruleError('Retainer state is inconsistent; review the account before adjusting.',409);
      const delta = fields.direction === 'increase' ? -fields.amount : fields.amount;
      const after = round2(before - delta);
      if (after < 0) throw ruleError(`Only $${before.toFixed(2)} is available. Funds already applied cannot be refunded or removed.`,409);
      if (after > 99999999.99) throw ruleError('Resulting retainer credit exceeds 99,999,999.99.',409);
      await actionContext(trx,actorId,fields.reason);
      const {retainer_id,created_at,...copy} = latest;
      const snapshot = await service.createRetainer(trx,{...copy,parent_retainer_id:root.retainer_id,current_amount:-after,is_retainer_active:after>0,created_by_user_id:actorId,created_at:ledgerNow(trx)});
      const [event] = await trx('retainer_events').insert({...fields,account_id:accountId,customer_id:root.customer_id,root_retainer_id:root.retainer_id,snapshot_id:snapshot.retainer_id,balance_delta:delta,available_before:before,available_after:after,actor_id:actorId,created_at:ledgerNow(trx)}).returning('*');
      if (!event) throw new Error('Retainer event insertion did not return its saved record.');
      return {event,available:after,message:'Retainer event recorded.'};
   });
}
module.exports = { validate, history, createEvent };
