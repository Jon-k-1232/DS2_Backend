const express = require('express');
const { enforceAccountId } = require('../auth/account-scope');
const userRouter = express.Router();
userRouter.param('accountID', enforceAccountId);
const accountUserService = require('./user-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { createGrid } = require('../../utils/gridFunctions');
const { requireManagerOrAdmin, requireSuperAdmin } = require('../auth/jwt-auth');
const { restoreDataTypesUserOnCreate, restoreDataTypesUserOnUpdate } = require('./userObjects');

// Create a new user — super admin only (Kasi/Jon)
userRouter
   .route('/createUser/:accountID/:userID')
   .all(requireSuperAdmin)
   .post(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const userWithAccountID = { ...req.body.user, accountID };
         const sanitizedNewUser = sanitizeFields(userWithAccountID);

         const userDataTypes = restoreDataTypesUserOnCreate(sanitizedNewUser);
         // Trust the account from the (guard-verified) URL, never the request body.
         userDataTypes.account_id = Number(accountID);
         const userData = await accountUserService.createUser(db, userDataTypes);
         const { account_id } = userData;

         await sendUpdatedTableWith200Response(db, res, account_id);
      } catch (err) {
         console.log(err);
         res.send({
            message: err.message || 'An error occurred while creating the user.',
            status: 500
         });
      }
   });

// Edit User — super admin only (Kasi/Jon)
userRouter
   .route('/updateUser/:accountID/:userID')
   .all(requireSuperAdmin)
   .put(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const sanitizedUpdatedUser = sanitizeFields(req.body.user);
         const userDataTypes = restoreDataTypesUserOnUpdate(sanitizedUpdatedUser);
         // Trust the account from the (guard-verified) URL, never the request body.
         userDataTypes.account_id = Number(accountID);

         await accountUserService.updateUser(db, userDataTypes, accountID);

         await sendUpdatedTableWith200Response(db, res, accountID);
      } catch (err) {
         console.log(err);
         res.send({
            message: err.message || 'An error occurred while updating the user.',
            status: 500
         });
      }
   });

// Delete user — super admin only (Kasi/Jon)
userRouter
   .route('/deleteUser/:accountID/:userID')
   .all(requireSuperAdmin)
   .delete(async (req, res) => {
      const db = req.app.get('db');
      const { userID, accountID } = req.params;

      try {
         await accountUserService.deleteUser(db, userID, accountID);
         await sendUpdatedTableWith200Response(db, res, accountID);
      } catch {
         res.send({
            message: 'The user cannot be deleted because data tied to this user exists.',
            status: 500
         });
      }
   });

// fetch single user
userRouter
   .route('/fetchSingleUser/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .get(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, userID } = req.params;

      const [activeUser] = await accountUserService.fetchUser(db, accountID, userID);

      const activeUserData = {
         activeUser,
         grid: createGrid(activeUser)
      };

      res.send({
         activeUserData,
         message: 'Successfully fetched',
         status: 200
      });
   });

module.exports = userRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID) => {
   const activeUsers = await accountUserService.getActiveAccountUsers(db, accountID);

   const activeUserData = {
      activeUsers,
      grid: createGrid(activeUsers)
   };

   res.send({
      teamMembersList: { activeUserData },
      message: 'Success',
      status: 200
   });
};
