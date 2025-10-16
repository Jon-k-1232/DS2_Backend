const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const accountRouter = express.Router();
const accountService = require('./account-service');
const { createGrid } = require('../../utils/gridFunctions');
const { requireAdmin } = require('../auth/jwt-auth');
const automationSettingsService = require('./automation-settings-service');
const accountUserService = require('../user/user-service');
const {
   restoreDataTypesAccountOnCreate,
   restoreDataTypesAccountInformationOnCreate,
   restoreDataTypesAccountOnUpdate,
   restoreDataTypesAccountInformationOnUpdate
} = require('./accountObjects');
const { getObject } = require('../../utils/s3');
const path = require('path');

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

const fetchAccountLogo = async rawValue => {
   const derivedLogoKey = resolveLogoKey(rawValue);
   const logoKey = derivedLogoKey || 'James_F__Kimmel___Associates/app/assets/logo.png';

   let base64 = null;
   let metadata = null;
   let source = 's3';

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

// Create post to input new account
accountRouter.route('/createAccount').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const sanitizedNewAccount = sanitizeFields(req.body.account);

   // Create new object with sanitized fields
   const accountTableFields = restoreDataTypesAccountOnCreate(sanitizedNewAccount);

   // Post new account
   const accountData = await accountService.createAccount(db, accountTableFields);

   // need the account number to post to account_information table, then merge account to sanitizedData, then insert
   const { account_id } = accountData;
   const updatedWithAccountID = { ...sanitizedNewAccount, account_id };
   const accountInfoTableFields = restoreDataTypesAccountInformationOnCreate(updatedWithAccountID);
   // Post new account information
   const accountInfoData = await accountService.createAccountInformation(db, accountInfoTableFields);

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

      const accountData = await accountService.updateAccount(db, accountTableFields);
      const accountInfoData = await accountService.updateAccountInformation(db, accountInfoTableFields);

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

      const logo = await fetchAccountLogo(accountInfo.account_company_logo);

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
