const { detectAndRedact, _setClientForTest, _stringFallbackRedact } = require('../../src/utils/comprehend');

describe('comprehend detectAndRedact', () => {
   afterEach(() => _setClientForTest(null));

   it('redacts entities returned by Comprehend', async () => {
      const fakeClient = {
         send: () => Promise.resolve({
            Entities: [
               { Type: 'NAME', BeginOffset: 7, EndOffset: 16 },
               { Type: 'EMAIL', BeginOffset: 21, EndOffset: 38 }
            ]
         })
      };
      _setClientForTest(fakeClient);
      const { redacted, usedComprehend } = await detectAndRedact('Hello, John Smith at john@example.com');
      expect(usedComprehend).to.equal(true);
      expect(redacted).to.contain('[REDACTED_NAME]');
      expect(redacted).to.contain('[REDACTED_EMAIL]');
      expect(redacted).to.not.contain('John Smith');
      expect(redacted).to.not.contain('john@example.com');
   });

   it('falls back to string-match redaction on Comprehend failure', async () => {
      const fakeClient = { send: () => Promise.reject(new Error('no creds')) };
      _setClientForTest(fakeClient);
      const { redacted, usedComprehend } = await detectAndRedact('Met with Acme Corp via email at sales@acme.com', { knownNames: ['Acme Corp'] });
      expect(usedComprehend).to.equal(false);
      expect(redacted).to.contain('[REDACTED_NAME]');
      expect(redacted).to.contain('[REDACTED_EMAIL]');
      expect(redacted).to.not.contain('Acme Corp');
   });

   it('ignores entity types outside the redaction set', async () => {
      const fakeClient = {
         send: () => Promise.resolve({
            Entities: [
               { Type: 'DATE_TIME', BeginOffset: 0, EndOffset: 5 }
            ]
         })
      };
      _setClientForTest(fakeClient);
      const { redacted } = await detectAndRedact('Today is sunny');
      expect(redacted).to.equal('Today is sunny');
   });

   it('returns text unchanged for empty input', async () => {
      const result = await detectAndRedact('');
      expect(result.redacted).to.equal('');
      expect(result.usedComprehend).to.equal(false);
   });
});

describe('comprehend _stringFallbackRedact', () => {
   it('redacts an email regardless of name list', () => {
      const out = _stringFallbackRedact('Reach me at user@company.com please');
      expect(out).to.contain('[REDACTED_EMAIL]');
   });

   it('redacts a US phone number', () => {
      const out = _stringFallbackRedact('Call (555) 123-4567 today');
      expect(out).to.contain('[REDACTED_PHONE]');
   });

   it('redacts a SSN-like pattern', () => {
      const out = _stringFallbackRedact('SSN 123-45-6789');
      expect(out).to.contain('[REDACTED_SSN]');
   });

   it('redacts known names case-insensitively', () => {
      const out = _stringFallbackRedact('Dealing with ACME corp again', ['Acme Corp']);
      expect(out).to.contain('[REDACTED_NAME]');
   });

   it('skips short or empty names', () => {
      const out = _stringFallbackRedact('No PII here', ['', 'a']);
      expect(out).to.equal('No PII here');
   });
});
