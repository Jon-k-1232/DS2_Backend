const express = require('express');
const userRouter = express.Router();
const accountUserService = require('./user-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { createGrid } = require('../../utils/gridFunctions');
const { requireManagerOrAdmin } = require('../auth/jwt-auth');
const { restoreDataTypesUserOnCreate, restoreDataTypesUserOnUpdate } = require('./userObjects');

// Create a new user
userRouter
   .route('/createUser/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .post(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const userWithAccountID = { ...req.body.user, accountID };
         const sanitizedNewUser = sanitizeFields(userWithAccountID);

         const userDataTypes = restoreDataTypesUserOnCreate(sanitizedNewUser);
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

// Edit User
userRouter
   .route('/updateUser/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .put(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const sanitizedUpdatedUser = sanitizeFields(req.body.user);
         const userDataTypes = restoreDataTypesUserOnUpdate(sanitizedUpdatedUser);

         await accountUserService.updateUser(db, userDataTypes);

         await sendUpdatedTableWith200Response(db, res, accountID);
      } catch (err) {
         console.log(err);
         res.send({
            message: err.message || 'An error occurred while updating the user.',
            status: 500
         });
      }
   });

// Delete user
userRouter
   .route('/deleteUser/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .delete(async (req, res) => {
      const db = req.app.get('db');
      const { userID, accountID } = req.params;

      try {
         await accountUserService.deleteUser(db, userID);
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
