/**
 * Shared fixtures/helpers for src/pdfCreator/templateOne/** unit tests.
 *
 * Every test renders a PDF in memory with pdfkit (createPDF never touches
 * S3/MinIO — see templateOneOrchestrator.js) and reads it back with the
 * `pdftotext` CLI (poppler), the same tool the clean-room integration spec
 * uses (test/integration/clean-room-regression.integration.spec.js), so a
 * layout bug that is only visible in the rendered page (overlap, a row split
 * across a page boundary) shows up in the extracted text just like it would
 * for a real statement.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PDFTOTEXT = process.env.PDFTOTEXT_BIN || '/opt/homebrew/bin/pdftotext';

// Collapse all whitespace (including the \f page-break poppler emits between
// pages) to single spaces — for asserting on word content/order only, not on
// which literal line or page something landed on.
const flat = text => text.replace(/\s+/g, ' ').trim();

// Split raw `pdftotext -layout` output into one string per page. Poppler
// separates pages with a form-feed; drop a trailing empty page from the
// final \f.
const pagesOf = rawText =>
   rawText
      .split('\f')
      .map(page => page.replace(/\s+$/, ''))
      .filter((page, index, all) => !(index === all.length - 1 && page === ''));

/**
 * Renders `pdfBuffer` to a temp file and returns pdftotext's `-layout`
 * output (raw — including form feeds between pages; use `flat()` or
 * `pagesOf()` on the result as needed).
 */
const extractPdfText = (pdfBuffer, scratchDir) => {
   const file = path.join(scratchDir, `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
   fs.writeFileSync(file, pdfBuffer);
   try {
      return execFileSync(PDFTOTEXT, ['-layout', file, '-'], { encoding: 'utf8' });
   } finally {
      fs.unlinkSync(file);
   }
};

// A minimal but complete invoiceDetails object — every field every
// templateOne section reads — matching the shape addInvoiceDetail.js hands
// createPDF in the real pipeline. Individual tests override just the
// section(s) they're exercising.
const baseFixture = (overrides = {}) => ({
   customer_id: 900101,
   invoiceNumber: 'INV-2026-00001',
   dueDate: '10/09/2026',
   billingDate: '2026-09-23',
   companyLogo: fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'images', 'noImage.png')),
   accountBillingInformation: {
      account_name: 'Review Fixture Firm',
      account_street: '1 Main Street',
      account_city: 'Mesa',
      account_state: 'AZ',
      account_zip: '85201',
      account_phone: '555-0100',
      account_email: 'fixture@example.test',
      account_statement: 'Payment due as indicated.',
      account_interest_statement: 'Balances unpaid for 30 days accrue interest at the rate of 18% per annum.'
   },
   customerContactInformation: {
      display_name: 'Review Fixture Customer',
      customer_name: 'Review Fixture Customer',
      business_name: null,
      customer_street: '2 Main Street',
      customer_city: 'Mesa',
      customer_state: 'AZ',
      customer_zip: '85201',
      customer_phone: '555-0101'
   },
   outstandingInvoices: { outstandingInvoiceRecords: [], outstandingInvoiceTotal: 0 },
   payments: { paymentRecords: [], paymentTotal: 0, paymentsReceivedTotal: 0 },
   transactions: { transactionRecords: [], transactionsTotal: 0 },
   writeOffs: { writeOffRecords: [], writeOffTotal: 0, writeOffsListedTotal: 0 },
   retainers: { retainerRecords: [], retainerTotal: 0 },
   retainerAppliedToInvoice: 0,
   remainingRetainer: 0,
   invoiceTotal: 0,
   preRetainerInvoiceTotal: 0,
   invoiceNote: '',
   globalInvoiceNote: '',
   ...overrides
});

module.exports = { PDFTOTEXT, flat, pagesOf, extractPdfText, baseFixture };
