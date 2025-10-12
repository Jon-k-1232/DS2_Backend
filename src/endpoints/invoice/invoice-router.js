const express = require('express');
const path = require('path');
const fs = require('fs');
const invoiceRouter = express.Router();
const invoiceService = require('./invoice-service');
const accountService = require('../account/account-service');
const transactionsService = require('../transactions/transactions-service');
const paymentsService = require('../payments/payments-service');
const writeOffsService = require('../writeOffs/writeOffs-service');
const retainersService = require('../retainer/retainer-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { findCustomersNeedingInvoices } = require('./invoiceEligibility/invoiceEligibility');
const { createGrid, filterGridByColumnName, generateTreeGridData } = require('../../utils/gridFunctions');
const { fetchInitialQueryItems } = require('./createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('./createInvoice/invoiceCalculations/calculateInvoices');
const { addInvoiceDetails } = require('./createInvoice/addDetailToInvoice/addInvoiceDetail');
const { createPDFInvoices } = require('../../utils/createAndSavePDFs');
const { createCsvData } = require('./createInvoiceCsv/createInvoiceCsv');
const { createAndSaveZip } = require('../../pdfCreator/zipOrchestrator');
const dataInsertionOrchestrator = require('./invoiceDataInsertions/dataInsertionOrchestrator');
const { requireManagerOrAdmin } = require('../auth/jwt-auth');
const config = require('../../../config');
const { getObject } = require('../../utils/s3');
const { normalizeInvoiceFileLocation } = require('../../utils/invoicePath');


// GET all invoices
invoiceRouter.route('/getInvoices/:accountID/:invoiceID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   const activeInvoices = await invoiceService.getInvoices(db, accountID);

   // Return Object
   const activeInvoiceData = {
      activeInvoices,
      grid: createGrid(activeInvoices),
      treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
   };

   res.send({
      activeInvoiceData,
      message: 'Successfully retrieved invoices.',
      status: 200
   });
});

// Delete invoice
invoiceRouter
   .route('/deleteInvoice/:accountID/:invoiceID')
   .all(requireManagerOrAdmin)
   .delete(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, invoiceID } = req.params;

      try {
         // check from transactions, writeoffs, and retainers, payments, and writeoffs
         const foundTransactions = await transactionsService.getTransactionsForInvoice(db, accountID, invoiceID);
         const foundPayments = await paymentsService.getPaymentsForInvoice(db, accountID, invoiceID);
         const foundWriteoffs = await writeOffsService.getWriteoffsForInvoice(db, accountID, invoiceID);

         if (foundTransactions.length || foundPayments.length || foundWriteoffs.length) {
            throw new Error('Cannot delete invoice with transactions, retainers, payments, or writeoffs.');
         }

         await invoiceService.deleteInvoice(db, invoiceID);
         const activeInvoices = await invoiceService.getInvoices(db, accountID);

         // Return Object
         const activeInvoiceData = {
            activeInvoices,
            grid: createGrid(activeInvoices),
            treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
         };

         res.send({
            invoicesList: { activeInvoiceData },
            message: 'Successfully deleted invoice.',
            status: 200
         });
      } catch (error) {
         res.send({
            message: error.message || 'An error occurred while deleting the invoice.',
            status: 500
         });
      }
   });

// Get accounts with a balance to generate invoices
invoiceRouter.route('/createInvoice/AccountsWithBalance/:accountID/:invoiceID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   const activeOutstandingBalances = await findCustomersNeedingInvoices(db, accountID);

   const fullGrid = createGrid(activeOutstandingBalances);

   // Return Object
   const activeOutstandingBalancesData = {
      activeOutstandingBalances,
      grid: filterGridByColumnName(fullGrid, ['customer_id', 'business_name', 'customer_name', 'display_name', 'retainer_count', 'transaction_count', 'invoice_count', 'write_off_count'])
   };

   res.send({
      outstandingBalanceList: { activeOutstandingBalancesData },
      message: 'Successfully retrieved balance.',
      status: 200
   });
});

// Create an invoice or multiple invoices
invoiceRouter.route('/createInvoice/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID, userID } = req.params;

   // Sanitize fields
   const sanitizedData = sanitizeFields(req.body.invoiceConfiguration);
   const { invoicesToCreate, invoiceCreationSettings } = sanitizedData;
   const { isFinalized, isRoughDraft, isCsvOnly, globalInvoiceNote } = invoiceCreationSettings;

   try {
      // Create map of customer_id and object as value. Needed later when matching calculated invoices with invoice details
      const invoicesToCreateMap = invoicesToCreate.reduce((map, obj) => ({ ...map, [obj.customer_id]: obj }), {});
      const [accountBillingInformation] = await accountService.getAccount(db, accountID);
      const invoiceQueryData = await fetchInitialQueryItems(db, invoicesToCreateMap, accountID);
      const calculatedInvoices = calculateInvoices(invoicesToCreate, invoiceQueryData);
      const invoicesWithDetail = await addInvoiceDetails(calculatedInvoices, invoiceQueryData, invoicesToCreateMap, accountBillingInformation, globalInvoiceNote);

      let fileLocation = '';

      if (isCsvOnly || isRoughDraft || isFinalized) {
         const csvBuffer = createCsvData(invoicesWithDetail);
         const pdfBuffer = await createPDFInvoices(invoicesWithDetail);
         const filesToZip = pdfBuffer.concat(csvBuffer);

         if (isCsvOnly && isRoughDraft) {
            fileLocation = await createAndSaveZip(filesToZip, accountBillingInformation, 'invoicing/csv_report_and_draft_invoices', 'zipped_files.zip');
         } else if (isCsvOnly) {
            fileLocation = await createAndSaveZip([csvBuffer], accountBillingInformation, 'invoicing/csv_report', 'zipped_files.zip');
         } else if (isRoughDraft) {
            fileLocation = await createAndSaveZip(pdfBuffer, accountBillingInformation, 'invoicing/draft_invoices', 'zipped_files.zip');
         } else if (isFinalized) {
            fileLocation = await createAndSaveZip(pdfBuffer, accountBillingInformation, 'invoicing/final_invoices', 'zipped_files.zip');
            // Insert data into db
            await dataInsertionOrchestrator(db, invoicesWithDetail, accountBillingInformation, pdfBuffer, userID);
         }
      }

      // get invoices table data
      const activeInvoices = await invoiceService.getInvoices(db, accountID);

      // Return Object
      const activeInvoiceData = {
         activeInvoices,
         grid: createGrid(activeInvoices),
         treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
      };

      res.send({
         invoicesWithDetail,
         fileLocation,
         invoicesList: { activeInvoiceData },
         message: 'Successfully retrieved balance.',
         status: 200
      });
   } catch (error) {
      res.send({
         message: error.message,
         status: 500
      });
   }
});

invoiceRouter.route('/downloadFile/:accountID/:userID').get(async (req, res) => {
   try {
      const { accountID } = req.params;
      const rawLocation = req.query.fileLocation;

      if (typeof rawLocation !== 'string' || rawLocation.trim().length === 0) {
         throw new Error('Invalid or no file path.');
      }

      const db = req.app.get('db');
      const [accountRecord] = await accountService.getAccount(db, accountID);
      const normalizedKey = normalizeInvoiceFileLocation({
         rawLocation,
         accountName: accountRecord?.account_name || '',
         bucketName: config.S3_BUCKET_NAME
      });

      if (normalizedKey) {
         try {
            const { body, metadata } = await getObject(normalizedKey);

            if (!body || !Buffer.isBuffer(body)) {
               throw new Error('File does not exist.');
            }

            const filename = path.basename(normalizedKey);

            if (metadata?.contentType) {
               res.set('Content-Type', metadata.contentType);
            }

            if (metadata?.contentLength) {
               res.set('Content-Length', `${metadata.contentLength}`);
            }

            return res.status(200).attachment(filename).send(body);
         } catch (s3Error) {
            console.warn(`Falling back to legacy invoice download for ${normalizedKey}: ${s3Error.message}`);
         }
      }

      const localPath = rawLocation.startsWith('/') ? rawLocation : `/${rawLocation}`;
      if (fs.existsSync(localPath)) {
         return res.status(200).download(localPath, path.basename(localPath), err => {
            if (err) {
               return res.status(400).send({ message: `Couldn't download file`, error: err });
            }
         });
      }

      throw new Error('File does not exist.');
   } catch (error) {
      res.status(400).send({
         message: error.message
      });
   }
});

// fetch invoice details
invoiceRouter.route('/getInvoiceDetails/:invoiceID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID, invoiceID } = req.params;

   const [invoiceDetails] = await invoiceService.getInvoiceByInvoiceRowID(db, accountID, invoiceID);
   const { start_date, end_date, customer_id } = invoiceDetails;
   // Update the remaining balance on the invoice. In either case of fetching the selected invoice, or the parent invoice, the current remaining balance is required to be fetched.
   const currentBalance = await invoiceService.getRemainingInvoiceAmount(db, accountID, invoiceID);
   invoiceDetails.remaining_balance_on_invoice = currentBalance.remaining_balance_on_invoice;

   // get all data between the start and end date to show what was accounted for.
   const invoiceTransactions = await transactionsService.getTransactionsForInvoice(db, accountID, invoiceID);
   const invoicePayments = await paymentsService.getPaymentsForInvoice(db, accountID, invoiceID);
   const invoiceWriteoffs = await writeOffsService.getWriteoffsForInvoice(db, accountID, invoiceID);
   // ToDo: Find retainer record applicable at time of invoice creation
   const invoiceRetainers = await retainersService.getRetainersBetweenDates(db, accountID, start_date, end_date);
   const lastBillDate = await invoiceService.getLastInvoiceDatesByCustomerID(db, accountID, [customer_id]);
   const customerOutstandingInvoices = await invoiceService.getOutstandingInvoices(db, accountID, [customer_id], lastBillDate[customer_id]);
   const invoiceOutstandingInvoices = customerOutstandingInvoices[customer_id];

   // create grid objects
   const invoiceTransactionsData = {
      invoiceTransactions,
      grid: createGrid(invoiceTransactions)
   };

   const invoicePaymentsData = {
      invoicePayments,
      grid: createGrid(invoicePayments)
   };

   const invoiceWriteoffsData = {
      invoiceWriteoffs,
      grid: createGrid(invoiceWriteoffs)
   };

   const invoiceRetainersData = {
      invoiceRetainers,
      grid: createGrid(invoiceRetainers),
      treeGrid: generateTreeGridData(invoiceRetainers, 'retainer_id', 'parent_retainer_id')
   };

   const invoiceOutstandingInvoicesData = {
      invoiceOutstandingInvoices,
      grid: createGrid(invoiceOutstandingInvoices),
      treeGrid: generateTreeGridData(invoiceOutstandingInvoices, 'customer_invoice_id', 'parent_invoice_id')
   };

   res.send({
      invoiceDetails,
      invoiceTransactionsData,
      invoicePaymentsData,
      invoiceWriteoffsData,
      invoiceRetainersData,
      invoiceOutstandingInvoicesData,
      message: 'Successfully retrieved invoice details.',
      status: 200
   });
});

module.exports = invoiceRouter;
