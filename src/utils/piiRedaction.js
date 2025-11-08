const DEFAULT_PLACEHOLDER = 'Jon Doe';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildCandidateList = ({ companyName, firstName, lastName }) => {
   const candidates = new Set();
   const normalized = value => (typeof value === 'string' ? value.trim() : '');

   const safeCompany = normalized(companyName);
   const safeFirst = normalized(firstName);
   const safeLast = normalized(lastName);

   if (safeCompany) {
      candidates.add(safeCompany);
   }

   if (safeFirst) {
      candidates.add(safeFirst);
   }

   if (safeLast) {
      candidates.add(safeLast);
   }

   if (safeFirst && safeLast) {
      candidates.add(`${safeFirst} ${safeLast}`);
      candidates.add(`${safeLast}, ${safeFirst}`);
   }

   return Array.from(candidates).filter(Boolean);
};

/**
 * Replace occurrences of sensitive identifiers with a generic placeholder prior to AI submission.
 *
 * @param {Object} params
 * @param {string} params.notes - Original notes string supplied by the user.
 * @param {string} [params.companyName]
 * @param {string} [params.firstName]
 * @param {string} [params.lastName]
 * @param {string} [params.placeholder='Jon Doe']
 * @returns {{ sanitizedNotes: string, redactedValues: string[] }}
 */
const redactNotes = ({ notes, companyName, firstName, lastName, placeholder = DEFAULT_PLACEHOLDER }) => {
   if (!notes) {
      return { sanitizedNotes: '', redactedValues: [] };
   }

   let sanitizedNotes = notes;
   const redactedValues = new Set();
   const candidates = buildCandidateList({ companyName, firstName, lastName });

   candidates.forEach(candidate => {
      if (!candidate) return;

      const regex = new RegExp(escapeRegex(candidate), 'gi');
      if (regex.test(sanitizedNotes)) {
         sanitizedNotes = sanitizedNotes.replace(regex, placeholder);
         redactedValues.add(candidate);
      }
   });

   return {
      sanitizedNotes,
      redactedValues: Array.from(redactedValues)
   };
};

module.exports = {
   redactNotes,
   DEFAULT_PLACEHOLDER
};
