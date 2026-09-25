const retainerService = require('./retainer-service');
const {
   round2,
   ruleError,
   withTransaction,
   ledgerNow,
   lockCustomerLedger,
   lockCustomerLedgerForRow,
   parseCancelledByReversal,
   preserveSystemMarkers,
   stripLinkMarkers
} = require('../payments/ledger-helpers');

const RETAINERS = 'customer_retainers_and_prepayments';
const chainRows = (trx, accountID, rootID) =>
   trx(RETAINERS)
      .where('account_id', accountID)
      .andWhere(builder => builder.where('retainer_id', rootID).orWhere('parent_retainer_id', rootID));

/**
 * Resolve the retainer a payment draws from and validate the draw against the
 * chain's LATEST snapshot. The picker may hand us the root id or any snapshot
 * id; validating the selected row (the old behavior) accepted draws against a
 * stale balance and rebuilt the next snapshot from it, silently refunding the
 * chain's earlier draws. Returns the latest row of the chain.
 */
const findMatchingRetainer = async (db, retainerID, accountID, payment_amount, customerID = null) => {
   const [latest] = await retainerService.getMostRecentRecordOfSingleRetainer(db, accountID, retainerID);

   if (!latest) {
      throw ruleError('No matching retainer found for this payment.');
   }
   if (customerID != null && Number(latest.customer_id) !== Number(customerID)) {
      throw ruleError('The selected retainer belongs to a different customer than this payment.');
   }

   // Retainer balances are stored NEGATIVE (credits held for the customer).
   const available = round2(Math.max(0, -Number(latest.current_amount)));
   if (!latest.is_retainer_active || available <= 0) {
      throw ruleError('The selected retainer has no remaining balance.');
   }

   // Return error for over payment, along with the max amount that can be applied to this invoice
   if (available < round2(Math.abs(Number(payment_amount)))) {
      throw ruleError(`Payment amount exceeds remaining balance on retainer. Max amount that can be applied to this invoice is $${available}.`);
   }

   return latest;
};

/**
 * New retainer / prepayment. Always a new chain root (draw-down snapshots are
 * server-generated), stored NEGATIVE, owned by a customer of this account.
 */
const createRetainerCore = (db, { accountId, retainerFields }) =>
   withTransaction(db, async trx => {
      // A client-typed note must never be able to plant a system marker
      // (e.g. `[cancelled by reversal of payment #999999]`) that later makes
      // this brand-new retainer look already cancelled — refusing genuine
      // amount edits and deletes for a reversal that never happened.
      const fields = { ...retainerFields, note: stripLinkMarkers(retainerFields.note), account_id: Number(accountId), parent_retainer_id: null };
      await lockCustomerLedger(trx, accountId, fields.customer_id);

      const amount = -round2(Math.abs(Number(fields.starting_amount)));
      if (!(amount < 0)) throw ruleError('Retainer amount must be greater than $0.00.');
      if (!fields.type_of_hold) throw ruleError('Select a type of hold (Retainer or Prepayment).');

      return retainerService.createRetainer(trx, {
         ...fields,
         starting_amount: amount,
         current_amount: amount,
         is_retainer_active: true,
         created_at: ledgerNow(trx)
      });
   });

/**
 * Edit a retainer. The balance is never taken from the client: a change of
 * starting_amount shifts EVERY row of the chain by the same delta, so each
 * snapshot keeps its draw history (starting − current = amount drawn so far),
 * and is_retainer_active follows the resulting balance ($0 → inactive).
 * The previous mapper reset current_amount to the starting amount and forced
 * the retainer active, erasing every draw.
 */
const updateRetainerCore = (db, { accountId, retainerFields }) =>
   withTransaction(db, async trx => {
      const retainerID = retainerFields.retainer_id;
      await lockCustomerLedgerForRow(trx, accountId, RETAINERS, 'retainer_id', retainerID, 'No matching retainer record found.');
      const [row] = await retainerService.getSingleRetainer(trx, accountId, retainerID);

      if (Number.isInteger(retainerFields.customer_id) && retainerFields.customer_id > 0 && retainerFields.customer_id !== Number(row.customer_id)) {
         throw ruleError('Moving a retainer to a different customer is not supported. Delete it and re-enter it for the correct customer.');
      }

      const rootID = row.parent_retainer_id || row.retainer_id;
      if (await trx('retainer_events').where({account_id:Number(accountId),root_retainer_id:rootID}).first()) {
         throw ruleError('Retainer event history is immutable; record a new adjustment instead.',409,'RETAINER_EVENT_LOCKED');
      }
      const chain = await retainerService.getRetainerChain(trx, accountId, rootID);
      const latest = chain[chain.length - 1] || row;
      const root = chain.find(r => r.retainer_id === rootID) || row;

      const oldStarting = round2(Number(row.starting_amount));
      const requested = Number(retainerFields.starting_amount);
      let newStarting = oldStarting;
      if (Number.isFinite(requested)) {
         newStarting = -round2(Math.abs(requested));
         if (!(newStarting < 0)) throw ruleError('Retainer amount must be greater than $0.00.');
      }

      const delta = round2(newStarting - oldStarting);
      // An NSF reversal zeroed this prepayment: its funds never existed. Any
      // balance edit would make them spendable again; deleting the reversal
      // restores the prepayment exactly.
      const cancelledBy = parseCancelledByReversal(root.note);
      if (delta !== 0 && cancelledBy) {
         throw ruleError(
            `Prepayment retainer #${rootID} was cancelled by the reversal of payment #${cancelledBy}; its amount cannot be edited. Delete that reversal to restore the prepayment.`
         );
      }
      if (delta !== 0) {
         const latestCurrent = round2(Number(latest.current_amount));
         if (round2(latestCurrent + delta) > 0) {
            const drawn = round2(latestCurrent - oldStarting);
            throw ruleError(`Starting amount cannot be less than the $${drawn.toFixed(2)} already drawn from this retainer.`);
         }
         await chainRows(trx, accountId, rootID).update({
            starting_amount: newStarting,
            current_amount: trx.raw('current_amount + ?', [delta])
         });
      }

      // Chain-level descriptors (copied onto every snapshot, and the picker
      // shows the latest snapshot's copy).
      const chainPatch = {};
      ['display_name', 'form_of_payment', 'payment_reference_number'].forEach(column => {
         if (retainerFields[column] !== undefined) chainPatch[column] = retainerFields[column];
      });
      if (retainerFields.type_of_hold) chainPatch.type_of_hold = retainerFields.type_of_hold;
      if (Object.keys(chainPatch).length) await chainRows(trx, accountId, rootID).update(chainPatch);

      if (retainerFields.note !== undefined) {
         // System markers (cancelled-by-reversal, overpayment-excess link) survive a note edit.
         await trx(RETAINERS)
            .where({ account_id: Number(accountId), retainer_id: row.retainer_id })
            .update({ note: preserveSystemMarkers(row.note, retainerFields.note) });
      }

      await chainRows(trx, accountId, rootID).update({ is_retainer_active: trx.raw('current_amount < 0') });
      return { rootID, delta };
   });

/**
 * Delete a retainer only while nothing depends on it: no draw-down snapshots
 * anywhere in the chain, no transaction or payment referencing ANY chain row
 * (draws reference the snapshot ids, not the root), and not a prepayment that
 * a payment's overpayment split banked (delete that payment instead).
 */
const deleteRetainerCore = (db, { accountId, retainerId }) =>
   withTransaction(db, async trx => {
      await lockCustomerLedgerForRow(trx, accountId, RETAINERS, 'retainer_id', retainerId, 'No matching retainer record found.');
      const [row] = await retainerService.getSingleRetainer(trx, accountId, retainerId);
      const rootID = row.parent_retainer_id || row.retainer_id;
      if (await trx('retainer_events').where({account_id:Number(accountId),root_retainer_id:rootID}).first()) {
         throw ruleError('Retainer event history is immutable; record a new adjustment instead.',409,'RETAINER_EVENT_LOCKED');
      }

      if (row.parent_retainer_id) {
         throw ruleError(`This row is a draw-down entry on retainer #${rootID}. Delete the payment or time/charge entry that drew on it instead.`);
      }

      const cancelledBy = parseCancelledByReversal(row.note);
      if (cancelledBy) {
         throw ruleError(
            `This prepayment was cancelled by the reversal of payment #${cancelledBy}. Delete that reversal to restore it (and then the payment, to remove both) instead of deleting the prepayment.`
         );
      }

      const chain = await retainerService.getRetainerChain(trx, accountId, rootID);
      if (chain.some(r => r.parent_retainer_id)) {
         throw ruleError('This retainer has already been drawn on and cannot be deleted. Delete the payments or time/charge entries that drew on it first.');
      }

      const refs = await retainerService.getRetainerChainReferences(
         trx,
         accountId,
         chain.map(r => r.retainer_id),
         rootID
      );
      if (refs.transactions.length) throw ruleError('Transactions are linked to this retainer; it cannot be deleted.');
      if (refs.payments.length) throw ruleError('Payments are linked to this retainer; it cannot be deleted.');
      if (refs.overpaymentPayments.length) {
         throw ruleError(
            `This prepayment was banked from the overpayment on payment #${refs.overpaymentPayments[0].payment_id}. Delete that payment instead — it removes the prepayment with it.`
         );
      }

      await retainerService.deleteRetainer(trx, rootID, accountId);
      return { rootID };
   });

module.exports = { findMatchingRetainer, createRetainerCore, updateRetainerCore, deleteRetainerCore };
