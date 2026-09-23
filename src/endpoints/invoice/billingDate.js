const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));

// The firm's billing calendar day — independent of the server's TZ (ECS runs in
// UTC; an evening run must not issue tomorrow's statements). One value per
// request, threaded through eligibility, the same-day guard, numbering year,
// due date and the persisted invoice_date. Arizona does not observe DST, so
// America/Phoenix is a fixed UTC−7: a run at 05:30Z on the 24th is still the
// 23rd for the firm.
const BILLING_TIMEZONE = process.env.BILLING_TIMEZONE || 'America/Phoenix';

/**
 * @param {dayjs.Dayjs|Date|string} [now] instant to convert (tests); defaults to the current time.
 * @returns {string} YYYY-MM-DD in the firm's billing time zone.
 */
const billingDateToday = now => {
   const instant = now === undefined ? dayjs() : dayjs(now);
   try {
      return instant.tz(BILLING_TIMEZONE).format('YYYY-MM-DD');
   } catch (e) {
      return instant.format('YYYY-MM-DD');
   }
};

module.exports = { BILLING_TIMEZONE, billingDateToday };
