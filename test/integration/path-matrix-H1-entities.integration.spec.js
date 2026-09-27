'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');const {randomUUID}=require('crypto');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2cAAAAASUVORK5CYII=';
describe('H1 business route refusals and roles preserve the whole database',function(){
 this.timeout(180000);let s,a,b,c,root;
 const request=(method,path,body,role='sa',key)=>{let r=s.request[method]('/billing-entities'+path);if(role)r=r.set('Authorization','Bearer '+s.token(role));if(key)r=r.set('Idempotency-Key',key);return body===undefined?r:r.send(body);};
 before(async()=>{s=await new PathScenario().boot();a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;b=ok(await request('post','',{name:'H1 Secondary',legal_name:'Secondary LLC',invoice_prefix:'SEC',reason:'Synthetic business'})).entity.billing_entity_id;c=await s.customer('H1 Route Matrix');root=await s.retainer(c,100,{entityId:a});});
 after(async()=>{if(s)await s.close();});
 const transfer=()=>({customerId:c.id,sourceEntityId:a,destinationEntityId:b,retainerId:root.retainer_id,expectedSnapshotId:root.retainer_id,amount:10,reason:'Synthetic transfer'});
 const actions=()=>[['post','',{name:'No',legal_name:'No',invoice_prefix:'NO',reason:'x'}],['patch',`/${b}`,{phone:'x',expectedVersion:1,reason:'x'}],['get',`/${b}`],['get','/review'],['post','/review/999/resolve',{}],['post',`/${b}/aliases`,{alias:'x',reason:'x'}],['delete',`/${b}/aliases/999`,{reason:'x'}],['post',`/${b}/logo`,{base64:png,expectedVersion:1,reason:'x'}],['get',`/${b}/logo`],['get','/cutover'],['post','/cutover',{}],['get','/work/999'],['post','/work/999',{}],['post','/transfers',transfer()]];
 for(const role of ['employee','manager'])it(`${role} cannot change settings, mapping, opening allocations or transfer money`,async()=>{
  await s.db('users').where({user_id:3,account_id:1}).update({access_level:role});
  for(const [method,path,body] of actions())await s.refused(()=>request(method,path,body,'staff',randomUUID()),403,403,/unauthorized/i);
  expect((await request('get','/transfers',undefined,'staff')).status).to.equal(200);
 });
 it('all new routes require a session before any write',async()=>{for(const [method,path,body] of [...actions(),['get',''],['get','/balances?customerId=1'],['get','/transfers']])await s.refused(()=>request(method,path,body,null,randomUUID()),401,undefined,/unauthorized|missing|authorization/i);});
 for(const [label,patch,status,pattern] of [['missing reason',{reason:''},400,/reason/i],['negative',{amount:-1},400,/positive/i],['three decimals',{amount:'1.001'},400,/decimal/i],['over-application',{amount:101},409,/available/i],['same business',{destinationEntityId:'SOURCE'},400,/different/i],['wrong source',{sourceEntityId:'DEST',destinationEntityId:'SOURCE'},409,/another business/i],['missing credit',{retainerId:2147483646},404,/not found/i],['missing target',{destinationEntityId:2147483646},404,/not found/i],['stale snapshot',{expectedSnapshotId:2147483646},409,/changed/i]])it(`transfer rejects ${label}`,async()=>{
  const body={...transfer(),...patch};for(const k in body){if(body[k]==='SOURCE')body[k]=a;if(body[k]==='DEST')body[k]=b;}await s.refused(()=>request('post','/transfers',body,'sa',randomUUID()),status,status,pattern);
 });
 it('requires idempotency and does not write on malformed administration',async()=>{
  await s.refused(()=>request('post','/transfers',transfer()),400,400,/idempotency/i);
  for(const body of [{},{name:'x',legal_name:'x',invoice_prefix:'bad',reason:'x'},{name:'x',legal_name:'x',invoice_prefix:'X',email:'no',reason:'x'}])await s.refused(()=>request('post','',body),400,400,/required|prefix|email/i);
  await s.refused(()=>request('patch',`/${b}`,{expectedVersion:999,reason:'Stale form',name:'Changed'}),409,409,/changed/i);
  await s.refused(()=>request('get','/2147483646'),404,404,/not found/i);
  await s.refused(()=>request('post','/review/2147483646/resolve',{entityId:b,reason:'x',expectedSourceHash:'a'.repeat(64)}),404,404,/not found/i);
  await s.refused(()=>request('get','/work/2147483646'),404,404,/not found/i);
 });
 it('rolls back all database and audit writes if the transfer evidence cannot be saved',async()=>{
  await s.queryFault(/insert into "billing_credit_transfers"/i,()=>s.refused(()=>request('post','/transfers',transfer(),'admin',randomUUID()),500,500,/no changes/i));
 });
 it('rolls back settings on database failure and leaves logo metadata unchanged on storage failure',async()=>{
  await s.queryFault(/insert into "public"\."billing_entities"/i,()=>s.refused(()=>request('post','',{name:'Fault',legal_name:'Fault',invoice_prefix:'FAULT',reason:'Fault injection'}),500,500,/no changes/i));
  await s.fail(require('../../src/utils/s3'),'putObject',()=>s.refused(()=>request('post',`/${b}/logo`,{base64:png,expectedVersion:1,reason:'Fault upload'}),500,500,/no changes/i));
 });
 it('accepts aliases and logos for an admin, validates exact mappings, then preserves the bytes',async()=>{
  const alias=ok(await request('post',`/${b}/aliases`,{alias:'Secondary, LLP.',reason:'Verified tracker spelling'},'admin')).alias;
  expect((await s.db.raw('SELECT ds2_entity_match(?,?) AS ids',[1,' SECONDARY LLP '])).rows[0].ids).to.deep.equal([b]);
  await s.refused(()=>request('post',`/${a}/aliases`,{alias:'SECONDARY LLP',reason:'Wrong mapping'}),409,409,/another business/i);
  ok(await request('delete',`/${b}/aliases/${alias.alias_id}`,{reason:'Unused alias removed'},'admin'));
  await s.refused(()=>request('delete',`/${b}/aliases/${alias.alias_id}`,{reason:'Double delete'}),404,404,/not found/i);
  const image=ok(await request('post',`/${b}/logo`,{base64:png,expectedVersion:1,reason:'Synthetic letterhead'},'admin'));
  expect(image.entity.logo_sha256).to.match(/^[a-f0-9]{64}$/);expect(ok(await request('get',`/${b}/logo`)).dataUrl).to.equal('data:image/png;base64,'+png);
  await s.refused(()=>request('post',`/${b}/logo`,{base64:png,expectedVersion:1,reason:'Stale upload'}),409,409,/changed/i);
  await s.refused(()=>request('post',`/${b}/logo`,{base64:Buffer.from('not an image').toString('base64'),expectedVersion:2,reason:'Bad image'}),400,400,/png|jpeg/i);
 });
 for(const role of ['admin','sa'])it(`${role} alone may transfer credit; audit records the session and both businesses`,async()=>{
  root=await s.retainer(c,20,{entityId:a});const res=await request('post','/transfers',transfer(),role,randomUUID());const body=ok(res);expect(body.sourceAvailable).to.equal(10);const events=await s.db('audit_events').where({correlation_id:res.headers['x-correlation-id']});expect(events.length).to.be.above(3);expect(events.every(e=>e.actor_user_id===(role==='admin'?2:1))).to.equal(true);expect(events.find(e=>e.entity==='billing_credit_transfers').reason).to.equal('Synthetic transfer');
 });
 it('keeps foreign businesses, clients and financial records out of every object route',async()=>{
  await s.foreignFixture();const foreign=(await s.db('billing_entities').where({account_id:700,is_default:true}).first()).billing_entity_id;
  for(const [method,path,body] of [['get',`/${foreign}`],['patch',`/${foreign}`,{expectedVersion:1,phone:'x',reason:'Foreign'}],['post',`/${foreign}/aliases`,{alias:'Forbidden',reason:'Foreign'}],['delete',`/${foreign}/aliases/1`,{reason:'Foreign'}],['get',`/${foreign}/logo`],['post',`/${foreign}/logo`,{base64:png,expectedVersion:1,reason:'Foreign'}],['get','/work/70001'],['post','/work/70001',{entityId:b,expectedSourceHash:'f'.repeat(64),reason:'Foreign'}],['get','/balances?customerId=70001']])await s.refused(()=>request(method,path,body),404,404,/not found/i);
  for(const patch of [{sourceEntityId:foreign},{destinationEntityId:foreign},{customerId:70001}])await s.refused(()=>request('post','/transfers',{...transfer(),...patch},'admin',randomUUID()),404,404,/not found/i);
  const own=ok(await request('get','',undefined,'foreign')).entities;expect(own.every(e=>e.account_id===700)).to.equal(true);
 });
 it('rejects inactive choices, duplicate prefixes and an attempt to remove the active default',async()=>{
  const e=ok(await request('post','',{name:'Inactive H1',legal_name:'Inactive LLC',invoice_prefix:'INACTIVE',reason:'Synthetic'})).entity;
  ok(await request('patch',`/${e.billing_entity_id}`,{active:false,expectedVersion:1,reason:'No activity'}));
  await s.refused(()=>request('post','/transfers',{...transfer(),destinationEntityId:e.billing_entity_id},'admin',randomUUID()),409,409,/inactive/);
  await s.refused(()=>s.request.post('/transactions/createTransaction/1/1').set('Authorization','Bearer '+s.token()).send({entityId:e.billing_entity_id,transaction:{}}),409,409,/inactive/);
  await s.refused(()=>request('post','',{name:'Duplicate prefix',legal_name:'Duplicate',invoice_prefix:'SEC',reason:'Conflict'}),409,409,/already in use/);
  const primary=ok(await request('get',`/${a}`)).entity;
  await s.refused(()=>request('patch',`/${a}`,{is_default:false,expectedVersion:primary.version,reason:'Remove default'}),409,409,/default/);
 });
 it('serializes competing default choices and stale settings without losing the active default',async()=>{
  const e=ok(await request('post','',{name:'Candidate Default',legal_name:'Candidate',invoice_prefix:'CANDIDATE',reason:'Default race'})).entity;
  const replies=await Promise.all([1,2].map(()=>request('patch',`/${e.billing_entity_id}`,{is_default:true,expectedVersion:1,reason:'Concurrent default'})));
  expect(replies.map(r=>r.status).sort()).to.deep.equal([200,409]);expect(await s.db('billing_entities').where({account_id:1,is_default:true,active:true})).to.have.length(1);
  const old=ok(await request('get',`/${a}`)).entity;ok(await request('patch',`/${a}`,{is_default:true,expectedVersion:old.version,reason:'Restore fixture default'}));
 });
 it('holds ambiguous tracker names, rejects stale or processed review sources and retains used aliases',async()=>{
  const e=ok(await request('post','',{name:'Ambiguous Display',legal_name:'Secondary LLC',invoice_prefix:'AMBIG',reason:'Shared legal name fixture'})).entity;
  const entries=await require('../../src/endpoints/timesheets/timesheets-service').insertTimesheetEntriesWithTransaction(s.db,[{account_id:1,user_id:3,employee_name:'Uma User',timesheet_name:'H1-matrix.xlsx',time_tracker_start_date:'2026-09-20',time_tracker_end_date:'2026-09-26',date:'2026-09-25',entity:' Secondary, LLC. ',duration:6,notes:'Ambiguous fixture',is_processed:false,is_deleted:false}]);
  expect(entries[0].billing_entity_id).to.equal(null);expect(entries[0].hold_reason).to.equal('entity_ambiguous');
  const review=ok(await request('get','/review')).reviews.find(r=>r.record_id===entries[0].timesheet_entry_id);expect(review.candidate_ids).to.have.members([b,e.billing_entity_id]);
  const body={entityId:b,expectedSourceHash:review.sourceHash,reason:'Explicit business choice'};
  await s.refused(()=>request('post',`/review/${review.review_id}/resolve`,{...body,expectedSourceHash:'f'.repeat(64)}),409,409,/changed/);
  await s.queryFault(/insert into "public"\."billing_entity_resolutions"/,()=>s.refused(()=>request('post',`/review/${review.review_id}/resolve`,body),500,500,/no changes/i));
  await s.db('timesheet_entries').where({timesheet_entry_id:entries[0].timesheet_entry_id}).update({is_deleted:true});
  const processed=ok(await request('get','/review')).reviews.find(r=>r.review_id===review.review_id);
  await s.refused(()=>request('post',`/review/${review.review_id}/resolve`,{...body,expectedSourceHash:processed.sourceHash}),409,409,/processed|issued/);
  const alias=ok(await request('post',`/${b}/aliases`,{alias:'Evidence spelling',reason:'Import spelling'})).alias;
  await s.db('timesheet_entries').insert({account_id:1,user_id:3,date:'2026-09-25',entity:'Evidence spelling',timesheet_name:'H1-alias.xlsx',time_tracker_start_date:'2026-09-20',time_tracker_end_date:'2026-09-26',duration:6,notes:'Used alias evidence',is_processed:false,is_deleted:false});
  await s.refused(()=>request('delete',`/${b}/aliases/${alias.alias_id}`,{reason:'Remove used evidence'}),409,409,/used by tracker/);
 });
 it('returns database failures from every read without saving anything',async()=>{
  for(const path of ['',`/${b}`,'/review','/transfers',`/balances?customerId=${c.id}`,'/cutover','/work/70001'])await s.queryFault(/select .*from (?:"public"\.)?"(?:billing_entities|billing_entity_reviews|billing_credit_transfers|billing_cutover_positions|customer_transactions|customers)"/i,()=>s.refused(()=>request('get',path),500,500,/no changes/i));
 });
 it('rolls back settings, aliases and logo metadata on late database failures',async()=>{
  const entity=ok(await request('get',`/${b}`)).entity;
  await s.queryFault(/update "public"\."billing_entities"/,()=>s.refused(()=>request('patch',`/${b}`,{phone:'602-555-0111',expectedVersion:entity.version,reason:'Injected save failure'}),500,500,/no changes/i));
  await s.queryFault(/insert into "public"\."billing_entity_aliases"/,()=>s.refused(()=>request('post',`/${b}/aliases`,{alias:'DB fault alias',reason:'Injection'}),500,500,/no changes/i));
  const alias=ok(await request('post',`/${b}/aliases`,{alias:'Unused deletion failure',reason:'Injection'})).alias;
  await s.queryFault(/delete from "public"\."billing_entity_aliases"/,()=>s.refused(()=>request('delete',`/${b}/aliases/${alias.alias_id}`,{reason:'Injection'}),500,500,/no changes/i));
  await s.queryFault(/update "billing_entities"/,()=>s.refused(()=>request('post',`/${b}/logo`,{base64:png,expectedVersion:entity.version,reason:'Injected after upload'}),500,500,/no changes/i));
  await s.fail(require('../../src/utils/s3'),'getObject',()=>s.refused(()=>request('get',`/${b}/logo`),500,500,/no changes/i));
 });
 it('refuses foreign logo keys and changed bytes without following the foreign path',async()=>{
  const entity=ok(await request('get',`/${b}`)).entity;
  await s.db('billing_entities').where({billing_entity_id:b}).update({logo_key:'another-account/app/assets/logo.png'});
  await s.refused(()=>request('get',`/${b}/logo`),409,409,/ownership/);
  await s.db('billing_entities').where({billing_entity_id:b}).update({logo_key:entity.logo_key});
  await s.stub(require('../../src/utils/s3'),'getObject',async()=>({body:Buffer.from('changed bytes')}),()=>s.refused(()=>request('get',`/${b}/logo`),409,409,/bytes/));
 });

});
