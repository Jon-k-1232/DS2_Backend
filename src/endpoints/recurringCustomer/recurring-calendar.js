'use strict';
const v = require('../payments/receipt-values');
const { ruleError } = require('../payments/ledger-helpers');
const MONTHS = Object.freeze({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 });
const monthNumber = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthStart = n => `${String(Math.floor(n / 12)).padStart(4, '0')}-${String(n % 12 + 1).padStart(2, '0')}-01`;
function period(plan, n) {
  const start = monthStart(n), step = MONTHS[String(plan.subscription_frequency).toLowerCase()];
  const last = new Date(Date.UTC(Math.floor(n / 12), n % 12 + 1, 0)).getUTCDate();
  return { periodStart: start, periodEnd: new Date(Date.parse(monthStart(n + step)) - 86400000).toISOString().slice(0, 10),
    dueDate: start.slice(0, 8) + String(Math.min(Number(plan.bill_on_date), last)).padStart(2, '0') };
}
function periods(plan, through, { historical = false } = {}) {
  v.date(through, { future: true });
  const step = MONTHS[String(plan.subscription_frequency).toLowerCase()];
  if (!step) return [];
  const start = v.day(plan.start_date), end = plan.end_date && v.day(plan.end_date);
  const first = historical ? start.slice(0, 8) + '01' : v.day(plan.first_automated_period || start);
  const anchor = monthNumber(v.day(plan.anchor_start_date || start));
  const from = Math.max(anchor, monthNumber(first));
  const offset = Math.max(0, Math.ceil((from - anchor) / step));
  const result = [];
  for (let n = anchor + offset * step; n <= monthNumber(through); n += step) {
    const p = period(plan, n);
    if (p.dueDate >= start && p.dueDate <= through && (!end || p.dueDate <= end)) result.push(p);
  }
  return result;
}
function validate(fields) {
  const frequency = String(fields.subscription_frequency || '').toLowerCase();
  if (!MONTHS[frequency]) throw ruleError('Choose monthly, quarterly, semiannual or annual.', 400);
  if (!Number.isInteger(fields.bill_on_date) || fields.bill_on_date < 1 || fields.bill_on_date > 31) throw ruleError('Bill-on day must be 1 through 31.', 400);
  v.cents(fields.recurring_bill_amount);
  v.date(v.day(fields.start_date), { future: true });
  if (fields.end_date) { v.date(v.day(fields.end_date), { future: true }); if (v.day(fields.end_date) < v.day(fields.start_date)) throw ruleError('End date cannot precede start date.', 400); }
  if (typeof fields.is_recurring_customer_active !== 'boolean') throw ruleError('Active must be true or false.', 400);
  return frequency;
}
function firstPeriod(plan, cutoff) {
  const anchor = monthNumber(v.day(plan.anchor_start_date || plan.start_date)), step = MONTHS[String(plan.subscription_frequency).toLowerCase()];
  const boundary = cutoff > v.day(plan.start_date) ? cutoff : v.day(plan.start_date);
  let n = anchor + Math.max(0, Math.floor((monthNumber(boundary) - anchor) / step)) * step;
  while (period(plan, n).dueDate < boundary) n += step;
  return monthStart(n);
}
module.exports = { MONTHS, monthNumber, monthStart, period, periods, validate, firstPeriod };
