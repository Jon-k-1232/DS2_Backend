'use strict';
const {PathScenario,expect}=require('./_path-matrix');
const supertest=require('supertest');
const cfg=require('../../config');
const automation=require('../../src/automations/automationOrchestrator');
const users=require('../../src/endpoints/user/user-service');

describe('Path matrix: global parser, lock and rate-limit refusals',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});after(()=>s?.close());
 // Construct an in-process application with production error presentation,
 // while retaining the scenario DB/network guard and disabling all schedulers.
 // Never changes or restarts either running local server.
 function isolated(){const env=cfg.NODE_ENV,disabled=process.env.DISABLE_RATE_LIMIT,cron=automation.scheduledAutomations,id=require.resolve('../../src/app'),cached=require.cache[id];let app;try{cfg.NODE_ENV='production';process.env.DISABLE_RATE_LIMIT='false';automation.scheduledAutomations=()=>{};delete require.cache[id];app=require(id);app.set('db',s.db);}finally{cfg.NODE_ENV=env;automation.scheduledAutomations=cron;if(disabled===undefined)delete process.env.DISABLE_RATE_LIMIT;else process.env.DISABLE_RATE_LIMIT=disabled;require.cache[id]=cached;}return supertest(app);}
 it('global error | database sent-lock code is normalized to HTTP 409 and SENT_INVOICE_LOCKED',async()=>{await s.stub(users,'getActiveAccountUsers',async()=>{throw Object.assign(Error('locked: part of sent invoice INV-2026-00001'),{code:'P0409'});},async()=>{const r=await s.refused(()=>s.get('/time-tracking/users/1/1'),409,409,/locked: part of sent invoice/);expect(r.body.code).eq('SENT_INVOICE_LOCKED');});});
 it('global error | production presentation hides internal database text and preserves rows',async()=>{const request=isolated();await s.fail(users,'getActiveAccountUsers',async()=>{const r=await s.refused(()=>request.get('/time-tracking/users/1/1').set('Authorization','Bearer '+s.token()),500,undefined,/^Server error$/);expect(r.body).deep.eq({message:'Server error'});});});
 it('global JSON parser | malformed JSON refuses HTTP 400 before any writes',()=>s.refused(()=>s.request.post('/customer/createCustomer/1/1').set('Content-Type','application/json').set('Authorization','Bearer '+s.token()).send('{invalid'),400,undefined,/JSON|property|Unexpected/));
 it('global JSON parser | oversized JSON refuses HTTP 413 before any writes',()=>s.refused(()=>s.post('/customer/createCustomer/1/1',{padding:'x'.repeat(1024*1024)}),413,undefined,/entity too large/));
 it('global API limiter | request 301 is 429 and every preceding health request succeeds without writes',async()=>{const request=isolated(),before=await s.allState();for(let i=0;i<300;i++){const r=await request.get('/healthz/');expect(r.status).eq(200);}const r=await request.get('/healthz/');expect(r.status).eq(429);expect(r.body).deep.eq({error:'Too many requests, please slow down.',status:429});expect(await s.allState()).deep.eq(before);});
 it('expensive limiter | mutation 31 refuses 429 without launching AI or writing rows',async()=>{const request=isolated(),before=await s.allState();for(let i=0;i<30;i++){const r=await request.post('/billing-review/reprocess/1/1').set('Authorization','Bearer '+s.token()).send({});expect(r.status).eq(503);}const r=await request.post('/billing-review/reprocess/1/1').set('Authorization','Bearer '+s.token()).send({});expect(r.status).eq(429);expect(r.body).deep.eq({error:'Too many requests for this resource, please slow down.',status:429});expect(await s.allState()).deep.eq(before);});
 it('expensive limiter | repeated GET polls do not consume the mutation budget',async()=>{const request=isolated(),before=await s.allState();for(let i=0;i<35;i++){const r=await request.get('/billing-review/reprocess-count/1/1').set('Authorization','Bearer '+s.token());expect(r.status).eq(200);}const r=await request.post('/billing-review/reprocess/1/1').set('Authorization','Bearer '+s.token()).send({});expect(r.status).eq(503);expect(r.body.message).match(/not enabled/);expect(await s.allState()).deep.eq(before);});
});
