'use strict';
const { randomUUID } = require('crypto');
const ctx = require('../billingEntities/entity-context');
const audit = require('../../utils/auditContext');
const { id, text, reason } = require('../../utils/ledgerAction');
const { ruleError, lockCustomerLedger } = require('../payments/ledger-helpers');
const { lockAccount, sha } = require('../billingEntities/entities-service');
const v = require('../payments/receipt-values');
const calendar = require('./recurring-calendar');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const base = p => ({ account_id: p.account_id, customer_id: p.customer_id, billing_entity_id: p.billing_entity_id });
async function plan(db, accountId, planId) {
  const p = await db('public.recurring_customers').where({ account_id: accountId, recurring_customer_id: id(planId) }).first();
  if (!p) throw ruleError('Recurring plan not found.', 404);
  return p;
}
async function request(db, args, operation, fn) {
  const { accountId, actorId, body = {}, key } = args;
  if (!UUID.test(key || '')) throw ruleError('A UUID Idempotency-Key is required.', 400);
  const hash = sha(JSON.stringify(canonical({ ...body, planId: args.planId, occurrenceId: args.occurrenceId })));
  return db.transaction(async trx => {
    await lockAccount(trx, accountId, actorId, body.reason || 'Prepare due recurring charges');
    const prior = await trx('financial_requests').where({ account_id: accountId, operation, idempotency_key: key }).first();
    if (prior) { if (prior.input_hash !== hash) throw ruleError('This request key was already used for different information.', 409); return prior.response; }
    const response = await fn(trx);
    await trx('financial_requests').insert({ request_id: randomUUID(), account_id: accountId, customer_id: response.plan?.customer_id || response.occurrence?.customer_id || body.customerId || (response.plans?.length === 1 ? response.plans[0].customer_id : 0),
      operation, idempotency_key: key, input_hash: hash, response });
    return response;
  });
}
async function validatePlan(trx, accountId, body, prior) {
  const customerId = prior?.customer_id || id(body.customerId), entityId = id(body.entityId);
  const customer = await trx('customers').where({ account_id: accountId, customer_id: customerId }).first();
  if (!customer) throw ruleError('Client not found.', 404);
  if (!customer.is_customer_active) throw ruleError('This client is inactive.', 409);
  await ctx.requireEntity(trx, accountId, entityId);
  const fields = { account_id: accountId, customer_id: customerId, billing_entity_id: entityId,
    description: text(body.description, 'Description', 2000, !body.jobId), job_id: body.jobId ? id(body.jobId) : null,
    subscription_frequency: body.frequency, bill_on_date: Number(body.billDay), recurring_bill_amount: v.dollars(v.cents(body.amount)),
    start_date: v.date(body.startDate, { future: true }), end_date: body.endDate ? v.date(body.endDate, { future: true }) : null,
    is_recurring_customer_active: body.active };
  if (body.billDay == null || typeof body.billDay === 'boolean') throw ruleError('Bill-on day must be 1 through 31.', 400);
  fields.subscription_frequency = calendar.validate(fields);
  if (fields.job_id) {
    const j = await trx('public.customer_jobs').where({ account_id: accountId, customer_id: customerId, customer_job_id: fields.job_id }).first();
    if (!j || j.billing_entity_id && Number(j.billing_entity_id) !== entityId) throw ruleError('Job not found for this client and business.', 404);
    if (j.is_job_complete) throw ruleError('Choose an open job.', 409);
    if (!fields.description) { const type = await trx('customer_job_types').where({ account_id: accountId, job_type_id: j.job_type_id }).first(); fields.description = type?.job_description || 'Recurring services'; }
  }
  return fields;
}
async function savePlan(db, args) {
  reason(args.body.reason);
  return request(db, args, args.planId ? 'recurring_plan_update' : 'recurring_plan_create', async trx => {
    const prior = args.planId ? await plan(trx, args.accountId, args.planId) : null;
    if (prior && id(args.body.expectedVersion) !== prior.version) throw ruleError('This plan changed. Reload before saving.', 409);
    const fields = await validatePlan(trx, args.accountId, args.body, prior);
    await lockCustomerLedger(trx, args.accountId, fields.customer_id);
    const history = prior && await trx('recurring_charge_occurrences').where({ plan_id: prior.recurring_customer_id }).first();
    if (history && (Number(prior.billing_entity_id) !== fields.billing_entity_id || v.day(prior.start_date) !== fields.start_date || String(prior.subscription_frequency).toLowerCase() !== fields.subscription_frequency || prior.bill_on_date !== fields.bill_on_date))
      throw ruleError('This plan has generated periods. End it and create a new plan to change its business or calendar.', 409);
    if (prior && args.body.customerId != null && id(args.body.customerId) !== prior.customer_id) throw ruleError('A plan cannot move to another client.', 409);
    const [saved] = prior ? await trx('public.recurring_customers').where({ recurring_customer_id: prior.recurring_customer_id }).update({ ...fields,
      version: prior.version + 1, review_status: 'ready', ...(!history ? { anchor_start_date: fields.start_date, first_automated_period: calendar.firstPeriod(fields, prior.cutover_date ? v.day(prior.cutover_date) : fields.start_date) } : {}) }).returning('*') :
      await trx('public.recurring_customers').insert({ ...fields, created_by_user_id: args.actorId, anchor_start_date: fields.start_date,
        first_automated_period: fields.start_date.slice(0, 8) + '01' }).returning('*');
    await require('./recurringCustomer-service').reconcileCustomerRecurringFlag(trx, args.accountId, saved.customer_id);
    return { plan: saved, message: prior ? 'Plan saved. Existing charges keep their amounts; review them separately.' : 'Recurring plan created.' };
  });
}
function filters(query = {}) {
  if (query.planId != null) id(query.planId);
  return { billingDate: v.date(query.billingDate === undefined ? v.today() : query.billingDate, { future: true }), entityId: query.entityId != null && query.entityId !== 'all' ? id(query.entityId) : null,
    customerId: query.customerId != null ? id(query.customerId) : null };
}
async function readDue(trx, accountId, query = {}) {
  const f = filters(query);
  if (query.customerIds != null) { if (!Array.isArray(query.customerIds)) throw ruleError('Choose a list of client IDs.', 400); query.customerIds.forEach(id); }
  if (f.customerId && !await trx('customers').where({ account_id: accountId, customer_id: f.customerId }).first()) throw ruleError('Client not found.', 404);
  if (query.planId) { const selected = await plan(trx, accountId, query.planId); if (f.entityId && f.entityId !== selected.billing_entity_id || f.customerId && f.customerId !== selected.customer_id) throw ruleError('Recurring plan not found for this selection.', 404); }
  if (f.entityId) await ctx.requireEntity(trx, accountId, f.entityId, { active: false });
  const q = trx('public.recurring_customers as p').join('customers as c', function () { this.on('c.customer_id', 'p.customer_id').andOn('c.account_id', 'p.account_id'); })
    .leftJoin('billing_entities as e', 'e.billing_entity_id', 'p.billing_entity_id').where('p.account_id', accountId).select('p.*', 'c.display_name', 'c.is_customer_active', 'e.name as business', 'e.active as entity_active').orderBy(['p.customer_id', 'p.recurring_customer_id']);
  if (f.entityId) q.where('p.billing_entity_id', f.entityId);
  if (f.customerId) q.where('p.customer_id', f.customerId);
  if (query.planId) q.where('p.recurring_customer_id', id(query.planId));
  if (query.customerIds) q.whereIn('p.customer_id', query.customerIds);
  const plans = await q;
  const rows = plans.length ? await trx('recurring_charge_occurrences as o').leftJoin('public.customer_transactions as t', 't.transaction_id', 'o.transaction_id')
    .where('o.account_id', accountId).whereIn('o.plan_id', plans.map(p => p.recurring_customer_id)).select('o.*', 't.total_transaction as amount', 't.detailed_work_description as description').orderBy(['o.plan_id', 'o.period_start']) : [];
  return { billingDate: f.billingDate, plans: plans.map(p => {
    const occurrences = rows.filter(o => o.plan_id === p.recurring_customer_id);
    const existing = new Set(occurrences.map(o => v.day(o.period_start)));
    const pending = p.is_recurring_customer_active && p.review_status === 'ready' ? calendar.periods(p, f.billingDate).filter(x => !existing.has(x.periodStart)) : [];
    const excluded = p.cutover_date ? calendar.periods(p, f.billingDate, { historical: true }).filter(x => x.periodStart < v.day(p.first_automated_period) && !existing.has(x.periodStart)) : [];
    return { ...p, pending, occurrences, excludedPeriods: excluded, remaining: pending.length,
      catchUpRequired: pending.length > 0 || p.review_status !== 'ready', blockedReason: p.review_status !== 'ready' ? 'Review the legacy plan settings.' : !p.entity_active ? 'Business is inactive.' : !p.is_customer_active ? 'Client is inactive.' : null };
  }) };
}
async function due(db, args) { return ctx.unscoped(() => db.transaction(async trx => { await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); return readDue(trx, args.accountId, args.query); })); }
async function detail(db, args) {
  return ctx.unscoped(() => db.transaction(async trx => {
    await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await plan(trx, args.accountId, args.planId);
    const data = await readDue(trx, args.accountId, { ...args.query, planId: args.planId });
    const events = await trx('recurring_occurrence_events').where({ account_id: args.accountId }).whereIn('occurrence_id', data.plans[0].occurrences.map(o => o.occurrence_id)).orderBy('event_id');
    return { plan: data.plans[0], events };
  }));
}
async function event(trx, occurrence, kind, why, detail) { return trx('recurring_occurrence_events').insert({ ...base(occurrence), occurrence_id: occurrence.occurrence_id, kind, reason: why, detail }); }
async function generate(trx, p, period, { skip = false, reason: why, source }) {
  let transactionId = null;
  if (!skip) {
    if (!p.entity_active || !p.is_customer_active) throw ruleError(p.blockedReason || 'Client or business is inactive.', 409);
    if (p.job_id) { const job = await trx('public.customer_jobs').where({ account_id: p.account_id, customer_id: p.customer_id, customer_job_id: p.job_id }).first(); if (!job || job.is_job_complete || job.billing_entity_id && job.billing_entity_id !== p.billing_entity_id) throw ruleError('The recurring job is missing, closed or belongs to another business. Edit the plan before generating.', 409); }
    const [t] = await trx('public.customer_transactions').insert({ ...base(p), customer_job_id: p.job_id, logged_for_user_id: null, general_work_description_id: null,
      detailed_work_description: `${p.description} (${period.periodStart} to ${period.periodEnd})`, transaction_date: period.dueDate,
      transaction_type: 'Charge', quantity: 1, unit_cost: p.recurring_bill_amount, total_transaction: p.recurring_bill_amount,
      is_transaction_billable: true, is_excess_to_subscription: false, created_by_user_id: p.created_by_user_id, note: 'Recurring plan fee' }).returning('*');
    transactionId = t.transaction_id;
  }
  const [o] = await trx('recurring_charge_occurrences').insert({ ...base(p), plan_id: p.recurring_customer_id, period_start: period.periodStart,
    period_end: period.periodEnd, due_date: period.dueDate, snapshot_amount: p.recurring_bill_amount, snapshot_description: p.description,
    plan_version: p.version, transaction_id: transactionId, state: skip ? 'skipped' : 'generated', source, reason: why }).returning('*');
  await event(trx, o, o.state, why, { amount: p.recurring_bill_amount, period, planVersion: p.version, source });
  if (p.job_id && !skip) await require('../transactions/sharedTransactionFunctions').updateRecentJobTotal(trx, p.job_id, p.account_id, 0);
  return o;
}
async function prepareInside(trx, args) {
  const before = await readDue(trx, args.accountId, args.body);
  const generated = [];
  for (const p of before.plans) {
    if (!p.pending.length || p.blockedReason) continue;
    await lockCustomerLedger(trx, args.accountId, p.customer_id);
    for (const period of p.pending.slice(0, 12)) generated.push(await ctx.run(p.billing_entity_id, () => audit.asSystem(`automation/recurring/${args.source || 'prepare'}`, () => generate(trx, p, period, {
      source: args.source || 'prepare', reason: 'Prepare scheduled recurring fee' }))));
  }
  const result = await readDue(trx, args.accountId, args.body);
  return { ...result, generated: generated.length, generatedPeriods: generated.map(o => ({ planId: o.plan_id, period: v.day(o.period_start), occurrenceId: o.occurrence_id })),
    skipped: result.plans.reduce((n, p) => n + p.occurrences.filter(o => o.state === 'skipped').length, 0),
    remaining: result.plans.reduce((n, p) => n + p.remaining, 0), catchUpRequired: result.plans.some(p => p.catchUpRequired || p.blockedReason && p.is_recurring_customer_active) };
}
async function prepare(db, args) {
  filters(args.body);
  return ctx.unscoped(() => request(db, args, 'recurring_prepare', trx => prepareInside(trx, args)));
}
async function prepareForFinalize(db, args) {
  return ctx.unscoped(() => db.transaction(async trx => {
    await lockAccount(trx, args.accountId, args.actorId, 'Prepare due recurring charges before invoice review');
    return prepareInside(trx, { ...args, source: 'finalize' });
  }));
}
async function assertReady(trx, accountId, query) {
  const result = await readDue(trx, accountId, query);
  if (result.plans.some(p => p.catchUpRequired || p.blockedReason && p.is_recurring_customer_active)) throw ruleError('Recurring plans changed or require catch-up. Refresh Create Invoice before finalizing.', 409);
}
async function catchUp(db, args) {
  const why = reason(args.body.reason), expected = id(args.body.expectedVersion);
  if (!['generate', 'skip'].includes(args.body.action)) throw ruleError('Choose generate or skip.', 400);
  if (args.body.periods && (!Array.isArray(args.body.periods) || !args.body.periods.length || args.body.periods.length > 12 || new Set(args.body.periods).size !== args.body.periods.length)) throw ruleError('Choose 1 through 12 distinct periods.', 400);
  return ctx.unscoped(() => request(db, args, 'recurring_catch_up', async trx => {
    const p = await plan(trx, args.accountId, args.planId);
    if (p.version !== expected) throw ruleError('This plan changed. Reload before catching up.', 409);
    if (!p.is_recurring_customer_active || p.review_status !== 'ready') throw ruleError('Activate and review the plan before catching up.', 409);
    const data = (await readDue(trx, args.accountId, { ...args.body, planId: p.recurring_customer_id })).plans[0];
    let periods = data.pending.slice(0, 12);
    if (args.body.periods) {
      const all = [...data.pending, ...data.excludedPeriods];
      periods = args.body.periods.map(start => { const found = all.find(p => p.periodStart === start); if (!found) throw ruleError('A selected period is already handled or is not due.', 409); return found; });
      if (periods.some(x => data.excludedPeriods.some(e => e.periodStart === x.periodStart)) && args.body.confirmHistorical !== true) throw ruleError('Confirm these earlier periods were not already billed manually.', 400);
    }
    await lockCustomerLedger(trx, args.accountId, p.customer_id);
    const occurrences = [];
    for (const period of periods) occurrences.push(await ctx.run(p.billing_entity_id, () => args.body.action === 'skip'
      ? generate(trx, data, period, { skip: true, reason: why, source: 'catch-up' })
      : audit.asSystem('automation/recurring/catch-up', () => generate(trx, data, period, { reason: why, source: 'catch-up' }))));
    return { ...await readDue(trx, args.accountId, { ...args.body, planId: p.recurring_customer_id }), generated: occurrences.filter(o => o.state === 'generated').length, skipped: occurrences.filter(o => o.state === 'skipped').length, message: 'Selected recurring periods handled.' };
  }));
}
async function changeOccurrence(db, args, skip = false) {
  const why = reason(args.body.reason), expected = id(args.body.expectedVersion);
  if (!skip) { v.cents(args.body.amount); text(args.body.description, 'Description', 2000); }
  return ctx.unscoped(() => request(db, args, skip ? 'recurring_skip' : 'recurring_edit', async trx => {
    const o = await trx('recurring_charge_occurrences').where({ account_id: args.accountId, occurrence_id: id(args.occurrenceId) }).first();
    if (!o) throw ruleError('Recurring charge not found.', 404);
    if (args.body.entityId != null && id(args.body.entityId) !== o.billing_entity_id) throw ruleError('This charge belongs to another business.', 404);
    await lockCustomerLedger(trx, args.accountId, o.customer_id);
    if (o.state !== 'generated') throw ruleError('This recurring period is already skipped or finalized and is locked.', 409);
    if (o.version !== expected) throw ruleError('This charge changed. Refresh before saving.', 409);
    await require('../invoice/sentInvoiceLocks').assertUnlocked(trx, args.accountId, 'customer_transactions', o.transaction_id);
    await trx.raw("SELECT set_config('app.recurring_write','on',true)");
    const changes = skip ? { is_transaction_billable: false } : { unit_cost: v.dollars(v.cents(args.body.amount)), total_transaction: v.dollars(v.cents(args.body.amount)), detailed_work_description: `${args.body.description.trim()} (${v.day(o.period_start)} to ${v.day(o.period_end)})` };
    await trx('public.customer_transactions').where({ transaction_id: o.transaction_id }).update(changes);
    const transaction = await trx('public.customer_transactions').where({ transaction_id: o.transaction_id }).first();
    if (transaction.customer_job_id) await require('../transactions/sharedTransactionFunctions').updateRecentJobTotal(trx, transaction.customer_job_id, args.accountId, 0);
    const [updated] = await trx('recurring_charge_occurrences').where({ occurrence_id: o.occurrence_id }).update({ state: skip ? 'skipped' : 'generated', version: o.version + 1 }).returning('*');
    await event(trx, updated, skip ? 'skipped' : 'edited', why, changes);
    return { occurrence: updated, message: skip ? 'Period skipped. It will not be generated again.' : 'Recurring charge updated.' };
  }));
}
async function markIssued(trx, transactionIds, invoiceId) {
  if (!transactionIds.length) return;
  const rows = await trx('recurring_charge_occurrences').whereIn('transaction_id', transactionIds).where({ state: 'generated' });
  if (!rows.length) return;
  await trx.raw("SELECT set_config('app.recurring_write','on',true)");
  for (const o of rows) { await trx('recurring_charge_occurrences').where({ occurrence_id: o.occurrence_id }).update({ state: 'issued', version: o.version + 1 }); await event(trx, o, 'issued', 'Finalize recurring charge on sent and locked statement', { invoiceId }); }
}
module.exports = { plan, savePlan, due, detail, prepare, prepareInside, prepareForFinalize, assertReady, catchUp, changeOccurrence, markIssued, readDue };
