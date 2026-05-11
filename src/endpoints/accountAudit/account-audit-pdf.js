// Server-side PDF rendering for an account audit. Streams to a Buffer so it
// can be uploaded to S3 in one shot. Mirrors the on-screen print view but is
// authoritative — this is the artifact that gets saved.

const stream = require('stream');
const PDFDocument = require('../../pdfCreator/pdfkit-tables');

const fmt = n => {
   const v = Number(n);
   if (!Number.isFinite(v)) return '$0.00';
   const sign = v < 0 ? '-' : '';
   const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
   return `${sign}$${abs}`;
};

const fmtDateTime = iso => {
   if (!iso) return '—';
   const d = new Date(iso);
   return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const severityLabel = sev => (sev || 'low').toUpperCase();
const severityColor = sev => {
   if (sev === 'high') return '#c62828';
   if (sev === 'medium') return '#ef6c00';
   return '#616161';
};

const buildAuditPdf = ({ audit, summary }) => {
   return new Promise((resolve, reject) => {
      try {
         const doc = new PDFDocument({ size: 'LETTER', margin: 36, bufferPages: true });
         const buffers = [];
         const pass = new stream.PassThrough();
         doc.pipe(pass);
         pass.on('data', d => buffers.push(d));
         pass.on('end', () => resolve(Buffer.concat(buffers)));
         pass.on('error', reject);

         const customer = summary.customer || {};
         const totals = summary.totals || {};
         const methodology = summary.methodology || {};
         const breakdown = summary.invoice_breakdown || [];
         const discrepancies = audit.discrepancies || [];
         const ledger = audit.ledger || [];

         // Header
         doc.fontSize(18).font('Helvetica-Bold').text('Account Audit Report');
         doc
            .fontSize(11)
            .font('Helvetica')
            .text(`${customer.display_name || ''}${customer.customer_id ? ` (ID ${customer.customer_id})` : ''}`);
         doc.moveDown(0.25);
         doc.fontSize(9).fillColor('#555').text(
            `Audit #${audit.audit_id} · Run by ${audit.run_by_display_name} · ${fmtDateTime(audit.created_at)}`
         );
         doc.fillColor('#000');
         doc.moveDown(1);

         // Narrative block (if present)
         if (audit.narrative) {
            doc.fontSize(11).font('Helvetica-Bold').text('Executive summary');
            doc.fontSize(10).font('Helvetica').fillColor('#222').text(audit.narrative, { align: 'left' });
            doc.fillColor('#000');
            const findings = audit.narrative_findings || [];
            const actions = audit.narrative_actions || [];
            if (findings.length) {
               doc.moveDown(0.5);
               doc.font('Helvetica-Bold').fontSize(10).text('Key findings');
               doc.font('Helvetica').fontSize(9);
               findings.forEach(f => doc.text(`• ${f}`, { indent: 6 }));
            }
            if (actions.length) {
               doc.moveDown(0.5);
               doc.font('Helvetica-Bold').fontSize(10).text('Recommended actions');
               doc.font('Helvetica').fontSize(9);
               actions.forEach(a => doc.text(`• ${a}`, { indent: 6 }));
            }
            doc.moveDown(1);
         }

         // Totals
         doc.fontSize(12).font('Helvetica-Bold').text('Lifetime totals');
         doc.moveDown(0.25);
         doc.fontSize(10).font('Helvetica');
         const row = (label, value, bold = false) => {
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
            const y = doc.y;
            doc.text(label, 36, y, { width: 360 });
            doc.text(value, 396, y, { width: 180, align: 'right' });
            doc.moveDown(0.2);
         };
         row('Total invoiced (parent invoices)', fmt(totals.total_invoiced));
         row('Total paid (lifetime |payments|)', fmt(totals.total_paid));
         row('Total transactions', fmt(totals.total_transactions));
         row('Total write-offs', fmt(totals.total_writeoffs));
         doc.moveDown(0.5);

         doc.fontSize(12).font('Helvetica-Bold').text('Audit balance breakdown');
         doc.moveDown(0.25);
         doc.fontSize(10);
         row('Outstanding on invoices (latest snapshot per chain)', fmt(totals.outstanding_invoices));
         row('+ Unbilled billable transactions', fmt(totals.unbilled_billable));
         row('− Unbilled |payments|', fmt(totals.unbilled_payments));
         doc.moveTo(36, doc.y).lineTo(576, doc.y).stroke();
         doc.moveDown(0.2);
         row('Audit balance (matches app)', fmt(totals.audit_balance), true);
         row('− Unbilled write-offs (pending adjustment)', fmt(totals.unbilled_writeoffs));
         doc.moveTo(36, doc.y).lineTo(576, doc.y).stroke();
         doc.moveDown(0.2);
         row('Strict ledger balance (after pending writeoffs applied)', fmt(totals.strict_ledger_balance), true);
         doc.moveDown(0.5);

         // Methodology
         doc.fontSize(11).font('Helvetica-Bold').text('Methodology');
         doc.fontSize(9).font('Helvetica').fillColor('#444');
         doc.text(methodology.description || '', { align: 'left' });
         if (methodology.audit_balance_formula) {
            doc.text(`Audit balance: ${methodology.audit_balance_formula}`);
         }
         if (methodology.strict_ledger_formula) {
            doc.text(`Strict ledger: ${methodology.strict_ledger_formula}`);
         }
         if (methodology.net_position_formula) {
            doc.text(`Net position: ${methodology.net_position_formula}`);
         }
         doc.fillColor('#000');
         doc.moveDown(0.75);

         // Invoice breakdown table
         if (breakdown.length) {
            doc.addPage();
            doc.fontSize(12).font('Helvetica-Bold').text('Per-invoice breakdown');
            doc.moveDown(0.5);
            doc.fontSize(8).font('Helvetica');

            const headers = ['Invoice', 'Date', 'Total', 'Paid', 'Writeoffs', 'Expected', 'Actual', 'Drift', 'Paid?'];
            const colX = [36, 130, 195, 245, 295, 350, 400, 450, 510];
            const colW = [94, 65, 50, 50, 55, 50, 50, 60, 65];
            const yHead = doc.y;
            doc.font('Helvetica-Bold');
            headers.forEach((h, i) => {
               const align = i >= 2 && i <= 7 ? 'right' : 'left';
               doc.text(h, colX[i], yHead, { width: colW[i], align });
            });
            doc.moveTo(36, yHead + 12).lineTo(576, yHead + 12).stroke();
            doc.font('Helvetica');
            let y = yHead + 16;
            breakdown.forEach(b => {
               const drift = Number(b.expected_remaining) - Number(b.actual_remaining_used);
               const driftSig = Math.abs(drift) >= 0.01;
               doc.fillColor(driftSig ? '#c62828' : '#000');
               doc.text(b.invoice_number || '—', colX[0], y, { width: colW[0] });
               doc.fillColor('#000');
               doc.text(b.invoice_date || '—', colX[1], y, { width: colW[1] });
               doc.text(fmt(b.parent_total_amount_due), colX[2], y, { width: colW[2], align: 'right' });
               doc.text(fmt(b.paid_against_invoice), colX[3], y, { width: colW[3], align: 'right' });
               doc.text(fmt(b.writeoffs_against_invoice), colX[4], y, { width: colW[4], align: 'right' });
               doc.text(fmt(b.expected_remaining), colX[5], y, { width: colW[5], align: 'right' });
               doc.text(fmt(b.actual_remaining_used), colX[6], y, { width: colW[6], align: 'right' });
               doc.fillColor(driftSig ? '#c62828' : '#000');
               doc.text(fmt(drift), colX[7], y, { width: colW[7], align: 'right' });
               doc.fillColor('#000');
               doc.text(b.is_paid_in_full_db ? 'Yes' : 'No', colX[8], y, { width: colW[8] });
               y += 14;
               if (y > 720) {
                  doc.addPage();
                  y = 50;
               }
               doc.y = y;
            });
         }

         // Discrepancies
         doc.addPage();
         doc.fontSize(12).font('Helvetica-Bold').text(`Discrepancies (${discrepancies.length})`);
         doc.moveDown(0.5);
         if (discrepancies.length === 0) {
            doc.fontSize(10).font('Helvetica').text('None detected. Customer ledger is internally consistent.');
         } else {
            discrepancies.forEach(d => {
               doc
                  .fontSize(10)
                  .font('Helvetica-Bold')
                  .fillColor(severityColor(d.severity))
                  .text(
                     `[${severityLabel(d.severity)}] ${(d.kind || '').replace(/_/g, ' ')}` +
                        (d.invoice_number ? ` — ${d.invoice_number}` : '') +
                        (typeof d.diff_amount === 'number' ? ` (${fmt(d.diff_amount)})` : '')
                  );
               doc.fillColor('#000').font('Helvetica').fontSize(9).text(d.detail || '');
               doc.moveDown(0.4);
            });
         }

         // Ledger
         doc.addPage();
         doc.fontSize(12).font('Helvetica-Bold').text(`Chronological ledger (${ledger.length} entries)`);
         doc.moveDown(0.5);
         doc.fontSize(7).font('Helvetica');
         const lHeaders = ['Date', 'Type', 'Description', 'Charge', 'Credit', 'Running'];
         const lColX = [36, 90, 175, 410, 460, 515];
         const lColW = [52, 80, 230, 50, 50, 60];
         const yH = doc.y;
         doc.font('Helvetica-Bold');
         lHeaders.forEach((h, i) => {
            const align = i >= 3 ? 'right' : 'left';
            doc.text(h, lColX[i], yH, { width: lColW[i], align });
         });
         doc.moveTo(36, yH + 10).lineTo(576, yH + 10).stroke();
         doc.font('Helvetica');
         let ly = yH + 14;
         ledger.forEach(e => {
            doc.text(e.date || '', lColX[0], ly, { width: lColW[0] });
            doc.text((e.type || '').replace(/_/g, ' '), lColX[1], ly, { width: lColW[1] });
            const desc = (e.description || '').slice(0, 95);
            doc.text(desc, lColX[2], ly, { width: lColW[2] });
            doc.text(e.charge ? fmt(e.charge) : '', lColX[3], ly, { width: lColW[3], align: 'right' });
            doc.text(e.credit ? fmt(e.credit) : '', lColX[4], ly, { width: lColW[4], align: 'right' });
            doc.text(fmt(e.running_balance), lColX[5], ly, { width: lColW[5], align: 'right' });
            ly += 10;
            if (ly > 740) {
               doc.addPage();
               ly = 50;
            }
            doc.y = ly;
         });

         // Footer note
         doc.moveDown(2);
         doc.fontSize(8).fillColor('#666').text(
            'Independent audit — recomputed from raw rows in customer_invoices, customer_payments, customer_writeoffs, customer_transactions. ' +
               'Does not share code with the in-app balance engine.'
         );

         doc.end();
      } catch (err) {
         reject(err);
      }
   });
};

module.exports = { buildAuditPdf };
