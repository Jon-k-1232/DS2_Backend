/**
 * CSV exports: shared cell encoder (quoting + spreadsheet formula-injection
 * guard with a numeric guard) and YYYY-MM-DD date cells, as used by the
 * Analytics, year-end packet and Accounts Receivable exports.
 */
const { csvCell, csvDate, csvRow } = require('../../../src/endpoints/analytics/csv-util');
const { csvBuilders } = require('../../../src/endpoints/analytics/analytics-router');
const { generateArCsv } = require('../../../src/endpoints/accountsReceivable/accounts-receivable-router');

describe('csvCell', () => {
   it('writes empty cells for null / undefined and non-finite numbers', () => {
      expect(csvCell(null)).to.equal('');
      expect(csvCell(undefined)).to.equal('');
      expect(csvCell(NaN)).to.equal('');
      expect(csvCell(Infinity)).to.equal('');
   });

   it('NUMERIC GUARD: numbers and numeric strings (pg NUMERIC) are never altered', () => {
      expect(csvCell(-225)).to.equal('-225');
      expect(csvCell(12.5)).to.equal('12.5');
      expect(csvCell(0)).to.equal('0');
      ['-225.00', '+12', '-0.5', '.5', '1e5', '-1.25E-3', '1234.'].forEach(s => expect(csvCell(s), s).to.equal(s));
   });

   it('neutralises strings a spreadsheet would evaluate as a formula (= + - @ TAB CR)', () => {
      expect(csvCell('=SUM(A1:A2)')).to.equal("'=SUM(A1:A2)");
      expect(csvCell('+cmd|calc')).to.equal("'+cmd|calc");
      expect(csvCell('-2+3')).to.equal("'-2+3");
      expect(csvCell('@SUM(1)')).to.equal("'@SUM(1)");
      expect(csvCell('\t=1+1')).to.equal("'\t=1+1");
      expect(csvCell('\r=1+1')).to.equal('"\'\r=1+1"');
      expect(csvCell('-')).to.equal("'-");
      expect(csvCell('- see note')).to.equal("'- see note");
   });

   it('quotes the neutralised payload too, doubling embedded quotes', () => {
      expect(csvCell('=HYPERLINK("http://x.test","click")')).to.equal('"\'=HYPERLINK(""http://x.test"",""click"")"');
   });

   it('RFC 4180 quoting for commas, quotes and line breaks; plain text untouched', () => {
      expect(csvCell('Acme LLC')).to.equal('Acme LLC');
      expect(csvCell('Smith, John')).to.equal('"Smith, John"');
      expect(csvCell('He said "hi"')).to.equal('"He said ""hi"""');
      expect(csvCell('line\nbreak')).to.equal('"line\nbreak"');
      expect(csvCell('a = b')).to.equal('a = b'); // only a LEADING trigger matters
   });

   it('booleans and Dates', () => {
      expect(csvCell(true)).to.equal('true');
      expect(csvCell(new Date('2026-05-01T17:00:00Z'))).to.equal('2026-05-01T17:00:00.000Z');
      expect(csvCell(new Date('nope'))).to.equal('');
   });

   it('csvRow joins encoded cells', () => {
      expect(csvRow(['=x', -5, '-5.00', 'a,b', null])).to.equal("'=x,-5,-5.00,\"a,b\",");
   });
});

describe('csvDate', () => {
   it('formats date-only cells as YYYY-MM-DD (never Date#toString slices)', () => {
      const localMidnight = new Date(2025, 2, 1); // what node-postgres returns for a DATE column
      expect(String(localMidnight).slice(0, 10)).to.not.equal('2025-03-01'); // the old bug: 'Sat Mar 01'
      expect(csvDate(localMidnight)).to.equal('2025-03-01');
      expect(csvDate('2025-03-01')).to.equal('2025-03-01');
      expect(csvDate('2025-03-01T00:00:00.000Z')).to.equal('2025-03-01');
      expect(csvDate(null)).to.equal('');
      expect(csvDate('')).to.equal('');
      expect(csvDate('not a date')).to.equal('');
   });
});

describe('report CSV builders', () => {
   it('WIP CSV: date cells are YYYY-MM-DD, names are neutralised, future-dated columns present', () => {
      const lines = csvBuilders.buildWipCsvLines([
         {
            display_name: '=cmd()',
            unbilled_amount: 1200.5,
            unbilled_hours: 8,
            entries: 3,
            oldest_date: new Date(2025, 2, 1),
            days_old: 400,
            bucket_0_30: 0,
            bucket_31_60: 0,
            bucket_61_90: 0,
            bucket_over_90: 1200.5,
            future_dated_count: 2,
            future_dated_amount: 150
         }
      ]);
      expect(lines[0]).to.match(/Future-Dated Entries,Future-Dated Amount$/);
      expect(lines[1]).to.equal("'=cmd(),1200.5,8,3,2025-03-01,400,0,0,0,1200.5,2,150");
   });

   it('year-end AR CSV: statement / payment / oldest-open-charge dates formatted, inactive flagged', () => {
      const lines = csvBuilders.buildArAgingCsvLines([
         {
            display_name: 'Estate, Joe',
            bucket_0_30: 0,
            bucket_31_60: 0,
            bucket_61_90: 0,
            bucket_over_90: '150.00',
            total_outstanding: '150.00',
            statement_date: new Date(2025, 3, 14),
            most_recent_invoice_date: new Date(2025, 3, 14),
            last_payment_date: new Date(2025, 1, 26),
            oldest_open_charge_date: new Date(2025, 2, 5),
            oldest_open_charge_days: 567,
            is_customer_active: false
         }
      ]);
      expect(lines[0]).to.equal('Customer,0-30,31-60,61-90,>90,Total Owed,Most Recent Invoice,Last Payment,Oldest Open Charge,Days Since Oldest Open Charge,Active Customer');
      expect(lines[1]).to.equal('"Estate, Joe",0,0,0,150.00,150.00,2025-04-14,2025-02-26,2025-03-05,567,No');
   });

   it('client-rates CSV keeps negative margins numeric and neutralises names', () => {
      const lines = csvBuilders.buildClientRatesCsvLines(
         [{ display_name: '@evil', years: { 2025: { hours: 2, total_billed: 100, effective_rate: 50, agreed_rate: null, margin: -12.5 } }, last_full_year_rate: 50, yoy_pct: -3.2, suggested_rate: null }],
         [2025]
      );
      expect(lines[1]).to.equal("'@evil,2,100,50,,-12.5,50,-3.2,");
   });

   it('AR router export: shared encoder + new receivable-age columns', () => {
      const csv = generateArCsv([
         {
            customer_id: 5,
            business_name: '+Biz',
            customer_name: 'Kim, Jo',
            display_name: 'Jo Kim',
            bucket_0_30: 10,
            bucket_31_60: 0,
            bucket_61_90: 0,
            bucket_over_90: 0,
            total_outstanding: 10,
            statement_date: new Date(2026, 8, 15),
            most_recent_invoice_date: new Date(2026, 8, 15),
            oldest_days: 8,
            last_payment_date: null,
            last_payment_amount: null,
            has_work_since_last_payment: true,
            oldest_open_charge_date: new Date(2026, 6, 13),
            oldest_open_charge_days: 72,
            is_customer_active: true
         }
      ]).split('\n');
      expect(csv[0]).to.match(/Oldest Open Charge Date,Days Since Oldest Open Charge,Active Customer$/);
      expect(csv[1]).to.equal("5,'+Biz,\"Kim, Jo\",Jo Kim,10.00,0.00,0.00,0.00,10.00,2026-09-15,8,,,Yes,2026-07-13,72,Yes");
   });
});
