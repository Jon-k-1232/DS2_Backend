'use strict';
const fs = require('fs');
const path = require('path');
const harness = require('./helpers/pgHarness');
const { assertPlainSql } = require('../../scripts/migrate');
describe('025 immutable credit statement selection', function () {
   this.timeout(30000);
   const name = `ds2_mig_test_025_${process.pid}`;
   let db;
   const sql = fs.readFileSync(path.join(__dirname, '../../migrations/025.credit_statement_selection.sql'), 'utf8');
   before(async () => {
      if (!harness.isAvailable()) throw Error('Local database required');
      harness.createThrowawayDb(name); db = harness.knexFor(name);
      await db.raw(fs.readFileSync(path.join(__dirname, '../../migrations/023.sent_invoice_locks.sql'), 'utf8'));
   });
   after(async () => { if (db) await db.destroy(); harness.dropDb(name); });
   it('is plain SQL, rerunnable, nullable for historical issues and does not backfill', async () => {
      expect(() => assertPlainSql(sql, '025')).not.to.throw();
      await db.transaction(t => t.raw(sql));
      await db.transaction(t => t.raw(sql));
      const column = (await db.raw("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_name='invoice_issues' AND column_name='credit_selection_reason'")).rows;
      expect(column).to.deep.equal([{ data_type: 'text', is_nullable: 'YES' }]);
      for (const table of ['invoice_issues','customers','customer_invoices']) expect((await db(table).count({n:'*'}).first()).n).to.equal('0');
      const guard = (await db.raw("SELECT tgname FROM pg_trigger WHERE tgrelid='invoice_issues'::regclass AND NOT tgisinternal")).rows;
      expect(guard.some(r => r.tgname === 'ds2_immutable')).to.equal(true);
   });
});
