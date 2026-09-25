const { committedResponse } = require('../../utils/committedResponse');
const express = require('express');
const { enforceAccountId, enforceSelfOrPrivileged } = require('../auth/account-scope');
const userRouter = express.Router();
userRouter.param('accountID', enforceAccountId);
// :userID across these routes conventionally carries the ACTING user's own id
// (createUser/updateUser never actually read it — the target comes from the
// request body) except on deleteUser, where it IS the target to delete. Either
// way, self-or-privileged is the right guard: super admin (required below on
// every route here) always satisfies "privileged", so this is a no-op for the
// legitimate caller and only matters as defense in depth — except on
// fetchSingleUser, which used to require manager/admin for EVERY call
// including a user looking up their own record (see fix below).
userRouter.param('userID', enforceSelfOrPrivileged);
const accountUserService = require('./user-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { createGrid } = require('../../utils/gridFunctions');
const { requireSuperAdmin } = require('../auth/jwt-auth');
const { restoreDataTypesUserOnCreate, restoreDataTypesUserOnUpdate, normalizeAccessLevel } = require('./userObjects');

const SUPER_ADMIN = 'super admin';
const isActiveSuperAdmin = user => !!user && user.is_user_active && String(user.access_level || '').toLowerCase() === SUPER_ADMIN;

// Refuses an update/delete that would leave the account with zero active Super
// Admins. `targetUserID` is the user being changed; `wouldLoseSuperAdmin`
// tells us whether the operation actually removes their active-super-admin
// status (a delete always does; an update only does if it deactivates them or
// changes their access_level away from Super Admin).
const assertNotLastSuperAdmin = async (db, accountID, targetUser, targetUserID, wouldLoseSuperAdmin) => {
   if (!isActiveSuperAdmin(targetUser) || !wouldLoseSuperAdmin) return;
   const { count } = await accountUserService.countActiveSuperAdmins(db, accountID, targetUserID);
   if (Number(count) < 1) {
      const error = new Error('Cannot remove the last active Super Admin on this account.');
      error.status = 400;
      throw error;
   }
};

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
         // Reject anything outside the canonical role set instead of persisting
         // a value none of the frontend's role gates would recognize.
         userDataTypes.access_level = normalizeAccessLevel(userDataTypes.access_level);
         const userData = await accountUserService.createUser(db, userDataTypes);
         const { account_id } = userData;

         await sendUpdatedTableWith200Response(db, res, account_id);
      } catch (err) {
         console.log(err);
         const status = err.status || 500;
         res.status(status).send({
            message: err.message || 'An error occurred while creating the user.',
            status
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
         userDataTypes.access_level = normalizeAccessLevel(userDataTypes.access_level);

         const targetUserID = Number(userDataTypes.user_id);
         const validTargetID = ['string', 'number'].includes(typeof userDataTypes.user_id) &&
            Number.isSafeInteger(targetUserID) && targetUserID > 0 && targetUserID <= 2147483647;
         const isSelf = validTargetID && targetUserID === Number(req.user.user_id);
         // is_user_active on the mapped object is `undefined` (not `false`)
         // when the caller omits it, so this only fires on an explicit
         // deactivation, never on an unrelated field edit.
         const willDeactivate = userDataTypes.is_user_active === false;

         if (isSelf && willDeactivate) {
            const error = new Error('You cannot deactivate your own user account.');
            error.status = 400;
            throw error;
         }

         await db.transaction(async trx => {
            await trx('accounts').where({ account_id: Number(accountID) }).forNoKeyUpdate().first();
            const [currentTarget] = validTargetID ? await accountUserService.fetchUser(trx, accountID, targetUserID) : [];
            if (!currentTarget) {
               const error = new Error('User not found.');
               error.status = 404;
               throw error;
            }
            const willLoseSuperAdmin = willDeactivate || userDataTypes.access_level !== 'Super Admin';
            await assertNotLastSuperAdmin(trx, accountID, currentTarget, targetUserID, willLoseSuperAdmin);
            await accountUserService.updateUser(trx, userDataTypes, accountID);
         });

         await sendUpdatedTableWith200Response(db, res, accountID);
      } catch (err) {
         console.log(err);
         const status = err.status || 500;
         res.status(status).send({
            message: err.message || 'An error occurred while updating the user.',
            status
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
         if (Number(userID) === Number(req.user.user_id)) {
            const error = new Error('You cannot delete your own user account.');
            error.status = 400;
            throw error;
         }

         await db.transaction(async trx => {
            await trx('accounts').where({ account_id: Number(accountID) }).forNoKeyUpdate().first();
            // Keep a concurrently inserted FK reference from slipping between
            // this history check and DELETE (matched_user_id uses SET NULL).
            const id = Number(userID);
            const targetUser = Number.isSafeInteger(id) && id > 0 && id <= 2147483647
               ? await trx('users').where({ account_id: Number(accountID), user_id: id }).forUpdate().first()
               : null;
            if (!targetUser) {
               const error = new Error('User not found.');
               error.status = 404;
               throw error;
            }
            await assertNotLastSuperAdmin(trx, accountID, targetUser, userID, true);
            const entry = await trx('timesheet_entries').where({ account_id: Number(accountID) })
               .andWhere(q => q.where('user_id', id).orWhere('matched_user_id', id)).first();
            const work = await trx('customer_transactions').where({ account_id: Number(accountID) })
               .andWhere(q => q.where('logged_for_user_id', id).orWhere('created_by_user_id', id)).first();
            if (entry || work) {
               const error = new Error('This user has time entries or work history. Deactivate the user instead to preserve attribution.');
               error.status = 409;
               throw error;
            }
            await accountUserService.deleteUser(trx, userID, accountID);
         });
         await sendUpdatedTableWith200Response(db, res, accountID);
      } catch (err) {
         console.log(err);
         const status = err.status || 500;
         res.status(status).send({
            message: status === 500 ? 'The user cannot be deleted because data tied to this user exists.' : err.message,
            status
         });
      }
   });

// Fetch single user. Called for EVERY logged-in user (any role) on page
// load/reload to populate their own session info (PrimaryRouter.js apiCall),
// as well as by the (super-admin-gated) Account Users admin screen to look up
// someone else's record. Blanket requireManagerOrAdmin used to 403 a plain
// "User"-role staff member reloading the page; self-or-privileged (registered
// above as the :userID param guard) is the correct check: any authenticated
// user may fetch their own record, only a manager+ may fetch someone else's.
userRouter
   .route('/fetchSingleUser/:accountID/:userID')
   .get(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, userID } = req.params;

      const [activeUser] = await accountUserService.fetchUser(db, accountID, userID);

      if (!activeUser) {
         return res.status(404).send({ message: 'User not found.', status: 404 });
      }

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

const sendUpdatedTableWith200Response = async (db, res, accountID) => committedResponse(res, 'Success', async () => {
   const activeUsers = await accountUserService.getActiveAccountUsers(db, accountID);

   const activeUserData = {
      activeUsers,
      grid: createGrid(activeUsers)
   };

   return {
      teamMembersList: { activeUserData },
      message: 'Success',
      status: 200
   };
});
