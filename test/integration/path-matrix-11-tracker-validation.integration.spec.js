'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const fs=require('fs');
const XLSX=require('xlsx');
const dayjs=require('dayjs');
const {S3Client}=require('@aws-sdk/client-s3');
const {Readable}=require('stream');
const {buildTrackerFromTemplate}=require('../fixtures/buildTrackerFromTemplate');
const builder=require('../../src/endpoints/timeTracking/template-builder');
const owner=require('../../src/endpoints/user/user-service');
const ROOT='James_F__Kimmel___Associates/time_tracking/tracker_versions/TimeTracker_PM.xlsx';

describe('Path matrix: tracker parser and tenant-safe template failures',function(){
 this.timeout(180000);let s,base;
 before(async()=>{s=await new PathScenario().boot();await s.foreignFixture();const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Name','Uma User']]),'Time');const d=dayjs().subtract(3,'day').format('YYYY-MM-DD');base=buildTrackerFromTemplate({templateBuffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),employeeName:'Uma User',startDate:d,endDate:d,rows:[{date:d,entity:'Clean Room CPA',category:'General Consulting',companyName:'Alice Anderson',duration:6,notes:'Local parser fixture'}]});});after(()=>s?.close());
 const upload=buffer=>s.request.post('/time-tracking/upload/1/1?ownerUserID=3').set('Authorization','Bearer '+s.token()).set('Content-Type','application/octet-stream').set('x-file-name','PM.xlsx').send(buffer);
 function patched(patches){const wb=XLSX.read(base,{type:'buffer'});for(const [cell,v] of Object.entries(patches)){if(v===null)delete wb.Sheets.Time[cell];else wb.Sheets.Time[cell]={t:'s',v};}return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
 const refused=async(buffer,pattern)=>{const r=await s.refused(()=>upload(buffer),400,undefined,/failed validation/);expect(r.body.errors.join(' ')).match(pattern);};
 for(const [title,patch,pattern] of [
  ['absent header row',{A5:null,B5:null,C5:null,D5:null,E5:null,F5:null,G5:null,H5:null,I5:null},/missing the time entry header row/],
  ['absent entry rows',{A6:null,B6:null,C6:null,D6:null,E6:null,F6:null,G6:null,H6:null,I6:null},/does not contain any time entry rows/],
  ['missing employee',{B1:null},/Employee Name.*required/],
  ['invalid start date',{B2:'not a date'},/Start Date.*invalid/],
  ['invalid end date',{B3:'not a date'},/End Date.*invalid/],
  ['end before start',{B3:'1/1/2000'},/cannot be before/],
  ['missing entity',{B6:null},/Entity.*required|Missing required value.*Entity/],
  ['missing category',{C6:null},/Category.*required|Missing required value.*Category/],
  ['missing date',{A6:null},/Date.*required|Missing required value.*Date/],
  ['invalid date',{A6:'not a date'},/Invalid date|invalid date/],
  ['missing notes',{I6:null},/Notes.*required|Missing required value.*Notes/],
  ['missing header',{I5:null},/missing required column.*Notes/],
  ['duplicate header',{H5:'Notes'},/repeats column.*Notes/]
 ])it(`POST upload | ${title} refuses before any storage or row writes`,()=>refused(patched(patch),pattern));
 it('POST upload | owner with empty email refuses validation and writes nothing',async()=>{await s.db('users').where({user_id:3}).update({email:''});try{await refused(base,/Employee Email is missing/);}finally{await s.db('users').where({user_id:3}).update({email:'staff@clean.test'});}});
 for(const [name,result,pattern] of [['no sheets',{SheetNames:[],Sheets:{}},/does not contain any worksheets/],['empty sheet',{SheetNames:['Time'],Sheets:{Time:{}}},/does not contain any data/]])it(`POST upload | workbook parser produces ${name}: 400 and no writes`,()=>s.stub(XLSX,'read',()=>result,()=>refused(base,pattern)));
 it('POST upload | workbook parser failure refuses corrupt workbook',()=>s.stub(XLSX,'read',()=>{throw Error('path-matrix corrupt workbook');},()=>refused(base,/corrupt or unsupported/)));
 it('POST template upload | missing raw bytes refuses 400 without writes',()=>s.refused(()=>s.request.post('/time-tracking/template/upload/1/1').set('Authorization','Bearer '+s.token()).set('Content-Type','application/octet-stream').set('x-file-name','PM.xlsx').send(Buffer.alloc(0)),400,undefined,/empty or missing/));
 const storage=async command=>command.constructor.name==='ListObjectsV2Command'?{Contents:[{Key:ROOT,LastModified:new Date()}]}:{Body:Readable.from([base]),ContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 it('GET non-owner template | unreadable neutral manifest refuses 503 and never returns owner bytes',async()=>{builder._resetCacheForTest();const read=fs.readFileSync;await s.stub(S3Client.prototype,'send',storage,()=>s.stub(fs,'readFileSync',function(p,...args){if(String(p).endsWith('neutral-template.manifest.json'))throw Error('path-matrix manifest unreadable');return read.call(this,p,...args);},()=>s.refused(()=>s.get('/time-tracking/template/latest/700/70001','foreign'),503,undefined,/could not prepare your time tracker/)));});
 it('GET non-owner template | audit-row insertion failure still returns a tenant-only workbook',async()=>{builder._resetCacheForTest();const before=await s.allState();const r=await s.stub(S3Client.prototype,'send',storage,()=>s.queryFault(/insert into "template_downloads"/i,()=>s.get('/time-tracking/template/latest/700/70001','foreign').buffer(true).parse((res,cb)=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)));})));expect(r.status).eq(200);const wb=XLSX.read(r.body,{type:'buffer'});const values=JSON.stringify(wb.Sheets);expect(values).include('Foreign Actor');expect(values).not.include('Uma User');expect(values).not.include('Alice Anderson');expect(await s.allState()).deep.eq(before);});
});
