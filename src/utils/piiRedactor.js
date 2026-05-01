const { detectAndRedact } = require('./comprehend');

const PII_COLUMNS = ['business_name', 'company_name', 'first_name', 'last_name', 'customer_name', 'employee_name'];

const _normalize = s => (typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ') : '');

const _knownNamesFromCatalogs = (customerCatalog = [], employeeCatalog = []) => {
   const names = new Set();
   for (const c of customerCatalog) {
      for (const key of ['display_name', 'business_name', 'customer_name', 'first_name', 'last_name']) {
         const v = c && c[key];
         if (v && typeof v === 'string' && v.trim().length > 1) names.add(v.trim());
      }
   }
   for (const e of employeeCatalog) {
      const v = e && e.display_name;
      if (v && typeof v === 'string' && v.trim().length > 1) names.add(v.trim());
   }
   return [...names];
};

const redactRowForAi = async (row, customerCatalog = [], employeeCatalog = [], { resolvedCustomerId = null, resolvedUserId = null } = {}) => {
   const mapping = {
      customerToken: resolvedCustomerId ? `CUSTOMER_${resolvedCustomerId}` : 'CUSTOMER_UNKNOWN',
      employeeToken: resolvedUserId ? `EMPLOYEE_${resolvedUserId}` : 'EMPLOYEE_UNKNOWN',
      resolvedCustomerId,
      resolvedUserId
   };

   const sanitized = {
      date: row.date || null,
      duration_minutes: typeof row.duration === 'number' ? row.duration : Number(row.duration) || null,
      category_freetext: row.category ? _normalize(row.category) : null,
      entity_token: mapping.customerToken,
      employee_token: mapping.employeeToken,
      notes: ''
   };

   for (const col of PII_COLUMNS) {
      if (col in sanitized) delete sanitized[col];
   }

   const knownNames = _knownNamesFromCatalogs(customerCatalog, employeeCatalog);
   const notesIn = typeof row.notes === 'string' ? row.notes : '';
   const { redacted, usedComprehend, entities } = await detectAndRedact(notesIn, { knownNames });
   sanitized.notes = redacted;

   return { sanitized, mapping, redactionMeta: { usedComprehend, entities: entities.length } };
};

const unredactSuggestion = (suggestion, mapping = {}) => {
   if (!suggestion || typeof suggestion !== 'object') return suggestion;
   const out = { ...suggestion };
   if (out.suggested_customer_token && mapping.resolvedCustomerId) {
      out.suggested_customer_id = mapping.resolvedCustomerId;
      delete out.suggested_customer_token;
   }
   return out;
};

const containsAnyName = (haystack, names) => {
   if (!haystack || !names || !names.length) return false;
   const stack = String(haystack).toLowerCase();
   for (const name of names) {
      if (!name) continue;
      const norm = name.toLowerCase();
      if (norm.length < 2) continue;
      if (stack.includes(norm)) return true;
   }
   return false;
};

const assertNoPii = (serializedAiPayload, customerCatalog = [], employeeCatalog = []) => {
   const names = _knownNamesFromCatalogs(customerCatalog, employeeCatalog);
   const haystack = typeof serializedAiPayload === 'string' ? serializedAiPayload : JSON.stringify(serializedAiPayload);
   if (containsAnyName(haystack, names)) {
      throw new Error('PII leak detected in serialized payload');
   }
   return true;
};

module.exports = {
   redactRowForAi,
   unredactSuggestion,
   assertNoPii,
   containsAnyName,
   PII_COLUMNS,
   _normalize,
   _knownNamesFromCatalogs
};
