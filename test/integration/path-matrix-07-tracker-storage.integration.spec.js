'use strict';
const {PathScenario,expect}=require('./_path-matrix');
const {S3Client}=require('@aws-sdk/client-s3');
const {SESClient}=require('@aws-sdk/client-ses');
const {Readable}=require('stream');
const zlib=require('zlib');
const dayjs=require('dayjs');
const XLSX=require('xlsx');
const {buildTrackerFromTemplate}=require('../fixtures/buildTrackerFromTemplate');
const userService=require('../../src/endpoints/user/user-service');
const accountService=require('../../src/endpoints/account/account-service');
const sheets=require('../../src/endpoints/timesheets/timesheets-service');
const staff=require('../../src/endpoints/timeTrackerStaff/timeTrackerStaff-service');
const owners=require('../../src/endpoints/timeTracking/trackerOwners');
const ROOT='James_F__Kimmel___Associates/time_tracking';
const KEY=ROOT+'/processed/Clean_Room_CPA_1/user_1/PM.xlsx.gz';
const missing=()=>Object.assign(Error('path-matrix object unavailable'),{name:'NoSuchKey'});
const getBody=body=>({Body:Readable.from([body]),ContentType:'application/octet-stream',Metadata:{}});

describe('Path matrix: tracker persistence and storage failures',function(){
 this.timeout(180000);let s,originalSes,originalFlag,originalEmailFlag,originalAdminEmail;
 const objects=new Map();let serial=0;
 before(async()=>{s=await new PathScenario().boot();originalSes=SESClient.prototype.send;SESClient.prototype.send=async()=>({MessageId:'local-stub'});originalFlag=process.env.TIME_TRACKER_AI_FEATURE_FLAG;process.env.TIME_TRACKER_AI_FEATURE_FLAG='off';originalEmailFlag=process.env.TIME_TRACKER_SEND_USER_SUCCESS_EMAILS;originalAdminEmail=process.env.TIME_TRACKING_ADMIN_EMAILS;});
 after(async()=>{SESClient.prototype.send=originalSes;for(const [k,v] of [['TIME_TRACKER_AI_FEATURE_FLAG',originalFlag],['TIME_TRACKER_SEND_USER_SUCCESS_EMAILS',originalEmailFlag],['TIME_TRACKING_ADMIN_EMAILS',originalAdminEmail]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}await s?.close();});
 const fakeStorage=async command=>{const i=command.input,n=command.constructor.name;if(n==='PutObjectCommand'){objects.set(i.Key,Buffer.from(i.Body));return {};}if(n==='DeleteObjectCommand'){objects.delete(i.Key);return {};}if(n==='GetObjectCommand'){if(!objects.has(i.Key))throw missing();return getBody(objects.get(i.Key));}if(n==='ListObjectsV2Command')return {Contents:[...objects.keys()].filter(k=>k.startsWith(i.Prefix)).map(Key=>({Key,LastModified:new Date(),Size:objects.get(Key).length})),CommonPrefixes:[]};throw Error('unexpected storage command '+n);};
 const upload=(buffer,query='',name='PM.xlsx',user='1')=>s.request.post(`/time-tracking/upload/1/${user}${query}`).set('Authorization','Bearer '+s.token()).set('Content-Type','application/octet-stream').set('x-file-name',name).send(buffer);
 function workbook(notes='PM '+ ++serial,rows){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Name','Uma User']]),'Time');const start=dayjs().subtract(7,'day').format('YYYY-MM-DD'),end=dayjs().subtract(3,'day').format('YYYY-MM-DD');return buildTrackerFromTemplate({templateBuffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),employeeName:'Uma User',startDate:start,endDate:end,rows:rows||[{date:start,entity:'Clean Room CPA',category:'General Consulting',companyName:'Alice Anderson',duration:60,timeRange:'0900-1000',notes}]});}
 for(const [id,msg] of [['bad',/Invalid account or user/],['0',/positive integers/],['1.5',/positive integers/]])it(`POST upload | owner ${id} refuses before persistence`,()=>s.refused(()=>upload(Buffer.from('x'),'?ownerUserID='+id),400,undefined,msg));
 it('GET users | nonnumeric requester refuses 400',()=>s.refused(()=>s.get('/time-tracking/users/1/not-number'),400,undefined,/Invalid account or user/));
 it('GET history | missing account refuses 404',()=>s.stub(accountService,'getAccount',async()=>[],()=>s.refused(()=>s.get('/time-tracking/history/1/1'),404,undefined,/Unable to locate account/)));
 it('POST upload | account query failure refuses 500 without rows',()=>s.fail(accountService,'getAccount',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while uploading/)));
 for(const [label,reply,http,msg] of [
  ['missing object',async()=>{throw missing();},404,/could not be found/],
  ['unavailable storage',async()=>{throw Error('path-matrix storage down');},500,/path-matrix/],
  ['corrupt gzip',async()=>getBody(Buffer.from('not gzip')),500,/may be corrupted/]
 ])it(`GET history/download | ${label} preserves all rows`,()=>s.stub(S3Client.prototype,'send',reply,()=>s.refused(()=>s.get('/time-tracking/history/download/1/1?key='+encodeURIComponent(KEY)),http,undefined,msg)));
 it('GET history/download | gzip success returns exactly the original bytes',async()=>{const body=Buffer.from('local tracker bytes'),before=await s.allState();const r=await s.stub(S3Client.prototype,'send',async()=>getBody(zlib.gzipSync(body)),()=>s.get('/time-tracking/history/download/1/1?key='+encodeURIComponent(KEY)));expect(r.status).eq(200);expect(r.body).deep.eq(body);expect(await s.allState()).deep.eq(before);});
 it('GET history | object-list failure refuses 500 after folder-discovery fallback',()=>s.fail(S3Client.prototype,'send',()=>s.refused(()=>s.get('/time-tracking/history/1/1'),500,undefined,/path-matrix/)));
 it('GET download/by-name | list and candidate failures end in 404 with no writes',()=>s.fail(S3Client.prototype,'send',()=>s.refused(()=>s.get('/time-tracking/download/by-name/1/1?ownerUserID=1&timesheetName=PM.xlsx'),404,undefined,/could not locate/)));
 it('GET download/by-name | listed candidate and durable legacy candidate failures end in 404',async()=>{
  const legacy=ROOT+'/processed/Clean_Room_CPA_1/Old_Name/PM.xlsx.gz';await owners.recordOwner(s.db,{s3Key:legacy,accountId:1,userId:1,source:'upload'});
  await s.stub(S3Client.prototype,'send',async command=>{if(command.constructor.name==='ListObjectsV2Command')return {Contents:[{Key:KEY}]};throw missing();},()=>s.refused(()=>s.get('/time-tracking/download/by-name/1/1?ownerUserID=1&timesheetName=PM.xlsx'),404,undefined,/could not locate/));
 });
 it('GET download/by-name | corrupt resolved gzip refuses 500',()=>s.stub(S3Client.prototype,'send',async command=>command.constructor.name==='ListObjectsV2Command'?{}:getBody(Buffer.from('bad gzip')),()=>s.refused(()=>s.get('/time-tracking/download/by-name/1/1?ownerUserID=1&timesheetName=PM.xlsx'),500,undefined,/may be corrupted/)));
 for(const [name,contents,msg] of [['empty',[],/No tracker templates/],['without base',[{Key:ROOT+'/tracker_versions/readme.txt'}],/Unable to find a base/]])it(`GET template/latest | ${name} list refuses 404`,()=>s.stub(S3Client.prototype,'send',async()=>({Contents:contents}),()=>s.refused(()=>s.get('/time-tracking/template/latest/1/1'),404,undefined,msg)));
 for(const route of ['template/latest','template/list'])it(`GET ${route} | storage failure refuses 500`,()=>s.fail(S3Client.prototype,'send',()=>s.refused(()=>s.get(`/time-tracking/${route}/1/1`),500,undefined,/path-matrix/)));
 it('POST template/upload | malformed filename encoding refuses 400',()=>s.refused(()=>s.request.post('/time-tracking/template/upload/1/1').set('Authorization','Bearer '+s.token()).set('Content-Type','application/octet-stream').set('x-file-name','%ZZ.xlsx').send(Buffer.from('x')),400,undefined,/Invalid file name encoding/));
 for(const cleanupFails of [false,true])it(`POST upload | insert failure rolls back every row; object cleanup ${cleanupFails?'fails visibly in logs':'removes saved bytes'}`,async()=>{
  objects.clear();let cleanupCalls=0;
  await s.stub(S3Client.prototype,'send',async command=>{if(command.constructor.name==='DeleteObjectCommand'){cleanupCalls++;if(cleanupFails)throw Error('path-matrix cleanup unavailable');}return fakeStorage(command);},()=>s.fail(sheets,'insertTimesheetEntriesWithTransaction',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while saving/)));
  expect(cleanupCalls).eq(1);expect(objects.size).eq(cleanupFails?1:0);objects.clear();
 });
 it('POST upload | storage put failure rolls back without any object or database rows',async()=>{objects.clear();await s.fail(S3Client.prototype,'send',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while saving/));expect(objects.size).eq(0);});
 it('POST upload | owner-record insert failure rolls back holding rows and removes stored file',async()=>{objects.clear();await s.stub(S3Client.prototype,'send',fakeStorage,()=>s.fail(owners,'recordOwner',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while saving/)));expect(objects.size).eq(0);});
 it('POST upload | database and system-error email failures still return rollback refusal',async()=>{process.env.TIME_TRACKING_ADMIN_EMAILS='dummy@scenario.test';await s.stub(S3Client.prototype,'send',fakeStorage,()=>s.fail(SESClient.prototype,'send',()=>s.fail(sheets,'insertTimesheetEntriesWithTransaction',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while saving/))));delete process.env.TIME_TRACKING_ADMIN_EMAILS;});
 it('POST upload | initial query and error-email failures refuse 500 without database writes',async()=>{process.env.TIME_TRACKING_ADMIN_EMAILS='dummy@scenario.test';try{await s.fail(SESClient.prototype,'send',()=>s.fail(accountService,'getAccount',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while uploading/)));}finally{delete process.env.TIME_TRACKING_ADMIN_EMAILS;}});
 it('POST upload | rollback reporting failure preserves the original refusal and removes the uploaded object',async()=>{
  const transaction=s.db.context.transaction;let rolledBack=0;
  await s.stub(s.db.context,'transaction',function(...args){const result=transaction.apply(this,args);if(args.length)return result;return result.then(trx=>{const rollback=trx.rollback;trx.rollback=async function(...values){await rollback.apply(this,values);rolledBack++;throw Error('path-matrix rollback reporting');};return trx;});},()=>s.stub(S3Client.prototype,'send',fakeStorage,()=>s.fail(sheets,'insertTimesheetEntriesWithTransaction',()=>s.refused(()=>upload(workbook(),'?ownerUserID=3'),500,undefined,/unexpected error occurred while saving/))));
  expect(rolledBack).eq(1);
 });
 it('POST upload | owner and submitter notification failures preserve the saved upload',async()=>{process.env.TIME_TRACKER_SEND_USER_SUCCESS_EMAILS='1';const before=Number((await s.db('timesheet_entries').count('* as n').first()).n);const r=await s.stub(S3Client.prototype,'send',fakeStorage,()=>s.fail(SESClient.prototype,'send',()=>upload(workbook(),'?ownerUserID=3')));expect(r.status,JSON.stringify(r.body)).eq(201);expect(r.body.inserted_count).eq(1);expect(r.body.message).match(/uploaded successfully/);expect(Number((await s.db('timesheet_entries').count('* as n').first()).n)).eq(before+1);expect(await s.db('tracker_file_owners').where({s3_key:r.body.storedKey}).first()).to.exist;delete process.env.TIME_TRACKER_SEND_USER_SUCCESS_EMAILS;});
 it('POST upload | staff-recipient query failure does not undo the saved upload',async()=>{const before=Number((await s.db('timesheet_entries').count('* as n').first()).n);const r=await s.stub(S3Client.prototype,'send',fakeStorage,()=>s.fail(staff,'listActiveEmailsByAccount',()=>upload(workbook(),'?ownerUserID=3')));expect(r.status,JSON.stringify(r.body)).eq(201);expect(r.body.inserted_count).eq(1);expect(Number((await s.db('timesheet_entries').count('* as n').first()).n)).eq(before+1);});
 it('POST upload | union of two previous uploads refuses all-rows-already-uploaded without writes',async()=>{
  const start=dayjs().subtract(7,'day').format('YYYY-MM-DD');const rows=[0,1].map(i=>({date:start,entity:'Clean Room CPA',category:'General Consulting',companyName:'Alice Anderson',duration:60,timeRange:i?'1000-1100':'0900-1000',notes:'PM union '+i}));
  await s.stub(S3Client.prototype,'send',fakeStorage,async()=>{for(const row of rows){const r=await upload(workbook('',[row]),'?ownerUserID=3');expect(r.status,JSON.stringify(r.body)).eq(201);}await s.refused(()=>upload(workbook('',rows),'?ownerUserID=3'),409,undefined,/All.*rows.*already.*uploaded/i);});
 });
});
