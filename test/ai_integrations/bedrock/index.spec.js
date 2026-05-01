const { invokeBedrockClaude, _setClientsForTest, _parseAnthropicJson } = require('../../../src/ai_integrations/bedrock');

const _bedrockResponse = ({ text = '{"ok":true}', inputTokens = 100, outputTokens = 50 } = {}) => {
   const body = JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens }
   });
   return { body: Buffer.from(body) };
};

describe('bedrock invokeBedrockClaude', () => {
   afterEach(() => _setClientsForTest({ bedrockClient: null, s3Client: null }));

   it('parses a valid JSON response and returns json + costs', async () => {
      const fakeClient = { send: () => Promise.resolve(_bedrockResponse({ text: '{"category_confidence":0.9,"ai_reason":"clear"}', inputTokens: 1000, outputTokens: 100 })) };
      _setClientsForTest({ bedrockClient: fakeClient, s3Client: null });
      const result = await invokeBedrockClaude({
         modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
         system: 'sys',
         messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
         accountId: 1,
         feature: 'category_haiku'
      });
      expect(result.json).to.deep.equal({ category_confidence: 0.9, ai_reason: 'clear' });
      expect(result.inputTokens).to.equal(1000);
      expect(result.outputTokens).to.equal(100);
      expect(result.cost).to.be.greaterThan(0);
      expect(result.requestId).to.be.a('string');
      expect(result.latencyMs).to.be.a('number');
   });

   it('retries once on ThrottlingException then succeeds', async () => {
      let calls = 0;
      const throttle = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
      const fakeClient = {
         send: () => {
            calls += 1;
            if (calls === 1) return Promise.reject(throttle);
            return Promise.resolve(_bedrockResponse({ text: '{"ok":true}' }));
         }
      };
      _setClientsForTest({ bedrockClient: fakeClient, s3Client: null });
      const result = await invokeBedrockClaude({
         modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
         system: 'sys',
         messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
         accountId: 1,
         feature: 'smoke_test'
      });
      expect(calls).to.equal(2);
      expect(result.json).to.deep.equal({ ok: true });
   });

   it('throws after retry exhaustion', async () => {
      const fakeClient = {
         send: () => Promise.reject(Object.assign(new Error('still throttled'), { name: 'ThrottlingException' }))
      };
      _setClientsForTest({ bedrockClient: fakeClient, s3Client: null });
      let caught = null;
      try {
         await invokeBedrockClaude({
            modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
            system: 'sys',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
            accountId: 1,
            feature: 'smoke_test'
         });
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.requestId).to.be.a('string');
      expect(caught.status).to.equal('error');
   });

   it('throws when response is malformed JSON (no JSON object found)', async () => {
      const fakeClient = { send: () => Promise.resolve(_bedrockResponse({ text: 'not-json-at-all' })) };
      _setClientsForTest({ bedrockClient: fakeClient, s3Client: null });
      let caught = null;
      try {
         await invokeBedrockClaude({
            modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
            system: 'sys',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
            accountId: 1,
            feature: 'category_haiku'
         });
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
   });
});

describe('bedrock _parseAnthropicJson', () => {
   it('extracts JSON object embedded in text', () => {
      const raw = JSON.stringify({
         content: [{ type: 'text', text: 'Here is JSON: {"a":1, "b":2} done.' }],
         usage: { input_tokens: 10, output_tokens: 5 }
      });
      const parsed = _parseAnthropicJson(raw);
      expect(parsed.json).to.deep.equal({ a: 1, b: 2 });
      expect(parsed.inputTokens).to.equal(10);
      expect(parsed.outputTokens).to.equal(5);
   });

   it('returns null json when no object found', () => {
      const raw = JSON.stringify({ content: [{ type: 'text', text: 'no json here' }], usage: { input_tokens: 1, output_tokens: 1 } });
      const parsed = _parseAnthropicJson(raw);
      expect(parsed.json).to.equal(null);
   });

   it('returns null entirely on bad input', () => {
      expect(_parseAnthropicJson('not even json')).to.equal(null);
   });
});
