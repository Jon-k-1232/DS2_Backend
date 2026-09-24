/**
 * review/full-audit-2026-09 finding 1 (Astra round 9): accounts.storage_slug
 * is the account's IMMUTABLE S3 namespace (migrations/020.accounts_storage_
 * slug.sql / src/utils/storageSlug.js) — it must never be settable by a
 * client, on create OR update, no matter what the request body contains.
 * Pure unit coverage (no DB) for the two field-whitelist mappers that sit
 * directly in front of accountService.createAccount / updateAccount.
 */
const {
   restoreDataTypesAccountOnCreate,
   restoreDataTypesAccountInformationOnCreate,
   restoreDataTypesAccountOnUpdate,
   restoreDataTypesAccountInformationOnUpdate
} = require('../../../src/endpoints/account/accountObjects');

describe('accountObjects — storage_slug is never client-settable', () => {
   describe('restoreDataTypesAccountOnCreate', () => {
      it('drops a client-supplied storage_slug entirely — it is not a key on the returned object', () => {
         const result = restoreDataTypesAccountOnCreate({
            account_name: 'New Co',
            account_type: 'business',
            is_account_active: true,
            storage_slug: 'James_F__Kimmel___Associates' // attempted collision with account 1
         });
         expect(Object.prototype.hasOwnProperty.call(result, 'storage_slug')).to.equal(false);
      });

      it('still passes through the fields that ARE meant to be settable, unaffected by the storage_slug attempt', () => {
         const result = restoreDataTypesAccountOnCreate({ account_name: 'New Co', account_type: 'business', is_account_active: true, storage_slug: 'anything' });
         expect(result.account_name).to.equal('New Co');
         expect(result.account_type).to.equal('business');
         expect(result.is_account_active).to.equal(true);
      });
   });

   describe('restoreDataTypesAccountOnUpdate', () => {
      it('drops a client-supplied storage_slug entirely, even when every other field is a legitimate partial update', () => {
         const result = restoreDataTypesAccountOnUpdate({
            account_id: 9001,
            account_statement: 'Thank you for your business.',
            storage_slug: 'James_F__Kimmel___Associates' // attempted collision with account 1
         });
         expect(Object.prototype.hasOwnProperty.call(result, 'storage_slug')).to.equal(false);
         expect(result.account_statement).to.equal('Thank you for your business.');
         expect(result.account_id).to.equal(9001);
      });

      it('drops storage_slug even as the ONLY field in the payload — never a passthrough default', () => {
         const result = restoreDataTypesAccountOnUpdate({ account_id: 9001, storage_slug: 'x' });
         expect(Object.prototype.hasOwnProperty.call(result, 'storage_slug')).to.equal(false);
         expect(Object.keys(result)).to.deep.equal(['account_id']);
      });
   });

   // account_information has no storage_slug column at all, but a client
   // could still try to smuggle the key through this mapper — confirms it's
   // whitelisted the same way.
   describe('account_information mappers ignore an unrelated storage_slug key too', () => {
      it('on create', () => {
         const result = restoreDataTypesAccountInformationOnCreate({ account_id: 9001, storage_slug: 'x' });
         expect(Object.prototype.hasOwnProperty.call(result, 'storage_slug')).to.equal(false);
      });

      it('on update', () => {
         const result = restoreDataTypesAccountInformationOnUpdate({ account_id: 9001, account_info_id: 1, storage_slug: 'x' });
         expect(Object.prototype.hasOwnProperty.call(result, 'storage_slug')).to.equal(false);
      });
   });
});
