const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const accountRouter = express.Router();
const accountService = require('./account-service');
const { createGrid } = require('../../utils/gridFunctions');
const { requireAdmin } = require('../auth/jwt-auth');
const { restoreDataTypesAccountOnCreate, restoreDataTypesAccountInformationOnCreate, restoreDataTypesAccountOnUpdate, restoreDataTypesAccountInformationOnUpdate } = require('./accountObjects');
const fs = require('fs');

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
      const [accountInfo] = await accountService.getAccount(db, accountID);

      const filePath = accountInfo.account_company_logo;

      // Check if the path is a file
      fs.stat(filePath, (err, stats) => {
         if (err) {
            console.log('Error accessing file');
            console.error(err);
            return res.status(500).send('Error accessing file');
         }

         if (!stats.isFile()) {
            console.log('Path is not a file');
            return res.status(400).send('Path is not a file');
         }

         // Check if the file is readable
         fs.access(filePath, fs.constants.R_OK, err => {
            if (err) {
               console.log('File is not readable');
               console.error(err);
               return res.status(500).send('File is not readable');
            }

            // Read the file
            fs.readFile(filePath, (err, buffer) => {
               if (err) {
                  console.log('Error reading file');
                  console.error(err);
                  return res.status(500).send('Error reading file');
               } else {
                  const account_logo_buffer = buffer;

                  const accountData = { ...accountInfo, account_logo_buffer };

                  res.send({
                     account: { accountData },
                     message: 'Successfully retrieved customer.',
                     status: 200
                  });
               }
            });
         });
      });
   });

module.exports = accountRouter;
