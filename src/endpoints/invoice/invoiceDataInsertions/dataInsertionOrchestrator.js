const { createAndSaveZip } = require('../../../pdfCreator/zipOrchestrator');
const { restoreDataTypesInvoiceOnCreate } = require('../invoiceObjects');
const { restoreDataTypesOnTransactions } = require('../../transactions/transactionsObjects');
const { restoreDataTypesOnPayments } = require('../../payments/paymentsObjects');
const cleanAndValidateInvoiceObject = require('./schemaValidation/invoiceValidation');
const cleanAndValidateTransactionObject = require('./schemaValidation/transactionValidation');
const cleanAndValidatePaymentObject = require('./schemaValidation/paymentValidations');
const invoiceService = require('../invoice-service');
const transactionsService = require('../../transactions/transactions-service');
const writeOffsService = require('../../writeOffs/writeOffs-service');
const paymentsService = require('../../payments/payments-service');
const dayjs = require('dayjs');

const dataInsertionOrchestrator = async (db, invoicesWithDetail, accountBillingInformation, pdfBuffer, userID) => {
   if (!invoicesWithDetail || !accountBillingInformation || !pdfBuffer || !userID) {
      throw new Error('Missing necessary arguments for dataInsertionOrchestrator');
   }

   const pdfFileLocations = await saveInvoiceImagesForDatabase(pdfBuffer, accountBillingInformation).catch(err => {
      throw new Error(`Error in saving invoice images: ${err.message}`);
   });
   const pdfFileLocationsMap = pdfFileLocations.reduce((acc, { customerID, filePath }) => ({ ...acc, [customerID]: filePath }), {});

   // Must create invoices first in order to get the new invoice_id to place on the other inserts.
   const newCustomerInvoices = invoicesWithDetail.map(invoice => newInvoiceObject(invoice, pdfFileLocationsMap, userID));
   const arrayOfAreInvoicesValidated = newCustomerInvoices.map(invoice => cleanAndValidateInvoiceObject(invoice));
   const newInvoicesArray = await Promise.all(arrayOfAreInvoicesValidated.map(invoice => invoiceService.createInvoice(db, invoice)));
   const newInvoicesMap = newInvoicesArray.reduce((acc, { customer_id, customer_invoice_id }) => ({ ...acc, [customer_id]: customer_invoice_id }), {});

   // Create Transaction, Write Off, and Payment objects.
   const validatedBillableItems = updateAndValidateBillableObjects(invoicesWithDetail, newInvoicesMap);
   return insertInvoiceWorkItems(db, validatedBillableItems);
};

module.exports = dataInsertionOrchestrator;

/** Insert data into DB with upserts */
const insertInvoiceWorkItems = async (db, validatedBillableItems) => {
   return Promise.all(
      validatedBillableItems.map(async invoice => {
         const { transactions, payments } = invoice;

         const operations = [];

         if (Array.isArray(transactions) && transactions.length > 0) {
            operations.push(transactionsService.upsertTransactions(db, transactions));
         }

         if (Array.isArray(payments) && payments.length > 0) {
            operations.push(paymentsService.upsertPayments(db, payments));
         }

         if (operations.length === 0) {
            return Promise.resolve();
         }

         return Promise.all(operations).catch(err => {
            throw new Error(`Error in inserting transactions and write offs: ${err.message}`);
         });
      })
   );
};

/**
 * Update data types. Validate data.
 * @param {*} invoicesWithDetail
 * @param {*} newInvoicesMap
 * @returns
 */
const updateAndValidateBillableObjects = (invoicesWithDetail, newInvoicesMap) => {
   return invoicesWithDetail.map(invoice => {
      // Excluding write offs as they are tracked differently. If write offs are needed to be tracked this are would need updated.
      const { transactions: { allTransactionRecords } = {}, payments: { allPaymentRecords } = {} } = invoice;

      // Filters payments and return only payments that have a a null or 0 customer_invoice_id
      const paymentsWithoutInvoiceID = allPaymentRecords.filter(payment => !payment.customer_invoice_id);

      const payments = paymentsWithoutInvoiceID.map(payment => {
         const newPaymentObject = restoreDataTypesOnPayments({ ...payment, customer_invoice_id: newInvoicesMap[payment.customer_id] });
         return cleanAndValidatePaymentObject(newPaymentObject);
      });

      // Update data types. Validate data.
      const transactions = allTransactionRecords.map(transaction => {
         const newTransactionObject = restoreDataTypesOnTransactions({ ...transaction, customer_invoice_id: newInvoicesMap[transaction.customer_id] });
         return cleanAndValidateTransactionObject(newTransactionObject);
      });

      return { transactions, payments };
   });
};

/**
 * Save pdf files to disk for db lookup.
 * Loop through pdfBuffer and create map of customerID as key and pdf file location as value. Convert from buffer to pdf and save on disk as zip.
 * @param {*} pdfBuffer
 * @param {*} accountBillingInformation
 * @returns
 */
const saveInvoiceImagesForDatabase = async (pdfBuffer, accountBillingInformation) => {
   return Promise.all(
      pdfBuffer.map(async pdf => {
         const {
            metadata: { customerID, displayName }
         } = pdf;
         const filePath = await createAndSaveZip([pdf], accountBillingInformation, 'program_files/invoice_images', `${displayName}.zip`);

         return { customerID, filePath };
      })
   );
};

/**
 * Creates new invoice object to be inserted into the database
 */
const newInvoiceObject = (invoice, pdfFileLocationsMap, userID) => {
   const {
      customer_id,
      lastInvoiceDate,
      invoiceNumber,
      dueDate,
      invoiceTotal,
      customerContactInformation: { customer_info_id, account_id } = {},
      outstandingInvoices: { outstandingInvoiceTotal } = {},
      payments: { paymentTotal } = {},
      retainers: { retainerTotal } = {},
      transactions: { transactionsTotal } = {},
      writeOffs: { writeOffTotal } = {}
   } = invoice;

   /* 
   Adding this in for condition where customer had original bill, did not pay, got invoiced again.
   The bug was that the invoice remaining_balance was showing the outstanding.
   Therefore duplicating the original bill and the current bill when the customer was billed a third time.
   - The remaining_amount should only be the total of what this current bill is, not of the previous bills. 
   */
   const remainingBalance = transactionsTotal + retainerTotal;

   return restoreDataTypesInvoiceOnCreate({
      account_id,
      customer_id,
      customer_info_id,
      invoice_number: invoiceNumber,
      due_date: dayjs(dueDate).format(),
      beginning_balance: outstandingInvoiceTotal || 0,
      total_payments: paymentTotal || 0,
      total_charges: transactionsTotal || 0,
      total_write_offs: writeOffTotal || 0,
      total_retainers: retainerTotal || 0,
      total_amount_due: invoiceTotal || 0,
      remaining_balance_on_invoice: remainingBalance,
      parent_invoice_id: null,
      invoice_date: dayjs().format(),
      is_invoice_paid_in_full: false,
      fully_paid_date: null,
      created_by_user_id: userID,
      start_date: dayjs(lastInvoiceDate).format(),
      end_date: dayjs().format(),
      invoice_file_location: pdfFileLocationsMap[customer_id],
      notes: null
   });
};
