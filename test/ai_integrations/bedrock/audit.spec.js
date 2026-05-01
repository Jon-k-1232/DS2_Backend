const { s3KeyForCall, writeS3Log } = require('../../../src/ai_integrations/bedrock/audit');

describe('bedrock audit', () => {
   describe('s3KeyForCall', () => {
      it('builds a date-partitioned key with account, feature, and request id', () => {
         const when = new Date('2026-05-01T13:45:07Z');
         const key = s3KeyForCall({ accountId: 42, feature: 'category_haiku', requestId: 'abc-123', when });
         expect(key).to.equal('2026/05/01/134507_acct42_category_haiku_abc-123.json');
      });

      it('zero-pads single-digit components', () => {
         const when = new Date('2026-01-02T03:04:05Z');
         const key = s3KeyForCall({ accountId: 7, feature: 'customer_match', requestId: 'r', when });
         expect(key).to.equal('2026/01/02/030405_acct7_customer_match_r.json');
      });
   });

   describe('writeS3Log', () => {
      it('returns null when no bucket configured', async () => {
         const result = await writeS3Log({ s3Client: { send: () => {} }, bucket: '', record: { account_id: 1 } });
         expect(result).to.equal(null);
      });

      it('returns null when no client configured', async () => {
         const result = await writeS3Log({ s3Client: null, bucket: 'foo', record: { account_id: 1 } });
         expect(result).to.equal(null);
      });

      it('sends a PutObjectCommand and returns the generated key', async () => {
         const sent = [];
         const fakeClient = { send: cmd => { sent.push(cmd); return Promise.resolve({}); } };
         const record = {
            account_id: 99,
            feature: 'smoke_test',
            request_id: 'req-x',
            created_at: '2026-05-01T00:00:00Z',
            payload: { hello: 'world' }
         };
         const key = await writeS3Log({ s3Client: fakeClient, bucket: 'my-bucket', record });
         expect(key).to.match(/^2026\/05\/01\/000000_acct99_smoke_test_req-x\.json$/);
         expect(sent).to.have.lengthOf(1);
         expect(sent[0].input.Bucket).to.equal('my-bucket');
         expect(sent[0].input.Key).to.equal(key);
         const body = sent[0].input.Body;
         expect(body).to.be.a('string');
         expect(JSON.parse(body)).to.deep.include({ account_id: 99, feature: 'smoke_test' });
      });
   });
});
