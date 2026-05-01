const { inferCategorization, _validateSuggestion, _buildUserPrompt, ESCALATE_THRESHOLD, HAIKU_MODEL, SONNET_MODEL } = require('../../src/ai_integrations/categoryInference');

const refData = {
   general_work_descriptions: [
      { id: 7, label: 'Tax Return Preparation' },
      { id: 8, label: 'Bookkeeping' }
   ],
   job_categories: [{ id: 3, label: 'Tax Compliance' }],
   job_types: [{ id: 11, label: '1040 Individual', category_id: 3 }]
};

const redactedRow = {
   date: '2026-05-01',
   duration_minutes: 60,
   category_freetext: 'Consulting',
   entity_token: 'CUSTOMER_1',
   employee_token: 'EMPLOYEE_7',
   notes: 'prepared 1040 return'
};

describe('categoryInference', () => {
   describe('_validateSuggestion', () => {
      it('accepts valid IDs that exist in refData', () => {
         const validated = _validateSuggestion({
            suggested_general_work_description_id: 7,
            suggested_job_category_id: 3,
            suggested_job_type_id: 11,
            suggested_category_label: 'Tax Return',
            category_confidence: 0.92,
            ai_reason: 'notes mention 1040'
         }, refData);
         expect(validated).to.deep.include({ suggested_general_work_description_id: 7, category_confidence: 0.92 });
      });

      it('rejects an invalid ID', () => {
         expect(_validateSuggestion({
            suggested_general_work_description_id: 999,
            suggested_job_category_id: null,
            suggested_job_type_id: null,
            category_confidence: 0.9,
            ai_reason: 'r'
         }, refData)).to.equal(null);
      });

      it('clamps category_confidence into 0..1', () => {
         const v = _validateSuggestion({
            suggested_general_work_description_id: null,
            suggested_job_category_id: null,
            suggested_job_type_id: null,
            category_confidence: 1.5,
            ai_reason: 'r'
         }, refData);
         expect(v.category_confidence).to.equal(1);
      });

      it('truncates ai_reason to 200 chars', () => {
         const long = 'x'.repeat(500);
         const v = _validateSuggestion({
            suggested_general_work_description_id: null,
            suggested_job_category_id: null,
            suggested_job_type_id: null,
            category_confidence: 0.4,
            ai_reason: long
         }, refData);
         expect(v.ai_reason).to.have.lengthOf(200);
      });

      it('returns null when input is not an object', () => {
         expect(_validateSuggestion(null, refData)).to.equal(null);
      });
   });

   describe('_buildUserPrompt', () => {
      it('includes redacted row, ref data, and few-shot block', () => {
         const prompt = _buildUserPrompt({
            redactedRow,
            refData,
            fewShots: [{ sanitized_notes: 'review books', duration_minutes: 30, final_general_work_description: 'Bookkeeping' }]
         });
         expect(prompt).to.contain('CUSTOMER_1');
         expect(prompt).to.contain('EMPLOYEE_7');
         expect(prompt).to.contain('1040 Individual');
         expect(prompt).to.contain('Bookkeeping');
      });

      it('omits the few-shot block when no examples provided', () => {
         const prompt = _buildUserPrompt({ redactedRow, refData, fewShots: [] });
         expect(prompt).to.not.contain('Recent reviewer-corrected');
      });
   });

   describe('inferCategorization', () => {
      it('returns Haiku result when confidence >= ESCALATE_THRESHOLD without escalating', async () => {
         const calls = [];
         const fakeInvoker = ({ modelId }) => {
            calls.push(modelId);
            return Promise.resolve({
               json: {
                  suggested_general_work_description_id: 7,
                  suggested_job_category_id: 3,
                  suggested_job_type_id: 11,
                  category_confidence: 0.9,
                  ai_reason: 'clear 1040 work'
               },
               cost: 0.002
            });
         };
         const result = await inferCategorization({
            redactedRow,
            refData,
            fewShots: [],
            accountId: 1,
            bedrockInvoker: fakeInvoker
         });
         expect(result.escalated).to.equal(false);
         expect(result.modelUsed).to.equal(HAIKU_MODEL);
         expect(result.suggestion.suggested_general_work_description_id).to.equal(7);
         expect(calls).to.have.lengthOf(1);
      });

      it('escalates to Sonnet when Haiku confidence is below threshold', async () => {
         const calls = [];
         const fakeInvoker = ({ modelId }) => {
            calls.push(modelId);
            const conf = modelId === HAIKU_MODEL ? 0.5 : 0.92;
            return Promise.resolve({
               json: {
                  suggested_general_work_description_id: 7,
                  suggested_job_category_id: 3,
                  suggested_job_type_id: 11,
                  category_confidence: conf,
                  ai_reason: 'r'
               },
               cost: modelId === HAIKU_MODEL ? 0.001 : 0.005
            });
         };
         const result = await inferCategorization({
            redactedRow,
            refData,
            fewShots: [],
            accountId: 1,
            bedrockInvoker: fakeInvoker
         });
         expect(result.escalated).to.equal(true);
         expect(result.modelUsed).to.equal(SONNET_MODEL);
         expect(result.totalCost).to.equal(0.006);
         expect(calls).to.deep.equal([HAIKU_MODEL, SONNET_MODEL]);
      });

      it('returns null suggestion when both models fail to validate', async () => {
         const fakeInvoker = () => Promise.resolve({ json: { suggested_general_work_description_id: 9999, category_confidence: 0.9, ai_reason: 'r' }, cost: 0.001 });
         const result = await inferCategorization({
            redactedRow,
            refData,
            fewShots: [],
            accountId: 1,
            bedrockInvoker: fakeInvoker
         });
         expect(result.suggestion).to.equal(null);
      });

      it('falls through to Sonnet when Haiku throws', async () => {
         let calls = 0;
         const fakeInvoker = ({ modelId }) => {
            calls += 1;
            if (modelId === HAIKU_MODEL) return Promise.reject(new Error('haiku exploded'));
            return Promise.resolve({
               json: {
                  suggested_general_work_description_id: 7,
                  suggested_job_category_id: null,
                  suggested_job_type_id: null,
                  category_confidence: 0.85,
                  ai_reason: 'rescued'
               },
               cost: 0.005
            });
         };
         const result = await inferCategorization({
            redactedRow,
            refData,
            fewShots: [],
            accountId: 1,
            bedrockInvoker: fakeInvoker
         });
         expect(calls).to.equal(2);
         expect(result.suggestion.suggested_general_work_description_id).to.equal(7);
      });

      it('returns suggestion=null when both models throw', async () => {
         const fakeInvoker = () => Promise.reject(new Error('totally down'));
         const result = await inferCategorization({
            redactedRow,
            refData,
            fewShots: [],
            accountId: 1,
            bedrockInvoker: fakeInvoker
         });
         expect(result.suggestion).to.equal(null);
         expect(result.error).to.contain('totally down');
      });

      it('truncates job_types when refData exceeds MAX_REF_JOB_TYPES (smoke check)', async () => {
         const big = { ...refData, job_types: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, label: `Type${i + 1}`, category_id: 3 })) };
         let promptLength = 0;
         const fakeInvoker = ({ messages }) => {
            promptLength = messages[0].content[0].text.length;
            return Promise.resolve({
               json: {
                  suggested_general_work_description_id: 7,
                  suggested_job_category_id: null,
                  suggested_job_type_id: 1,
                  category_confidence: 0.9,
                  ai_reason: 'r'
               },
               cost: 0.001
            });
         };
         await inferCategorization({ redactedRow, refData: big, fewShots: [], accountId: 1, bedrockInvoker: fakeInvoker });
         // 150-cap; should be much smaller than the full 200-item prompt would be.
         expect(promptLength).to.be.lessThan(20000);
      });
   });
});
