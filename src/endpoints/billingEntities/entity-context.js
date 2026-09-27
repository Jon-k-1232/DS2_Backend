'use strict';
const { storage } = require('../../utils/auditContext');
const { ruleError } = require('../payments/ledger-helpers');
const { id } = require('../../utils/ledgerAction');
const current = () => storage.getStore()?.billingEntityId ?? null;
const run = (entityId, fn) => storage.run({ ...storage.getStore(), billingScope:true, billingEntityId:entityId, correlationId:storage.getStore()?.correlationId || require('crypto').randomUUID() }, async () => await fn());
const unscoped = fn => storage.run({ ...storage.getStore(), billingScope:false, billingEntityId:null },async () => await fn());
async function requireEntity(db,accountId,value,{active=true}={}) {
   if(value == null || value === '' || value === 'all') throw ruleError('Choose a billing entity.',400);
   const entityId=id(value);
   const row=await db('public.billing_entities').where({account_id:Number(accountId),billing_entity_id:entityId}).first();
   if(!row) throw ruleError('Billing entity not found.',404);
   if(active && !row.active) throw ruleError('This billing entity is inactive. Choose an active business.',409);
   return row;
}
// After authentication. Mutations that create a financial document must carry
// an explicit selection; background imports resolve their tracker source instead.
const creates = /\/(?:createTransaction|createPayment|createRetainer|createWriteOffs?|createRecurringCustomer|createQuote|createInvoice)(?:\/|$)|\/pending-payments\/(?:approve)(?:\/|$)/i;
function selected(req) {
   const body=req.body || {};
   const nested=body.transaction || body.payment || body.retainer || body.writeOff || body.writeoff || body.recurringCustomer || body.customer || body.quote || body.job || body.invoiceConfiguration?.invoiceCreationSettings || {};
   return body.entityId ?? body.billing_entity_id ?? nested.entityId ?? nested.billing_entity_id ?? req.query.entityId;
}
async function middleware(req,res,next) {
   try {
      if(require('../auth/adjustment-policy').isAdjustment(req) && !['admin','super admin'].includes((req.user.access_level || '').toLowerCase()))return require('../auth/jwt-auth').requireAdmin(req,res,next);
      // Preserve existing authorization responses before validating form choices.
      if (!['manager','admin','super admin','owner'].includes((req.user.access_level || '').toLowerCase())) return next();
      const match=req.path.match(/\/(?:createTransaction|createPayment|createRetainer|createWriteOffs?|createRecurringCustomer|createInvoice|approve)\/([^/]+)\//i);
      if(match && /^\d+$/.test(match[1]) && Number(match[1])!==Number(req.user.account_id)) return next();
      const value=selected(req);
      const required=(req.method==='POST' && creates.test(req.originalUrl)) || (['POST','PUT'].includes(req.method) && req.body?.customer?.isCustomerRecurring && !req.body.customer.recurringCustomerID);
      const chosen=value!=null && value!=='' && value!=='all';
      const e=(required || chosen) ? await requireEntity(req.app.get('db'),req.user.account_id,value,{active:required}) : null;
      // The scope does not confer permission; existing route guards still apply.
      const names=Object.fromEntries((await entities(req.app.get('db'),req.user.account_id)).map(r=>[r.billing_entity_id,r.name]));
      run(e?.billing_entity_id ?? null,()=>{req.billingEntity=e;storage.getStore().billingEntityNames=names;next();});
   } catch(e) {const status=e.statusCode || 500;res.status(status).json({status,message:status===500?'Unable to load billing entities. Please retry.':e.message});}
}
async function entities(db,accountId) {return db('public.billing_entities').where({account_id:Number(accountId)}).orderBy([{column:'is_default',order:'desc'},{column:'name'}]);}
module.exports={current,run,unscoped,requireEntity,middleware,entities,selected};
