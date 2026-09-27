'use strict';
const { PathScenario, expect, ok } = require('./_path-matrix');
const { today, ago } = require('./_scenario');
const { randomUUID } = require('crypto');

describe('H7 request identity, malformed forms and historical money boundaries', function () {
 this.timeout(180000); let s, e, c, job, invoices, state, receipt;
 const req = (method, path, body, key = randomUUID()) => {
  const r = s.request[method](path).set('Authorization', 'Bearer '+s.token()).set('Idempotency-Key', key);
  return body === undefined ? r : r.send(body);
 };
 const open = () => req('get', `/payments/open-obligations?customerId=${c.id}&entityId=${e}`).then(ok);
 const detail = id => req('get', `/payments/receipts/${id}`).then(ok);
 const refusal = (action, status, pattern = /./) => s.refused(action, status, status, pattern);
 const payment = (st, amount = 10) => ({ customerId:c.id, entityId:e, amount, date:today(), method:'cash', reason:'Reviewed allocation', allocations:[], ledgerFingerprint:st.ledgerFingerprint });
 before(async () => {
  s = await new PathScenario().boot(); e = (await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  c = await s.customer('H7 boundary client'); job = await s.job(c); invoices = [];
  for (const amount of [100,100,100]) { await s.work(c,job,amount,{entityId:e}); invoices.push((await s.finalize([c],{entityId:e,allowSameDayRebill:true})).committedInvoices[0]); }
  await s.shift(5); state = await open();
 });
 after(async () => { if(s) await s.close(); });

 for (const value of [null, [], 7, 'invoice']) it(`receipt allocation ${JSON.stringify(value)} is a 400 with no writes`, async () => {
  await refusal(()=>req('post','/payments/receipts',{...payment(state),allocations:[value]}),400);
 });
 for (const field of ['customerId','entityId']) it(`array-shaped ${field} cannot silently select a record`, async () => {
  const b=payment(await open()); await refusal(()=>req('post','/payments/receipts',{...b,[field]:[b[field]]}),400);
 });
 for (const suffix of ['credit-memos','void-rebill/preview','void-rebill']) it(`${suffix} rejects null charge lines before side effects`, async () => {
  state=await open();
  await refusal(()=>req('post',`/invoices/${invoices[0].customer_invoice_id}/${suffix}`,{entityId:e,replacementEntityId:e,amount:10,reason:'Invalid pasted row',date:today(),ledgerFingerprint:state.ledgerFingerprint,previewFingerprint:'review',lines:[null]}),400);
 });
 for (const timestamp of ['2026-02-30T10:00:00Z','2026-04-31T10:00:00.123456Z','2026-09-01T24:00:00Z','0000-01-01T00:00:00Z']) {
  for (const path of ['payments/open-obligations','credits','accountsReceivable/aging/1/1','analytics/billingPerformance/1/1']) it(`${path} rejects impossible UTC cutoff ${timestamp} with no writes`, async () => {
   await refusal(()=>req('get',`/${path}?customerId=${c.id}&entityId=${e}&recordedThrough=${encodeURIComponent(timestamp)}`),400);
  });
 }
 for (const path of ['payments/open-obligations','credits','accountsReceivable/aging/1/1','analytics/billingPerformance/1/1']) it(`${path} rejects year zero in an effective date with no writes`, async () => {
  await refusal(()=>req('get',`/${path}?customerId=${c.id}&entityId=${e}&asOf=0000-01-01`),400);
 });
 it('receipt entry rejects year zero before recording cash', async () => {
  const body={...payment(await open()),date:'0000-01-01'};
  await refusal(()=>req('post','/payments/receipts',body),400);
 });
 it('year one, leap day and PostgreSQL microseconds remain accepted', async () => {
  const before=await s.allState();
  for(const timestamp of ['0001-01-01T00:00:00Z','2024-02-29T23:59:59.123456Z','2026-09-01T00:00:00Z']) ok(await req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${e}&recordedThrough=${timestamp}`));
  expect(await s.allState()).to.deep.equal(before);
 });
 it('an application correction cannot precede the cash receipt it moves', async () => {
  state=await open(); receipt=ok(await req('post','/payments/receipts',{...payment(state),allocations:[{obligationId:state.obligations[0].obligation_id,amount:10}]})).receipt;
  const d=await detail(receipt.receipt_id);
  await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/applications/${d.applications[0].application_id}/correct`,{amount:10,obligationId:state.obligations[1].obligation_id,date:ago(1),reason:'Mistaken backdated allocation',ledgerFingerprint:d.ledgerFingerprint}),400,/precede|predate/);
 });
 it('one retry key cannot replay a correction against a different application', async () => {
  state=await open(); receipt=ok(await req('post','/payments/receipts',{...payment(state),allocations:[{obligationId:state.obligations[0].obligation_id,amount:10}]})).receipt;
  const d=await detail(receipt.receipt_id), key=randomUUID();
  const body={amount:10,obligationId:state.obligations[1].obligation_id,reason:'Move to the second original invoice',ledgerFingerprint:d.ledgerFingerprint};
  const first=ok(await req('post',`/payments/receipts/${receipt.receipt_id}/applications/${d.applications[0].application_id}/correct`,body,key));
  const before=await s.allState(); expect(ok(await req('post',`/payments/receipts/${receipt.receipt_id}/applications/${d.applications[0].application_id}/correct`,body,key))).to.deep.equal(first); expect(await s.allState()).to.deep.equal(before);
  await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/applications/${first.replacement.application_id}/correct`,body,key),409,/request key|different/);
 });
 it('one retry key cannot report cancellation success for a different receipt', async () => {
  const ids=[]; for(let i=0;i<2;i++) ids.push(ok(await req('post','/payments/receipts',payment(await open()))).receipt.receipt_id);
  const body={reason:'Wrong cash amount entered',ledgerFingerprint:(await detail(ids[0])).ledgerFingerprint},key=randomUUID();
  const first=ok(await req('post',`/payments/receipts/${ids[0]}/cancellations`,body,key));
  const before=await s.allState(); expect(ok(await req('post',`/payments/receipts/${ids[0]}/cancellations`,body,key))).to.deep.equal(first); expect(await s.allState()).to.deep.equal(before);
  await refusal(()=>req('post',`/payments/receipts/${ids[1]}/cancellations`,body,key),409,/request key|different/);
  expect((await detail(ids[1])).reversed).to.equal(false);
 });
});
