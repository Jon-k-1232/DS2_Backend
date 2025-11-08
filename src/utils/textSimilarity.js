const normalize = value => {
   if (!value || typeof value !== 'string') return '';
   return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
};

const tokenize = value => {
   const normalized = normalize(value);
   if (!normalized) return [];
   return normalized.split(' ');
};

/**
 * Lightweight token overlap score for fuzzy matching.
 * @param {string} a
 * @param {string} b
 * @returns {number} value between 0 and 1
 */
const tokenOverlapScore = (a, b) => {
   const tokensA = new Set(tokenize(a));
   const tokensB = new Set(tokenize(b));

   if (!tokensA.size || !tokensB.size) {
      return 0;
   }

   let intersectionCount = 0;
   tokensA.forEach(token => {
      if (tokensB.has(token)) {
         intersectionCount += 1;
      }
   });

   const unionSize = new Set([...tokensA, ...tokensB]).size;
   return unionSize ? intersectionCount / unionSize : 0;
};

/**
 * Calculate a similarity score between two strings using token overlap with substring boosting.
 * @param {string} a
 * @param {string} b
 * @returns {number} value between 0 and 1
 */
const similarityScore = (a, b) => {
   if (!a || !b) return 0;

   const overlap = tokenOverlapScore(a, b);
   const normalizedA = normalize(a);
   const normalizedB = normalize(b);

   if (!normalizedA || !normalizedB) {
      return overlap;
   }

   if (normalizedA === normalizedB) {
      return 1;
   }

   if (normalizedA.length >= 3 && normalizedB.includes(normalizedA)) {
      return Math.max(overlap, 0.9);
   }

   if (normalizedB.length >= 3 && normalizedA.includes(normalizedB)) {
      return Math.max(overlap, 0.9);
   }

   return overlap;
};

module.exports = {
   similarityScore,
   tokenOverlapScore
};
