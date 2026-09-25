const { bootHttp, uniqueName } = require('./_http');
const { putObject, deleteObject } = require('../../src/utils/s3');
describe('F4 audit PDF download role isolation', function () {
 let h,audit,key;
 const actors={};
 const bytes=Buffer.from('%PDF-1.4\nF4 private audit fixture\n%%EOF');
 before(async function () {
   h=await bootHttp.call(this);
   key=`account_audits/9001/900101/${uniqueName('F4')}.pdf`;
   await putObject(key,bytes,'application/pdf');
   for(const role of ['manager','admin','owner','super admin']) {
     const [user]=await h.db('users').insert({account_id:9001,email:`${uniqueName('F4')}@example.com`,display_name:'F4 fixture',job_title:'Fixture',access_level:role,is_user_active:true}).returning('*');
     actors[role]={...user,token:h.mint('admin',{user_id:user.user_id,email:user.email})};
   }
   [audit]=await h.db('account_audits').insert({account_id:9001,customer_id:900101,
     run_by_user_id:actors['super admin'].user_id,run_by_display_name:'F4 fixture',pdf_s3_key:key,status:'completed'}).returning('*');
 });
 after(async () => {
   if (!h) return;
   if(audit) await h.db('account_audits').where({account_id:9001,audit_id:audit.audit_id}).del();
   for(const actor of Object.values(actors)) await h.db('users').where({account_id:9001,user_id:actor.user_id}).del();
   if(key) await deleteObject(key);
   await h.close();
 });
 for(const role of ['manager','admin','owner']) it(`refuses the same saved audit through both surfaces for ${role}`,async () => {
   const actor=actors[role];
   const dedicated=await h.request.get(`/accountAudit/audit/${audit.audit_id}/pdf/9001/${actor.user_id}`).set('Authorization',`Bearer ${actor.token}`);
   expect(dedicated.status).to.equal(403);
   const generic=await h.request.get(`/invoices/downloadFile/9001/${actor.user_id}`).query({fileLocation:key}).set('Authorization',`Bearer ${actor.token}`);
   expect(generic.status).to.equal(403);
 });
 it('serves the saved bytes only through the Super Admin audit endpoint',async () => {
   const actor=actors['super admin'];
   const res=await h.request.get(`/accountAudit/audit/${audit.audit_id}/pdf/9001/${actor.user_id}`).set('Authorization',`Bearer ${actor.token}`);
   expect(res.status).to.equal(200);
   expect(res.body.equals(bytes)).to.equal(true);
   const generic=await h.request.get(`/invoices/downloadFile/9001/${actor.user_id}`).query({fileLocation:key}).set('Authorization',`Bearer ${actor.token}`);
   expect(generic.status).to.equal(403);
 });
});
