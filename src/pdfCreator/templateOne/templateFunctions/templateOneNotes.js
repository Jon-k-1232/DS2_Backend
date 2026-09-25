const { startContinuationPage } = require('./pdfLayoutHelpers');

const createNotesSection = (doc, invoiceDetails, preferenceSettings) => {
   const { accountBillingInformation } = invoiceDetails;
   const invoiceNote = String(invoiceDetails.invoiceNote ?? '');
   const globalInvoiceNote = String(invoiceDetails.globalInvoiceNote ?? '');
   const { account_statement, account_interest_statement } = accountBillingInformation;
   const { normalFont, boldFont, lineHeight, leftMargin, rightMargin, pageWidth } = preferenceSettings;

   const width = pageWidth - (leftMargin + 10) - rightMargin;
   const bottom = doc.page.height - doc.page.margins.bottom;

   let y = preferenceSettings.endOfGroupingHeight;

   const nextPage = () => {
      y = startContinuationPage(doc, invoiceDetails, preferenceSettings);
   };

   const heightOf = text => {
      doc.font(normalFont).fontSize(12);
      return doc.heightOfString(text, { width });
   };

   // Prints `text` starting at the current y, splitting it across as many
   // IDENTIFIED continuation pages as needed (every break goes through
   // startContinuationPage — never PDFKit's own silent auto-pagination,
   // which would insert a page with no statement/customer header). A binary
   // search finds the longest prefix that fits in the room left on the
   // current page; the cut point then backs up to the last word boundary at
   // or before that prefix so a word is never split across pages, falling
   // back to the raw character cut only when a single "word" alone is wider
   // than the page. Either way every character is printed exactly once —
   // nothing is ever dropped.
   const drawBlock = value => {
      let text = String(value ?? '');
      while (text.length) {
         const wholeHeight = heightOf(text);
         if (y + wholeHeight <= bottom) {
            doc.text(text, leftMargin + 10, y, { width });
            y += wholeHeight;
            return;
         }

         const available = bottom - y;
         if (heightOf(text[0]) > available) {
            // Not even one character fits where we are — move to a fresh
            // page before measuring further, rather than ever emit a
            // zero-length fragment.
            nextPage();
            continue;
         }

         // Find the longest prefix (in characters) that fits in `available`.
         let low = 1;
         let high = text.length;
         while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (heightOf(text.slice(0, mid)) <= available) low = mid;
            else high = mid - 1;
         }

         const prefix = text.slice(0, low);
         const boundary = prefix.search(/\s+\S*$/);
         const cut = boundary > 0 ? boundary + 1 : low;

         doc.text(text.slice(0, cut), leftMargin + 10, y, { width });
         text = text.slice(cut);
         nextPage();
      }
   };

   drawBlock(account_statement);

   if (invoiceNote || globalInvoiceNote) {
      y += lineHeight;

      // Keep the "Notes" heading together with at least one line of what
      // follows it — never a heading alone at the bottom of a page.
      if (y + lineHeight + heightOf('M') > bottom) nextPage();
      doc.font(boldFont).fontSize(12).text('Notes', leftMargin + 10, y);
      y += lineHeight;

      // Conditionally render globalInvoiceNote if it has content.
      if (globalInvoiceNote.length > 0) drawBlock(globalInvoiceNote);
      drawBlock(invoiceNote);
   }

   if (account_interest_statement) {
      doc.font(normalFont).fontSize(8);
      const footerWidth = pageWidth - leftMargin - rightMargin;
      const footerHeight = doc.heightOfString(account_interest_statement, { width: footerWidth });
      // Measured and placed on the LAST page: if the notes content ran
      // right up to (or past) where the footer belongs, give it a fresh
      // page instead of overlapping or silently falling off the bottom.
      if (y + footerHeight + 4 > bottom) nextPage();
      doc.font(normalFont)
         .fontSize(8)
         .text(account_interest_statement, leftMargin, bottom - footerHeight, { width: footerWidth, align: 'center' });
   }
};

module.exports = { createNotesSection };
