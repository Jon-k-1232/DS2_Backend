const express = require('express');
const dayjs = require('dayjs');
const { enforceAccountId } = require('../auth/account-scope');
const analyticsRouter = express.Router();
analyticsRouter.param('accountID', enforceAccountId);
const analyticsService = require('./analytics-service');

const escapeCsvValue = value => {
   if (value === null || value === undefined) return '';
   const s = String(value);
   if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
   return s;
};

const sendCsv = (res, fileName, lines) => {
   res.setHeader('Content-Type', 'text/csv');
   res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
   return res.status(200).send(lines.join('\n'));
};

// Per-client billing history: hours, billed, effective hourly rate per year,
// firm percentile, and a suggested current-year rate.
analyticsRouter.route('/clientRates/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const yearsBack = Number(req.query.yearsBack) || 6;
      const clientRates = await analyticsService.getClientRates(db, accountID, { yearsBack });
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
      const { clients, years } = await analyticsService.getClientRates(db, accountID, { yearsBack });

      const header = [
         'Customer',
         ...years.flatMap(y => [`${y} Hours`, `${y} Billed`, `${y} Rate`]),
         'Last Full-Year Rate',
         'YoY %',
         'Suggested Rate'
      ];
      const lines = [header.map(escapeCsvValue).join(',')];
      clients.forEach(c => {
         const cells = [c.display_name];
         years.forEach(y => {
            const row = c.years[y];
            cells.push(row ? row.hours : '', row ? row.total_billed : '', row && row.effective_rate != null ? row.effective_rate : '');
         });
         cells.push(c.last_full_year_rate ?? '', c.yoy_pct ?? '', c.suggested_rate ?? '');
         lines.push(cells.map(escapeCsvValue).join(','));
      });

      return sendCsv(res, `client_rates_${dayjs().format('YYYYMMDD_HHmmss')}.csv`, lines);
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
      const timeAllocation = await analyticsService.getTimeAllocation(db, accountID, { year: req.query.year });
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
      const data = await analyticsService.getTimeAllocation(db, accountID, { year: req.query.year });

      const lines = [];
      lines.push(`Time Allocation ${data.year}`);
      lines.push('');
      lines.push('Summary');
      lines.push(['Total Hours', 'Billable Hours', 'Non-Billable Hours', 'Billable %', 'Billed Amount'].join(','));
      lines.push([data.summary.total_hours, data.summary.billable_hours, data.summary.nonbillable_hours, data.summary.billable_pct ?? '', data.summary.billed_amount].join(','));
      lines.push('');
      lines.push('By Work Description');
      lines.push(['Work Description', 'Hours', 'Billable Hours', 'Non-Billable Hours', 'Billed Amount', 'Entries'].map(escapeCsvValue).join(','));
      data.byWorkDescription.forEach(r =>
         lines.push([escapeCsvValue(r.work_description), r.hours, r.billable_hours, r.nonbillable_hours, r.billed_amount, r.entries].join(','))
      );
      lines.push('');
      lines.push('By Employee');
      lines.push(['Employee', 'Hours', 'Billable Hours', 'Utilization %', 'Billed Amount'].map(escapeCsvValue).join(','));
      data.byEmployee.forEach(r => lines.push([escapeCsvValue(r.employee), r.hours, r.billable_hours, r.utilization_pct ?? '', r.billed_amount].join(',')));
      lines.push('');
      lines.push('By Customer (top 20 by hours)');
      lines.push(['Customer', 'Hours', 'Billed Amount'].map(escapeCsvValue).join(','));
      data.byCustomer.forEach(r => lines.push([escapeCsvValue(r.customer), r.hours, r.billed_amount].join(',')));
      lines.push('');
      lines.push('By Month');
      lines.push(['Month', 'Billable Hours', 'Non-Billable Hours', 'Billed Amount'].join(','));
      data.monthly.forEach(r => lines.push([r.month, r.billable_hours, r.nonbillable_hours, r.billed_amount].join(',')));
      lines.push('');
      lines.push('Raw Tracker By Category (includes held/unprocessed entries)');
      lines.push(['Category', 'Hours', 'Entries'].map(escapeCsvValue).join(','));
      data.trackerByCategory.forEach(r => lines.push([escapeCsvValue(r.category), r.hours, r.entries].join(',')));

      return sendCsv(res, `time_allocation_${data.year}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`, lines);
   } catch (err) {
      console.log(err);
      res.status(500).send({ message: err.message || 'An error occurred while exporting time allocation.', status: 500 });
   }
});

module.exports = analyticsRouter;
