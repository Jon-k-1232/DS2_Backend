const dayjs = require('dayjs');
const writeOffsService = require('./writeOffs-service');
const invoiceService = require('../invoice/invoice-service');
const {
   getCurrentChainTargets,
   pickCurrentChainTarget,
   getInvoiceRow,
   getLatestChainRow,
   getNewestParentInvoice,
   applyParentMirror,
   setSnapshotRemaining,
   updateObjectsWithRemainingAmounts
} = require('../payments/payment-logic');
const {
   round2,
   withTransaction,
   ledgerNow,
   ruleError,
   lockCustomerLedger,
   lockCustomerLedgerForRow,
   isLedgerRowBilled,
   appendNoteMarker,
   preserveSystemMarkers
} = require('../payments/ledger-helpers');

const WRITEOFFS = 'customer_writeoffs';
const BILLED_MESSAGE = 'Write-off is attached to an invoice that has already been billed and cannot be deleted or modified.';

/**
 * Billed = the write-off's ledger event (its invoice snapshot, or the write-off
 * row itself for job-level write-offs) was written at or before the customer's
 * newest parent invoice row — compared in SQL (isLedgerRowBilled), so a
 * microsecond tie is decided exactly like the billing engine's statement gate.
 * The customer comes from the STORED row.
 */
const loadUnbilledWriteOff = async (trx, accountId, writeoffId) => {
   await lockCustomerLedgerForRow(trx, accountId, WRITEOFFS, 'writeoff_id', writeoffId, 'Unable to find write-off record.');
   const [stored] = await writeOffsService.getSingleWriteOff(trx, writeoffId, accountId);

   const linkedRow = stored.customer_invoice_id ? await getInvoiceRow(trx, accountId, stored.customer_invoice_id) : undefined;
   const newestParent = await getNewestParentInvoice(trx, accountId, stored.customer_id);
   const billedAnchor = linkedRow ? { table: 'customer_invoices', id: linkedRow.customer_invoice_id } : { table: WRITEOFFS, id: stored.writeoff_id };
   if (await isLedgerRowBilled(trx, accountId, billedAnchor, newestParent)) {
      throw ruleError(BILLED_MESSAGE, 423);
   }
   if (linkedRow && Number(linkedRow.customer_id) !== Number(stored.customer_id)) {
      throw ruleError(`Write-off #${stored.writeoff_id} is linked to invoice ${linkedRow.invoice_number} of a different customer. Contact an administrator to correct the link.`);
   }
   return { stored, linkedRow };
};

/** A job-level write-off must credit a job of the write-off's own customer. */
const assertJobBelongsToCustomer = async (trx, accountId, customerId, jobId) => {
   if (!jobId) return;
   const job = await trx('customer_jobs').select('customer_job_id').where({ account_id: Number(accountId), customer_id: Number(customerId), customer_job_id: Number(jobId) }).first();
   if (!job) throw ruleError('The selected job does not belong to this customer. Re-select the job.');
};

/** Only the latest snapshot on a chain may change — later snapshots build on it. */
const assertLatestOnChain = async (trx, accountId, linkedRow, verb) => {
   const latestChild = await getLatestChainRow(trx, accountId, linkedRow.parent_invoice_id);
   if (latestChild && latestChild.customer_invoice_id !== linkedRow.customer_invoice_id) {
      throw ruleError(`A newer payment or write-off has been applied to this invoice since this write-off. ${verb} the newer entries first, then retry.`);
   }
};

/**
 * Create a write-off. Invoice-linked write-offs follow the same current-chain
 * rule as payments: a reference to an absorbed (rolled-forward) chain is
 * remapped to the current chain and annotated — a write-off tagged to an
 * absorbed chain never reduced any bill the engine reads. Cross-customer
 * references are refused. Job-level write-offs (no invoice) are credits on the
 * next bill and create no snapshot. Sign convention: writeoff_amount NEGATIVE.
 */
const createWriteOffCore = (db, { accountId, writeOffFields }) =>
   withTransaction(db, async trx => {
      const fields = { ...writeOffFields, account_id: Number(accountId) };
      const amount = round2(Math.abs(Number(fields.writeoff_amount)));
      if (!(amount > 0)) throw ruleError('Write-off amount must be greater than $0.00.', 400);
      fields.writeoff_amount = -amount;
      if (!fields.writeoff_reason) throw ruleError('A write-off reason is required.', 400);
      if (!fields.writeoff_date || !dayjs(fields.writeoff_date).isValid()) throw ruleError('A valid write-off date is required.', 400);

      await lockCustomerLedger(trx, accountId, fields.customer_id);
      // Always checked — not just for job-level write-offs. An invoice-linked
      // write-off can carry a customer_job_id too, and an unchecked one would
      // contaminate another customer's job history while writing under THIS
      // customer's ledger lock.
      await assertJobBelongsToCustomer(trx, accountId, fields.customer_id, fields.customer_job_id);

      let message = 'Successfully created write-off.';

      if (fields.customer_invoice_id) {
         const requestedInvoice = await getInvoiceRow(trx, accountId, fields.customer_invoice_id);
         if (!requestedInvoice) throw ruleError('No matching invoice record found for this write-off.', 404);
         if (Number(requestedInvoice.customer_id) !== Number(fields.customer_id)) {
            throw ruleError(`Invoice ${requestedInvoice.invoice_number} belongs to a different customer than this write-off. Re-select the invoice.`);
         }

         const targets = await getCurrentChainTargets(trx, accountId, fields.customer_id);
         if (!targets.length) throw ruleError('This customer has no invoices to write off against.');

         const { target, remapped } = pickCurrentChainTarget(
            targets,
            requestedInvoice,
            t =>
               `Invoice ${requestedInvoice.invoice_number} was already rolled into a newer statement, and the current invoice ${t.parent.invoice_number} shows $0 remaining — there is nothing left to write off.`
         );
         if (remapped) {
            fields.note = appendNoteMarker(fields.note, `[applied to ${target.parent.invoice_number}; referenced ${requestedInvoice.invoice_number}]`);
            message = `${message} Applied to current invoice ${target.parent.invoice_number} — the referenced invoice ${requestedInvoice.invoice_number} was already rolled into it.`;
         }

         const remaining = round2(target.remaining);
         if (amount > remaining) {
            throw ruleError(
               `Write-off amount exceeds remaining balance on invoice ${target.parent.invoice_number}. Max amount that can be written off on this invoice is $${Math.max(0, remaining)}.`
            );
         }

         // Snapshot on the current chain (latest row carries the authoritative
         // remaining), then the parent mirror. total_write_offs is a NEGATIVE net.
         const { invoiceInsertionObject } = updateObjectsWithRemainingAmounts({ ...target.latestRow }, { payment_amount: fields.writeoff_amount });
         const snapshot = await invoiceService.createInvoice(trx, { ...invoiceInsertionObject, created_at: ledgerNow(trx) });
         fields.customer_invoice_id = snapshot.customer_invoice_id;

         await applyParentMirror(trx, accountId, invoiceInsertionObject.parent_invoice_id, {
            remaining: invoiceInsertionObject.remaining_balance_on_invoice,
            writeOffsDelta: fields.writeoff_amount
         });
      }

      const writeOff = await writeOffsService.createWriteOff(trx, { ...fields, created_at: ledgerNow(trx) });
      return { message, writeOff };
   });

/**
 * Update a write-off. Refused once billed. Customer and invoice linkage are
 * server-owned (a different value from the client is refused, a missing one
 * keeps the stored link). An amount change on an invoice-linked write-off
 * re-prices its snapshot (latest on the chain only) and the parent mirror.
 */
const updateWriteOffCore = (db, { accountId, writeOffFields }) =>
   withTransaction(db, async trx => {
      const { stored, linkedRow } = await loadUnbilledWriteOff(trx, accountId, writeOffFields.writeoff_id);

      if (Number.isInteger(writeOffFields.customer_id) && writeOffFields.customer_id > 0 && writeOffFields.customer_id !== Number(stored.customer_id)) {
         throw ruleError('Moving a write-off to a different customer is not supported. Delete the write-off and re-enter it for the correct customer.');
      }
      if (writeOffFields.customer_invoice_id && stored.customer_invoice_id && Number(writeOffFields.customer_invoice_id) !== Number(stored.customer_invoice_id)) {
         throw ruleError('Moving a write-off to a different invoice is not supported. Delete the write-off and re-enter it against the correct invoice.');
      }
      if (writeOffFields.customer_invoice_id && !stored.customer_invoice_id) {
         throw ruleError('A job-level write-off cannot be moved onto an invoice. Delete it and re-enter it against the invoice.');
      }

      const newAmount = round2(Math.abs(Number(writeOffFields.writeoff_amount)));
      if (!(newAmount > 0)) throw ruleError('Write-off amount must be greater than $0.00.', 400);
      const delta = round2(newAmount - Math.abs(Number(stored.writeoff_amount)));

      if (delta !== 0 && linkedRow) {
         if (!linkedRow.parent_invoice_id) {
            throw ruleError(`This write-off is linked directly to invoice ${linkedRow.invoice_number} and cannot be re-priced. Delete it and re-enter it.`);
         }
         await assertLatestOnChain(trx, accountId, linkedRow, 'Edit or delete');

         const snapshotRemaining = Number(linkedRow.remaining_balance_on_invoice);
         const newRemaining = round2(snapshotRemaining - delta);
         if (newRemaining < 0) {
            throw ruleError(`Write-off amount exceeds remaining balance on invoice ${linkedRow.invoice_number}. Max increase is $${snapshotRemaining}.`);
         }
         await setSnapshotRemaining(trx, accountId, linkedRow.customer_invoice_id, newRemaining);
         // Negative net: a bigger write-off makes total_write_offs more negative.
         await applyParentMirror(trx, accountId, linkedRow.parent_invoice_id, { remaining: newRemaining, writeOffsDelta: -delta });
      }

      // Client-editable columns only; linkage, type and creator stay as stored.
      // The job only matters for job-level write-offs (no invoice snapshot).
      const jobChange = !stored.customer_invoice_id && writeOffFields.customer_job_id !== undefined ? writeOffFields.customer_job_id : undefined;
      if (jobChange && Number(jobChange) !== Number(stored.customer_job_id)) {
         await assertJobBelongsToCustomer(trx, accountId, stored.customer_id, jobChange);
      }
      const patch = {
         writeoff_amount: -newAmount,
         writeoff_reason: writeOffFields.writeoff_reason || undefined,
         customer_job_id: jobChange,
         writeoff_date: writeOffFields.writeoff_date && dayjs(writeOffFields.writeoff_date).isValid() ? writeOffFields.writeoff_date : undefined,
         note: writeOffFields.note === undefined ? undefined : preserveSystemMarkers(stored.note, writeOffFields.note)
      };
      await trx(WRITEOFFS).where({ account_id: Number(accountId), writeoff_id: stored.writeoff_id }).update(patch);

      return { message: 'Successfully updated write-off.', stored };
   });

/**
 * Delete a write-off — symmetric to deletePayment: refused once billed, only
 * the latest snapshot on a chain, parent mirror restored, and a legacy
 * write-off that points straight at a PARENT row never deletes that row.
 */
const deleteWriteOffCore = (db, { accountId, writeoffId }) =>
   withTransaction(db, async trx => {
      const { stored, linkedRow } = await loadUnbilledWriteOff(trx, accountId, writeoffId);

      if (linkedRow && linkedRow.parent_invoice_id) {
         await assertLatestOnChain(trx, accountId, linkedRow, 'Delete');

         const remainingBefore = round2(Number(linkedRow.remaining_balance_on_invoice) + Math.abs(Number(stored.writeoff_amount)));
         await applyParentMirror(trx, accountId, linkedRow.parent_invoice_id, {
            remaining: remainingBefore,
            // Negative net: creation added the (negative) amount; deletion removes it.
            writeOffsDelta: -Number(stored.writeoff_amount)
         });
         await invoiceService.deleteInvoice(trx, linkedRow.customer_invoice_id, accountId);
      }

      await writeOffsService.deleteWriteOff(trx, stored.writeoff_id, accountId);
      return { message: 'Successfully deleted write-off.', stored };
   });

module.exports = { createWriteOffCore, updateWriteOffCore, deleteWriteOffCore };
