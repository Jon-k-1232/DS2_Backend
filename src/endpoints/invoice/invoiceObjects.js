const restoreDataTypesInvoiceOnCreate = data => ({
   parent_invoice_id: Number(data.parentInvoiceID) || null,
   account_id: Number(data.account_id),
   customer_id: Number(data.customer_id),
   customer_info_id: Number(data.customer_info_id),
   invoice_number: data.invoice_number,
   invoice_date: data.invoice_date,
   due_date: data.due_date,
   beginning_balance: Number(data.beginning_balance),
   total_payments: Number(data.total_payments),
   total_charges: Number(data.total_charges),
   total_write_offs: Number(data.total_write_offs),
   total_retainers: Number(data.total_retainers),
   total_amount_due: Number(data.total_amount_due),
   remaining_balance_on_invoice: Number(data.remaining_balance_on_invoice),
   is_invoice_paid_in_full: data.is_invoice_paid_in_full,
   fully_paid_date: data.fully_paid_date,
   created_by_user_id: Number(data.created_by_user_id),
   start_date: data.start_date || null,
   end_date: data.end_date || null,
   invoice_file_location: data.invoice_file_location || null,
   notes: data.notes
});

const restoreDataTypesInvoiceOnUpdate = data => ({
   customer_invoice_id: Number(data.customer_invoice_id),
   parent_invoice_id: Number(data.parentInvoiceID) || null,
   account_id: Number(data.account_id),
   customer_id: Number(data.customer_id),
   customer_info_id: Number(data.customer_info_id),
   invoice_number: data.invoice_number,
   invoice_date: data.invoice_date,
   due_date: data.due_date,
   beginning_balance: Number(data.beginning_balance),
   total_payments: Number(data.total_payments),
   total_charges: Number(data.total_charges),
   total_write_offs: Number(data.total_write_offs),
   total_retainers: Number(data.total_retainers),
   total_amount_due: Number(data.total_amount_due),
   remaining_balance_on_invoice: Number(data.remaining_balance_on_invoice),
   is_invoice_paid_in_full: data.is_invoice_paid_in_full,
   fully_paid_date: data.fully_paid_date,
   created_by_user_id: Number(data.created_by_user_id),
   start_date: data.startDate || null,
   end_date: data.endDate || null,
   invoice_file_location: data.invoice_file_location || null,
   notes: data.notes
});

const createNewInvoiceObject = (invoice, userID) => {
   const { customerContactInfo, invoiceNote, incrementedNextInvoiceNumber, dueDate, outstandingInvoices, payments, transactions, writeOffs, retainers, invoiceTotal } = invoice;
   const { customer_id, account_id, customer_info_id } = customerContactInfo;
   return {
      account_id,
      customer_id,
      customer_info_id,
      invoice_number: incrementedNextInvoiceNumber,
      invoice_date: new Date(),
      due_date: dueDate,
      beginning_balance: outstandingInvoices?.outstandingBalanceTotalForInvoiceDisplay || 0.0,
      total_payments: payments?.paymentTotal || 0.0,
      total_charges: transactions?.transactionTotals || 0.0,
      total_write_offs: writeOffs?.totalWriteOffs || 0.0,
      total_retainers: retainers?.retainerTotal || 0.0,
      total_amount_due: invoiceTotal || 0.0,
      remaining_balance_on_invoice: invoiceTotal || 0.0,
      is_invoice_paid_in_full: false,
      fully_paid_date: null,
      created_by_user_id: userID,
      invoice_file_location: data.invoiceFileLocation || null,
      notes: invoiceNote
   };
};

/**
 * Calculates the amount that amount thats should remain on the retainer.
 * @param {*} invoice
 * @returns retainer object with the remaining amount.
 */
const calculateRemainingRetainer = invoice => {
   const {
      retainers: { retainerTotal, retainerRecords },
      remainingRetainer
   } = invoice;
   const amountToDistribute = remainingRetainer - retainerTotal;
   let remainder = 0;

   return retainerRecords.map((obj, i) => {
      const { current_amount, is_retainer_active, retainer_id, ...props } = obj;
      const currentAmount = Number(current_amount);
      const totalAboveZero = currentAmount + Number(amountToDistribute);

      const newCurrentAmount = totalAboveZero < 0 ? totalAboveZero : i > 0 && remainder === 0 ? currentAmount : ((remainder = totalAboveZero), 0);

      return {
         retainer_id,
         current_amount: newCurrentAmount,
         is_retainer_active: newCurrentAmount === 0 ? false : is_retainer_active,
         retainer_amount_used: current_amount - newCurrentAmount,
         ...props
      };
   });
};

const newPaymentObject = (retainer, invoiceID, userID) => ({
   customer_id: retainer.customer_id,
   account_id: retainer.account_id,
   retainer_id: retainer.retainer_id,
   customer_invoice_id: invoiceID,
   payment_date: new Date(),
   payment_amount: retainer.retainer_amount_used,
   form_of_payment: retainer.type_of_hold,
   payment_reference_number: 0,
   is_transaction_billable: true,
   created_by_user_id: userID,
   note: retainer.note
});

module.exports = {
   restoreDataTypesInvoiceOnCreate,
   restoreDataTypesInvoiceOnUpdate,
   createNewInvoiceObject,
   calculateRemainingRetainer,
   newPaymentObject
};
