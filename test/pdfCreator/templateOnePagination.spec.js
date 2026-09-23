/**
 * templateOne statement PDF — pagination (B4-N2).
 *
 * The legacy section renderers (templateOneTransactions.js and friends)
 * placed every row at `top + lineHeight * index`, gave text columns no
 * width, and never checked the page's bottom margin. A long wrapped cell
 * overlapped the next row, and a long statement (many jobs/payments/
 * write-offs/retainers, or a long note) ran off the page with no page break
 * — 35 jobs produced 24 pages with one job's id, description and amount
 * landing on different pages.
 *
 * These tests render real PDFs in memory with pdfkit (no S3/MinIO — see
 * templateOneOrchestrator.js) and read them back with the `pdftotext` CLI
 * (poppler, `-layout`), the same technique
 * test/integration/clean-room-regression.integration.spec.js uses against
 * real finalized statements.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const stream = require('stream');
const { createPDF } = require('../../src/pdfCreator/templateOne/templateOneOrchestrator');
const { createTotalsSection } = require('../../src/pdfCreator/templateOne/templateFunctions/templateOneTotals');
const { createChargesSection } = require('../../src/pdfCreator/templateOne/templateFunctions/templateOneTransactions');
const PDFDocument = require('../../src/pdfCreator/pdfkit-tables');
const { PDFTOTEXT, flat, pagesOf, extractPdfText, baseFixture } = require('./_pdfFixtures');

// Captured from a fixture invoice rendered with the PRE-FIX
// templateOneOutstandingCharges/Payments/Transactions/WriteOffs/Retainers/
// Totals/Notes code (a working copy of the unmodified files, run through the
// same createPDF -> pdftotext -layout -> whitespace-collapse pipeline used
// below) and confirmed byte-for-byte equal, word for word, to what the fixed
// code below now produces for the same single-page invoice. If this ever
// fails, either a real regression was introduced, or the statement's visible
// text legitimately changed and this baseline needs to be re-captured.
const GOLDEN_SINGLE_PAGE_TEXT =
   'Review Fixture Firm INVOICE 1 Main Street Mesa, AZ 85201 INV-2026-00001 Phone: 555-0100 Email: fixture@example.test Bill To: Review Fixture Customer ' +
   'Statement Date: 09/23/2026 2 Main Street Payment Due Date: 10/09/2026 Mesa, AZ 85201 555-0101 Beginning Balance Invoice Date Invoice Original Amount ' +
   'Outstanding Beginning Balance: 0.00 Payments Date Invoice Type Reference Amount 08/15/2026 INV-2026-00090 Check 4521 -150.50 Total Payments Received: ' +
   '-150.50 Professional Services Job Job Description Charge J-1 Bookkeeping services 150.00 J-2 Tax prep consultation 250.00 Total New Charges: 400.00 ' +
   'Balance Due: 249.50 Payment due as indicated. Notes Thank you for choosing us this quarter. Balances unpaid for 30 days accrue interest at the rate of 18% per annum.';

describe('templateOne statement PDF — pagination', function () {
   this.timeout(30_000);

   let scratchDir;

   before(function () {
      if (!fs.existsSync(PDFTOTEXT)) this.skip();
      scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-pdf-pagination-'));
   });

   after(() => {
      if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
   });

   it('wraps a long job description without overlap: both jobs readable, the second job stays on one line', async () => {
      const longDescription = 'Long description ' + 'monthly accounting service and reconciliation '.repeat(6);
      const rows = [
         { jobID: 'J-1', jobDescription: longDescription, jobTotal: 111.11 },
         { jobID: 'J-2', jobDescription: 'Job description 2', jobTotal: 222.22 }
      ];
      const fixture = baseFixture({ transactions: { transactionRecords: rows, transactionsTotal: 333.33 }, invoiceTotal: 333.33, preRetainerInvoiceTotal: 333.33 });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const lines = raw.split('\n').map(l => l.replace(/\s+$/, ''));

      expect(raw, 'first job amount present').to.include('111.11');
      expect(raw, 'second job amount present').to.include('222.22');

      // The long description actually wrapped — pdftotext shows several
      // lines, each carrying a fragment of the repeated phrase.
      const descriptionLines = lines.filter(l => l.includes('monthly accounting service and reconciliation'));
      expect(descriptionLines.length, 'long description wraps across multiple lines').to.be.greaterThan(1);

      // Job 1's id and amount sit on the SAME line as the first line of its
      // (wrapped) description, exactly like the un-wrapped case always did.
      const job1FirstLine = lines.find(l => l.includes('J-1'));
      expect(job1FirstLine, 'job 1 row found').to.exist;
      expect(job1FirstLine).to.include('Long description');
      expect(job1FirstLine).to.include('111.11');

      // Job 2's id, description and amount are all on ONE line together.
      const job2Line = lines.find(l => l.includes('J-2'));
      expect(job2Line, 'job 2 row found').to.exist;
      expect(job2Line).to.include('Job description 2');
      expect(job2Line).to.include('222.22');

      // No overlap: job 2's row comes strictly after every fragment of job
      // 1's wrapped description, never interleaved with it.
      const job1LastDescLineIndex = lines.reduce((last, l, i) => (l.includes('monthly accounting service') ? i : last), -1);
      expect(lines.indexOf(job2Line), "job 2's row appears after job 1 finishes wrapping").to.be.greaterThan(job1LastDescLineIndex);

      expect(flat(raw), 'section subtotal unaffected').to.include('Total New Charges: 333.33');
   });

   it('paginates 35 jobs: every job\'s id/description/amount stay on one page, and the subtotal stays with the last job', async () => {
      const rows = Array.from({ length: 35 }, (_, i) => ({ jobID: `J-${i + 1}`, jobDescription: `Job description ${i + 1}`, jobTotal: 100 + i }));
      const total = rows.reduce((acc, row) => acc + row.jobTotal, 0);
      const fixture = baseFixture({ transactions: { transactionRecords: rows, transactionsTotal: total }, invoiceTotal: total, preRetainerInvoiceTotal: total });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);

      // Sane page count: more than the single page 35 rows cannot fit on,
      // nowhere near the legacy bug's 24 pages for this same input.
      expect(pages.length, `page count sane (got ${pages.length})`).to.be.within(2, 4);

      rows.forEach(row => {
         const amount = row.jobTotal.toFixed(2);
         const pageIndex = pages.findIndex(page => page.includes(row.jobID) && page.includes(row.jobDescription) && page.includes(amount));
         expect(pageIndex, `${row.jobID}: id, description and amount together on one page`).to.be.at.least(0);
      });

      const lastJobPage = pages.findIndex(page => page.includes('J-35') && page.includes('Job description 35') && page.includes((134).toFixed(2)));
      const subtotalPage = pages.findIndex(page => page.includes(`Total New Charges: ${total.toFixed(2)}`));
      expect(subtotalPage, 'subtotal printed').to.be.at.least(0);
      expect(subtotalPage, 'subtotal is on the same page as the last job, not stranded alone').to.equal(lastJobPage);
   });

   it('handles 40 payments + 10 write-offs + 3 retainers + a long note without error; totals land on the last page', async () => {
      const payments = Array.from({ length: 40 }, (_, i) => ({
         payment_id: i + 1,
         payment_date: '2026-09-01',
         invoice_number: `INV-2026-${String(i + 1).padStart(5, '0')}`,
         form_of_payment: ['Check', 'Credit Card', 'Bank Transfer', 'Cash'][i % 4],
         payment_reference_number: `REF-${1000 + i}`,
         payment_amount: `-${(50 + i).toFixed(2)}`
      }));
      const writeOffRecords = Array.from({ length: 10 }, (_, i) => ({
         writeoff_id: i + 1,
         transaction_type: 'Write Off',
         writeoff_reason: `Adjustment reason number ${i + 1} for a delayed engagement letter and scope revision`,
         writeoff_amount: `-${(10 + i).toFixed(2)}`
      }));
      const retainerRecords = [
         { retainer_id: 1, type_of_hold: 'Retainer', starting_amount: '1000.00', current_amount: '400.00' },
         { retainer_id: 2, type_of_hold: 'Prepayment', starting_amount: '500.00', current_amount: '500.00' },
         { retainer_id: 3, type_of_hold: 'Retainer', starting_amount: '250.00', current_amount: '0.00' }
      ];
      const longNote = 'This is a very long invoice note. '.repeat(60);
      // customer_payments is stored NEGATIVE per the ledger's sign convention
      // (see CLAUDE.md); the declared total must equal the actual sum of the
      // rows above it, not an independently-typed number.
      const paymentsTotalAmount = payments.reduce((sum, p) => sum + Number(p.payment_amount), 0);

      const fixture = baseFixture({
         payments: { paymentRecords: payments, paymentTotal: paymentsTotalAmount, paymentsReceivedTotal: paymentsTotalAmount },
         writeOffs: { writeOffRecords, writeOffTotal: -145, writeOffsListedTotal: -145 },
         retainers: { retainerRecords, retainerTotal: 900 },
         retainerAppliedToInvoice: 100,
         remainingRetainer: 900,
         invoiceTotal: 500,
         preRetainerInvoiceTotal: 600,
         invoiceNote: longNote,
         globalInvoiceNote: 'Thank you for your business. '.repeat(20)
      });

      // Must not throw — no row here is individually unfittable, only the
      // section as a whole is long.
      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);

      expect(pages.length, `page count sane (got ${pages.length})`).to.be.within(2, 8);

      payments.forEach(p => expect(raw, `payment ${p.payment_reference_number} present`).to.include(p.payment_reference_number));
      writeOffRecords.forEach(w => expect(raw, `write-off ${w.writeoff_id} present`).to.include(`Adjustment reason number ${w.writeoff_id}`));
      retainerRecords.forEach(r => expect(raw, `retainer starting amount ${r.starting_amount} present`).to.include(r.starting_amount));
      expect(flat(raw), 'long note present in full').to.include(longNote.trim());
      // The printed subtotal is exactly the sum of the 40 (negative) payment rows above it.
      expect(flat(raw), 'Payments subtotal equals the sum of its own rows').to.include(`Total Payments Received: ${paymentsTotalAmount.toFixed(2)}`);

      const balanceDuePage = pages.findIndex(page => page.includes('Balance Due: 500.00'));
      expect(balanceDuePage, 'Balance Due present').to.be.at.least(0);
      expect(balanceDuePage, 'totals block is on the LAST page').to.equal(pages.length - 1);
   });

   it('single-page statement: extracted text is unchanged (whitespace-insensitive) from the pre-fix baseline', async () => {
      const fixture = baseFixture({
         payments: {
            paymentRecords: [{ payment_id: 1, payment_date: '2026-08-15', invoice_number: 'INV-2026-00090', form_of_payment: 'Check', payment_reference_number: '4521', payment_amount: '-150.50' }],
            paymentTotal: -150.5,
            paymentsReceivedTotal: -150.5
         },
         transactions: {
            transactionRecords: [
               { jobID: 'J-1', jobDescription: 'Bookkeeping services', jobTotal: 150 },
               { jobID: 'J-2', jobDescription: 'Tax prep consultation', jobTotal: 250 }
            ],
            transactionsTotal: 400
         },
         invoiceTotal: 249.5,
         preRetainerInvoiceTotal: 249.5,
         invoiceNote: 'Thank you for choosing us this quarter.'
      });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);

      expect(pagesOf(raw).length, 'still renders as a single page').to.equal(1);
      expect(flat(raw), 'extracted text identical to the pre-fix baseline, ignoring whitespace').to.equal(GOLDEN_SINGLE_PAGE_TEXT);
   });

   it('refuses a single row that cannot fit on one page, before returning any PDF', async () => {
      const rows = [{ jobID: 'J-1', jobDescription: 'X '.repeat(20_000), jobTotal: 100 }];
      const fixture = baseFixture({ transactions: { transactionRecords: rows, transactionsTotal: 100 }, invoiceTotal: 100, preRetainerInvoiceTotal: 100 });

      let caught;
      try {
         await createPDF(fixture);
      } catch (e) {
         caught = e;
      }
      expect(caught, 'createPDF rejects instead of silently clipping/overlapping the row').to.exist;
      expect(caught.message).to.match(/cannot fit on a single statement page/);
   });

   it('paginates 30 outstanding (Beginning Balance) invoices the same way as the charges section', async () => {
      const rows = Array.from({ length: 30 }, (_, i) => ({
         invoice_date: '2026-0' + ((i % 9) + 1) + '-10',
         invoice_number: `INV-2025-${String(i + 1).padStart(5, '0')}`,
         remaining_balance_on_invoice: 50 + i
      }));
      const total = rows.reduce((acc, row) => acc + row.remaining_balance_on_invoice, 0);
      const fixture = baseFixture({ outstandingInvoices: { outstandingInvoiceRecords: rows, outstandingInvoiceTotal: total }, invoiceTotal: total, preRetainerInvoiceTotal: total });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);

      expect(pages.length, `page count sane (got ${pages.length})`).to.be.within(2, 4);

      rows.forEach(row => {
         const amount = row.remaining_balance_on_invoice.toFixed(2);
         const pageIndex = pages.findIndex(page => page.includes(row.invoice_number) && page.includes(amount));
         expect(pageIndex, `${row.invoice_number}: invoice number and amount together on one page`).to.be.at.least(0);
      });

      const subtotalPage = pages.findIndex(page => page.includes(`Beginning Balance: ${total.toFixed(2)}`));
      const lastRowPage = pages.findIndex(page => page.includes(rows[rows.length - 1].invoice_number));
      expect(subtotalPage, 'Beginning Balance subtotal printed').to.be.at.least(0);
      expect(subtotalPage, 'subtotal stays on the same page as the last outstanding invoice row').to.equal(lastRowPage);
   });

   it('prints "Bill To" / the letterhead only on page 1; later pages get a short continuation header instead', async () => {
      const rows = Array.from({ length: 35 }, (_, i) => ({ jobID: `J-${i + 1}`, jobDescription: `Job description ${i + 1}`, jobTotal: 100 + i }));
      const total = rows.reduce((acc, row) => acc + row.jobTotal, 0);
      const fixture = baseFixture({ transactions: { transactionRecords: rows, transactionsTotal: total }, invoiceTotal: total, preRetainerInvoiceTotal: total });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);
      expect(pages.length, 'multi-page fixture').to.be.greaterThan(1);

      expect(pages[0], 'page 1 has the Bill To block').to.include('Bill To:');
      expect(pages[0], 'page 1 has no continuation header').to.not.include('(continued)');
      pages.slice(1).forEach((page, i) => {
         expect(page, `page ${i + 2} has no Bill To block`).to.not.include('Bill To:');
         expect(page, `page ${i + 2} has a continuation header`).to.include(`${fixture.invoiceNumber}`);
         expect(page, `page ${i + 2} has a continuation header`).to.include('(continued)');
      });
   });

   it('keeps the totals block (retainer summary + Balance Due) together on one page instead of splitting it', async () => {
      const doc = new PDFDocument({ size: 'A3' });
      const buffers = [];
      const pdfStream = new stream.PassThrough();
      doc.pipe(pdfStream);
      pdfStream.on('data', d => buffers.push(d));

      const preferenceSettings = {
         boldFont: 'Helvetica-Bold',
         normalFont: 'Helvetica',
         lineHeight: 20,
         rightMargin: doc.page.margins.right,
         leftMargin: doc.page.margins.left,
         topMargin: doc.page.margins.top,
         pageWidth: doc.page.width,
         pageHeight: doc.page.height,
         // Just short of the room a 5-line (retainer summary + Balance Due)
         // totals block needs below the standard 25pt gap — forces the
         // "does it fit? no -> move the WHOLE block" branch.
         endOfGroupingHeight: doc.page.height - doc.page.margins.bottom - 25 - 60
      };
      const invoiceDetails = {
         invoiceNumber: 'INV-2026-00099',
         customerContactInformation: { display_name: 'Totals Fixture Customer' },
         retainerAppliedToInvoice: 100,
         remainingRetainer: 900,
         invoiceTotal: 500,
         preRetainerInvoiceTotal: 600,
         retainers: { retainerRecords: [{ retainer_id: 1 }] }
      };

      createTotalsSection(doc, invoiceDetails, preferenceSettings);
      doc.end();
      const pdf = await new Promise((resolve, reject) => {
         pdfStream.on('end', () => resolve(Buffer.concat(buffers)));
         pdfStream.on('error', reject);
      });

      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);
      expect(pages.length, 'the block was pushed to its own page').to.equal(2);
      expect(pages[0].trim(), 'nothing printed on page 1').to.equal('');

      ['Invoice Total Before Retainer/ Pre-Payment: 600.00', 'Retainer/ Pre-Payment Applied to Invoice: 100.00', 'Remaining Retainer/ Pre-Payment: 900.00', 'Balance Due: 500.00'].forEach(
         line => expect(pages[1], `"${line}" on page 2 with the rest of the block`).to.include(line)
      );
   });

   // ── B5-N1: the single-row cap omitted the continuation-page header gap,
   // and only the LAST row's own height (not row + subtotal) was checked
   // against the bottom margin, so a full row could end a page exactly at
   // the margin and strand "Total New Charges" alone under a freshly
   // repeated (otherwise empty) "Professional Services" heading. ──────────

   it('23 ordinary jobs: the subtotal is never printed beneath an empty repeated heading', async () => {
      // The exact row count the reviewer's sweep identified as orphaning the
      // subtotal onto its own page (job 23 landed on page 1, the subtotal on
      // page 2, with nothing else on page 2 above it).
      const rows = Array.from({ length: 23 }, (_, i) => ({ jobID: `JOB_${i + 1}_END`, jobDescription: `Service ${i + 1}`, jobTotal: 100 + i }));
      const total = rows.reduce((acc, row) => acc + row.jobTotal, 0);
      const fixture = baseFixture({ transactions: { transactionRecords: rows, transactionsTotal: total }, invoiceTotal: total, preRetainerInvoiceTotal: total });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);

      // No page shows the section heading without at least one job row on it.
      pages.forEach((page, i) => {
         if (page.includes('Professional Services')) expect(page, `page ${i + 1}: heading is not orphaned — has a job row too`).to.match(/JOB_\d+_END/);
      });

      const lastRowPage = pages.findIndex(page => page.includes('JOB_23_END'));
      const subtotalPage = pages.findIndex(page => page.includes(`Total New Charges: ${total.toFixed(2)}`));
      expect(lastRowPage, 'last job row found').to.be.at.least(0);
      expect(subtotalPage, 'subtotal is on the SAME page as the last job row, not orphaned on the next one').to.equal(lastRowPage);
   });

   it("refuses the reviewer's 71-line near-max description together with its required subtotal", async () => {
      const doc = new PDFDocument({ size: 'A3' });
      const buffers = [];
      const pdfStream = new stream.PassThrough();
      doc.pipe(pdfStream);
      pdfStream.on('data', d => buffers.push(d));
      // Drain so the render can finish even though the call throws before we care about the buffer.
      pdfStream.on('error', () => {});

      const preferenceSettings = {
         boldFont: 'Helvetica-Bold',
         normalFont: 'Helvetica',
         lineHeight: 20,
         rightMargin: doc.page.margins.right,
         leftMargin: doc.page.margins.left,
         topMargin: doc.page.margins.top,
         pageWidth: doc.page.width,
         // Mid-page start, same as a section that isn't first on the statement.
         endOfGroupingHeight: 500
      };
      const fixture = baseFixture({
         transactions: {
            // 71 lines measures just over the room actually available on a
            // continuation page (below its own heading, with its subtotal) —
            // the exact boundary the reviewer's probe found the old,
            // continuation-gap-blind guard letting through.
            transactionRecords: [{ jobID: 'TALL-JOB', jobDescription: Array(71).fill('Description line').join('\n'), jobTotal: 987.65 }],
            transactionsTotal: 987.65
         }
      });

      expect(() => createChargesSection(doc, fixture, preferenceSettings)).to.throw(/cannot fit on a single statement page with its required subtotal/);
      doc.end();
   });

   // ── B5-N2: a note block taller than the remaining page was handed whole
   // to PDFKit, which silently auto-paginated with no statement/customer
   // header, and a coordinate computed for the old page carried over onto
   // the new one — producing a page with "Notes" and no note text, a
   // continuation page with no header, and a footer-only trailing page. ──

   it('a 100-line note is split across identified continuation pages: every line present, every page headed, footer on the last page, no blank Notes page', async () => {
      const noteLines = Array.from({ length: 100 }, (_, i) => `Note line ${i + 1}`);
      const fixture = baseFixture({ invoiceNote: noteLines.join('\n') });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);
      const pages = pagesOf(raw);

      expect(pages.length, 'note spans more than one page').to.be.greaterThan(1);

      // Every line survives, in full, somewhere in the document.
      // Exact lines, once each, in order — a substring check confuses
      // "Note line 1" with "Note line 10" and would miss dropped lines.
      const renderedLines = [...raw.matchAll(/^\s*(Note line \d+)\s*$/gm)].map(match => match[1]);
      expect(renderedLines, 'every note line exactly once, in order').to.deep.equal(noteLines);

      // Every page is identified: page 1 carries the Bill To block, every
      // later page carries the short "(continued)" statement/customer
      // header — never a page PDFKit added on its own with neither.
      expect(pages[0], 'page 1 has the Bill To block').to.include('Bill To:');
      pages.slice(1).forEach((page, i) => {
         expect(page, `page ${i + 2} has the statement/customer continuation header`).to.include(`${fixture.invoiceNumber}`);
         expect(page, `page ${i + 2} has the statement/customer continuation header`).to.include('(continued)');
      });

      // The "Notes" heading always has at least its first line right there
      // with it — never a page that prints the heading and nothing else.
      const notesHeadingPage = pages.findIndex(page => page.includes('Notes'));
      expect(notesHeadingPage, '"Notes" heading printed').to.be.at.least(0);
      expect(pages[notesHeadingPage], 'the Notes heading is not alone on its page').to.match(/^\s*Note line 1\s*$/m);

      // The interest-statement footer is measured and placed on the LAST
      // page, not wherever PDFKit happened to leave off.
      const footerPage = pages.findIndex(page => page.includes('Balances unpaid for 30 days accrue interest'));
      expect(footerPage, 'footer printed').to.be.at.least(0);
      expect(footerPage, 'footer is on the last page').to.equal(pages.length - 1);
   });

   // ── B5-N3: NULL form_of_payment / payment_reference_number used to
   // interpolate as the literal text "null" once the column moved from
   // PDFKit's own (null-tolerant) argument to a template string. ──────────

   it('a payment with NULL form_of_payment and payment_reference_number renders blank, never the text "null"', async () => {
      const paymentRecords = [
         { payment_id: 1, payment_date: '2026-08-15', invoice_number: 'INV-2026-00090', form_of_payment: null, payment_reference_number: null, payment_amount: '-150.50' },
         { payment_id: 2, payment_date: '2026-08-20', invoice_number: 'INV-2026-00091', form_of_payment: 'Check', payment_reference_number: '9981', payment_amount: '-25.00' }
      ];
      const fixture = baseFixture({ payments: { paymentRecords, paymentTotal: -175.5, paymentsReceivedTotal: -175.5 } });

      const pdf = await createPDF(fixture);
      const raw = extractPdfText(pdf, scratchDir);

      expect(raw, 'the literal text "null" never appears on the statement').to.not.match(/\bnull\b/);
      // The NULL row still renders its non-null fields.
      expect(raw, 'the NULL row\'s date still prints').to.include('08/15/2026');
      expect(raw, 'the NULL row\'s amount still prints').to.include('-150.50');
      // The populated row is unaffected.
      expect(raw, "the populated row's type still prints").to.include('Check');
      expect(raw, "the populated row's reference still prints").to.include('9981');
   });
});
