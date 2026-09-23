/**
 * The firm's billing day is computed in America/Phoenix (UTC−7, no DST), not in
 * the server's time zone. ECS runs in UTC, so an evening Arizona run happens on
 * the NEXT UTC date; the statement date, the same-day guard and the invoice
 * numbering year must all use the Arizona date.
 */
const { billingDateToday, BILLING_TIMEZONE } = require('../../../src/endpoints/invoice/billingDate');

describe('billingDateToday — Arizona calendar day on a UTC server', () => {
   it('defaults to America/Phoenix', () => {
      expect(BILLING_TIMEZONE).to.equal(process.env.BILLING_TIMEZONE || 'America/Phoenix');
   });

   it('22:30 in Phoenix on the 23rd (05:30Z on the 24th) is still the 23rd', () => {
      expect(billingDateToday('2026-09-24T05:30:00Z')).to.equal('2026-09-23');
   });

   it('00:30 in Phoenix on the 24th (07:30Z) is the 24th', () => {
      expect(billingDateToday('2026-09-24T07:30:00Z')).to.equal('2026-09-24');
   });

   it('New Year: 23:00 Phoenix on Dec 31 (06:00Z Jan 1) keeps the OLD numbering year', () => {
      expect(billingDateToday('2027-01-01T06:00:00Z')).to.equal('2026-12-31');
      expect(billingDateToday('2027-01-01T07:00:00Z')).to.equal('2027-01-01');
   });

   it('ignores DST: the offset is −7 in July as well as in January', () => {
      expect(billingDateToday('2026-07-15T06:59:59Z')).to.equal('2026-07-14');
      expect(billingDateToday('2026-07-15T07:00:00Z')).to.equal('2026-07-15');
      expect(billingDateToday('2026-01-15T06:59:59Z')).to.equal('2026-01-14');
   });

   it('accepts a Date and returns today by default', () => {
      expect(billingDateToday(new Date('2026-03-01T12:00:00Z'))).to.equal('2026-03-01');
      expect(billingDateToday()).to.match(/^\d{4}-\d{2}-\d{2}$/);
   });
});
