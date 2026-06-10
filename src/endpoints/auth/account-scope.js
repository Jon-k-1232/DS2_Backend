// Tenancy guard. Registered on each authenticated router via
//   router.param('accountID', enforceAccountId)
// so it runs before any handler on a route that declares :accountID, and
// after requireAuth has populated req.user. It rejects any request whose
// URL account does not match the authenticated user's account, closing the
// cross-account IDOR where account scoping was driven by the URL value.
const enforceAccountId = (req, res, next, value) => {
   if (!req.user || req.user.account_id == null) {
      return res.status(401).json({ message: 'Unauthorized request', status: 401 });
   }

   const urlAccountId = Number(value);
   if (!Number.isInteger(urlAccountId) || urlAccountId !== Number(req.user.account_id)) {
      return res.status(403).json({ message: 'Account access denied', status: 403 });
   }

   next();
};

// Roles permitted to act on other users' per-user data (e.g. a manager
// downloading a staff member's uploaded tracker).
const PRIVILEGED_ROLES = ['manager', 'admin', 'super admin', 'owner'];

// Per-user data guard. Registered via router.param('userID', enforceSelfOrPrivileged)
// on routers whose :userID identifies the OWNER of the data (not merely the
// acting user). Non-privileged users may only address their own user_id; the
// privilege decision is taken from the authenticated req.user, never the URL.
const enforceSelfOrPrivileged = (req, res, next, value) => {
   if (!req.user || req.user.user_id == null) {
      return res.status(401).json({ message: 'Unauthorized request', status: 401 });
   }

   const role = (req.user.access_level || '').toLowerCase();
   if (PRIVILEGED_ROLES.includes(role)) {
      return next();
   }

   if (Number(value) !== Number(req.user.user_id)) {
      return res.status(403).json({ message: 'Access denied for this user', status: 403 });
   }

   next();
};

module.exports = { enforceAccountId, enforceSelfOrPrivileged, PRIVILEGED_ROLES };
