const { pendingPaymentsService } = require('./pendingPayments-service');

const validatePendingPaymentExists = async (db, paymentID, accountID) => {
   const record = await pendingPaymentsService.getSinglePendingPayment(db, paymentID, accountID);

   if (!record) {
      throw new Error('Pending payment record not found.');
   }

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
