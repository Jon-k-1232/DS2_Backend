/**
 * Non-work time: vacation / PTO / holidays / sick time / lunch / out-of-office
 * / personal time. Prod trackers carried rows like "Sick Day — 480 min",
 * "Holiday — Memorial Day — 480 min" and "Personal Appointment — Barber shop"
 * that were auto-inserted as BILLABLE transactions. A row flagged here must
 * never become a billable transaction.
 *
 * Detection is deliberately narrow so real client work that merely mentions
 * these words stays billable ("calculated sick pay for client payroll",
 * "discussed her vacation schedule", "2025 Personal Tax Return"):
 *   - Category / Entity: the WHOLE cell is a non-work label, optionally with a
 *     qualifier ("Vacation", "Vacation Day", "Sick Day", "PTO", "Holiday",
 *     "Personal Appointment", "Lunch Break", "Out of Office").
 *   - Notes: the note STARTS with a non-work phrase that is not immediately
 *     followed by a work object ("sick pay", "holiday schedule", "lunch
 *     meeting with client" are work).
 */
const _norm = value =>
   String(value == null ? '' : value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

// 'doctor' is in the lead group (not just tacked on as a qualifier) so a bare
// "Doctor" category/entity cell also counts, matching how 'personal' behaves
// with no qualifier; "Doctor Appointment" (the real template's category —
// test/fixtures — and prod trackers) matches via the existing 'appointment'
// qualifier below.
const LABEL_RE = /^(?:paid )?(paid time off|pto|vacation|holiday|sick|lunch|out of (?:the )?office|ooo|personal|doctor)(?: (?:day|days|time|leave|hours?|hrs?|break|appointment|appt|errand|off|request|visit))*$/;

// 'doctor' requires a qualifier here (appointment/appt/visit) — unlike the
// category/entity label check above, a free-text note that merely STARTS with
// "Doctor" is too generic to assume non-work (e.g. "Doctor's office wants an
// updated W-9" is billable client work). _norm() has already turned any
// apostrophe into a space by the time this regex runs, so "Doctor's
// Appointment" arrives as "doctor s appointment" — the optional " s" below
// accounts for that.
const NOTES_LEAD_RE = /^(paid time off|pto|vacation|holiday|sick(?: day| leave| time)?|lunch(?: break)?|out of (?:the )?office|ooo|personal (?:appointment|appt|day|time|leave|errand)|doctor(?: s)? (?:appointment|appt|visit))(?: (.*))?$/;

// Words that, right after the lead phrase, mean the note is ABOUT the topic
// (client payroll, notices, scheduling) rather than the employee being off.
const WORK_OBJECT_WORDS = new Set([
   'pay', 'payroll', 'paycheck', 'paychecks', 'bonus', 'bonuses', 'accrual', 'accruals', 'accrued', 'balance', 'balances',
   'policy', 'policies', 'schedule', 'schedules', 'notice', 'notices', 'calendar', 'calendars', 'report', 'reports',
   'form', 'forms', 'calculation', 'calculations', 'calc', 'letter', 'letters', 'sign', 'signs', 'card', 'cards',
   'party', 'observance', 'request', 'requests', 'tracking', 'reconciliation', 'email', 'emails', 'share', 'project', 'projects', 'plan', 'planning'
]);
const LUNCH_WORK_WORDS = new Set(['with', 'meeting', 'and', 'n', 'presentation', 'seminar']);

const _labelReason = (field, value) => {
   const text = _norm(value);
   if (!text) return null;
   const match = text.match(LABEL_RE);
   return match ? `${field}:${match[1]}` : null;
};

const _notesReason = notes => {
   const text = _norm(notes);
   if (!text) return null;
   const match = text.match(NOTES_LEAD_RE);
   if (!match) return null;
   const lead = match[1];
   const nextWord = (match[2] || '').split(' ')[0];
   if (nextWord && WORK_OBJECT_WORDS.has(nextWord)) return null;
   if (lead.startsWith('lunch') && nextWord && LUNCH_WORK_WORDS.has(nextWord)) return null;
   return `notes:${lead}`;
};

/**
 * @param {{category?:*, entity?:*, notes?:*}} entry
 * @returns {string|null} e.g. 'category:vacation', 'notes:sick day', or null for work
 */
const detectNonWorkReason = (entry = {}) =>
   _labelReason('category', entry.category) || _labelReason('entity', entry.entity) || _notesReason(entry.notes);

const isNonWorkEntry = entry => detectNonWorkReason(entry) !== null;

// Lunch-break rows have always been dropped at upload (they are not time
// worked). Only the Category cell decides this; lunch mentioned elsewhere is
// handled by detectNonWorkReason (kept, non-billable).
const isLunchBreakCategory = category => /^lunch(?: break)?$/.test(_norm(category));

module.exports = { detectNonWorkReason, isNonWorkEntry, isLunchBreakCategory };
