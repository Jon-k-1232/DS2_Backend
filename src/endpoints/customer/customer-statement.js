/**
 * Customer statement PDF: opening balance, chronological activity (charges,
 * payments, write-offs, reversals) with a running balance, closing balance,
 * and the rolling-balance amount currently due. Built on the audit engine's
 * transaction-based ledger so it reflects every recorded event, billed or not.
 */
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');
const auditService = require('../accountAudit/account-audit-service');
const invoiceService = require('../invoice/invoice-service');
const { auditCustomerLedger } = require('../accountAudit/account-audit-logic');

const fmtMoney = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildStatementData = async (db, accountId, customerId, { start, end }) => db.transaction(async readTrx => {
   await readTrx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const customer = await auditService.getCustomer(readTrx, accountId, customerId);
   if (!customer) throw new Error('No matching customer record found.');

   const [invoices, payments, writeoffs, transactions, retainers, retainerEvents] = await Promise.all([
      auditService.getInvoices(readTrx, accountId, customerId),
      auditService.getPayments(readTrx, accountId, customerId),
      auditService.getWriteoffs(readTrx, accountId, customerId),
      auditService.getTransactions(readTrx, accountId, customerId),
      auditService.getRetainers(readTrx, accountId, customerId),
      auditService.getRetainerEvents(readTrx, accountId, customerId)
   ]);

   const accountInfo = await invoiceService.getAccountPayToInfo(readTrx, accountId);
   const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers, retainerEvents });

   const startDate = start ? dayjs(start) : null;
   const endDate = end ? dayjs(end) : dayjs();

   let openingBalance = 0;
   const events = [];
   audit.ledger.forEach(event => {
      const d = dayjs(event.date);
      if (startDate && d.isBefore(startDate, 'day')) {
         openingBalance = event.running_balance;
         return;
      }
      if (endDate && d.isAfter(endDate, 'day')) return;
      events.push(event);
   });
   const closingBalance = events.length ? events[events.length - 1].running_balance : openingBalance;

   return {
      customer,
      accountInfo,
      audit,
      events,
      openingBalance,
      closingBalance,
      range: {
         start: startDate ? startDate.format('MM/DD/YYYY') : 'account opening',
         end: endDate.format('MM/DD/YYYY')
      }
   };
});

const renderStatementPdf = ({ customer, audit, events, openingBalance, closingBalance, range }, accountInfo = {}) => {
   const doc = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
   const chunks = [];
   doc.on('data', c => chunks.push(c));
   const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

   const pageWidth = doc.page.width;
   const left = 50;
   const right = pageWidth - 50;

   // Header
   doc.font('Helvetica-Bold').fontSize(18).text(accountInfo.account_name || 'James F. Kimmel & Associates', left, 50);
   doc.font('Helvetica').fontSize(10).text(`Statement of Account — ${range.start} through ${range.end}`, left, doc.y + 2);
   doc.moveDown(0.5);
   doc.font('Helvetica-Bold').fontSize(12).text(customer.display_name || customer.customer_name || customer.business_name, left, doc.y + 6);
   doc.font('Helvetica').fontSize(9).fillColor('#444')
      .text(`Generated ${dayjs().format('MM/DD/YYYY')} · ${Number(audit.totals.audit_balance) < 0 ? 'Credit balance (no payment due)' : 'Current amount due (rolling balance)'}: ${fmtMoney(audit.totals.audit_balance)}`, left, doc.y + 2)
      .fillColor('#000');

   // Column layout
   const cols = { date: left, desc: left + 70, charge: right - 210, credit: right - 140, balance: right - 70 };
   const drawHeaderRow = y => {
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Date', cols.date, y);
      doc.text('Description', cols.desc, y);
      doc.text('Charges', cols.charge, y, { width: 65, align: 'right' });
      doc.text('Credits', cols.credit, y, { width: 65, align: 'right' });
      doc.text('Balance', cols.balance, y, { width: 65, align: 'right' });
      doc.moveTo(left, y + 12).lineTo(right, y + 12).lineWidth(0.5).stroke();
      return y + 18;
   };

   let y = drawHeaderRow(doc.y + 14);

   doc.font('Helvetica').fontSize(9);
   doc.text(`Opening balance`, cols.desc, y);
   doc.font('Helvetica-Bold').text(fmtMoney(openingBalance), cols.balance, y, { width: 65, align: 'right' });
   y += 16;
   doc.font('Helvetica');

   const bottomLimit = doc.page.height - 70;
   events.forEach(event => {
      const descWidth = cols.charge - cols.desc - 8;
      let remaining = event.description || '';
      let first = true;
      do {
         if (y + 18 > bottomLimit) { doc.addPage(); y = drawHeaderRow(60); doc.font('Helvetica').fontSize(9); }
         const room = bottomLimit - y - 2;
         let length = remaining.length;
         if (doc.heightOfString(remaining, {width:descWidth}) > room) {
            // Split a long reason across table pages instead of letting PDFKit
            // advance pages underneath the date/amount columns.
            let lo=1, hi=length;
            while(lo<hi) { const mid=Math.ceil((lo+hi)/2); if(doc.heightOfString(remaining.slice(0,mid),{width:descWidth})<=room)lo=mid;else hi=mid-1; }
            length=lo;
            const space=remaining.lastIndexOf(' ',length); if(space>length/2)length=space;
         }
         const chunk=remaining.slice(0,length); remaining=remaining.slice(length).trimStart();
         const rowHeight=Math.max(13,doc.heightOfString(chunk,{width:descWidth})+2);
         doc.text(first ? dayjs(event.date).format('MM/DD/YY') : 'continued',cols.date,y,{width:65});
         doc.text(chunk,cols.desc,y,{width:descWidth});
         if(!remaining) {
            if(event.charge)doc.text(fmtMoney(event.charge),cols.charge,y,{width:65,align:'right'});
            if(event.credit)doc.text(fmtMoney(event.credit),cols.credit,y,{width:65,align:'right'});
            doc.text(fmtMoney(event.running_balance),cols.balance,y,{width:65,align:'right'});
         }
         y+=rowHeight; first=false;
         if(remaining) { doc.addPage(); y=drawHeaderRow(60); doc.font('Helvetica').fontSize(9); }
      } while(remaining);
   });

   if (y + 40 > bottomLimit) {
      doc.addPage();
      y = 60;
   }
   doc.moveTo(left, y + 2).lineTo(right, y + 2).lineWidth(0.5).stroke();
   y += 10;
   doc.font('Helvetica-Bold').fontSize(10);
   doc.text('Closing balance (transaction basis)', cols.desc, y);
   doc.text(fmtMoney(closingBalance), cols.balance - 10, y, { width: 75, align: 'right' });
   y += 16;
   doc.font('Helvetica').fontSize(8).fillColor('#444');
   doc.text(
      'Transaction basis: work charges minus payments and adjustments, by date performed. The current amount due above follows the billing system (rolling statement balance) and may differ until unbilled work is invoiced.',
      cols.desc,
      y,
      { width: right - cols.desc }
   );
   doc.fillColor('#000');

   doc.end();
   return done;
};

module.exports = { buildStatementData, renderStatementPdf };
