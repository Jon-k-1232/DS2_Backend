const { matchCustomer } = require('../../src/ai_integrations/customerMatching');

const customers = [
   { customer_id: 1, display_name: 'Acme Corp' },
   { customer_id: 2, display_name: 'Globex Industries' },
   { customer_id: 3, display_name: 'Smith, John' },
   { customer_id: 4, display_name: 'Smith, Jane' }
];

describe('customerMatching matchCustomer', () => {
   const failingInvoker = () => Promise.reject(new Error('should not be called'));

   it('returns tier=exact on exact display_name', async () => {
      const result = await matchCustomer({
         searchName: 'acme corp',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.tier).to.equal('exact');
      expect(result.customerId).to.equal(1);
      expect(result.score).to.equal(1.0);
   });

   it('returns tier=fuzzy_high when fuzzy score is >= 0.90 and skips Bedrock', async () => {
      const result = await matchCustomer({
         searchName: 'Acme Corporation',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(['exact', 'fuzzy_high']).to.include(result.tier);
      expect(result.customerId).to.equal(1);
   });

   it('returns tier=none when no candidate clears MATCH_THRESHOLD', async () => {
      const result = await matchCustomer({
         searchName: 'Zyxx Quaerendum',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.tier).to.equal('none');
      expect(result.customerId).to.equal(null);
   });

   it('escalates to Bedrock when fuzzy is in [matchThreshold, llmSkipThreshold) range', async () => {
      let invoked = 0;
      const fakeInvoker = ({ feature }) => {
         invoked += 1;
         expect(feature).to.equal('customer_match');
         return Promise.resolve({
            json: { match_id: 3, match_confidence: 0.78, reason: 'last-name-first matched John Smith' },
            cost: 0.001
         });
      };
      // Force the LLM tier by setting llmSkipThreshold above any plausible fuzzy score.
      const result = await matchCustomer({
         searchName: 'John Smith',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(invoked).to.equal(1);
      expect(result.tier).to.equal('llm_tiebreak');
      expect(result.customerId).to.equal(3);
   });

   it('returns tier=llm_no_match when Bedrock returns null match_id', async () => {
      const fakeInvoker = () => Promise.resolve({ json: { match_id: null, match_confidence: 0, reason: 'shared last name only' } });
      const result = await matchCustomer({
         searchName: 'Smith',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(result.tier).to.equal('llm_no_match');
      expect(result.customerId).to.equal(null);
   });

   it('returns tier=llm_invalid_id when Bedrock returns an unknown id', async () => {
      const fakeInvoker = () => Promise.resolve({ json: { match_id: 9999, match_confidence: 0.9 } });
      const result = await matchCustomer({
         searchName: 'John S.',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(result.tier).to.equal('llm_invalid_id');
   });

   it('returns tier=llm_error when Bedrock throws', async () => {
      const fakeInvoker = () => Promise.reject(new Error('rate limited'));
      const result = await matchCustomer({
         searchName: 'John S.',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(result.tier).to.equal('llm_error');
      expect(result.reason).to.contain('bedrock_error');
   });

   it('returns reason=empty_search for blank input', async () => {
      const result = await matchCustomer({
         searchName: '   ',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.reason).to.equal('empty_search');
   });
});
