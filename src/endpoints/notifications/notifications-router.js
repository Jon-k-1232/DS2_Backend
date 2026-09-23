const express = require('express');
const { enforceAccountId, enforceSelfOrPrivileged } = require('../auth/account-scope');
const notificationsRouter = express.Router();
notificationsRouter.param('accountID', enforceAccountId);
// :userID here identifies the OWNER of the notifications being read/mutated,
// not merely the acting caller — a plain user must only reach their own
// notifications; managers/admins/super admins may act on any user's.
notificationsRouter.param('userID', enforceSelfOrPrivileged);
const asyncHandler = require('../../utils/asyncHandler');
const jsonParser = express.json();
const notificationsService = require('./notifications-service');

notificationsRouter.route('/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.params.userID);
      const unreadOnly = req.query.unreadOnly === 'true';
      const limit = req.query.limit ? Number(req.query.limit) : 30;
      const notifications = await notificationsService.listForUser(db, accountId, userId, { unreadOnly, limit });
      res.status(200).json({ message: 'ok', notifications });
   })
);

notificationsRouter.route('/:accountID/:userID/unread-count').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.params.userID);
      const count = await notificationsService.unreadCount(db, accountId, userId);
      res.status(200).json({ message: 'ok', count });
   })
);

notificationsRouter.route('/:notificationID/:accountID/:userID/read').put(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.params.userID);
      const notificationId = Number(req.params.notificationID);
      const updated = await notificationsService.markRead(db, accountId, userId, notificationId);
      if (!updated) return res.status(404).json({ message: 'notification not found' });
      res.status(200).json({ message: 'ok', notification: updated });
   })
);

notificationsRouter.route('/:accountID/:userID/read-all').put(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.params.userID);
      await notificationsService.markAllRead(db, accountId, userId);
      res.status(200).json({ message: 'ok' });
   })
);

module.exports = notificationsRouter;
