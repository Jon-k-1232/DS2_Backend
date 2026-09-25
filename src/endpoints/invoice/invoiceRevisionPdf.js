'use strict';
const PDFDocument = require('pdfkit');
// A revision republishes frozen evidence with an explicit correction schedule.
// It never re-queries live work/prices/contact details to rebuild the old bill.
function revisionPdf({ issue, revision, originalAmount, corrections, retainerCancellations = [], revisedAmount }) {
   return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: true });
      const chunks = [];
      doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
      const money = n => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      const line = (text, size = 10) => { if (doc.y > 680) doc.addPage(); doc.fontSize(size).fillColor('#172235').text(String(text), { width: 516 }).moveDown(0.5); };
      const payload = issue.payload || {};
      line(`${issue.invoice_number} - REVISION ${revision}`, 19);
      line('Bounced payment correction - issued for reprint / resend', 12);
      line(payload.customerContactInformation?.display_name || `Customer ${issue.customer_id}`, 12);
      line(`Original issue: ${new Date(issue.issued_at).toISOString().slice(0, 10)}`);
      line('This revision retains the original statement and corrects only the receipts listed below. Send this correction with the enclosed unchanged original PDF.');
      line(`Original issued ${Number(originalAmount) < 0 ? 'credit balance' : 'amount due'}: ${money(originalAmount)}`, 12);
      corrections.forEach(c => line(`Payment #${c.payment_id} reversed by entry #${c.reversal_id}: +${money(c.amount)}. ${c.reason}`));
      retainerCancellations.forEach(c => line(`Overpayment credit cancelled: ${money(c.amount)} from retainer #${c.retainer_id} (correction #${c.correction_retainer_id}). This credit was never received; it is no longer available.`));
      line(`Revised issued ${Number(revisedAmount) < 0 ? 'credit balance' : 'amount due'}: ${money(revisedAmount)}`, 15);
      if (Number(revisedAmount) < 0) line('No payment due — this credit carries forward.');
      line('Payments or work recorded after this statement are separate account activity. Consult the current account balance before collecting payment.');
      line('Original statement details (unchanged)', 14);
      const summaries = [ ['Beginning balance', payload.outstandingInvoices?.outstandingInvoiceTotal], ['Charges', payload.transactions?.transactionsTotal],
         ['Payments included in calculation', payload.payments?.paymentTotal], ['Write-offs included in calculation', payload.writeOffs?.writeOffTotal], ['Original retainer shown (before corrections above)', payload.retainers?.retainerTotal] ];
      summaries.forEach(([label, amount]) => { if (amount != null) line(`${label}: ${money(amount)}`); });
      const groups = [ ['Work', payload.transactions?.allTransactionRecords, 'total_transaction'], ['Receipts', payload.payments?.allPaymentRecords, 'payment_amount'],
         ['Write-offs', [...new Map([...(payload.writeOffs?.allWriteOffRecords || []), ...(payload.writeOffs?.writeOffRecords || [])].map(r=>[r.writeoff_id,r])).values()], 'writeoff_amount'] ];
      groups.forEach(([title, rows, amount]) => {
         if (!rows?.length) return;
         line(title, 12);
         rows.forEach(r => line(`#${r.transaction_id || r.payment_id || r.writeoff_id}  ${money(r[amount] || 0)}  ${r.description || r.note || r.notes || r.work_description || ''}`));
      });
      if (payload.legacy) line('Historical statement: the archived original PDF supplies the full original itemization. This correction schedule must accompany that original.');
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
         doc.switchToPage(i); doc.fontSize(8).fillColor('#516074').text(`${issue.invoice_number} - Revision ${revision} | Page ${i + 1} of ${pages.count}`, 48, 735, { lineBreak: false });
      }
      doc.end();
   });
}
module.exports = { revisionPdf };
