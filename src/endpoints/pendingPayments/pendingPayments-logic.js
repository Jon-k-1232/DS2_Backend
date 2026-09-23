const { pendingPaymentsService } = require('./pendingPayments-service');

const pendingPaymentNotFound = () => Object.assign(new Error('Pending payment record not found.'), { statusCode: 404 });

/**
 * The account's pending row for `paymentID`. A malformed id is answered exactly
 * like a missing one (404) and never reaches Postgres, whose driver error would
 * echo the SQL back to the client.
 */
const validatePendingPaymentExists = async (db, paymentID, accountID) => {
   const id = Number(paymentID);
   if (!Number.isInteger(id) || id <= 0) throw pendingPaymentNotFound();

   const record = await pendingPaymentsService.getSinglePendingPayment(db, id, accountID);
   if (!record) throw pendingPaymentNotFound();

   return record;
};

const validateCanApprove = record => {
   if (record.is_payment_processed) {
      throw new Error('This payment has already been processed.');
   }
   if (record.deleted) {
      throw new Error('This payment has been deleted and cannot be processed.');
   }
};

const validateCanDelete = record => {
   if (record.is_payment_processed) {
      throw new Error('This payment has already been processed and cannot be deleted.');
   }
   if (record.deleted) {
      throw new Error('This payment is already deleted.');
   }
};

module.exports = { validatePendingPaymentExists, validateCanApprove, validateCanDelete };
