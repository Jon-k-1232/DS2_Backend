/**
 * Tracker "Duration" cells are MINUTES. Staff also type hours ("1.5h") or unit
 * suffixed minutes ("90m"); the old parseInt() silently turned "1.5h" into 1
 * minute, "7.5" into 7, and let "-46" through (billed as +$34.50 downstream
 * because the transaction total is Math.abs()'d). This parser accepts only
 * unambiguous inputs and throws on everything else.
 *
 * Accepted (case-insensitive, optional spaces):
 *   90 | "90" | 90.0000001 (float noise from a formula)   -> 90
 *   "90m" | "90 min" | "90 mins" | "90 minutes"           -> 90
 *   "1.5h" | "1.5 hr" | "1.5 hrs" | "1.5 hours"           -> 90  (hours are rounded to the nearest minute)
 *   "1h30m" | "1 hr 30 min" | "1h 30"                     -> 90
 * Rejected: <= 0, > MAX_ENTRY_MINUTES (one entry cannot exceed a day),
 *   fractional minutes ("7.5", "7.5m" — almost always hours typed into a
 *   minutes column), Excel time-of-day fractions (0.0625 == 1:30), "1:30",
 *   and anything else that isn't a number with an explicit unit.
 */
const MAX_ENTRY_MINUTES = 24 * 60;
const FLOAT_NOISE = 1e-6;

const HOUR_UNITS = '(?:h|hr|hrs|hour|hours)';
const MINUTE_UNITS = '(?:m|min|mins|minute|minutes)';
const NUMBER = '([+-]?\\d+(?:\\.\\d+)?|[+-]?\\.\\d+)';

const BARE_NUMBER_RE = new RegExp(`^${NUMBER}$`);
const MINUTES_RE = new RegExp(`^${NUMBER}\\s*${MINUTE_UNITS}$`);
const HOURS_RE = new RegExp(`^${NUMBER}\\s*${HOUR_UNITS}$`);
const HOURS_AND_MINUTES_RE = new RegExp(`^([+-]?\\d+)\\s*${HOUR_UNITS}\\s*(\\d+)\\s*(?:${MINUTE_UNITS})?$`);

const HINT = 'Enter whole minutes (e.g. 90) or use an explicit unit such as "1.5h" or "90m".';

const _wholeMinutes = (value, raw) => {
   const rounded = Math.round(value);
   if (Math.abs(value - rounded) > FLOAT_NOISE) {
      throw new Error(`Duration "${raw}" is not a whole number of minutes. ${HINT}`);
   }
   return rounded;
};

/**
 * @param {number|string} value raw cell value
 * @returns {number} positive whole minutes
 * @throws {Error} with a user-facing message
 */
const parseDurationMinutes = value => {
   if (value === undefined || value === null) {
      throw new Error(`Duration is required. ${HINT}`);
   }
   const raw = typeof value === 'number' ? String(value) : String(value).normalize('NFKC').trim();
   let minutes;

   if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Duration "${raw}" is not a number. ${HINT}`);
      minutes = _wholeMinutes(value, raw);
   } else {
      const text = raw.toLowerCase().replace(/\s+/g, ' ');
      if (!text) throw new Error(`Duration is required. ${HINT}`);
      let match;
      if ((match = text.match(BARE_NUMBER_RE))) {
         minutes = _wholeMinutes(Number(match[1]), raw);
      } else if ((match = text.match(MINUTES_RE))) {
         minutes = _wholeMinutes(Number(match[1]), raw);
      } else if ((match = text.match(HOURS_RE))) {
         minutes = Math.round(Number(match[1]) * 60);
      } else if ((match = text.match(HOURS_AND_MINUTES_RE))) {
         const hours = Number(match[1]);
         const extra = Number(match[2]);
         minutes = hours * 60 + (hours < 0 ? -extra : extra);
      } else {
         throw new Error(`Duration "${raw}" is not a recognized number of minutes. ${HINT}`);
      }
   }

   if (!(minutes > 0)) {
      throw new Error(`Duration must be greater than 0 minutes (got "${raw}").`);
   }
   if (minutes > MAX_ENTRY_MINUTES) {
      throw new Error(`Duration "${raw}" is ${minutes} minutes, more than 24 hours for a single entry. ${HINT}`);
   }
   return minutes;
};

module.exports = { parseDurationMinutes, MAX_ENTRY_MINUTES };
