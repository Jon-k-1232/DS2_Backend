const fuzzball = require('fuzzball');

const normalize = s => (typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ') : '');

const scoreCandidates = (query, candidates, { limit = 5, scoreCutoff = 62 } = {}) => {
   const cleanQuery = normalize(query).toLowerCase();
   if (!cleanQuery) return [];
   const choices = candidates
      .map(c => (typeof c === 'string' ? { id: null, label: c } : { id: c.id, label: c.label }))
      .filter(c => c.label && c.label.trim());

   const labels = choices.map(c => normalize(c.label).toLowerCase());
   const results = fuzzball.extract(cleanQuery, labels, {
      scorer: fuzzball.WRatio,
      limit,
      cutoff: scoreCutoff
   });
   return results.map(([label, score, idx]) => ({
      id: choices[idx].id,
      label: choices[idx].label,
      score: score / 100
   }));
};

module.exports = { scoreCandidates, normalize };
