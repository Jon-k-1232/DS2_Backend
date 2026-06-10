const paymentsService = require('./payments-service');
const invoiceService = require('../invoice/invoice-service');
const retainersService = require('../retainer/retainer-service');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');

/**
 * Finds matching invoice and returns it
 * @param {*} customer_invoice_id
 * @param {*} account_id
 * @param {*} payment_amount
 * @returns
 */
const findInvoice = async (db, customer_invoice_id, account_id, payment_amount) => {
   const [matchingInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, customer_invoice_id);
   const { remaining_balance_on_invoice } = matchingInvoice || {};

   // If no matching invoice return error
   if (!Object.keys(matchingInvoice).length) {
      throw new Error('No matching invoice record found for this payment.');
   }

   // return error for over payment, along with the max amount that can be applied to this invoice
   if (Math.abs(remaining_balance_on_invoice) < Math.abs(payment_amount)) {
      throw new Error(`Payment amount exceeds remaining balance on invoice. Max amount that can be applied to this invoice is $${Math.abs(remaining_balance_on_invoice)}.`);
   }

   return matchingInvoice;
};

/**
 * Resolve the customer's CURRENT invoice chain — the only chain a new payment
 * may be applied to under the rolling-balance model (the newest parent's
 * remaining IS the customer's debt; every older chain has been absorbed into a
 * newer beginning_balance and is invisible to the billing engine's date gate).
 *
 * Returns the latest row of the current chain (the row that carries the
 * authoritative remaining balance) for every parent sharing the newest
 * invoice_date — duplicate same-day parents are all live, so the caller picks
 * among them. Returns [] when the customer has no parent invoices.
 */
const getCurrentChainTargets = async (db, account_id, customer_id) => {
   const parents = await db
      .select('*')
      .from('customer_invoices')
      .where('account_id', account_id)
      .andWhere('customer_id', customer_id)
      .whereNull('parent_invoice_id')
      .orderBy([
         { column: 'invoice_date', order: 'desc' },
         { column: 'customer_invoice_id', order: 'desc' }
      ]);

   if (!parents.length) return [];

   const newestDate = new Date(parents[0].invoice_date).toISOString().slice(0, 10);
   const currentParents = parents.filter(p => new Date(p.invoice_date).toISOString().slice(0, 10) === newestDate);

   return Promise.all(
      currentParents.map(async parent => {
         const [latestChild] = await db
            .select('*')
            .from('customer_invoices')
            .where('parent_invoice_id', parent.customer_invoice_id)
            .orderBy('created_at', 'desc')
            .limit(1);
         const latestRow = latestChild || parent;
         return { parent, latestRow, remaining: Number(latestRow.remaining_balance_on_invoice) || 0 };
      })
   );
};

/**
 * Check if the payment has been invoiced or not by checking the last invoice date against the payment created_at date.
 * @param {*} db
 * @param {*} paymentTableFields
 */
const checkIfPaymentIsAttachedToInvoice = async (db, paymentTableFields) => {
   const { payment_id, account_id, customer_id } = paymentTableFields;

   // Need to check if the payment has been invoiced yet. If it has been invoiced, do not allow delete in order to preserve records.
   const customerLastInvoiceDateObject = await invoiceService.getLastInvoiceDatesByCustomerID(db, account_id, [customer_id]);
   const [paymentRecord] = await paymentsService.getSinglePayment(db, payment_id, account_id);

   const customerInvoiceID = paymentRecord.customer_invoice_id;

   const [paymentInvoiceRecord] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, customerInvoiceID);

   // Also need to check if the retainer record has been invoiced yet. If it has been invoiced, do not allow delete in order to preserve records.
   // Retainer row id not stored, only the parent is stored. the parent is only stored for invoicing purposes.
   const [retainerRecord] = await retainersService.getRetainerBySameTime(db, account_id, paymentRecord?.retainer_id, paymentRecord.created_at);

   // If payment is attached to an invoice, do not allow delete
   if (paymentInvoiceRecord?.created_at <= customerLastInvoiceDateObject[customer_id]) {
      throw new Error('Payment is attached to an invoice and cannot be deleted or Modified.');
   }

   // If retainer is attached to an invoice, do not allow delete
   if (paymentRecord?.retainer_id && retainerRecord?.created_at <= customerLastInvoiceDateObject[customer_id]) {
      throw new Error('Retainer is attached to an invoice and cannot be deleted or Modified.');
   }

   // return record objects
   return { paymentRecord, retainerRecord, paymentInvoiceRecord };
};

/**
 * Calculate the remaining amounts for the invoice and payment objects
 * @param {*} db
 * @param {*} matchingInvoice
 * @param {*} paymentTableFields
 * @param {*} outstandingInvoices
 */
const updateObjectsWithRemainingAmounts = (matchingInvoice, paymentTableFields) => {
   const { remaining_balance_on_invoice = 0, customer_invoice_id } = matchingInvoice;
   const paymentAmount = Number(paymentTableFields.payment_amount);
   const remainingBalance = Number(remaining_balance_on_invoice);
   const remainingAmount = remainingBalance + paymentAmount;

   const invoiceInsertionObject = createInvoiceObject(matchingInvoice, remainingAmount, customer_invoice_id);
   const paymentInsertionObject = paymentTableFields;

   return { paymentInsertionObject, invoiceInsertionObject, remainingAmount };
};

/**
 * Send back all tables with success response
 * @param {*} db
 * @param {*} res
 * @param {*} paymentTableFields
 */
const returnTablesWithSuccessResponse = async (db, res, paymentTableFields, message) => {
   const { account_id } = paymentTableFields;

   const [activePayments, activeRetainers, invoicesList] = await Promise.all([
      paymentsService.getActivePayments(db, account_id),
      retainersService.getActiveRetainers(db, account_id),
      invoiceService.getInvoices(db, account_id)
   ]);

   const activePaymentsData = {
      activePayments,
      grid: createGrid(activePayments)
   };

   const activeRetainerData = {
      activeRetainers,
      grid: createGrid(activeRetainers),
      treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
   };

   const activeInvoiceData = {
      invoicesList,
      grid: createGrid(invoicesList),
      treeGrid: generateTreeGridData(invoicesList, 'customer_invoice_id', 'parent_invoice_id')
   };

   res.send({
      paymentsList: { activePaymentsData },
      accountRetainersList: { activeRetainerData },
      invoicesList: { activeInvoiceData },
      message,
      status: 200
   });
};

/**
 * Makes invoice object for insertion into invoice table
 * @param {*} matchingInvoice
 * @param {*} remainingAmount- int, not required - if provided, this amount will be used as the remaining balance
 * @returns
 */
const createInvoiceObject = (matchingInvoice, remainingAmount, customerInvoiceID) => {
   const { parent_invoice_id } = matchingInvoice;

   // Delete unneeded fields
   delete matchingInvoice.customer_invoice_id;
   delete matchingInvoice.customer_name;
   delete matchingInvoice.customer_street;
   delete matchingInvoice.customer_city;
   delete matchingInvoice.customer_state;
   delete matchingInvoice.customer_zip;
   delete matchingInvoice.customer_email;
   delete matchingInvoice.customer_phone;

   return {
      ...matchingInvoice,
      parent_invoice_id: parent_invoice_id > 0 ? parent_invoice_id : customerInvoiceID,
      remaining_balance_on_invoice: remainingAmount || 0,
      is_invoice_paid_in_full: remainingAmount === 0 ? true : false,
      fully_paid_date: remainingAmount === 0 ? new Date() : null,
      created_at: new Date()
   };
};

module.exports = { findInvoice, getCurrentChainTargets, updateObjectsWithRemainingAmounts, checkIfPaymentIsAttachedToInvoice, returnTablesWithSuccessResponse };
