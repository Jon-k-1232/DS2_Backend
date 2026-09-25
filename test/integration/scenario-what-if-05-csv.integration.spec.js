'use strict';
const { Scenario, ok, expect } = require('./_scenario');
const { parseString } = require('fast-csv');
const parse = text => new Promise((resolve, reject) => { const rows = []; parseString(text, { headers: true }).on('data', r => rows.push(r)).on('error', reject).on('end', () => resolve(rows)); });
describe('what-if C: exported descriptions, formula safety and failure paths', function () {
   this.timeout(180000); const s = new Scenario(); let c, j;
   before(async () => { await s.boot(); await s.foreignFixture(); c = await s.customer('CSV notes'); j = await s.job(c); });
   after(() => s.close());
   for (const [input, expected] of [
      ['=1+1', "'=1+1"], ['+1+1', "'+1+1"], ['-1+1', "'-1+1"], ['@SUM(1,1)', "'@SUM(1,1)"],
      ['\t=1+1', "'\t=1+1"], ['\r=1+1', "'\r=1+1"],
      ['Résumé 日本語 🙂', 'Résumé 日本語 🙂'], ['A, "quoted"\nsecond line', 'A, "quoted"\nsecond line']
   ]) it(`C01 export safely round-trips ${JSON.stringify(input)} as one text cell`, async () => {
      const row = await s.work(c, j, 10, { detailedJobDescription: input, note: input });
      const response = await s.get('/transactions/exportTransactions/1/1'); expect(response.status).to.equal(200);
      expect(response.headers['content-type']).to.include('text/csv');
      const exported = (await parse(response.text)).find(r => Number(r.transaction_id) === row.transaction_id);
      expect(exported.detailed_work_description).to.equal(expected);
      expect(exported.total_transaction).to.equal('10.00'); expect(exported.unit_cost).to.equal('10.00');
      const stored = await s.db('customer_transactions').where({ transaction_id: row.transaction_id }).first();
      expect(stored.detailed_work_description).to.equal(input); expect(stored.note).to.equal(input);
   });
   it('C01 CSV exports are read-only and exclude the other tenant', async () => {
      const before = await s.state(), response = await s.get('/transactions/exportTransactions/1/1');
      expect(response.status).to.equal(200); expect((await parse(response.text)).some(r => Number(r.transaction_id) === 70001)).to.equal(false); expect(await s.state()).to.deep.equal(before);
   });
   it('C01 export denies absent, employee and foreign sessions', async () => {
      for (const [role, status] of [[null, 401], ['staff', 403], ['foreign', 403]]) await s.reject(() => s.get('/transactions/exportTransactions/1/1', role), null, null, null, status);
   });
   it('C01 database export failure is explicit500, unchanged, and retry succeeds', async () => {
      const service = require('../../src/endpoints/transactions/transactions-service'), original = service.getActiveTransactionsForExport;
      try { service.getActiveTransactionsForExport = async () => { throw new Error('scenario export failure'); }; await s.reject(() => s.get('/transactions/exportTransactions/1/1'), /scenario export failure/, null, null, 500); }
      finally { service.getActiveTransactionsForExport = original; }
      expect((await s.get('/transactions/exportTransactions/1/1')).status).to.equal(200);
   });
   it('C01 a long note over the application body limit refuses413 before any write', async () => {
      await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(c, j, 10, { note: 'x'.repeat(1024 * 1024 + 1) }) }), null, null, null, 413);
   });
   it('C01 malformed JSON refuses400 before any write; valid empty note succeeds', async () => {
      await s.reject(() => s.request.post('/transactions/createTransaction/1/1').set('Authorization', `Bearer ${s.token()}`).set('Content-Type', 'application/json').send('{"transaction":'), null, null, null, 400);
      const row = await s.work(c, j, 10, { note: '' }); expect(row.note).to.equal(null);
   });
});
