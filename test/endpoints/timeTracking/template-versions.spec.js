const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const express = require('express');
const crypto = require('crypto');

// Load the real router and S3 adapter with fake auth/SDK and a frozen clock.
// No database, network, or shared owner-template object is touched.
function load(file, overrides = {}) {
 const filename=path.resolve(__dirname,'../../../',file);
 const nativeRequire=createRequire(filename);
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:mod,exports:mod.exports,
  require:name => Object.prototype.hasOwnProperty.call(overrides,name) ? overrides[name] : nativeRequire(name),
  process:{env:{...process.env,TEMPLATE_OWNER_ACCOUNT_ID:'9001'}},Buffer,console,
  __dirname:path.dirname(filename),__filename:filename,setTimeout,clearTimeout},{filename});
 return mod.exports;
}
function harness(uuid = crypto.randomUUID) {
 const objects=new Map();
 const writes=[];
 class Command { constructor(input) { this.input=input; } }
 class PutObjectCommand extends Command {}
 class ListObjectsV2Command extends Command {}
 class S3Client {
  async send(command) {
   const input=command.input;
   if (command instanceof PutObjectCommand) {
    writes.push(input);
    if (input.IfNoneMatch==='*' && objects.has(input.Key)) throw new Error('PreconditionFailed');
    objects.set(input.Key,Buffer.from(input.Body));
    return {};
   }
   if (command instanceof ListObjectsV2Command) return {Contents:[...objects].map(([Key,body]) => ({Key,Size:body.length,LastModified:new Date('2026-09-24T12:34:56Z')}))};
   throw new Error('Unexpected S3 operation');
  }
 }
 const s3=load('src/utils/s3.js',{'@aws-sdk/client-s3':{S3Client,PutObjectCommand,ListObjectsV2Command},
  '../../config':{S3_BUCKET_NAME:'fixture-only',S3_REGION:'local',S3_ENDPOINT:'http://127.0.0.1:9000',S3_ACCESS_KEY_ID:'fake',S3_SECRET_ACCESS_KEY:'fake'}});
 const allow=(req,res,next)=>next();
 const router=load('src/endpoints/timeTracking/timeTracking-router.js',{
  '../../utils/s3':s3,'../auth/jwt-auth':{requireAuth:allow,requireSuperAdmin:allow},
  dayjs:()=>({format:()=>'September-24-2026_12-34-56PM'}),crypto:{...crypto,randomUUID:uuid}
 });
 const app=express();
 app.use((req,res,next)=>{req.user={account_id:9001,user_id:90013,access_level:'super admin'};next();});
 app.use('/time-tracking',router);
 app.use((err,req,res,next)=>res.status(500).json({message:err.message}));
 const request=supertest(app);
 const upload=body=>request.post('/time-tracking/template/upload/9001/90013').set('Content-Type','application/octet-stream')
  .set('x-file-name','template.xlsx').set('x-file-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(body);
 return {objects,writes,upload,request};
}
describe('F7 immutable template versions',()=>{
 it('retains distinct bytes and history entries for simultaneous uploads with a frozen clock',async()=>{
  const h=harness();
  const first=Buffer.from('first workbook');const second=Buffer.from('second workbook');
  const [a,b]=await Promise.all([h.upload(first),h.upload(second)]);
  expect(a.status).to.equal(201);expect(b.status).to.equal(201);
  expect(a.body.storedKey).not.to.equal(b.body.storedKey);
  expect(h.objects.get(a.body.storedKey).equals(first)).to.equal(true);
  expect(h.objects.get(b.body.storedKey).equals(second)).to.equal(true);
  const history=await h.request.get('/time-tracking/template/list/9001/90013');
  expect(history.status).to.equal(200);
  expect(history.body.templates.map(t=>t.key)).to.have.members([a.body.storedKey,b.body.storedKey]);
 });
 it('refuses an unexpected key collision without replacing earlier bytes',async()=>{
  const h=harness(()=> 'fixed-uuid');
  const first=Buffer.from('first workbook');
  expect((await h.upload(first)).status).to.equal(201);
  const collision=await h.upload(Buffer.from('replacement'));
  expect(collision.status).to.equal(500);
  expect(h.objects.size).to.equal(1);
  expect([...h.objects.values()][0].equals(first)).to.equal(true);
  expect(h.writes.every(w=>w.IfNoneMatch==='*')).to.equal(true);
 });
});
