'use strict';
const { randomUUID }=require('crypto');const fileType=require('file-type');
const { id,reason }=require('../../utils/ledgerAction');const { ruleError }=require('../payments/ledger-helpers');
const {lockAccount,sha}=require('./entities-service');const {requireEntity}=require('./entity-context');
async function upload(db,{accountId,actorId,entityId,body}) {
   const why=reason(body.reason),expected=id(body.expectedVersion);
   if(typeof body.base64!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) || body.base64.length>1000000)throw ruleError('Choose a PNG or JPEG logo smaller than 750 KB.',400);
   const buffer=Buffer.from(body.base64,'base64');const type=await fileType.fromBuffer(buffer);
   if(!type || !['image/png','image/jpeg'].includes(type.mime) || buffer.length>750000)throw ruleError('Choose a PNG or JPEG logo smaller than 750 KB.',400);
   return db.transaction(async trx=>{await lockAccount(trx,accountId,actorId,why);const entity=await requireEntity(trx,accountId,entityId,{active:false});if(entity.version!==expected)throw ruleError('This business changed. Reload before uploading.',409);
      const account=await trx('accounts').where({account_id:accountId}).first();const key=`${account.storage_slug}/app/assets/entities/${entity.billing_entity_id}/${randomUUID()}.${type.ext}`;
      await require('../../utils/s3').putObject(key,buffer,type.mime,{}, {ifNoneMatch:'*'});
      const [saved]=await trx('billing_entities').where({account_id:accountId,billing_entity_id:entity.billing_entity_id,version:expected}).update({logo_key:key,logo_sha256:sha(buffer),version:expected+1,updated_at:trx.fn.now()}).returning('*');return {entity:saved};
   });
}
async function read(db,accountId,entityId){
 const e=await requireEntity(db,accountId,entityId,{active:false});if(!e.logo_key)throw ruleError('No logo has been uploaded.',404);
 const account=await db('accounts').where({account_id:accountId}).first();
 if(!e.logo_key.startsWith(`${account.storage_slug}/app/assets/entities/${e.billing_entity_id}/`))throw ruleError('Logo ownership is invalid.',409);
 const result=await require('../../utils/s3').getObject(e.logo_key);const buffer=Buffer.isBuffer(result)?result:result.body;
 if(sha(buffer)!==e.logo_sha256)throw ruleError('Logo bytes no longer match the saved image.',409);
 const type=await fileType.fromBuffer(buffer);return {dataUrl:`data:${type.mime};base64,${buffer.toString('base64')}`};
}
module.exports={upload,read};
