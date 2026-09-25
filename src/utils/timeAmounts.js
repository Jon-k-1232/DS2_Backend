'use strict';
// Manual entry policy: round each duration UP to six minutes (one tenth hour).
// Price integer hundredths against integer cents, then round once to cents.
const billableHours = minutes => Math.ceil(Number(minutes) / 6) / 10;
const priceQuantity = (quantity, rate) => Math.round(Math.round(Number(quantity) * 100) * Math.round(Number(rate) * 100) / 100) / 100;
const computeTimeAmounts = (minutes, rate) => {
   const quantity = billableHours(minutes);
   const unitCost = Math.round(Number(rate) * 100) / 100;
   return { quantity, unitCost, totalTransaction: priceQuantity(quantity, unitCost) };
};
module.exports = { billableHours, priceQuantity, computeTimeAmounts };
