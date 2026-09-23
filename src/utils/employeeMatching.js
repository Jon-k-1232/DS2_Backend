const _normalize = s => (typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '');

// Legacy, name-only fallback for rows with no validated entry.user_id (see
// auto-ingest-orchestrator.js processEntry, which prefers entry.user_id over
// this whenever it is present). Two employees can share a display name
// ("Alex Jones" hired twice, at different rates) — silently returning
// whichever one happened to sort first used to price the work at the WRONG
// employee's rate. A name that matches more than one catalog entry is refused
// (null) rather than guessed.
const matchEmployee = (rawName, employeeCatalog = []) => {
   const normalizedTarget = _normalize(rawName);
   if (!normalizedTarget) return null;
   const matches = (employeeCatalog || []).filter(emp => emp && emp.display_name && _normalize(emp.display_name) === normalizedTarget);
   if (matches.length !== 1) return null;
   const emp = matches[0];
   return { userId: emp.user_id, displayName: emp.display_name };
};

module.exports = { matchEmployee, _normalize };
