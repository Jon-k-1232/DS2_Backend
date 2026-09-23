const fuzzball = require('fuzzball');

const normalize = s => (typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ') : '');

// Score every candidate with its OWN call to fuzzball.WRatio (no fuzzball.extract()
// batch call, and no options object shared across candidates).
//
// In the installed fuzzball 2.2.6, extract() scores every candidate through ONE
// shared `options` object. WRatio (and the scorers it delegates to —
// partial_token_sort_ratio / partial_token_set_ratio) receive that same object
// as their own `options` parameter; fuzzball's `clone_and_set_option_defaults`
// short-circuits to returning the SAME object, rather than cloning, once it is
// already tagged `isAClone` (an optimization "for extract functions"), so
// WRatio's internal `options.partial = true` (set only when a candidate's own
// length ratio triggers the partial-ratio path) mutates extract's shared object
// and is never reset. Every candidate scored AFTER that one then silently takes
// the partial-ratio branch too, regardless of its own shape — so a candidate's
// score depended on which candidates preceded it in the catalog (verified: the
// SAME two-candidate pair scores 0.79/0.79 alone but 0.95/0.95 once a third,
// longer candidate is scored ahead of them).
//
// Calling fuzzball.WRatio(query, label) directly — once per candidate, with no
// options argument — sidesteps this: each call's `options_p` is undefined, so
// clone_and_set_option_defaults builds a brand-new object every time (nothing
// is tagged `isAClone` yet), and any internal mutation is scoped to that single
// call. That keeps every candidate's score a pure function of (query, label).
const scoreCandidates = (query, candidates, { limit = 5, scoreCutoff = 62 } = {}) => {
   const cleanQuery = normalize(query).toLowerCase();
   if (!cleanQuery) return [];
   const choices = candidates
      .map(c => (typeof c === 'string' ? { id: null, label: c } : { id: c.id, label: c.label }))
      .filter(c => c.label && c.label.trim());

   const scored = choices
      .map(choice => ({ id: choice.id, label: choice.label, raw: fuzzball.WRatio(cleanQuery, normalize(choice.label).toLowerCase()) }))
      // matches fuzzball.extract()'s own cutoff semantics: strictly greater than.
      .filter(c => c.raw > scoreCutoff)
      // Array.prototype.sort is stable, so two candidates tied on score used to
      // keep whatever order the catalog happened to hand them in — nondeterministic
      // since the catalog load has no guaranteed physical row order. Break ties
      // deterministically by id, then label, so the SAME candidate set always
      // produces the SAME ordering (and therefore the same top-N truncation)
      // regardless of input order.
      .sort((a, b) => b.raw - a.raw || Number(a.id || 0) - Number(b.id || 0) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
   const limited = typeof limit === 'number' && limit > 0 ? scored.slice(0, limit) : scored;
   return limited.map(c => ({ id: c.id, label: c.label, score: c.raw / 100 }));
};

// ---------------------------------------------------------------------------
// Token-level name comparison.
//
// WRatio alone is not a safe auto-match signal for customer names: its
// token-set component scores ANY two names that share a single token at ~95
// ("Wallace Illsley" vs "Donald Illsley", "Smith" vs "Smith, Jane"). The
// helpers below let callers require agreement on real name tokens instead.
//
// Canonical form: NFKC, lowercase, apostrophes dropped ("Jake's" == "Jakes"),
// '&' == 'and', every other punctuation mark becomes a space, and common
// legal-suffix spellings are folded (corporation -> corp, ...). Legal suffixes
// and connector words are then dropped from the NAME tokens because they do not
// identify anybody ("Acme Corp" and "Acme Inc" share no name token besides
// "acme").
// ---------------------------------------------------------------------------
const LEGAL_SUFFIX_CANON = Object.freeze({
   corporation: 'corp',
   incorporated: 'inc',
   company: 'co',
   limited: 'ltd'
});
const LEGAL_SUFFIXES = new Set(['llc', 'inc', 'corp', 'co', 'ltd', 'pllc', 'pc', 'pa', 'lp', 'llp', 'plc']);
const CONNECTOR_WORDS = new Set(['and', 'the', 'of']);

const _canonicalTokens = value =>
   String(value == null ? '' : value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(token => LEGAL_SUFFIX_CANON[token] || token);

/**
 * Identifying name tokens of a customer / search name (legal suffixes and
 * connector words removed), in their original order.
 * @param {string} value
 * @returns {string[]}
 */
const nameTokens = value => _canonicalTokens(value).filter(token => !LEGAL_SUFFIXES.has(token) && !CONNECTOR_WORDS.has(token));

/**
 * Order-, case-, punctuation- and legal-suffix-insensitive key. Two names with
 * the same key are the same name spelled differently ("Smith, John" ==
 * "John Smith", "Red Rock Windows & Doors LLC" == "Red Rock Windows and Doors").
 * Returns '' when the name has no identifying tokens.
 * @param {string} value
 * @returns {string}
 */
const canonicalNameKey = value => nameTokens(value).slice().sort().join(' ');

/**
 * Number of DISTINCT identifying name tokens the two names have in common.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const sharedNameTokenCount = (a, b) => {
   const other = new Set(nameTokens(b));
   return new Set(nameTokens(a).filter(token => other.has(token))).size;
};

/**
 * Legal-form tokens present in a name (canonicalized: 'corporation'/'corp' are
 * the SAME form; see LEGAL_SUFFIX_CANON), in no particular order.
 * @param {string} value
 * @returns {string[]}
 */
const legalForms = value => _canonicalTokens(value).filter(token => LEGAL_SUFFIXES.has(token));

/**
 * True when both names name an explicit (and DIFFERENT) legal form — e.g.
 * 'Acme Inc' vs 'Acme LLC' — so they must never be treated as the same legal
 * entity, even though canonicalNameKey() strips legal suffixes entirely and
 * would otherwise consider them identical. 'Acme Corp' vs 'Acme Corporation'
 * is NOT a conflict (same canonical form). A name with NO legal suffix at all
 * never conflicts (a bare 'Acme' could plausibly be either).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
const conflictingLegalForms = (a, b) => {
   const left = legalForms(a);
   const right = legalForms(b);
   // Full SET agreement is required, not merely a shared token: 'Acme Company
   // LLC' (['co','llc']) vs 'Acme Company Inc' (['co','inc']) used to be
   // treated as compatible because both share 'co' ('Company') — even though
   // 'llc' never appears on the right and 'inc' never appears on the left.
   // Either side naming a form the OTHER side lacks is a conflict.
   return left.length > 0 && right.length > 0 && (left.some(form => !right.includes(form)) || right.some(form => !left.includes(form)));
};

module.exports = { scoreCandidates, normalize, nameTokens, canonicalNameKey, sharedNameTokenCount, LEGAL_SUFFIXES, conflictingLegalForms };
