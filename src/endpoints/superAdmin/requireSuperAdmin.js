const authService = require('../auth/auth-service');
const { isSuperAdmin } = require('./superAdminAllowlist');

// Middleware that requires the requesting user to have access_level
// "Super Admin" (case-insensitive). Returns 401 on bad/missing token,
// 403 on a valid token whose user is not a super admin.
const requireSuperAdmin = async (req, res, next) => {
   try {
      const authHeader = req.get('Authorization') || '';
      if (!authHeader.toLowerCase().startsWith('bearer ')) {
         return res.status(401).send({ message: 'Missing bearer token', status: 401 });
      }
      const token = authHeader.slice(7);
      const payload = authService.verifyJwt(token);

      const [userRow] = await req.app
         .get('db')('user_login')
         .join('users', 'user_login.user_id', '=', 'users.user_id')
         .where({
            'user_login.user_name': payload.sub,
            'user_login.is_login_active': true,
            'users.is_user_active': true
         })
         .select('users.user_id', 'users.display_name', 'users.access_level', 'users.account_id');

      if (!userRow) {
         return res.status(403).send({ message: 'Unauthorized', status: 403 });
      }
      if (!isSuperAdmin(userRow.access_level)) {
         return res.status(403).send({ message: 'Unauthorized', status: 403 });
      }
      req.superAdminUser = userRow;
      next();
   } catch (err) {
      console.error('Super-admin auth error:', err.message);
      return res.status(401).send({ message: 'Unauthorized', status: 401 });
   }
};

module.exports = { requireSuperAdmin };
