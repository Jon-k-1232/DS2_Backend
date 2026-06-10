const jwt = require('jsonwebtoken');
const authService = require('./auth-service');
const { AUTH_COOKIE_NAME } = require('./auth-cookie');

// Resolve the session token from the httpOnly cookie (primary) or, for
// non-browser API clients, the Authorization: Bearer header (fallback).
const extractToken = req => {
   const cookieToken = req.cookies && req.cookies[AUTH_COOKIE_NAME];
   if (cookieToken) return cookieToken;

   const authHeader = req.get('Authorization') || '';
   if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7);
   }
   return null;
};

const requireAuth = async (req, res, next) => {
   const token = extractToken(req);

   if (!token) {
      return res.status(401).json({
         message: 'Missing authentication token',
         status: 401
      });
   }

   try {
      const payload = authService.verifyJwt(token);
      const user = await authService.getUserByEmail(req.app.get('db'), payload.sub);

      if (!user) {
         return res.status(401).json({
            message: 'Unauthorized request',
            status: 401
         });
      }

      req.user = {
         user_id: user.user_id,
         email: user.email,
         display_name: user.display_name,
         account_id: user.account_id,
         access_level: user.access_level
      };

      next();
   } catch (error) {
      console.error(`Authentication error: ${error}`);
      if (error instanceof jwt.TokenExpiredError) {
         return res.status(401).json({
            message: 'Expired token',
            status: 401
         });
      } else {
         return res.status(401).json({
            message: 'Unauthorized request',
            status: 401
         });
      }
   }
};

const checkRole = allowedRoles => async (req, res, next) => {
   const token = extractToken(req);
   if (!token) {
      return res.status(401).json({ message: 'Missing authentication token', status: 401 });
   }

   let payload;
   try {
      payload = authService.verifyJwt(token);
   } catch (err) {
      return res.status(401).json({ message: 'Invalid token', status: 401 });
   }

   const user = await authService.getUserRoleByEmail(req.app.get('db'), payload.sub);
   const role = user && user.access_level ? user.access_level.toLowerCase() : '';

   if (user && allowedRoles.includes(role)) {
      next();
   } else {
      return res.status(403).json({
         message: 'Unauthorized',
         status: 403
      });
   }
};

// Role hierarchy: super admin > admin > manager > user. Higher roles satisfy lower checks.
const requireSuperAdmin = checkRole(['super admin']);
const requireAdmin = checkRole(['admin', 'super admin']);
const requireManager = checkRole(['manager']);
const requireManagerOrAdmin = checkRole(['manager', 'admin', 'super admin', 'owner']);

module.exports = { requireAuth, requireSuperAdmin, requireAdmin, requireManager, requireManagerOrAdmin };
