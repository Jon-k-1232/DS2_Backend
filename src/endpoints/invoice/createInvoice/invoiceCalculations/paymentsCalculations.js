/**
 * Customer payments and payments total
 * @param {*} customerPayments
 * @returns
 */
const groupAndTotalPayments = (customer_id, invoiceQueryData) => {
   const customerPayments = invoiceQueryData.customerPayments[customer_id] || [];
   const paymentTotal = customerPayments ? customerPayments.reduce((acc, payment) => acc + Number(payment.payment_amount), 0) : 0;

   // for the customer payments, filter out payments that have a form_of_payment of 'Retainer' or 'Prepayment'
   const retainerPayments = customerPayments.filter(payment => payment.form_of_payment === 'Retainer' || payment.form_of_payment === 'Prepayment');
   const retainerPaymentTotal = retainerPayments.reduce((acc, payment) => acc + Number(payment.payment_amount), 0);

   if (isNaN(paymentTotal)) {
      console.log(`Payment Total on customerID:${customer_id} is NaN`);
      throw new Error(`Payment Total on customerID:${customer_id} is NaN`);
   }
   if (paymentTotal === null || paymentTotal === undefined) {
      console.log(`Payment Total on customerID:${customer_id} is null or undefined`);
      throw new Error(`Payment Total on customerID:${customer_id} is null or undefined`);
   }
   if (typeof paymentTotal !== 'number') {
      console.log(`Payment Total on customerID:${customer_id} is not a number`);
      throw new Error(`Payment Total on customerID:${customer_id} is not a number`);
   }

   return { paymentTotal, retainerPaymentTotal, paymentRecords: customerPayments, allPaymentRecords: customerPayments };
};

module.exports = { groupAndTotalPayments };
