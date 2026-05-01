const { estimateCost, isKnownModel } = require('../../../src/ai_integrations/bedrock/cost');

describe('bedrock cost', () => {
   it('computes Haiku 4.5 cost matching published price', () => {
      const result = estimateCost('us.anthropic.claude-haiku-4-5-20251001-v1:0', 1_000_000, 1_000_000);
      expect(result).to.equal(4.8);
   });

   it('computes Sonnet 4.5 cost matching published price', () => {
      const result = estimateCost('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 1_000_000, 1_000_000);
      expect(result).to.equal(18);
   });

   it('returns 0 for an unknown model', () => {
      expect(estimateCost('claude-unknown-9000', 100, 100)).to.equal(0);
   });

   it('handles zero token counts', () => {
      expect(estimateCost('us.anthropic.claude-haiku-4-5-20251001-v1:0', 0, 0)).to.equal(0);
   });

   it('isKnownModel returns true for supported models', () => {
      expect(isKnownModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).to.equal(true);
      expect(isKnownModel('made-up-model')).to.equal(false);
   });

   it('rounds output to 6 decimals', () => {
      const result = estimateCost('us.anthropic.claude-haiku-4-5-20251001-v1:0', 1, 1);
      expect(result.toString()).to.match(/^0\.0+\d+$/);
   });
});
