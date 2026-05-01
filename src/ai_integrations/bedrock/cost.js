const PRICE_PER_MILLION_TOKENS = {
   'us.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 0.80, output: 4.00 },
   'us.anthropic.claude-haiku-3-5-20241022-v1:0': { input: 0.80, output: 4.00 },
   'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { input: 3.00, output: 15.00 },
   'anthropic.claude-haiku-4-5-20251001-v1:0': { input: 0.80, output: 4.00 },
   'anthropic.claude-sonnet-4-5-20250929-v1:0': { input: 3.00, output: 15.00 }
};

const estimateCost = (modelId, inputTokens = 0, outputTokens = 0) => {
   const price = PRICE_PER_MILLION_TOKENS[modelId];
   if (!price) return 0;
   const inCost = (inputTokens / 1_000_000) * price.input;
   const outCost = (outputTokens / 1_000_000) * price.output;
   return Number((inCost + outCost).toFixed(6));
};

const isKnownModel = modelId => Object.prototype.hasOwnProperty.call(PRICE_PER_MILLION_TOKENS, modelId);

module.exports = { estimateCost, isKnownModel, PRICE_PER_MILLION_TOKENS };
