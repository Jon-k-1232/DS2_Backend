const { inferCategorization, HAIKU_MODEL, SONNET_MODEL } = require('../../src/ai_integrations/categoryInference');

const refData = {
   general_work_descriptions: [{ id: 7, label: 'X' }],
   job_categories: [{ id: 3, label: 'Y' }],
   job_types: [{ id: 11, label: 'Z', category_id: 3 }]
};
const redactedRow = { date: '2026-05-01', duration_minutes: 60, entity_token: 'CUSTOMER_1', employee_token: 'EMPLOYEE_7', notes: '' };

describe('categoryInference: skip Sonnet on fatal Haiku errors', () => {
   const fatalCases = [
      'AccessDeniedException: User: arn:aws:iam... is not authorized',
      'UnrecognizedClientException: The security token included in the request is invalid',
      'ResourceNotFoundException: model not enabled for account',
      'ValidationException: model id format invalid'
   ];
   for (const errMsg of fatalCases) {
      it(`does NOT escalate when Haiku returns ${errMsg.split(':')[0]}`, async () => {
         const calls = [];
         const fakeInvoker = ({ modelId }) => {
            calls.push(modelId);
            if (modelId === HAIKU_MODEL) return Promise.reject(new Error(errMsg));
            return Promise.resolve({ json: { suggested_general_work_description_id: 7, category_confidence: 0.95, ai_reason: 'r' }, cost: 0.01 });
         };
         const result = await inferCategorization({
            redactedRow, refData, fewShots: [], accountId: 1, bedrockInvoker: fakeInvoker
         });
         expect(calls).to.have.lengthOf(1);  // only Haiku, no Sonnet
         expect(calls[0]).to.equal(HAIKU_MODEL);
         expect(result.suggestion).to.equal(null);
         expect(result.escalated).to.equal(false);
      });
   }

   it('STILL escalates when Haiku throws ThrottlingException (transient)', async () => {
      const calls = [];
      const fakeInvoker = ({ modelId }) => {
         calls.push(modelId);
         if (modelId === HAIKU_MODEL) return Promise.reject(new Error('ThrottlingException: rate exceeded'));
         return Promise.resolve({ json: { suggested_general_work_description_id: 7, category_confidence: 0.95, ai_reason: 'r' }, cost: 0.01 });
      };
      const result = await inferCategorization({
         redactedRow, refData, fewShots: [], accountId: 1, bedrockInvoker: fakeInvoker
      });
      expect(calls).to.deep.equal([HAIKU_MODEL, SONNET_MODEL]);  // both fired
      expect(result.suggestion).to.exist;
      expect(result.escalated).to.equal(true);
   });
});
