const _normalize = s => (typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '');

const matchEmployee = (rawName, employeeCatalog = []) => {
   const normalizedTarget = _normalize(rawName);
   if (!normalizedTarget) return null;
   for (const emp of employeeCatalog) {
      if (!emp || !emp.display_name) continue;
      if (_normalize(emp.display_name) === normalizedTarget) {
         return { userId: emp.user_id, displayName: emp.display_name };
      }
   }
   return null;
};

module.exports = { matchEmployee, _normalize };
