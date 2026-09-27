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

   let accountInfo = await invoiceService.getAccountPayToInfo(readTrx, accountId);
   accountInfo = await require('../billingEntities/invoice-entity').letterhead(readTrx,accountId,accountInfo);
   const corrections=await auditService.getCorrections(readTrx,accountId,customerId);
   const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers, retainerEvents,corrections });

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
   const receivables=await require('../payments/receivables-report').read(readTrx,accountId,customerId,{asOf:endDate.format('YYYY-MM-DD'),...(startDate?{start:startDate.format('YYYY-MM-DD')}:{})});
   const closingBalance = events.length ? events[events.length - 1].running_balance : openingBalance;

   const entityStatements=audit.by_entity ? await Promise.all(audit.by_entity.map(async section=>{
      const entity=await readTrx('billing_entities').where({account_id:accountId,billing_entity_id:section.billing_entity_id}).first();
      let opening=0;const lines=[];
      for(const event of section.ledger){const d=dayjs(event.date);if(startDate && d.isBefore(startDate,'day'))opening=event.running_balance;else if(!d.isAfter(endDate,'day'))lines.push(event);}
      return {customer,audit:section,receivables:{...receivables,sections:receivables.sections.filter(r=>r.billing_entity_id===section.billing_entity_id)},events:lines,openingBalance:opening,closingBalance:lines.length?lines[lines.length-1].running_balance:opening,
       billingEntity:entity,range:{start:startDate?startDate.format('MM/DD/YYYY'):'account opening',end:endDate.format('MM/DD/YYYY')}};
   })) : null;
   return {
      entityStatements,receivables,
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

const renderStatementPdf = (data, accountInfo = {}, targetDocument = null) => {
   if(data.entityStatements?.length)return renderGroupedStatements(data,accountInfo);
   const {customer,audit,events,openingBalance,closingBalance,range,billingEntity}=data;
   const doc = targetDocument || new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
   const chunks = [];
   const done = targetDocument ? null : new Promise((resolve,reject) => {
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error',reject);
   });

   const pageWidth = doc.page.width;
   const left = 50;
   const right = pageWidth - 50;

   // Header
   doc.font('Helvetica-Bold').fontSize(18).text(accountInfo.account_name || 'James F. Kimmel & Associates', left, 50);
   doc.font('Helvetica').fontSize(10).text(`Statement of Account — ${range.start} through ${range.end}`, left, doc.y + 2);
   if(billingEntity)doc.font('Helvetica-Bold').text(`Business: ${billingEntity.legal_name}`,left,doc.y+4);
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

   if(data.receivables){
      y=doc.y+18;
      const line=(value,bold=false)=>{if(y>bottomLimit-25){doc.addPage();y=60;}doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(9).text(value,left,y,{width:right-left});y=doc.y+7;};
      line(`Receivables as of ${data.receivables.asOf}; recorded through ${data.receivables.recordedThrough}`,true);
      for(const section of data.receivables.sections){
         line(`${section.business}: billed balance ${fmtMoney(section.billed_balance)}; issued credit ${fmtMoney(section.issued_statement_credit)}; held receipt credit ${fmtMoney(section.held_receipt_credit)}`,true);
         const a=section.aging;line(`Original invoice ages: 0–30 ${fmtMoney(a.bucket_0_30)} / 31–60 ${fmtMoney(a.bucket_31_60)} / 61–90 ${fmtMoney(a.bucket_61_90)} / over 90 ${fmtMoney(a.bucket_over_90)} / unknown ${fmtMoney(a.bucket_unknown)}`);
         line('Cash received (each receipt once; allocations are already included in activity above)',true);
         for(const r of section.receipts)line(`Receipt #${r.receipt_id} · ${require('../payments/receipt-values').day(r.receipt_date)} · ${r.method} ${r.reference || ''} · ${fmtMoney(r.amount)}${r.source_kind==='manual'?'':' · historical/legacy source'}`);
         for(const o of section.obligations)line(`${o.invoice_number || 'Original invoice #'+o.original_invoice_id} · ${o.obligation_date?require('../payments/receipt-values').day(o.obligation_date):'Unknown legacy age'} · remaining ${fmtMoney(o.openCents/100)}`);
      }
   }
   if (!targetDocument) doc.end();
   return done;
};

async function renderGroupedStatements(data,accountInfo){
   const doc=new PDFDocument({size:'LETTER',margin:50,bufferPages:true}),chunks=[];
   const done=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
   for(const [index,statement] of data.entityStatements.entries()){
      if(index)doc.addPage();
      renderStatementPdf(statement,{...accountInfo,account_name:statement.billingEntity.legal_name},doc);
   }
   doc.end();return done;
}
module.exports = { buildStatementData, renderStatementPdf };
