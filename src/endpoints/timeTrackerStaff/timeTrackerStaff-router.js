const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const accountUserService = require('../user/user-service');
const { requireManagerOrAdmin } = require('../auth/jwt-auth');
const timeTrackerStaffService = require('./timeTrackerStaff-service');

const timeTrackerStaffRouter = express.Router({ mergeParams: true });
const jsonParser = express.json();

const buildResponse = (staff, users) => {
   const availableUsers = (users || []).map(user => ({
      user_id: user.user_id,
      display_name: user.display_name || user.email || `User ${user.user_id}`,
      email: user.email
   }));

   const activeStaffUserIds = (staff || [])
      .filter(member => member.is_active)
      .map(member => member.user_id);

   return {
      staff,
      availableUsers,
      activeStaffUserIds
   };
};

timeTrackerStaffRouter.get(
   '/:accountID/:userID',
   requireManagerOrAdmin,
   asyncHandler(async (req, res) => {
      const { accountID } = req.params;
      const accountIdNumber = Number(accountID);

      if (!Number.isFinite(accountIdNumber)) {
         return res.status(400).json({ message: 'Invalid account identifier provided.' });
      }
      const db = req.app.get('db');

      const [staff, users] = await Promise.all([
         timeTrackerStaffService.listByAccount(db, accountIdNumber),
         accountUserService.getActiveAccountUsers(db, accountIdNumber)
      ]);

      console.log(
         `[${new Date().toISOString()}] Time Tracker Staff GET: account ${accountID} -> staff ${staff.length}, users ${users.length}`
      );

      res.status(200).json(buildResponse(staff, users));
   })
);

timeTrackerStaffRouter.post(
   '/:accountID/:userID',
   requireManagerOrAdmin,
   jsonParser,
   asyncHandler(async (req, res) => {
      const { accountID } = req.params;
      const accountIdNumber = Number(accountID);
      if (!Number.isFinite(accountIdNumber)) {
         return res.status(400).json({ message: 'Invalid account identifier provided.' });
      }
      const { userIds } = req.body || {};
      const db = req.app.get('db');

      if (!Array.isArray(userIds) || !userIds.length) {
         return res.status(400).json({ message: 'Select at least one user to add as time tracker staff.' });
      }

      const staff = await timeTrackerStaffService.createMany(db, accountIdNumber, userIds);
      const users = await accountUserService.getActiveAccountUsers(db, accountIdNumber);

      res.status(201).json(buildResponse(staff, users));
   })
);

timeTrackerStaffRouter.put(
   '/:accountID/:userID/:staffID',
   requireManagerOrAdmin,
   jsonParser,
   asyncHandler(async (req, res) => {
      const { accountID, staffID } = req.params;
      const accountIdNumber = Number(accountID);
      if (!Number.isFinite(accountIdNumber)) {
         return res.status(400).json({ message: 'Invalid account identifier provided.' });
      }
      const { isActive } = req.body || {};
      const db = req.app.get('db');

      if (typeof isActive !== 'boolean') {
         return res.status(400).json({ message: 'Include an "isActive" boolean in the request body.' });
      }

      const staff = await timeTrackerStaffService.updateStatus(db, accountIdNumber, staffID, isActive);
      const users = await accountUserService.getActiveAccountUsers(db, accountIdNumber);

      res.status(200).json(buildResponse(staff, users));
   })
);

timeTrackerStaffRouter.delete(
   '/:accountID/:userID/:staffID',
   requireManagerOrAdmin,
   asyncHandler(async (req, res) => {
      const { accountID, staffID } = req.params;
      const accountIdNumber = Number(accountID);
      if (!Number.isFinite(accountIdNumber)) {
         return res.status(400).json({ message: 'Invalid account identifier provided.' });
      }
      const db = req.app.get('db');

      const staff = await timeTrackerStaffService.deleteById(db, accountIdNumber, staffID);
      const users = await accountUserService.getActiveAccountUsers(db, accountIdNumber);

      res.status(200).json(buildResponse(staff, users));
   })
);

module.exports = timeTrackerStaffRouter;
