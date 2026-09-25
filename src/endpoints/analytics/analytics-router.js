const express = require('express');
const dayjs = require('dayjs');
const { enforceAccountId } = require('../auth/account-scope');
const analyticsRouter = express.Router();
analyticsRouter.param('accountID', enforceAccountId);
const analyticsService = require('./analytics-service');
const accountsReceivableService = require('../accountsReceivable/accounts-receivable-service');
const archiver = require('archiver');
// Every CSV cell goes through csvCell (quoting + formula-injection guard that
// leaves numbers / numeric strings alone); date-only cells through csvDate.
const { csvDate, csvRow } = require('./csv-util');

// Customer ids to exclude from analytics, from the ?exclude=1,2,3 query param.
const parseExclude = req =>
   String(req.query.exclude || '')
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter(n => Number.isInteger(n) && n > 0);

const sendCsv = (res, fileName, lines) => {
   res.setHeader('Content-Type', 'text/csv');
   res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
   return res.status(200).send(lines.join('\n'));
};

const buildClientRatesCsvLines = (clients, years) => {
   const header = [
      'Customer',
      ...years.flatMap(y => [`${y} Hours`, `${y} Billed`, `${y} Rate`, `${y} Agreed`, `${y} Margin`]),
      'Last Full-Year Rate',
      'YoY %',
      'Suggested Rate'
   ];
   const lines = [csvRow(header)];
   clients.forEach(c => {
      const cells = [c.display_name];
      years.forEach(y => {
         const row = c.years[y];
         cells.push(
            row ? row.hours : '',
            row ? row.total_billed : '',
            row && row.effective_rate != null ? row.effective_rate : '',
            row && row.agreed_rate != null ? row.agreed_rate : '',
            row && row.margin != null ? row.margin : ''
         );
      });
      cells.push(c.last_full_year_rate ?? '', c.yoy_pct ?? '', c.suggested_rate ?? '');
      lines.push(csvRow(cells));
   });
   return lines;
};

const buildTimeAllocationCsvLines = data => {
   const lines = [];
   lines.push(csvRow([`Time Allocation ${data.year}`]));
   lines.push('');
   lines.push('Summary');
   lines.push(csvRow(['Total Hours', 'Billable Hours', 'Non-Billable Hours', 'Billable %', 'Billed Amount']));
   lines.push(csvRow([data.summary.total_hours, data.summary.billable_hours, data.summary.nonbillable_hours, data.summary.billable_pct ?? '', data.summary.billed_amount]));
   lines.push('');
   lines.push('By Work Description');
   lines.push(csvRow(['Work Description', 'Hours', 'Billable Hours', 'Non-Billable Hours', 'Billed Amount', 'Entries']));
   data.byWorkDescription.forEach(r => lines.push(csvRow([r.work_description, r.hours, r.billable_hours, r.nonbillable_hours, r.billed_amount, r.entries])));
   lines.push('');
   lines.push(csvRow(['By Customer (top 20 by hours)']));
   lines.push(csvRow(['Customer ID', 'Customer', 'Hours', 'Billed Amount']));
   data.byCustomer.forEach(r => lines.push(csvRow([r.customer_id, r.customer, r.hours, r.billed_amount])));
   lines.push('');
   lines.push('By Month');
   lines.push(csvRow(['Month', 'Billable Hours', 'Non-Billable Hours', 'Billed Amount']));
   data.monthly.forEach(r => lines.push(csvRow([r.month, r.billable_hours, r.nonbillable_hours, r.billed_amount])));
   lines.push('');
   lines.push(csvRow(['Raw Tracker By Category (includes held/unprocessed entries)']));
   lines.push(csvRow(['Category', 'Hours', 'Entries']));
   data.trackerByCategory.forEach(r => lines.push(csvRow([r.category, r.hours, r.entries])));
   return lines;
};

const buildWipCsvLines = rows => {
   const lines = [
      csvRow(['Customer', 'Unbilled Amount', 'Unbilled Hours', 'Entries', 'Oldest Date', 'Days Old', '0-30', '31-60', '61-90', '>90', 'Future-Dated Entries', 'Future-Dated Amount'])
   ];
   rows.forEach(r =>
      lines.push(
         csvRow([
            r.display_name,
            r.unbilled_amount,
            r.unbilled_hours,
            r.entries,
            csvDate(r.oldest_date),
            r.days_old ?? '',
            r.bucket_0_30,
            r.bucket_31_60,
            r.bucket_61_90,
            r.bucket_over_90,
            r.future_dated_count ?? 0,
            r.future_dated_amount ?? 0
         ])
      )
   );
   return lines;
};

// AR sheet of the year-end packet. Buckets are STATEMENT age (days since the
// newest statement); the trailing columns carry the real receivable age (oldest
// charge still unpaid, FIFO) — see accounts-receivable-service.
const buildArAgingCsvLines = rows => {
   const lines = [
      csvRow([
         'Customer',
         '0-30',
         '31-60',
         '61-90',
         '>90',
         'Total Owed',
         'Most Recent Invoice',
         'Last Payment',
         'Oldest Open Charge',
         'Days Since Oldest Open Charge',
         'Active Customer'
      ])
   ];
   rows.forEach(r =>
      lines.push(
         csvRow([
            r.display_name,
            r.bucket_0_30,
            r.bucket_31_60,
            r.bucket_61_90,
            r.bucket_over_90,
            r.total_outstanding,
            csvDate(r.statement_date || r.most_recent_invoice_date),
            csvDate(r.last_payment_date),
            csvDate(r.oldest_open_charge_date),
            r.oldest_open_charge_days ?? '',
            r.is_customer_active === false ? 'No' : 'Yes'
         ])
      )
   );
   return lines;
};

// Per-client billing history: hours, billed, effective hourly rate per year,
// firm percentile, and a suggested current-year rate.
analyticsRouter.route('/clientRates/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const yearsBack = Number(req.query.yearsBack) || 6;
      const clientRates = await analyticsService.getClientRates(db, accountID, { yearsBack, excludeIds: parseExclude(req) });
      res.send({ clientRates, message: 'Successfully retrieved client rates.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while retrieving client rates.', status: 500 });
   }
});

analyticsRouter.route('/clientRates/:accountID/:userID/export').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const yearsBack = Number(req.query.yearsBack) || 6;
      const { clients, years } = await analyticsService.getClientRates(db, accountID, { yearsBack, excludeIds: parseExclude(req) });
      return sendCsv(res, `client_rates_${dayjs().format('YYYYMMDD_HHmmss')}.csv`, buildClientRatesCsvLines(clients, years));
   } catch (err) {
      console.log(err);
      res.status(500).send({ message: err.message || 'An error occurred while exporting client rates.', status: 500 });
   }
});

// Year time allocation: billable vs administrative and everything else,
// by work description / employee / customer / month, plus the raw tracker view.
analyticsRouter.route('/timeAllocation/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const timeAllocation = await analyticsService.getTimeAllocation(db, accountID, { year: req.query.year, excludeIds: parseExclude(req) });
      res.send({ timeAllocation, message: 'Successfully retrieved time allocation.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while retrieving time allocation.', status: 500 });
   }
});

analyticsRouter.route('/timeAllocation/:accountID/:userID/export').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const data = await analyticsService.getTimeAllocation(db, accountID, { year: req.query.year, excludeIds: parseExclude(req) });
      return sendCsv(res, `time_allocation_${data.year}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`, buildTimeAllocationCsvLines(data));
   } catch (err) {
      console.log(err);
      res.status(500).send({ message: err.message || 'An error occurred while exporting time allocation.', status: 500 });
   }
});

// Record/update the agreed rate for a client-year (rate card).
analyticsRouter.route('/rateAgreement/:accountID/:userID').post(express.json(), async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const { customerId, year, agreedRate, notes } = req.body || {};
      const numericCustomer = Number(customerId);
      const numericRate = Number(agreedRate);
      const numericYear = Number(year);
      if (!Number.isInteger(numericCustomer) || numericCustomer <= 0 || numericCustomer > 2147483647 ||
          !Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100 ||
          !Number.isFinite(numericRate) || numericRate <= 0 || numericRate > 99999999.99 ||
          Math.abs(Math.round(numericRate * 100) / 100 - numericRate) > 1e-9) {
         throw new Error('A customer, a year, and a positive agreed rate are required.');
      }
      const agreement = await analyticsService.upsertRateAgreement(db, accountID, {
         customerId: numericCustomer,
         year: numericYear,
         agreedRate: numericRate,
         notes,
         userId: Number(req.user.user_id)
      });
      res.send({ agreement, message: 'Successfully saved rate agreement.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while saving the rate agreement.', status: 500 });
   }
});

// Unbilled work aged from transaction date.
analyticsRouter.route('/wipAging/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const wipAging = await analyticsService.getWipAging(db, accountID, { excludeIds: parseExclude(req) });
      res.send({ wipAging, message: 'Successfully retrieved WIP aging.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while retrieving WIP aging.', status: 500 });
   }
});

// Budget vs actual for parent jobs with an agreed amount.
analyticsRouter.route('/jobBudgets/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const jobBudgets = await analyticsService.getJobBudgets(db, accountID, { excludeIds: parseExclude(req) });
      res.send({ jobBudgets, message: 'Successfully retrieved job budgets.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while retrieving job budgets.', status: 500 });
   }
});

// Year-end packet: one zip with the four review reports for the year —
// client rates, time allocation, WIP aging, and AR aging.
analyticsRouter.route('/yearEndPacket/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const year = Number(req.query.year) || new Date().getFullYear() - 1;
      const excludeIds = parseExclude(req);

      const [clientRates, timeAllocation, wipRows, arResult] = await Promise.all([
         analyticsService.getClientRates(db, accountID, { yearsBack: 6, excludeIds }),
         analyticsService.getTimeAllocation(db, accountID, { year, excludeIds }),
         analyticsService.getWipAging(db, accountID, { excludeIds }),
         accountsReceivableService.getAging(db, accountID, { limit: 10000, offset: 0, excludeIds })
      ]);

      const arLines = buildArAgingCsvLines(arResult.rows);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="year_end_packet_${year}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => {
         console.log(err);
         if (!res.headersSent) res.status(500).send({ message: err.message, status: 500 });
      });
      archive.pipe(res);
      archive.append(buildClientRatesCsvLines(clientRates.clients, clientRates.years).join('\n'), { name: `client_rates_${year}.csv` });
      archive.append(buildTimeAllocationCsvLines(timeAllocation).join('\n'), { name: `time_allocation_${year}.csv` });
      archive.append(buildWipCsvLines(wipRows).join('\n'), { name: 'wip_unbilled_aging.csv' });
      archive.append(arLines.join('\n'), { name: 'accounts_receivable_aging.csv' });
      await archive.finalize();
   } catch (err) {
      console.log(err);
      if (!res.headersSent) {
         res.status(500).send({ message: err.message || 'An error occurred while building the year-end packet.', status: 500 });
      }
   }
});

// Tax-season hours per employee per week, this year vs last.
analyticsRouter.route('/taxSeasonCapacity/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const taxSeasonCapacity = await analyticsService.getTaxSeasonCapacity(db, accountID, { year: req.query.year, excludeIds: parseExclude(req) });
      res.send({ taxSeasonCapacity, message: 'Successfully retrieved tax season capacity.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while retrieving tax season capacity.', status: 500 });
   }
});

// Customer list + default-excluded ids for the analytics "filter out" picker.
analyticsRouter.route('/exclusions/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const exclusions = await analyticsService.getExcludableCustomers(db, accountID);
      res.send({ exclusions, message: 'Successfully retrieved exclusion options.', status: 200 });
   } catch (err) {
      console.log(err);
      res.send({ message: err.message || 'An error occurred while retrieving exclusion options.', status: 500 });
   }
});

module.exports = analyticsRouter;
// Exposed for unit tests of the CSV builders.
module.exports.csvBuilders = { buildClientRatesCsvLines, buildTimeAllocationCsvLines, buildWipCsvLines, buildArAgingCsvLines };
