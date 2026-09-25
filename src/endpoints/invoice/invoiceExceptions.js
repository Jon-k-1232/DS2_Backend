'use strict';
const { ruleError, lockCustomerLedger, round2 } = require('../payments/ledger-helpers');
const { lockNumber, captureIssue, historyEvent, TABLE_KEYS } = require('./sentInvoiceLocks');
const payments = require('../payments/payment-logic');
const invoiceService = require('./invoice-service');
const { createAndSaveZip } = require('../../pdfCreator/zipOrchestrator');
const { revisionPdf } = require('./invoiceRevisionPdf');
const { getObject } = require('../../utils/s3');
const unzipper = require('unzipper');
const { resolveOwnDownloadPrefixes, isAuthorizedDownloadKey } = require('../../utils/downloadAuthorization');
const CONDITIONS = Object.freeze([{ code: 'bounced_check', label: 'Bounced check', correction: 'payment_reversal' }]);
const id = (value, name) => {
   if (!['number','string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || (!Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)) throw ruleError(`Invalid ${name}.`, 400);
   return Number(value);
};
async function parentFor(db, accountId, invoiceId, lock = false) {
   const p = await db('customer_invoices').where({ account_id: accountId, customer_invoice_id: invoiceId }).first();
   if (!p) throw ruleError('Invoice not found.', 404);
   if (p.parent_invoice_id) throw ruleError('Select the parent statement for an exception.', 409);
   if (lock) await lockCustomerLedger(db, accountId, p.customer_id);
   // Re-read under customer lock to close delete/issuance races.
   const current = lock ? await db('customer_invoices').where({ account_id: accountId, customer_invoice_id: invoiceId }).first() : p;
   if (!current) throw ruleError('Invoice not found.', 404);
   if (!await lockNumber(db, accountId, 'customer_invoices', invoiceId)) throw ruleError('Invoice has not been sent.', 409);
   return current;
}
async function issueFor(trx, parent, actor) {
   return await trx('invoice_issues').where({ account_id: parent.account_id, invoice_id: parent.customer_invoice_id }).first()
      || captureIssue(trx, parent, null, actor);
}
async function readHistory(db, accountId, invoiceId) {
   const parent = await db('customer_invoices').where({ account_id: accountId, customer_invoice_id: invoiceId }).first();
   if (!parent) throw ruleError('Invoice not found.', 404);
   const root = parent.parent_invoice_id || parent.customer_invoice_id;
   const where = { account_id: accountId, invoice_id: root };
   const issue = await db('invoice_issues').where(where).first();
   const [events, revisions, exceptions, selected, members] = await Promise.all([
      db('invoice_history').where(where).orderBy('history_id'), db('invoice_revisions').where(where).orderBy('revision'),
      db('invoice_exceptions').where(where).orderBy('exception_id'), db('invoice_exception_payments').where(where),
      db('invoice_statement_members').where(where).where('table_name', 'customer_payments')
   ]);
   const number = await lockNumber(db, accountId, 'customer_invoices', root);
   const current = await invoiceService.getRemainingInvoiceAmount(db, accountId, root);
   let statementPayments = members.map(m => m.snapshot);
   if (number && !issue) {
      // No writes on GET. Historical boundary is the original parent's DB timestamp.
      statementPayments = await db('customer_payments').where({ account_id: accountId, customer_id: parent.customer_id })
         .where(q => q.where('customer_invoice_id', root).orWhereRaw('created_at <= (SELECT created_at FROM customer_invoices WHERE customer_invoice_id=?)', [root]));
   }
   const reversals = statementPayments.length ? await db('customer_payments').where({ account_id: accountId, customer_id: parent.customer_id }).where('payment_amount', '>', 0) : [];
   const reversedIds = new Set(reversals.map(r => /^\[reversal of payment #(\d+)\]/.exec(r.note || '')?.[1]).filter(Boolean));
   return { current_remaining_balance:Number(current?.remaining_balance_on_invoice ?? parent.remaining_balance_on_invoice), sent_locked: !!number, locked_invoice_number: number, conditions: CONDITIONS, issue,
      events, revisions: revisions.length ? revisions : (number ? [{ revision: 0, artifact_key: parent.invoice_file_location, issued_amount: parent.total_amount_due }] : []),
      exceptions: exceptions.map(e => ({ ...e, payments: selected.filter(p => p.exception_id === e.exception_id) })),
      statementPayments: statementPayments.map(p => ({ ...p, eligible_for_exception: Number(p.payment_amount) < 0 && !p.retainer_id && !reversedIds.has(String(p.payment_id)) })) };
}
async function flag(db, { accountId, invoiceId, actor, body }) {
   if (!body || typeof body !== 'object' || !CONDITIONS.some(c => c.code === body.condition)) throw ruleError('Unsupported exception condition.', 400);
   if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000 || body.reason.includes('\0')) throw ruleError('A reason of 1 to 2000 characters is required.', 400);
   if (!Array.isArray(body.paymentIds) || !body.paymentIds.length || body.paymentIds.length > 100) throw ruleError('Select 1 to 100 payments.', 400);
   const paymentIds = body.paymentIds.map(p => id(p, 'payment ID'));
   if (new Set(paymentIds).size !== paymentIds.length) throw ruleError('Select each payment only once.', 400);
   return db.transaction(async trx => {
      const parent = await parentFor(trx, accountId, invoiceId, true);
      const issue = await issueFor(trx, parent, actor);
      if (await trx('invoice_exceptions').where({ account_id: accountId, invoice_id: invoiceId }).whereIn('state', ['flagged', 'reversed']).first()) throw ruleError('Resolve the existing exception first.', 409);
      const history = await readHistory(trx, accountId, invoiceId);
      const selected = [];
      for (const paymentId of paymentIds) {
         const p = history.statementPayments.find(p => p.payment_id === paymentId);
         if (!p) throw ruleError('Selected payment is not on this statement.', 404);
         if (!p.eligible_for_exception) throw ruleError(`Payment #${paymentId} cannot be reversed by this condition.`, 409);
         selected.push(p);
      }
      const [exception] = await trx('invoice_exceptions').insert({ account_id: accountId, invoice_id: invoiceId,
         condition: body.condition, reason: body.reason.trim(), created_by: actor }).returning('*');
      await trx('invoice_exception_payments').insert(selected.map(p => ({ account_id: accountId, invoice_id: invoiceId,
         exception_id: exception.exception_id, payment_id: p.payment_id, amount: Math.abs(Number(p.payment_amount)) })));
      await historyEvent(trx, issue, actor, 'exception_flagged', { condition: body.condition, reason: body.reason.trim(), payment_ids: paymentIds }, exception.exception_id);
      return exception;
   });
}
async function transition(db, { accountId, invoiceId, exceptionId, actor, action }) {
   if (!['reverse', 'revision', 'roll_forward', 'cancel'].includes(action)) throw ruleError('Invalid exception action.', 400);
   return db.transaction(async trx => {
      const parent = await parentFor(trx, accountId, invoiceId, true);
      const issue = await trx('invoice_issues').where({ account_id: accountId, invoice_id: invoiceId }).first();
      const exception = await trx('invoice_exceptions').where({ account_id: accountId, invoice_id: invoiceId, exception_id: exceptionId }).first();
      if (!exception) throw ruleError('Exception not found.', 404);
      const expected = ['reverse', 'cancel'].includes(action) ? 'flagged' : 'reversed';
      if (exception.state !== expected) throw ruleError(`Exception is ${exception.state}; ${action} is not permitted.`, 409);
      const selected = await trx('invoice_exception_payments').where({ exception_id: exceptionId }).orderBy('payment_id');
      let state, detail = { reason: exception.reason }, artifactKey;
      if (action === 'reverse') {
         const before = await payments.getCurrentChainTargets(trx, accountId, parent.customer_id);
         const reversalIds = [];
         const retainerCancellations = [];
         for (const p of selected) {
            const result = await payments.reversePayment(trx, { accountId, userId: actor, paymentId: p.payment_id, reason: exception.reason, exceptionId }).catch(err => { if (err.isLedgerRule && err.statusCode === 422) err.statusCode = 409; throw err; });
            await trx('invoice_exception_payments').where({ exception_id: exceptionId, payment_id: p.payment_id }).update({ reversal_id: result.reversal.payment_id });
            reversalIds.push(result.reversal.payment_id);
            // The corrective events themselves are permanent evidence, immediately.
            const refs = [['customer_payments', result.reversal.payment_id], ['customer_invoices', result.reversal.customer_invoice_id]];
            if (result.cancelledPrepayment) {
               refs.push(['customer_retainers_and_prepayments', result.cancelledPrepayment.retainer_id]);
               retainerCancellations.push({ payment_id:p.payment_id, retainer_id:result.cancelledPrepayment.parent_retainer_id || result.cancelledPrepayment.retainer_id,
                  correction_retainer_id:result.cancelledPrepayment.retainer_id, amount:Math.abs(Number(result.cancelledPrepayment.starting_amount)) });
            }
            for (const [table, rid] of refs) {
               const row = await trx(table).where({ account_id: accountId, [TABLE_KEYS[table]]: rid }).first();
               await trx('invoice_statement_members').insert({ account_id: accountId, invoice_id: invoiceId, table_name: table, record_id: rid, snapshot: JSON.stringify(row) }).onConflict().ignore();
            }
         }
         const after = await payments.getCurrentChainTargets(trx, accountId, parent.customer_id);
         detail = { ...detail, payment_ids: selected.map(p => p.payment_id), reversal_ids: reversalIds,
            retainer_cancellations: retainerCancellations,
            before_balance: round2(before.reduce((s,t) => s+t.remaining,0)), after_balance: round2(after.reduce((s,t) => s+t.remaining,0)) };
         state = 'reversed';
      } else if (action === 'revision') {
         const targets = await payments.getCurrentChainTargets(trx, accountId, parent.customer_id);
         if (!targets.some(t => t.parent.customer_invoice_id === invoiceId)) throw ruleError('This invoice was rolled forward. Roll the correction into the next invoice.', 409);
         const previous = await trx('invoice_revisions').where({ account_id: accountId, invoice_id: invoiceId }).orderBy('revision', 'desc').first();
         const original = await trx('invoice_revisions').where({ account_id: accountId, invoice_id: invoiceId, revision: 0 }).first();
         const corrections = await trx('invoice_exception_payments as ep').join('invoice_exceptions as e', 'e.exception_id', 'ep.exception_id')
            .where({ 'ep.account_id': accountId, 'ep.invoice_id': invoiceId }).whereNotNull('ep.reversal_id').select('ep.*', 'e.reason');
         const revision = previous.revision + 1;
         const revisedAmount = round2(Number(original.issued_amount) + corrections.reduce((s,p) => s+Number(p.amount),0));
         const reversalEvents = await trx('invoice_history').where({ account_id:accountId, invoice_id:invoiceId, event:'exception_reversed' });
         const retainerCancellations = reversalEvents.flatMap(e => e.detail.retainer_cancellations || []);
         const payload = { issue, revision, originalAmount: Number(original.issued_amount), corrections, retainerCancellations, revisedAmount };
         const buffer = await revisionPdf(payload);
         const account = await trx('accounts').where({ account_id: accountId }).first();
         if (!isAuthorizedDownloadKey(original.artifact_key, resolveOwnDownloadPrefixes({storageSlug:account?.storage_slug}))) throw ruleError('Original archive is unavailable for this account.', 409);
         const stored = await getObject(original.artifact_key);
         const originalFiles = stored.body.subarray(0,4).toString() === '%PDF' ? [stored.body] : await unzipper.Open.buffer(stored.body).then(async zip => {
            const pdfs = zip.files.filter(f => f.type === 'File' && /\.pdf$/i.test(f.path));
            if (pdfs.length !== 1) throw new Error('Original archive must contain exactly one customer PDF.');
            return Promise.all(pdfs.map(f => f.buffer()));
         });
         artifactKey = await createAndSaveZip([{ buffer, metadata: { customerID: parent.customer_id, displayName: `${parent.invoice_number}_REVISION_${revision}`, type: 'pdf' } },
            { buffer:originalFiles[0], metadata:{ customerID:parent.customer_id, displayName:`${parent.invoice_number}_ORIGINAL_ARCHIVE`, type:'pdf' } }],
            account, 'invoicing/invoice_images', `${parent.invoice_number}_revision_${revision}.zip`, { customerID: parent.customer_id });
         await trx('invoice_revisions').insert({ account_id: accountId, invoice_id: invoiceId, revision, exception_id: exceptionId,
            artifact_key: artifactKey, issued_amount: revisedAmount, payload: JSON.stringify(payload), created_by: actor });
         detail = { ...detail, revision, artifact_key: artifactKey, issued_amount: revisedAmount };
         state = 'resolved_revision';
      } else state = action === 'cancel' ? 'cancelled' : 'resolved_roll_forward';
      await trx('invoice_exceptions').where({ exception_id: exceptionId }).update({ state });
      await historyEvent(trx, issue, actor, `exception_${state}`, detail, exceptionId);
      return { exception_id: exceptionId, state, ...detail, ...(artifactKey ? { artifact_key: artifactKey } : {}) };
   });
}
module.exports = { id, readHistory, flag, transition, CONDITIONS };
