/**
 * scripts/review-2026-09/billday-writeoff-ids.json (finding F7) and
 * scripts/review-2026-09/positive-total-payments-manifest.js (finding F2's accountant-package
 * generator), round-3 review.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pgHarness = require('./helpers/pgHarness');
const { seedReferenceData, invoiceDefaults, paymentDefaults } = require('./helpers/ledgerSeed');

// N5 sentinel identity, shared between the two describe blocks at the top and bottom of this
// file. Unique per test run (2026-09 second follow-up review: "the fixed-name sentinel allows
// concurrent suites to overwrite/delete one another's sentinel") — a fixed name would collide if
// two copies of this suite ever ran against the repo at once (e.g. a CI job and a local run, or
// two agents on the same checkout).
const N5_SENTINEL_NAME = `.n5-sentinel-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
const N5_SENTINEL_CONTENT = `N5 regression sentinel (pid ${process.pid}) — if this file is gone or its bytes changed, a test wrote into or deleted scripts/review-2026-09/out/. Written ${new Date().toISOString()}.\n`;

describe('scripts/review-2026-09/billday-writeoff-ids.json (F7)', () => {
   const ids = require('../../scripts/review-2026-09/billday-writeoff-ids.json');

   it('is versioned in the checkout (not only in the gitignored out/ directory)', () => {
      const filePath = path.join(__dirname, '..', '..', 'scripts', 'review-2026-09', 'billday-writeoff-ids.json');
      expect(fs.existsSync(filePath)).to.equal(true);
   });

   it('has exactly the reviewed 61 distinct write-off ids the report lists', () => {
      expect(ids).to.have.length(61);
      expect(new Set(ids).size).to.equal(61);
      ids.forEach(id => expect(Number.isInteger(id) && id > 0, `${id} should be a positive integer`).to.equal(true));
   });

   it('scripts/review-2026-09/billday-writeoff-double-credit.js requires the JSON file, not the gitignored CSV', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'review-2026-09', 'billday-writeoff-double-credit.js'), 'utf8');
      expect(src).to.match(/require\('\.\/billday-writeoff-ids\.json'\)/);
      expect(src).to.not.match(/billday-writeoffs-population\.csv/);
   });
});

// N5: the real scripts/review-2026-09/out/ directory holds gitignored but REAL accountant
// evidence (CSVs/manifest SQL a human generated and may still be reviewing). Before N5, every
// test below wrote into and deleted files in that exact shared directory. This describe block
// (and its matching "survives" check at the end of the file) place a sentinel there before the
// suite runs and confirm it is untouched after — the regression test for the bug itself, not
// just for the DS2_REVIEW_OUT_DIR plumbing. See artifact-probe.log (round-3 follow-up review).
describe('scripts/review-2026-09/out/ is never touched by this test file (N5)', () => {
   const realOutDir = path.join(__dirname, '..', '..', 'scripts', 'review-2026-09', 'out');
   const sentinelPath = path.join(realOutDir, N5_SENTINEL_NAME);

   before(() => {
      fs.mkdirSync(realOutDir, { recursive: true });
      fs.writeFileSync(sentinelPath, N5_SENTINEL_CONTENT);
   });

   it('placeholder — the real assertion runs once this file\'s other suites have finished (see the closing describe below)', () => {
      expect(fs.readFileSync(sentinelPath, 'utf8')).to.equal(N5_SENTINEL_CONTENT);
   });
});

describe('scripts/review-2026-09/positive-total-payments-manifest.js (F2 accountant package)', function () {
   this.timeout(30000);
   const DB = `ds2_mig_test_manifest_spec_${process.pid}`;
   let db;
   // N5: a private temp dir, never the shared scripts/review-2026-09/out/ — that directory holds
   // real (gitignored) accountant evidence and this suite must never write into or delete it
   // (see the sentinel-file describe block below). Qualified with DB (which already carries
   // process.pid) so the generated filename matches what the fixed generator itself produces.
   let outDir, sqlOutPath;

   before(function () {
      if (!pgHarness.isAvailable()) return this.skip();
      outDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ds2-review-spec-'));
      sqlOutPath = path.join(outDir, `positive-total-payments-manifest.${pgHarness.DATABASE}.account-1.manifest.sql`);
   });
   after(() => {
      if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
   });
   beforeEach(async function () {
      this.timeout(30000);
      pgHarness.createThrowawayDb(DB); // fresh per test — each test seeds its own account_id=1
      db = pgHarness.knexFor(DB);
   });
   afterEach(async () => {
      if (db) await db.destroy();
      pgHarness.dropDb(DB);
      fs.rmSync(sqlOutPath, { force: true });
   });

   const runScript = () => {
      const { execFileSync } = require('child_process');
      const cwd = path.join(__dirname, '..', '..');
      // Explicit connection vars, not just DS2_ENV_FILE/DATABASE_NAME: some
      // test/endpoints/**/*.integration.spec.js files load .env.dev's real RDS credentials into
      // process.env.DATABASE_USER/DATABASE_PASSWORD as a require-time side effect (they sit
      // outside test/integration/, so the unit run's --exclude doesn't catch them) — that would
      // otherwise leak into this child process's inherited env and point it at the wrong server.
      const env = Object.assign({}, process.env, {
         DS2_ENV_FILE: '.env.local',
         DS2_REVIEW_OUT_DIR: outDir,
         DATABASE_NAME: pgHarness.DATABASE,
         DB_HOST: pgHarness.HOST,
         DB_DEV_PORT: String(pgHarness.PORT),
         DATABASE_USER: pgHarness.USER,
         DATABASE_PASSWORD: pgHarness.PASSWORD,
         DB_SSL_DISABLE: 'true'
      });
      return execFileSync('node', ['scripts/review-2026-09/positive-total-payments-manifest.js'], { cwd, env, encoding: 'utf8' });
   };

   it('is read-only: running it makes no change to any ledger row', async () => {
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
      await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
      await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

      runScript();

      const row = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
      expect(Number(row.total_payments)).to.equal(100); // unchanged — generator only reads
   });

   it('generates a CSV row and a matching SQL INSERT block for an arithmetically-eligible candidate', async () => {
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
      await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
      await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

      const output = runScript();
      expect(output).to.match(/"candidates":1/);

      expect(fs.existsSync(sqlOutPath), 'manifest SQL file should be written').to.equal(true);
      const sql = fs.readFileSync(sqlOutPath, 'utf8');
      expect(sql).to.match(/INSERT INTO _m019_reviewed/);
      expect(sql).to.match(/\(1, 1, 4, '100\.00', '-100\.00', ARRAY\[6\]\)/);
      expect(sql, 'generated SQL must be marked unreviewed').to.match(/UNREVIEWED/);
   });

   it('excludes a root whose tagged payments belong to a different customer (cross-customer roll-up)', async () => {
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
      await db('customer_invoices').insert([
         invoiceDefaults(ref, 1, { customer_invoice_id: 5, total_payments: 100, invoice_number: 'INV-5' }),
         invoiceDefaults(ref, 2, { customer_invoice_id: 6, total_payments: 100, invoice_number: 'INV-6', parent_invoice_id: 5 })
      ]);
      await db('customer_payments').insert(paymentDefaults(ref, 2, { payment_id: 8, payment_amount: -100, customer_invoice_id: 6 }));

      const output = runScript();
      expect(output).to.match(/"candidates":0/);
   });

   it('N4: excludes a mixed-owner chain — root\'s own payment group matches arithmetically, but a foreign child in the same chain also holds a payment', async () => {
      // Root 10 (customer 1) has its OWN payment 10 (-100), which by itself is arithmetically
      // clean (magnitude 100 == total_payments 100, no reversal) — the pre-N4 grouping-by-
      // customer_id fix already keeps this from combining with payment 11 into one candidate
      // row. N4 goes further: a foreign payment (11, customer 2, via child invoice 11) still
      // sitting elsewhere in the SAME chain must exclude root 10 entirely, not just get a
      // correct payment_count on an otherwise-listed candidate.
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
      await db('customer_invoices').insert([
         invoiceDefaults(ref, 1, { customer_invoice_id: 10, total_payments: 100, invoice_number: 'INV-10' }),
         invoiceDefaults(ref, 2, { customer_invoice_id: 11, total_payments: 0, invoice_number: 'INV-11', parent_invoice_id: 10 })
      ]);
      await db('customer_payments').insert([
         paymentDefaults(ref, 1, { payment_id: 10, customer_invoice_id: 10, payment_amount: -100 }),
         paymentDefaults(ref, 2, { payment_id: 11, customer_invoice_id: 11, payment_amount: -50 })
      ]);

      const output = runScript();
      expect(output).to.match(/"candidates":0/);
   });

   it('R2: excludes a root whose child invoice is FOREIGN-OWNED but has NO payment of its own', async () => {
      // Fixture 500/501 from the round-5 review probe (see migrations/019.ledger_data_
      // normalization.sql and migration-019.spec.js for the matching apply-time test). Root 500
      // (customer 1) has its own clean receipt; child 501 (customer 2) has NO payment at all.
      // Before R2 the ownership check started from customer_payments (inner join), so a foreign
      // child with no payment was invisible to it and root 500 was wrongly listed as a candidate.
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
      await db('customer_invoices').insert([
         invoiceDefaults(ref, 1, { customer_invoice_id: 500, total_payments: 100, invoice_number: 'INV-500' }),
         invoiceDefaults(ref, 2, { customer_invoice_id: 501, total_payments: 0, invoice_number: 'INV-501', parent_invoice_id: 500 })
      ]);
      await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 500, customer_invoice_id: 500, payment_amount: -100 }));

      const output = runScript();
      expect(output).to.match(/"candidates":0/);
   });

   it('R2: a SAME-OWNER child invoice with no payment of its own does NOT disqualify the root — it is still listed as a candidate', async () => {
      // Control for the fixture above: same shape (unpaid child), but same-owner. The generator
      // must not become so broad that it quarantines every root with an unpaid child.
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
      await db('customer_invoices').insert([
         invoiceDefaults(ref, 1, { customer_invoice_id: 100, total_payments: 100, invoice_number: 'INV-100' }),
         invoiceDefaults(ref, 1, { customer_invoice_id: 101, total_payments: 0, invoice_number: 'INV-101', parent_invoice_id: 100 })
      ]);
      await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 100, customer_invoice_id: 100, payment_amount: -100 }));

      const output = runScript();
      expect(output).to.match(/"candidates":1/);
      const sql = fs.readFileSync(sqlOutPath, 'utf8');
      expect(sql).to.match(/\(1, 1, 100, '100\.00', '-100\.00', ARRAY\[100\]\)/);
   });

   it('R4: the zero-candidate manifest SQL still carries the source database, account and generation time', async () => {
      // Before R4, the empty-candidates branch was a bare fixed string with no identity at all
      // (probe.log:manifest:empty-identity — headerHasDB:false); the filename was qualified (N5)
      // but the file's own CONTENTS lost provenance the moment it left that filename behind.
      await seedReferenceData(db, { accountId: 1, customerIds: [1] }); // no invoices/payments — guaranteed zero candidates

      const output = runScript();
      expect(output).to.match(/"candidates":0/);

      expect(fs.existsSync(sqlOutPath), 'manifest SQL file should still be written even with zero candidates').to.equal(true);
      const sql = fs.readFileSync(sqlOutPath, 'utf8');
      expect(sql).to.match(new RegExp(`against database ${pgHarness.DATABASE}, account 1, at \\d{4}-\\d{2}-\\d{2}T`));
      expect(sql).to.match(/No arithmetically-eligible parents found/);
   });

   it('flags possible_misattributed_reversal when another payment reverses one of this root\'s own payments', async () => {
      const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
      await db('customer_invoices').insert([
         invoiceDefaults(ref, 1, { customer_invoice_id: 3, total_payments: 100, invoice_number: 'INV-3' }),
         invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' })
      ]);
      await db('customer_payments').insert([
         paymentDefaults(ref, 1, { payment_id: 5, payment_amount: -100, customer_invoice_id: 3 }),
         paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }),
         paymentDefaults(ref, 1, { payment_id: 7, payment_amount: 100, customer_invoice_id: 3, note: '[reversal of payment #6]' })
      ]);

      const output = runScript();
      // root 4 (payment 6 only) is still arithmetically eligible on its own root...
      expect(output).to.match(/"candidates":1/);
      const sql = fs.readFileSync(sqlOutPath, 'utf8');
      // ...but flagged in the generated SQL for extra scrutiny, since payment 6 has a reversal
      // recorded elsewhere (root 3).
      expect(sql).to.match(/possible_misattributed_reversal/);
   });
});

describe('scripts/review-2026-09/out/ survived this file\'s test suite (N5)', () => {
   const realOutDir = path.join(__dirname, '..', '..', 'scripts', 'review-2026-09', 'out');
   const sentinelPath = path.join(realOutDir, N5_SENTINEL_NAME);

   it('the sentinel written before this file\'s other suites ran is still present with its ORIGINAL bytes, under its unique name', () => {
      // Every test/DB-backed suite above has finished (mocha runs describes in file order), so
      // this is the true "after the suite" check the N5 fix promises. Fixed (2026-09 second
      // follow-up review): the previous version of this test called existsSync() alone, which
      // would also pass if some OTHER test had truncated, overwritten, or replaced the file's
      // contents while merely leaving a file at that path — this compares the actual bytes read
      // back against exactly what before() wrote, and the unique per-run filename (N5_SENTINEL_
      // NAME) means a concurrently-running copy of this same suite can't overwrite or delete this
      // one's sentinel (or vice versa), which a fixed shared name would allow.
      expect(fs.existsSync(sentinelPath), 'sentinel file in scripts/review-2026-09/out/ should still exist').to.equal(true);
      expect(fs.readFileSync(sentinelPath, 'utf8')).to.equal(N5_SENTINEL_CONTENT);
   });

   after(() => {
      // Clean up only the sentinel this file created — never touch anything else in out/.
      fs.rmSync(sentinelPath, { force: true });
   });
});
