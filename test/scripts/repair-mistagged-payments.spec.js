/**
 * scripts/repair-mistagged-payments.js — finding F1 (round-3 review): --apply used to run the
 * snapshot insert, the parent update and the payment retag as three separate, unlocked writes.
 * These specs prove the fixed version (one knex transaction, ledger lock taken first, candidate
 * re-classified under the lock) both works end-to-end and is atomic — an injected failure on the
 * LAST write leaves nothing committed.
 *
 * Runs against a throwaway ds2_mig_test_* database (see test/scripts/helpers/pgHarness.js) with
 * account_id=1 of its own — this database has no relation to ds2_local's real (read-only)
 * account 1 data; it's built fresh from migrations/schema-snapshot-2026-09-22.sql per test file.
 * Skips when the sandbox Postgres / psql CLI tools aren't reachable.
 *
 * The script's exported functions (findMistaggedPayments/applyFix/applyLockedFix) all take `db`
 * as an explicit parameter — requiring the module does not itself open any database connection
 * (that only happens in the require.main === module CLI block) — so this spec passes its own
 * throwaway-database connection straight in and never touches env vars or ds2_local at all.
 */
const pgHarness = require('./helpers/pgHarness');
const script = require('../../scripts/repair-mistagged-payments');
const { seedReferenceData, invoiceDefaults, paymentDefaults } = require('./helpers/ledgerSeed');

const DB = `ds2_mig_test_repair_spec_${process.pid}`; // unique per process: parallel mocha runs must not share a throwaway DB

describe('scripts/repair-mistagged-payments.js', function () {
   this.timeout(30000);
   let db;
   let ref; // reference rows (account/user/gwd/customer) — seeded ONCE; each test uses fresh ids for its own scenario rows

   before(async function () {
      if (!pgHarness.isAvailable()) return this.skip();
      pgHarness.createThrowawayDb(DB);
      db = pgHarness.knexFor(DB);
      ref = await seedReferenceData(db, { accountId: script.ACCOUNT_ID, customerIds: [1] });
   });

   after(async () => {
      if (db) await db.destroy();
      if (pgHarness.isAvailable()) pgHarness.dropDb(DB);
   });

   let nextId = 1000;
   const freshIds = () => ({ old: nextId++, current: nextId++, payment: nextId++ });

   const seedMistaggedScenario = async ({ customerId = 1 } = {}) => {
      const { old: oldId, current: currentId, payment: paymentId } = freshIds();
      await db('customer_invoices').insert([
         invoiceDefaults(ref, customerId, {
            customer_invoice_id: oldId,
            invoice_number: `INV-OLD-${oldId}`,
            invoice_date: '2026-01-01',
            created_at: '2026-01-01 08:00:00',
            total_payments: -50,
            remaining_balance_on_invoice: 0,
            is_invoice_paid_in_full: true
         }),
         invoiceDefaults(ref, customerId, {
            customer_invoice_id: currentId,
            invoice_number: `INV-NEW-${currentId}`,
            invoice_date: '2026-02-01',
            created_at: '2026-02-01 08:00:00',
            total_payments: 0,
            remaining_balance_on_invoice: 500,
            beginning_balance: 500,
            total_amount_due: 500
         })
      ]);
      await db('customer_payments').insert(
         paymentDefaults(ref, customerId, {
            payment_id: paymentId,
            payment_amount: -100,
            customer_invoice_id: oldId,
            created_at: '2026-02-05 09:00:00',
            payment_date: '2026-02-05'
         })
      );
      return { ref, oldId, currentId, paymentId };
   };

   it('finds a payment tagged to an absorbed chain and classifies it as PENDING', async () => {
      const { paymentId } = await seedMistaggedScenario();
      const all = await script.findMistaggedPayments(db, script.ACCOUNT_ID);
      const found = all.find(p => p.payment_id === paymentId);
      expect(found, 'mistagged payment should be found').to.exist;
      expect(found.is_pending).to.equal(true);
   });

   it('applyFix: locks the customer, moves the credit to the current chain, and retags the payment — all inside one transaction', async () => {
      const { currentId, oldId, paymentId } = await seedMistaggedScenario();
      const candidate = (await script.findMistaggedPayments(db, script.ACCOUNT_ID)).find(p => p.payment_id === paymentId);

      const startedAt = Date.now();
      const result = await script.applyFix(db, candidate);
      expect(result).to.equal(true);

      const parent = await db('customer_invoices').where({ customer_invoice_id: currentId }).first();
      expect(Number(parent.total_payments)).to.equal(-100);
      expect(Number(parent.remaining_balance_on_invoice)).to.equal(400);

      const child = await db('customer_invoices').where({ parent_invoice_id: currentId }).first();
      expect(child, 'a corrective snapshot child row should exist').to.exist;
      expect(Number(child.remaining_balance_on_invoice)).to.equal(400);
      expect(child.notes).to.match(new RegExp(`payment #${paymentId} re-applied from INV-OLD-${oldId}`));
      // created_at was stamped by ledgerNow (clock_timestamp() under the lock), not left to a
      // stale/default value — it must be a real, recent timestamp.
      expect(new Date(child.created_at).getTime()).to.be.at.least(startedAt - 2000);

      const payment = await db('customer_payments').where({ payment_id: paymentId }).first();
      expect(payment.customer_invoice_id).to.equal(child.customer_invoice_id);
      expect(payment.note).to.match(/\[reconciled to INV-NEW-\d+; was tagged to INV-OLD-\d+\]/);

      // Fixed payments drop out of the mistagged scan (note now contains the exclusion marker).
      const stillMistagged = (await script.findMistaggedPayments(db, script.ACCOUNT_ID)).find(p => p.payment_id === paymentId);
      expect(stillMistagged).to.equal(undefined);
    });

   it('ATOMICITY (F1): an injected failure on the LAST write (the payment retag) leaves nothing committed', async () => {
      const { currentId, oldId, paymentId } = await seedMistaggedScenario();
      const candidate = (await script.findMistaggedPayments(db, script.ACCOUNT_ID)).find(p => p.payment_id === paymentId);

      const faultyDb = { transaction: fn => db.transaction(trx => fn(makeFaultyTrx(trx, { failTable: 'customer_payments', message: 'injected failure retagging payment' }))) };

      let thrown = null;
      try {
         await script.applyFix(faultyDb, candidate);
      } catch (err) {
         thrown = err;
      }
      expect(thrown, 'applyFix should reject when the last write fails').to.exist;
      expect(thrown.message).to.match(/injected failure/i);

      const parent = await db('customer_invoices').where({ customer_invoice_id: currentId }).first();
      expect(Number(parent.total_payments), 'parent total_payments must be untouched').to.equal(0);
      expect(Number(parent.remaining_balance_on_invoice), 'parent remaining must be untouched').to.equal(500);

      const childCount = Number((await db('customer_invoices').where({ parent_invoice_id: currentId }).count('*'))[0].count);
      expect(childCount, 'no corrective snapshot row should have been left behind').to.equal(0);

      const payment = await db('customer_payments').where({ payment_id: paymentId }).first();
      expect(payment.customer_invoice_id, 'payment must still point at the OLD (mistagged) chain').to.equal(oldId);
      expect(payment.note, 'payment note must be untouched').to.equal(null);

      // Nothing was left half-fixed: the scan still finds it, still pending.
      const stillMistagged = (await script.findMistaggedPayments(db, script.ACCOUNT_ID)).find(p => p.payment_id === paymentId);
      expect(stillMistagged, 'a failed repair must not disappear from the scan').to.exist;
      expect(stillMistagged.is_pending).to.equal(true);
   });

   it('applyFix re-classifies under the lock: a candidate that is no longer pending by the time the lock is granted is skipped, not re-applied', async () => {
      const { paymentId } = await seedMistaggedScenario();
      const candidate = (await script.findMistaggedPayments(db, script.ACCOUNT_ID)).find(p => p.payment_id === paymentId);

      // Fix it for real first.
      expect(await script.applyFix(db, candidate)).to.equal(true);

      // Re-run applyFix with the ORIGINAL (now-stale) candidate snapshot, simulating a second
      // caller racing off the same dry-run scan. It must re-check under the lock and refuse to
      // touch it again rather than crediting it a second time.
      const secondResult = await script.applyFix(db, candidate);
      expect(secondResult).to.equal(false);

      const paymentsMatching = await db('customer_payments').where({ payment_id: paymentId });
      expect(paymentsMatching).to.have.length(1);
      // Only ever fixed once: exactly one snapshot notes it, not two.
      const snapshots = await db('customer_invoices').where('notes', 'like', `%payment #${paymentId} re-applied%`);
      expect(snapshots).to.have.length(1);
   });
});

/** Wrap a knex transaction so calling wrapped(failTable) returns a query builder whose
 *  .update() throws instead of executing — everything else passes through to the real trx
 *  untouched. Used to prove atomicity end-to-end against a real Postgres transaction/rollback,
 *  not a mock. */
function makeFaultyTrx(trx, { failTable, failMethod = 'update', message = 'INJECTED FAILURE' }) {
   const wrapped = (...args) => {
      const qb = trx(...args);
      if (args[0] === failTable) {
         qb[failMethod] = () => {
            throw new Error(message);
         };
      }
      return qb;
   };
   return new Proxy(wrapped, {
      get(target, prop) {
         if (prop in target) return target[prop];
         const value = trx[prop];
         return typeof value === 'function' ? value.bind(trx) : value;
      }
   });
}
