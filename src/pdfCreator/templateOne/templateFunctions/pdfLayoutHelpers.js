/**
 * Shared pagination helpers for the templateOne statement PDF.
 *
 * The legacy section renderers placed every heading/row at a Y coordinate
 * computed by simple arithmetic (`groupHeight + lineHeight * index`), with no
 * knowledge of how tall the text actually rendered and no check against the
 * page's bottom margin. A long wrapped cell silently overlapped the next row,
 * and a section that ran past the bottom of the page kept "printing" below
 * the visible area — or, once PDFKit's own layout forced a page somewhere
 * unrelated, resumed on the new page at the same fixed offset with no
 * heading, splitting one row's data across two pages.
 *
 * Every row-shaped section (Beginning Balance, Payments, Professional
 * Services, Revisions, Retainers) now goes through `renderTableSection`,
 * which measures each row with `doc.heightOfString` against the column's own
 * bounded width, advances a single running `y` cursor by that measured
 * height, and inserts a page break — repeating the section heading and
 * column headers — whenever the next row (or the closing rule + subtotal)
 * would cross the bottom margin. `startContinuationPage` is also used
 * directly by the totals block and the notes section, which don't have a
 * row/column shape but need the same "don't run off the page" treatment.
 */

// Gap below the short continuation header before section content resumes.
const CONTINUATION_GAP = 20;

/**
 * Starts a new page for statement content that overflowed the previous one.
 * The "Bill To" / letterhead block is only ever drawn once, on page 1 (see
 * templateOneOrchestrator.js); every later page instead gets a short
 * identifying header so a printed or separated page can still be matched
 * back to its statement.
 *
 * @returns {number} the y coordinate where content should resume.
 */
const startContinuationPage = (doc, invoiceDetails, preferenceSettings) => {
   doc.addPage();

   const { invoiceNumber, customerContactInformation = {} } = invoiceDetails;
   const { normalFont, leftMargin, rightMargin, pageWidth, topMargin } = preferenceSettings;
   const customerLabel = customerContactInformation.display_name || customerContactInformation.business_name || customerContactInformation.customer_name || '';

   doc.font(normalFont)
      .fontSize(9)
      .fillColor('#555555')
      .text(`Statement ${invoiceNumber}${customerLabel ? ` — ${customerLabel}` : ''} (continued)`, leftMargin, topMargin, {
         width: pageWidth - leftMargin - rightMargin
      });

   // Reset state a section heading relies on.
   doc.fillColor('#000000').fontSize(12);

   return topMargin + CONTINUATION_GAP;
};

/**
 * How tall one row will actually render, measured against each column's own
 * bounded width — not a fixed lineHeight. `+4` gives wrapped rows a little
 * breathing room before the next row starts.
 */
const measureRowHeight = (doc, columns, row, { normalFont, lineHeight }) => {
   doc.font(normalFont).fontSize(12);
   const tallest = columns.reduce((max, column) => Math.max(max, doc.heightOfString(column.cell(row), { width: column.width })), 0);
   return Math.max(lineHeight, tallest) + 4;
};

/**
 * Renders one "title / column headers / rule / rows / rule / subtotal"
 * section, paginating as needed. Mutates preferenceSettings.endOfGroupingHeight
 * to the y position below the printed subtotal so the next section can start
 * there, exactly like the legacy per-section code did.
 *
 * @param {object} config
 * @param {string} config.title - bold section heading (e.g. "Payments")
 * @param {Array<{header:string, x:number, width:number, align?:string, cell:(row)=>string}>} config.columns
 * @param {Array<object>} config.rows
 * @param {string[]} config.subtotalLines - already-formatted, right-aligned line(s) printed after the closing rule (e.g. ["Total New Charges: 100.00"])
 * @param {number} [config.startY] - forced first-heading y (defaults to endOfGroupingHeight + 25)
 * @param {(row:object)=>string} [config.describeRow] - short row identifier used in the "row too tall" error
 */
const renderTableSection = (doc, invoiceDetails, preferenceSettings, config) => {
   const { boldFont, normalFont, lineHeight, leftMargin, rightMargin, pageWidth, topMargin } = preferenceSettings;
   const { title, columns, rows, subtotalLines, startY, describeRow } = config;
   const right = pageWidth - rightMargin;
   const bottom = doc.page.height - doc.page.margins.bottom;
   // Title line + column header line + gap before the rule's gap — same shape as the legacy fixed layout.
   const headingHeight = lineHeight * 2 + 10;
   const subtotalBlockHeight = 10 + subtotalLines.length * lineHeight;
   // How much room a lone row gets below its own heading on a fresh page.
   // Every "fresh page" a row can actually land on is produced by
   // startContinuationPage, which itself prints a short header and returns a
   // start position CONTINUATION_GAP below the top margin — omitting that
   // gap here let a row measure as "fits on a page" while still overflowing
   // once really placed on the continuation page it lands on.
   const maxSingleRowHeight = bottom - topMargin - CONTINUATION_GAP - headingHeight;

   // Measure every row once, up front. The LAST row must carry the closing
   // rule + subtotal block with it wherever it lands — otherwise a row can
   // fill a page right up to the margin, only for the subtotal to be pushed
   // alone onto the next page under a freshly repeated (and otherwise empty)
   // heading. Non-last rows only need to fit themselves.
   const heights = rows.map(row => measureRowHeight(doc, columns, row, preferenceSettings));
   const required = heights.map((height, index) => height + (index === rows.length - 1 ? subtotalBlockHeight : 0));

   required.forEach((requiredHeight, index) => {
      if (requiredHeight > maxSingleRowHeight) {
         const which = describeRow ? describeRow(rows[index]) : 'row';
         throw new Error(`${title}: ${which} cannot fit on a single statement page with its required subtotal. Shorten it before finalizing.`);
      }
   });

   let y = startY ?? preferenceSettings.endOfGroupingHeight + 25;

   const drawHeading = () => {
      doc.font(boldFont).fontSize(14).text(title, leftMargin, y);
      doc.font(normalFont).fontSize(12);
      columns.forEach(column => doc.text(column.header, column.x, y + lineHeight, { width: column.width, align: column.align || 'left' }));
      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(leftMargin, y + lineHeight * 2)
         .lineTo(right, y + lineHeight * 2)
         .stroke();
      y += headingHeight;
   };

   // Not even the heading AND whatever must immediately follow it (the first
   // row, or — for an empty section — the subtotal) fits below the inherited
   // y: a heading is never printed with nothing under it.
   if (y + headingHeight + (required[0] ?? subtotalBlockHeight) > bottom) y = startContinuationPage(doc, invoiceDetails, preferenceSettings);
   drawHeading();

   rows.forEach((row, index) => {
      const height = heights[index];

      if (y + required[index] > bottom) {
         y = startContinuationPage(doc, invoiceDetails, preferenceSettings);
         drawHeading();
      }

      doc.font(normalFont).fontSize(12);
      columns.forEach(column => doc.text(column.cell(row), column.x, y, { width: column.width, align: column.align || 'left' }));
      y += height;
   });

   // The last row's required[] already reserved room for this rule + the
   // subtotal below, so by construction it always fits here — no separate
   // "does the subtotal fit" check (and possible orphaning) needed.
   doc.lineCap('butt').lineWidth(1).moveTo(leftMargin, y).lineTo(right, y).stroke();
   y += 10;

   doc.font(normalFont).fontSize(12);
   subtotalLines.forEach(line => {
      doc.text(line, leftMargin, y, { width: right - leftMargin, align: 'right' });
      y += lineHeight;
   });

   preferenceSettings.endOfGroupingHeight = y;
};

module.exports = { startContinuationPage, measureRowHeight, renderTableSection };
