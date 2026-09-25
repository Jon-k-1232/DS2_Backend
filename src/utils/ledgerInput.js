'use strict';
const { round2, ruleError } = require('../endpoints/payments/ledger-helpers');

// Validate the submitted values before the legacy mappers coerce them. In
// particular Number(true), Number([10]) and invalid optional IDs must not turn
// a malformed request into a different, valid financial event.
const invalid = message => {
   const error = ruleError(message, 400);
   error.inputValidation = true;
   throw error;
};
const emptySelection = value => value == null || value === '';
const scalarNumber = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));

function validLedgerDate(value) {
   if (typeof value !== 'string') return false;
   const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
   if (!match) return false;
   const [, yearText, monthText, dayText] = match;
   const year = Number(yearText), month = Number(monthText), day = Number(dayText);
   const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
   const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
   return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number.isFinite(Date.parse(value));
}

function validateLedgerInput(data, kind, { update = false } = {}) {
   if (!data || typeof data !== 'object' || Array.isArray(data)) invalid(`${kind} must be an object.`);
   const label = { payment: 'Payment', writeoff: 'Write-off', retainer: 'Retainer' }[kind];
   if (!(kind === 'retainer' && update && data.unitCost === undefined)) {
      if (!scalarNumber(data.unitCost)) invalid(`${label} amount must be a finite number.`);
      const amount = round2(Math.abs(Number(data.unitCost)));
      if (!(amount > 0)) invalid(`${label} amount must be greater than $0.00.`);
      if (amount > 99999999.99) invalid(`${label} amount exceeds the supported maximum of $99999999.99.`);
   }

   if (!update || data.customerID !== undefined) {
      const id = data.customerID;
      if (!scalarNumber(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1 || Number(id) > 2147483647) invalid('customerID must be a positive integer ID.');
   }

   const optionalIDs = kind === 'payment' ? ['selectedJobID', 'selectedInvoiceID', 'selectedRetainerID'] : kind === 'writeoff' ? ['selectedJobID', 'customerInvoiceID'] : [];
   for (const field of optionalIDs) {
      const value = data[field];
      if (emptySelection(value)) continue;
      if (!scalarNumber(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) invalid(`${field} must be a positive integer ID or an empty selection.`);
   }

   const dateField = kind === 'payment' ? 'transactionDate' : kind === 'writeoff' ? 'selectedDate' : null;
   if (dateField && (!update || data[dateField] !== undefined) && !validLedgerDate(data[dateField])) invalid(`A valid ${kind === 'payment' ? 'payment' : 'write-off'} date is required.`);

   const reasonKey = data.writeoffReason == null && data.writeOffReason !== undefined ? 'writeOffReason' : 'writeoffReason';
   const required = kind === 'writeoff' ? reasonKey : kind === 'retainer' ? 'typeOfHold' : null;
   if (required && (!update || data[required] !== undefined)) {
      const value = data[required];
      if (typeof value !== 'string' || !value.trim() || ['null', 'undefined'].includes(value)) invalid(kind === 'writeoff' ? 'A write-off reason is required.' : 'Select a type of hold (Retainer or Prepayment).');
   }
   const textFields = kind === 'writeoff' ? [[reasonKey, 50]] : [['formOfPayment', 50], ['paymentReferenceNumber', 50], ...(kind === 'retainer' ? [['displayName', 100], ['typeOfHold', 50]] : [])];
   for (const [field, max] of [...textFields, ['note', null]]) {
      const value = data[field];
      if (value == null) continue;
      if (typeof value !== 'string' || value.includes('\0')) invalid(`${field} must be text without null characters.`);
      if (max && [...value].length > max) invalid(`${field} supports at most ${max} characters.`);
   }
   return data;
}

module.exports = { validateLedgerInput, validLedgerDate };
