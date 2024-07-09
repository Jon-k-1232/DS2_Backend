const retainerService = require('./retainer-service');

/**
 *
 * @param {*} db
 * @param {*} retainerID
 * @param {*} accountID
 * @param {*} payment_amount
 * @returns
 */
const findMatchingRetainer = async (db, retainerID, accountID, payment_amount) => {
   const [matchingRetainer] = await retainerService.getSingleRetainer(db, accountID, retainerID);
   const { current_amount } = matchingRetainer || {};

   // If no matching invoice return error
   if (!Object.keys(matchingRetainer).length) {
      throw new Error('No matching retainer found for this payment.');
   }

   // Return error for over payment, along with the max amount that can be applied to this invoice
   if (Math.abs(current_amount) < Math.abs(payment_amount)) {
      throw new Error(`Payment amount exceeds remaining balance on retainer. Max amount that can be applied to this invoice is $${Math.abs(current_amount)}.`);
   }

   return matchingRetainer;
};

module.exports = { findMatchingRetainer };
