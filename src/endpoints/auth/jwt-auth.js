const jwt = require('jsonwebtoken');
const authService = require('./auth-service');

const requireAuth = async (req, res, next) => {
   const authToken = req.get('Authorization') || '';
   let bearerToken;

   if (!authToken.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({
         message: 'Missing bearer token',
         status: 401
      });
   } else {
      bearerToken = authToken.slice(7, authToken.length);
   }

   try {
      const payload = authService.verifyJwt(bearerToken);
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
   const authHeader = req.get('Authorization') || '';
   if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ message: 'Missing bearer token', status: 401 });
   }

   let payload;
   try {
      payload = authService.verifyJwt(authHeader.slice(7));
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
