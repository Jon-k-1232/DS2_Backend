const { computeTimeAmounts, priceQuantity } = require('../../../src/utils/timeAmounts');
const { validateTransactionPrice } = require('../../../src/endpoints/transactions/transactionPricing');
const { parseDurationMinutes } = require('../../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration');
const { _computeTimeAmounts } = require('../../../src/endpoints/timesheets/auto-ingest-orchestrator');
describe('manual six-minute policy at duration boundaries', () => {
   for(const [minutes,quantity,totalTransaction] of [[1,.1,13.75],[6,.1,13.75],[7,.2,27.5],[14,.3,41.25],[15,.3,41.25],[16,.3,41.25],[59,1,137.5],[60,1,137.5],[61,1.1,151.25]]) {
      it(`${minutes} minutes -> ${quantity}h -> $${totalTransaction}`,()=>{
         const expected={quantity,unitCost:137.5,totalTransaction};
         expect(computeTimeAmounts(minutes,137.5)).to.deep.equal(expected);
         expect(_computeTimeAmounts(parseDurationMinutes(`${minutes}m`),137.5)).to.deep.equal(expected);
         expect(validateTransactionPrice({transactionType:'Time',minutes,...expected})).to.include(expected);
      });
   }
   it('rounds the half cent once, matching direct entry and ingestion',()=>{
      expect(priceQuantity(.3,1.15)).to.equal(.35);
      expect(computeTimeAmounts(15,1.15).totalTransaction).to.equal(.35);
   });
   for(const minutes of [true,[],{},' ','Infinity',-1]) it(`rejects malformed duration ${JSON.stringify(minutes)}`,()=>{
      expect(()=>validateTransactionPrice({transactionType:'Time',minutes,quantity:.1,unitCost:10,totalTransaction:1})).to.throw(/six-minute/);
   });
});
