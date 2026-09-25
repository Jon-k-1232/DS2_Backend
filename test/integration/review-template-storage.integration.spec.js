const { bootHttp, uniqueName } = require('./_http');
const { putObject, getObject, deleteObject } = require('../../src/utils/s3');
describe('F7 conditional template storage with local MinIO', function () {
 let h,key;
 before(async function () {
   h=await bootHttp.call(this);
   const account=await h.db('accounts').where({account_id:9001}).first();
   key=`${account.storage_slug}/test-template-versions/${uniqueName('F7')}.xlsx`;
 });
 after(async () => { if(key) await deleteObject(key); if(h) await h.close(); });
 it('preserves prior bytes when a conditional put collides in the local object store',async()=>{
   const original=Buffer.from('F7 original fixture workbook');
   await putObject(key,original,'application/octet-stream',{}, {ifNoneMatch:'*'});
   let failure;
   try { await putObject(key,Buffer.from('replacement'),'application/octet-stream',{}, {ifNoneMatch:'*'}); }
   catch(error) { failure=error; }
   expect(failure).to.be.an('error');
   expect(failure.$metadata.httpStatusCode).to.equal(412);
   expect((await getObject(key)).body.equals(original)).to.equal(true);
 });
});
