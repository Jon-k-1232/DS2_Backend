const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const accountRouter = express.Router();
const accountService = require('./account-service');
const { createGrid } = require('../../utils/gridFunctions');
const { requireAdmin } = require('../auth/jwt-auth');
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

module.exports = accountRouter;
