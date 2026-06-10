const express = require('express');
const dayjs = require('dayjs');
const { enforceAccountId } = require('../auth/account-scope');
const accountsReceivableRouter = express.Router();
accountsReceivableRouter.param('accountID', enforceAccountId);
const accountsReceivableService = require('./accounts-receivable-service');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');

const SORTABLE_AR_COLUMNS = [
   'business_name',
   'customer_name',
   'display_name',
   'bucket_0_30',
   'bucket_31_60',
   'bucket_61_90',
   'bucket_over_90',
   'total_outstanding',
   'last_payment_date',
   'has_work_since_last_payment',
   'oldest_days'
];
const AGE_FILTERS = ['30', '60', '90', 'over_90'];

const parseSort = req => {
   const sort = SORTABLE_AR_COLUMNS.includes(req.query.sort) ? req.query.sort : null;
   const direction = String(req.query.direction || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
   return { sort, direction };
};
const parseFilter = req => (AGE_FILTERS.includes(req.query.filter) ? req.query.filter : null);

const escapeCsvValue = value => {
   if (value === null || value === undefined) return '';
   if (value instanceof Date) return value.toISOString();
   const s = String(value);
   if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
   return s;
};

const fmtCurrencyForCsv = v => (v == null ? '' : Number(v).toFixed(2));
const fmtDateForCsv = v => (v ? dayjs(v).format('YYYY-MM-DD') : '');

const EXPORT_COLUMNS = [
   { header: 'Customer ID', get: r => r.customer_id },
   { header: 'Business Name', get: r => r.business_name || '' },
   { header: 'Customer Name', get: r => r.customer_name || '' },
   { header: 'Display Name', get: r => r.display_name || '' },
   { header: '0-30 Days', get: r => fmtCurrencyForCsv(r.bucket_0_30) },
   { header: '31-60 Days', get: r => fmtCurrencyForCsv(r.bucket_31_60) },
   { header: '61-90 Days', get: r => fmtCurrencyForCsv(r.bucket_61_90) },
   { header: '>90 Days', get: r => fmtCurrencyForCsv(r.bucket_over_90) },
   { header: 'Total Owed', get: r => fmtCurrencyForCsv(r.total_outstanding) },
   { header: 'Most Recent Invoice Date', get: r => fmtDateForCsv(r.most_recent_invoice_date) },
   { header: 'Days Since Last Invoice', get: r => (r.oldest_days == null ? '' : r.oldest_days) },
   { header: 'Last Payment Date', get: r => fmtDateForCsv(r.last_payment_date) },
   { header: 'Last Payment Amount', get: r => fmtCurrencyForCsv(r.last_payment_amount) },
   { header: 'Work Since Last Payment', get: r => (r.has_work_since_last_payment ? 'Yes' : 'No') }
];

const generateArCsv = rows => {
   const header = EXPORT_COLUMNS.map(c => escapeCsvValue(c.header)).join(',');
   const dataLines = rows.map(r => EXPORT_COLUMNS.map(c => escapeCsvValue(c.get(r))).join(','));
   return [header, ...dataLines].join('\n');
};

// GET aging snapshot — one row per customer with outstanding AR, bucketed by
// the age of their most recent unpaid parent invoice.
accountsReceivableRouter
   .route('/aging/:accountID/:userID')
   .get(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;
      const { search = '' } = req.query;

      try {
         const { page, limit, offset } = getPaginationParams({
            page: req.query.page || 1,
            limit: req.query.limit || 50
         });

         const { sort, direction } = parseSort(req);
         const filter = parseFilter(req);

         const { rows, totalCount } = await accountsReceivableService.getAging(db, accountID, {
            search: typeof search === 'string' ? search : '',
            limit,
            offset,
            sort,
            direction,
            filter
         });

         const pagination = getPaginationMetadata(totalCount, page, limit);

         return res.status(200).send({
            arAging: {
               customers: rows,
               pagination,
               searchTerm: typeof search === 'string' ? search.trim() : ''
            },
            message: 'Successfully retrieved AR aging.',
            status: 200
         });
      } catch (error) {
         console.error('Error fetching AR aging:', error);
         const isPaginationError = error.message && error.message.includes('Invalid pagination');
         const statusCode = isPaginationError ? 400 : 500;
         return res.status(statusCode).send({
            message: error.message || 'An error occurred while retrieving AR aging.',
            status: statusCode
         });
      }
   });

// CSV export — full dataset (no pagination), honors the same search filter.
accountsReceivableRouter
   .route('/aging/:accountID/:userID/export')
   .get(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;
      const { search = '' } = req.query;

      try {
         const { sort, direction } = parseSort(req);
         const filter = parseFilter(req);

         // High limit instead of unbounded: protects the server if the customer
         // list ever balloons.  10k rows is well above realistic AR size.
         const { rows } = await accountsReceivableService.getAging(db, accountID, {
            search: typeof search === 'string' ? search : '',
            limit: 10000,
            offset: 0,
            sort,
            direction,
            filter
         });

         const csv = generateArCsv(rows);
         const fileName = `accounts_receivable_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;

         res.setHeader('Content-Type', 'text/csv');
         res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
         return res.status(200).send(csv);
      } catch (error) {
         console.error('Error exporting AR aging:', error);
         return res.status(500).send({
            message: error.message || 'An error occurred while exporting AR aging.',
            status: 500
         });
      }
   });

module.exports = accountsReceivableRouter;
