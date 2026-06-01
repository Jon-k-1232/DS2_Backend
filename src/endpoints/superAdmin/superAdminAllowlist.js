// Super admin gate — single source of truth for "is this user a super admin?".
// "Super Admin" is a real access_level value in the users table, sitting above
// the regular "Admin" role. Used to gate destructive admin-of-admin actions
// (user CRUD, master tracker template upload).

const isSuperAdmin = accessLevel => {
   if (!accessLevel) return false;
   return accessLevel.trim().toLowerCase() === 'super admin';
};

module.exports = { isSuperAdmin };
