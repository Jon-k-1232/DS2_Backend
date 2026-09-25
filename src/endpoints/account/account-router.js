const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const accountRouter = express.Router();
accountRouter.param('accountID', enforceAccountId);
const accountService = require('./account-service');
const { createGrid } = require('../../utils/gridFunctions');
const { requireAdmin, requireSuperAdmin } = require('../auth/jwt-auth');
const automationSettingsService = require('./automation-settings-service');
const accountUserService = require('../user/user-service');
const {
   validateAccountCreation,
   restoreDataTypesAccountOnCreate,
   restoreDataTypesAccountInformationOnCreate,
   restoreDataTypesAccountOnUpdate,
   restoreDataTypesAccountInformationOnUpdate
} = require('./accountObjects');
const { getObject } = require('../../utils/s3');
const path = require('path');
const { resolveOwnLogoPrefixes, isAuthorizedDownloadKey } = require('../../utils/downloadAuthorization');

const resolveLogoKey = rawValue => {
   const candidateString = (() => {
      if (typeof rawValue === 'string') {
         return rawValue.trim();
      }
      if (Buffer.isBuffer(rawValue)) {
         return rawValue.toString('utf-8').trim();
      }
      return null;
   })();

   if (!candidateString) {
      return null;
   }

   const looksLikeS3Key =
      !candidateString.startsWith('s3://') &&
      !candidateString.startsWith('http://') &&
      !candidateString.startsWith('https://') &&
      !path.isAbsolute(candidateString) &&
      !candidateString.startsWith('\\\\') &&
      !candidateString.includes(':\\');

   return looksLikeS3Key ? candidateString : null;
};

const fetchAccountLogo = async (rawValue, storageSlug) => {
   const derivedLogoKey = resolveLogoKey(rawValue);
   // This account's own default — was a hardcoded account-1 key
   // ('James_F__Kimmel___Associates/app/assets/logo.png') regardless of
   // which account was asking, so any account with no custom logo set (e.g.
   // fixture account 9001) silently got served ACCOUNT 1's real logo bytes.
   // Deriving it from the caller's own storage_slug matches
   // addInvoiceDetail.js's fallbackS3Key and — for account 1 itself —
   // resolves to the exact same key as before, so account 1's behaviour is
   // unchanged. Astra round 9, finding 1: this used to be re-derived from
   // the mutable account_name via sanitizeAccountName() on every call — see
   // src/utils/storageSlug.js.
   const ownSlug = storageSlug || '';
   const fallbackLogoKey = ownSlug ? `${ownSlug}/app/assets/logo.png` : null;

   // review/full-audit-2026-09 finding 2: account_company_logo is a free-text
   // field that used to flow straight into getObject() with no check that
   // the key actually belonged to this account — PUT /updateAccount now
   // validates new values (see below), but this guards values already on
   // record from before that existed. A foreign/malformed key is never
   // fetched: treated exactly like "no custom logo," falling back to this
   // account's own default instead of leaking another object's bytes back
   // to the client as base64.
   const allowedLogoPrefixes = resolveOwnLogoPrefixes({ storageSlug });
   const isOwnKey = Boolean(derivedLogoKey) && isAuthorizedDownloadKey(derivedLogoKey, allowedLogoPrefixes);
   if (derivedLogoKey && !isOwnKey) {
      console.warn(`Ignoring account_company_logo "${derivedLogoKey}" — not under this account's own logo prefix.`);
   }
   const logoKey = isOwnKey ? derivedLogoKey : fallbackLogoKey;

   let base64 = null;
   let metadata = null;
   let source = 's3';

   if (!logoKey) {
      return { logoKey: null, base64: null, metadata: null, source: 'unavailable', originalValue: derivedLogoKey };
   }

   try {
      const { body, metadata: s3Metadata } = await getObject(logoKey);
      base64 = body.toString('base64');
      metadata = s3Metadata;
   } catch (s3Error) {
      source = 'unavailable';
      if (s3Error?.code === 'ENOTFOUND') {
         console.warn(`Account logo S3 endpoint not reachable (${s3Error.hostname}).`);
      } else if (s3Error?.$metadata?.httpStatusCode === 404 || s3Error?.name === 'NoSuchKey') {
         console.warn(`Account logo object ${logoKey} not found in S3.`);
      } else {
         console.error('Error retrieving account logo from S3:', s3Error);
      }
   }

   return {
      logoKey,
      base64,
      metadata,
      source,
      originalValue: derivedLogoKey
   };
};

// Create post to input new account. There is no "create a new tenant" page in
// the frontend at all (DS2 is effectively single-tenant today) — this was
// previously reachable, unauthenticated-role-wise, by any logged-in user.
// Provisioning an entirely new account/tenant is at least as sensitive as
// updateAccount (requireAdmin below), so gate it at the strictest level.
accountRouter
   .route('/createAccount')
   .all(requireSuperAdmin)
   .post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const sanitizedNewAccount = sanitizeFields(req.body.account);
   validateAccountCreation(sanitizedNewAccount);

   // Create new object with sanitized fields
   const accountTableFields = restoreDataTypesAccountOnCreate(sanitizedNewAccount);

   // Account identity/slug and its address become visible together.
   const returnedFields = await db.transaction(async trx => {
      const accountData = await accountService.createAccount(trx, accountTableFields);
      const accountInfoTableFields = restoreDataTypesAccountInformationOnCreate({ ...sanitizedNewAccount, account_id: accountData.account_id });
      const accountInfoData = await accountService.createAccountInformation(trx, accountInfoTableFields);
      return { ...accountData, ...accountInfoData };
   });

   const account = {
      returnedFields,
      grid: createGrid([returnedFields])
   };

   res.send({
      account,
      message: 'Successfully updated customer.',
      status: 200
   });
});

// Create put endpoint to update accounts and account_information tables
accountRouter
   .route('/updateAccount')
   .all(requireAdmin)
   .put(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      // Sanitize fields
      const sanitizedAccount = sanitizeFields(req.body.account);

      // Create new object with sanitized fields
      const accountTableFields = restoreDataTypesAccountOnUpdate(sanitizedAccount);
      const accountInfoTableFields = restoreDataTypesAccountInformationOnUpdate(sanitizedAccount);
      // No :accountID in the path — scope to the authenticated user's account so
      // an admin can only modify their own account, not an arbitrary one.
      accountTableFields.account_id = req.user.account_id;
      accountInfoTableFields.account_id = req.user.account_id;

      // review/full-audit-2026-09 finding 2: account_company_logo was written
      // completely unvalidated and later flows straight into getObject()
      // (fetchAccountLogo above, and addInvoiceDetail.js's loadCompanyLogo) —
      // an admin could set it to any string and have the app fetch and
      // return (or embed into a generated invoice PDF) whatever object that
      // string pointed at. There is no upload route today that produces this
      // value on the client's behalf (see DS2_Frontend's
      // formObjectForUpdateAccountPost, which deliberately never sends it),
      // so a non-empty value can only arrive here as a directly-posted
      // string — validated exactly like a pasted download key, against THIS
      // account's own logo prefix (resolveOwnLogoPrefixes). An explicit
      // clear (null/empty string) is always allowed.
      if (Object.prototype.hasOwnProperty.call(accountTableFields, 'account_company_logo')) {
         const rawLogo = accountTableFields.account_company_logo;
         const trimmedLogo = typeof rawLogo === 'string' ? rawLogo.trim() : rawLogo;
         if (trimmedLogo !== null && trimmedLogo !== undefined && trimmedLogo !== '') {
            const [currentAccount] = await accountService.getAccount(db, req.user.account_id);
            const allowedLogoPrefixes = resolveOwnLogoPrefixes({ storageSlug: currentAccount?.storage_slug });
            if (!isAuthorizedDownloadKey(trimmedLogo, allowedLogoPrefixes)) {
               return res.status(400).send({ status: 400, message: 'Invalid logo file key.' });
            }
         }
      }

      // The business-settings form and the address form both post through this
      // one combined endpoint, so a request only carries address fields when
      // the caller is the address form — restoreDataTypesAccountInformationOnUpdate
      // now only includes keys that were actually present in the body, so
      // anything beyond account_id here means "this request means to touch
      // account_information". A partial/garbage account_info_id used to reach
      // updateAccountInformation's WHERE clause, silently match zero rows, and
      // no-op — accepted as a 200 even though nothing was saved.
      const hasAddressFields = Object.keys(accountInfoTableFields).some(key => key !== 'account_id');
      if (hasAddressFields && (!Number.isInteger(accountInfoTableFields.account_info_id) || accountInfoTableFields.account_info_id <= 0)) {
         return res.status(400).send({ status: 400, message: 'Valid account address ID required.' });
      }

      // Both tables are written in one transaction — previously each ran
      // against the plain `db` connection independently, so an account update
      // that "succeeded" could be followed by an address update that failed
      // (or matched no row), leaving the two tables inconsistent with no
      // rollback.
      const { accountData, accountInfoData } = await db.transaction(async trx => {
         const accountData = await accountService.updateAccount(trx, accountTableFields);
         const accountInfoData = hasAddressFields ? await accountService.updateAccountInformation(trx, accountInfoTableFields) : undefined;
         if (!accountData || (hasAddressFields && !accountInfoData)) {
            throw new Error('Account or address not found.');
         }
         return { accountData, accountInfoData };
      });

      // Join account and accountInfo returned values
      const returnedFields = { ...accountData, ...accountInfoData };

      const account = {
         returnedFields,
         grid: createGrid([returnedFields])
      };

      res.send({
         account,
         message: 'Successfully updated customer.',
         status: 200
      });
   });

accountRouter
   .route('/AccountInformation/:accountID/:userID')
   .all(requireAdmin)
   .get(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const [accountInfo] = await accountService.getAccount(db, accountID);

         if (!accountInfo) {
            return res.status(404).send({
               message: 'Account not found.',
               status: 404
         });
      }

      const logo = await fetchAccountLogo(accountInfo.account_company_logo, accountInfo.storage_slug);

      const accountData = {
         ...accountInfo,
         account_company_logo: resolveLogoKey(accountInfo.account_company_logo) ?? accountInfo.account_company_logo,
         account_logo_s3_key: logo.logoKey,
         account_logo_base64: logo.base64,
         account_logo_content_type: logo.metadata?.contentType || 'image/png',
         account_logo_source: logo.source
      };

      res.send({
         account: { accountData },
            message: 'Successfully retrieved customer.',
            status: 200
         });
      } catch (error) {
         console.error('Error fetching account information:', error);
         res.status(500).send({
            message: 'Error retrieving account information.',
            status: 500
         });
      }
   });

accountRouter
   .route('/automations/:accountID/:userID')
   .all(requireAdmin)
   .get(async (req, res) => {
      const db = req.app.get('db');
      const sanitizedParams = sanitizeFields(req.params);
      const accountId = Number.parseInt(sanitizedParams.accountID, 10);

      if (!Number.isInteger(accountId)) {
         return res.status(400).json({
            message: 'Invalid account identifier.',
            status: 400
         });
      }

      try {
         const [automations, activeUsers] = await Promise.all([
            automationSettingsService.listAccountAutomations(db, accountId),
            accountUserService.getActiveAccountUsers(db, accountId)
         ]);

         const activeUserMap = new Map((activeUsers || []).map(user => [user.user_id, user]));
         const sanitizedAutomations = [];

         for (const automation of automations) {
            const filteredIds = (automation.recipientUserIds || []).filter(userId => activeUserMap.has(userId));

            if (filteredIds.length !== (automation.recipientUserIds || []).length) {
               await automationSettingsService.replaceAutomationRecipients(db, accountId, automation.key, filteredIds);
            }

            sanitizedAutomations.push({
               ...automation,
               recipientUserIds: filteredIds
            });
         }

         const availableUsers = (activeUsers || []).map(user => ({
            userId: user.user_id,
            displayName: user.display_name,
            email: user.email || ''
         }));

         return res.status(200).json({
            automations: sanitizedAutomations,
            availableUsers,
            status: 200
         });
      } catch (error) {
         console.error('Error fetching automation settings:', error);
         const status = error.status || 500;
         return res.status(status).json({
            message: error.message || 'Unable to retrieve automation settings.',
            status
         });
      }
   })
   .put(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      const sanitizedParams = sanitizeFields(req.params);
      const sanitizedBody = sanitizeFields(req.body || {});
      const accountId = Number.parseInt(sanitizedParams.accountID, 10);
      const { automationKey } = sanitizedBody;

      if (!Number.isInteger(accountId)) {
         return res.status(400).json({
            message: 'Invalid account identifier.',
            status: 400
         });
      }

      if (typeof automationKey !== 'string' || !automationKey.length) {
         return res.status(400).json({
            message: 'Invalid automation key.',
            status: 400
         });
      }

      const updates = {};
      if (Object.prototype.hasOwnProperty.call(sanitizedBody, 'isEnabled')) {
         const rawValue = sanitizedBody.isEnabled;
         if (typeof rawValue === 'boolean') {
            updates.isEnabled = rawValue;
         } else if (typeof rawValue === 'string') {
            const lowered = rawValue.trim().toLowerCase();
            if (lowered === 'true') {
               updates.isEnabled = true;
            } else if (lowered === 'false') {
               updates.isEnabled = false;
            } else {
               return res.status(400).json({
                  message: 'Invalid value for isEnabled.',
                  status: 400
               });
            }
         } else if (typeof rawValue === 'number') {
            updates.isEnabled = rawValue === 1;
         } else {
            return res.status(400).json({
               message: 'Invalid value for isEnabled.',
               status: 400
            });
         }
      }

      if (Object.prototype.hasOwnProperty.call(sanitizedBody, 'recipientUserIds')) {
         if (!Array.isArray(sanitizedBody.recipientUserIds)) {
            return res.status(400).json({
               message: 'Invalid automation recipients payload.',
               status: 400
            });
         }
         updates.recipientUserIds = sanitizedBody.recipientUserIds.map(id => Number.parseInt(id, 10)).filter(id => Number.isInteger(id));
      }

      if (!Object.keys(updates).length) {
        return res.status(400).json({
           message: 'No automation updates provided.',
           status: 400
        });
      }

      try {
         const automation = await automationSettingsService.updateAutomationSetting(db, accountId, automationKey, updates);
         return res.status(200).json({
            automation,
            status: 200
         });
      } catch (error) {
         console.error('Error updating automation setting:', error);
         const status = error.status || 500;
         return res.status(status).json({
            message: error.message || 'Unable to update automation setting.',
            status
         });
      }
   });

module.exports = accountRouter;
