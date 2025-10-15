const jwt = require('jsonwebtoken');
const authService = require('./auth-service');

// JWT Authentication Middleware
const requireAuth = async (req, res, next) => {
   const authToken = req.get('Authorization') || '';
   let bearerToken;

   if (!authToken.toLowerCase().startsWith('bearer ')) {
      return res.send({
         message: 'Missing bearer token',
         status: 401
      });
   } else {
      bearerToken = authToken.slice(7, authToken.length);
   }

   try {
      // Check JWT token, and check if modified or expired
      const payload = authService.verifyJwt(bearerToken);

      const [user] = await authService.getUserByUserName(req.app.get('db'), payload.sub);

      // Check if user exists and is active
      if (!user || !user.is_login_active) {
         return res.send({
            message: 'Unauthorized request',
            status: 401
         });
      }

      req.user = {
         user_login_id: user.user_login_id,
         user_id: user.user_id,
         user_name: user.user_name,
         account_id: user.account_id
      };

      next();
   } catch (error) {
      console.error(`Authentication error: ${error}`);
      if (error instanceof jwt.TokenExpiredError) {
         return res.send({
            message: 'Expired token',
            status: 401
         });
      } else {
         return res.send({
            message: 'Unauthorized request',
            status: 401
         });
      }
   }
};

const requireAdmin = async (req, res, next) => {
   // Assuming `getUserByUserName` returns roles as part of user object
   const authToken = req.get('Authorization').slice(7);
   const payload = authService.verifyJwt(authToken);
   const [user] = await authService.getUserRoleByUserName(req.app.get('db'), payload.sub);

   const lowerCaseUserAuth = user.access_level.toLowerCase();

   if (user && lowerCaseUserAuth === 'admin') {
      next();
   } else {
      return res.send({
         message: 'Unauthorized',
         status: 403
      });
   }
};

const requireManager = async (req, res, next) => {
   // Assuming `getUserByUserName` returns roles as part of user object
   const authToken = req.get('Authorization').slice(7);
   const payload = authService.verifyJwt(authToken);
   const [user] = await authService.getUserRoleByUserName(req.app.get('db'), payload.sub);

   const lowerCaseUserAuth = user.access_level.toLowerCase();

   if (user && lowerCaseUserAuth === 'manager') {
      next();
   } else {
      return res.send({
         message: 'Unauthorized',
         status: 403
      });
   }
};

const requireManagerOrAdmin = async (req, res, next) => {
   const authToken = req.get('Authorization').slice(7);
   const payload = authService.verifyJwt(authToken);
   const [user] = await authService.getUserRoleByUserName(req.app.get('db'), payload.sub);

   const lowerCaseUserAuth = user.access_level?.toLowerCase();
   const allowedRoles = ['manager', 'admin', 'owner'];

   if (user && allowedRoles.includes(lowerCaseUserAuth)) {
      next();
   } else {
      return res.send({
         message: 'Unauthorized',
         status: 403
      });
   }
};

module.exports = { requireAuth, requireAdmin, requireManager, requireManagerOrAdmin };
