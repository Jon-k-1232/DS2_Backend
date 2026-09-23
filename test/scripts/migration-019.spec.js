/**
 * migrations/019.ledger_data_normalization.sql — findings F2 (fail-closed total_payments flip)
 * and F3 (row-level before/after audit evidence for every changed field), round-3 review.
 *
 * Runs against throwaway ds2_mig_test_* databases built fresh from
 * migrations/schema-snapshot-2026-09-22.sql (never ds2_local/ds2_clean — 019's UPDATE
 * statements have no account_id filter by design, so this file deliberately never runs it
 * against a database holding real account-1 rows). Skips when the sandbox Postgres / psql CLI
 * tools aren't reachable.
 */
const fs = require('fs');
const path = require('path');
const pgHarness = require('./helpers/pgHarness');
const { seedReferenceData, invoiceDefaults, paymentDefaults } = require('./helpers/ledgerSeed');

const MIGRATION_019_PATH = path.join(__dirname, '..', '..', 'migrations', '019.ledger_data_normalization.sql');
const migrationSql = () => fs.readFileSync(MIGRATION_019_PATH, 'utf8');

/** Paste a (still-unreviewed, test-authored) block of _m019_reviewed rows into the migration
 *  text, exactly where the file's own "accountant-reviewed rows go here" marker says to. */
const withManifestRows = insertStatement => migrationSql().replace('-- accountant-reviewed rows go here', `-- accountant-reviewed rows go here\n${insertStatement}`);

describe('migrations/019.ledger_data_normalization.sql', function () {
   this.timeout(30000);
   const DB = `ds2_mig_test_019_spec_${process.pid}`;
   let db;

   before(function () {
      if (!pgHarness.isAvailable()) return this.skip();
   });

   beforeEach(async () => {
      pgHarness.createThrowawayDb(DB);
      db = pgHarness.knexFor(DB);
   });
   afterEach(async () => {
      if (db) await db.destroy();
      pgHarness.dropDb(DB);
   });

   describe('F2 — total_payments sign flip is fail-closed', () => {
      it('flips NOTHING when the manifest is empty, even for a parent that is arithmetically eligible', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

         await db.transaction(trx => trx.raw(migrationSql()));

         const row = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         expect(Number(row.total_payments)).to.equal(100); // unflipped — the ship-as-is manifest is empty
         const reviewLog = await db('ledger_normalization_log').where({ migration: '019-review', row_id: 4 }).first();
         expect(reviewLog, 'should be listed for accountant review instead').to.exist;
      });

      it('does NOT flip a reversal payment misattributed to a different root (the exact fixture shape from the report)', async () => {
         // root 3 (customer1): -100 (payment 5) and +100 (payment 7, tagged "[reversal of
         // payment #6]" — but payment 6 itself is tagged to root 4, not root 3).
         // root 4 (customer1): -100 (payment 6) only, as far as root 4's own resolved payments
         // go — arithmetic-only logic (the pre-fix behavior) flips this to -100, which is wrong:
         // payment 6 DOES have a reversal, it's just recorded against a different chain.
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

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('customer_invoices').select('customer_invoice_id', 'total_payments').whereIn('customer_invoice_id', [3, 4]);
         const byId = Object.fromEntries(rows.map(r => [r.customer_invoice_id, Number(r.total_payments)]));
         expect(byId[3]).to.equal(100); // correctly unflipped: has a real reversal event on its own root
         expect(byId[4]).to.equal(100); // correctly unflipped: the empty manifest protects it even though it looks arithmetically clean
      });

      it('does NOT flip a root whose tagged payments belong to a DIFFERENT customer (cross-customer child roll-up)', async () => {
         // root 5 is owned by customer 1; child invoice 6 (parent_invoice_id=5) is owned by
         // customer 2, and customer 2's payment 8 rolls up to root 5 through it. Arithmetic-only
         // logic (the pre-fix behavior) flips root 5 (customer 1's invoice) using customer 2's
         // payment — the exact cross-customer misattribution from finding F2.
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
         await db('customer_invoices').insert([
            invoiceDefaults(ref, 1, { customer_invoice_id: 5, total_payments: 100, invoice_number: 'INV-5' }),
            invoiceDefaults(ref, 2, { customer_invoice_id: 6, total_payments: 100, invoice_number: 'INV-6', parent_invoice_id: 5 })
         ]);
         await db('customer_payments').insert(paymentDefaults(ref, 2, { payment_id: 8, payment_amount: -100, customer_invoice_id: 6 }));

         await db.transaction(trx => trx.raw(migrationSql()));

         const row = await db('customer_invoices').where({ customer_invoice_id: 5 }).first();
         expect(Number(row.total_payments)).to.equal(100); // customer 1's invoice must not move because of customer 2's payment
      });

      it('N4: does NOT flip a chain with conflicting ownership even when a matching approval exists (own group matches arithmetically, but a foreign child holds another payment in the same chain)', async () => {
         // Root 10's OWN (account/customer-scoped) group is arithmetically clean on its own —
         // magnitude 100 matches total_payments exactly, no reversal — so an approval for it
         // looks legitimate by the numbers alone. Child invoice 11 (customer 2, parent_invoice_id
         // 10) rolls its own payment 11 up into the SAME chain via COALESCE(parent_invoice_id,
         // customer_invoice_id) — root 10 is not safe to flip regardless (finding N4).
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
         await db('customer_invoices').insert([
            invoiceDefaults(ref, 1, { customer_invoice_id: 10, total_payments: 100, invoice_number: 'INV-10' }),
            invoiceDefaults(ref, 2, { customer_invoice_id: 11, total_payments: 0, invoice_number: 'INV-11', parent_invoice_id: 10 })
         ]);
         await db('customer_payments').insert([
            paymentDefaults(ref, 1, { payment_id: 10, customer_invoice_id: 10, payment_amount: -100 }),
            paymentDefaults(ref, 2, { payment_id: 11, customer_invoice_id: 11, payment_amount: -50 })
         ]);

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 10, 100.00, -100.00, ARRAY[10]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 10 }).first();
         expect(Number(row.total_payments)).to.equal(100); // unflipped despite a matching approval
      });

      it('N4: a foreign-only root (no payments of its own customer_id, only a foreign child\'s) is excluded structurally — even a fabricated approval cannot match it', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
         await db('customer_invoices').insert([
            invoiceDefaults(ref, 1, { customer_invoice_id: 13, total_payments: 50, invoice_number: 'INV-13' }),
            invoiceDefaults(ref, 2, { customer_invoice_id: 14, total_payments: 0, invoice_number: 'INV-14', parent_invoice_id: 13 })
         ]);
         await db('customer_payments').insert(paymentDefaults(ref, 2, { payment_id: 14, customer_invoice_id: 14, payment_amount: -50 }));

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 13, 50.00, -50.00, ARRAY[14]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 13 }).first();
         expect(Number(row.total_payments)).to.equal(50); // unflipped — no sums row exists for (root 13, customer 1)
      });

      it('N4: a clean root with no foreign payments anywhere in its chain is still flippable (ownership check is not overly broad) — this test only exercises the migration\'s own apply predicate, not the generator; see review-2026-09.spec.js for the "listed by the generator" half', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 15, total_payments: 75, invoice_number: 'INV-15' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 15, customer_invoice_id: 15, payment_amount: -75 }));

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 15, 75.00, -75.00, ARRAY[15]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 15 }).first();
         expect(Number(row.total_payments)).to.equal(-75);
      });

      it('R2: does NOT flip a root whose child invoice is FOREIGN-OWNED but has NO payment of its own, even with a matching approval', async () => {
         // Fixture 500/501 from the round-5 review probe: root 500 (customer 1) has its own
         // receipt (-100, arithmetically clean on its own). Child invoice 501 (customer 2,
         // parent_invoice_id 500) has NO payment at all. Before R2 the ownership check started
         // from customer_payments (an inner join), so a foreign child with no payment produced no
         // "bad" row to find and root 500 flipped anyway (probe.log:predicates:foreign-child-
         // no-payment — generated:true, applied:true — this was the live bug).
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1, 2] });
         await db('customer_invoices').insert([
            invoiceDefaults(ref, 1, { customer_invoice_id: 500, total_payments: 100, invoice_number: 'INV-500' }),
            invoiceDefaults(ref, 2, { customer_invoice_id: 501, total_payments: 0, invoice_number: 'INV-501', parent_invoice_id: 500 })
         ]);
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 500, customer_invoice_id: 500, payment_amount: -100 }));

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 500, 100.00, -100.00, ARRAY[500]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 500 }).first();
         expect(Number(row.total_payments)).to.equal(100); // unflipped despite a matching approval
      });

      it('R2: a SAME-OWNER child invoice with no payment of its own does NOT disqualify the root — it stays eligible and flips when approved', async () => {
         // Control for the fixture above: same shape (child with no payment), but the child
         // belongs to the SAME customer as the root. This must stay flippable — R2's fix must
         // not become so broad that it quarantines every root with an unpaid child, only ones
         // where that child is foreign-owned.
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert([
            invoiceDefaults(ref, 1, { customer_invoice_id: 100, total_payments: 100, invoice_number: 'INV-100' }),
            invoiceDefaults(ref, 1, { customer_invoice_id: 101, total_payments: 0, invoice_number: 'INV-101', parent_invoice_id: 100 })
         ]);
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 100, customer_invoice_id: 100, payment_amount: -100 }));

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 100, 100.00, -100.00, ARRAY[100]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 100 }).first();
         expect(Number(row.total_payments)).to.equal(-100); // flipped — the unpaid child is same-owner, not a conflict
      });

      it('flips a row when a reviewed manifest entry matches the live data exactly (the happy path)', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 4, 100.00, -100.00, ARRAY[6]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         expect(Number(row.total_payments)).to.equal(-100);
         const flipLog = await db('ledger_normalization_log').where({ migration: '019', table_name: 'customer_invoices', row_id: 4, column_name: 'total_payments' }).first();
         expect(flipLog).to.include({ old_value: '100.00', new_value: '-100.00' });
      });

      it('does NOT flip when a manifest entry exists but the live data has since changed (stale approval)', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

         // Manifest was reviewed against a DIFFERENT old total (say the accountant reviewed it
         // before a later correction changed the stored value) — must not apply.
         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 4, 999.00, -100.00, ARRAY[6]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         expect(Number(row.total_payments)).to.equal(100);
      });

      it('does NOT flip when the manifest payment-id set does not exactly match the live tagged payments', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

         // Manifest names a payment id that isn't actually tagged to this root.
         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 4, 100.00, -100.00, ARRAY[6, 999]);`
         );
         await db.transaction(trx => trx.raw(sql));

         const row = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         expect(Number(row.total_payments)).to.equal(100);
      });
   });

   describe('N6 — a chain with a reversal/positive event of its own never flips, even via a hand-approved manifest row', () => {
      it('does NOT flip a positive-only chain (no reversal), and does not repeatedly log a nonexistent change on rerun', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         // A single POSITIVE payment (not a negative one): magnitude (100) still matches
         // total_payments exactly and, taken alone, signed_net (100) matches too — but
         // positive_events = 1, not the fail-closed 0 the shipped generator itself requires. The
         // generator would never produce this row; this models a hand-edited manifest entry (see
         // the migration's own header comment and finding N6).
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: 100, customer_invoice_id: 4 }));

         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 4, 100.00, 100.00, ARRAY[6]);`
         );

         await db.transaction(trx => trx.raw(sql));
         const afterFirst = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         expect(Number(afterFirst.total_payments)).to.equal(100); // unchanged
         const logsAfterFirst = await db('ledger_normalization_log').where({ migration: '019', table_name: 'customer_invoices', row_id: 4, column_name: 'total_payments' });
         expect(logsAfterFirst).to.have.length(0);

         // Rerun: this row's own old_value/signed_net never change (100 -> 100 every time), so
         // without the s.positive_events = 0 guard the WHERE clause never self-invalidates and a
         // bug here would insert a fresh nonexistent-change log row on every single run.
         await db.transaction(trx => trx.raw(sql));
         const afterSecond = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         expect(Number(afterSecond.total_payments)).to.equal(100);
         const logsAfterSecond = await db('ledger_normalization_log').where({ migration: '019', table_name: 'customer_invoices', row_id: 4, column_name: 'total_payments' });
         expect(logsAfterSecond).to.have.length(0);
      });
   });

   describe('F3 — row-level before/after audit evidence', () => {
      it('logs every changed field (transaction_type, notes, payment reference) with before/after values', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_transactions').insert([
            transactionRow(ref, { transaction_id: 1, transaction_type: 'time', note: 'null', detailed_work_description: 'undefined' }),
            transactionRow(ref, { transaction_id: 2, transaction_type: 'charge', note: null, detailed_work_description: null })
         ]);
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 1, payment_amount: -10, note: 'null', payment_reference_number: 'undefined' }));
         await db('customer_writeoffs').insert(writeoffRow(ref, { writeoff_id: 1, writeoff_amount: -5, note: 'undefined' }));

         await db.transaction(trx => trx.raw(migrationSql()));

         const logs = await db('ledger_normalization_log').where({ migration: '019' }).select('table_name', 'row_id', 'column_name', 'old_value', 'new_value');
         const find = (table, rowId, col) => logs.find(l => l.table_name === table && l.row_id === rowId && l.column_name === col);

         expect(find('customer_transactions', 1, 'transaction_type')).to.include({ old_value: 'time', new_value: 'Time' });
         expect(find('customer_transactions', 2, 'transaction_type')).to.include({ old_value: 'charge', new_value: 'Charge' });
         expect(find('customer_transactions', 1, 'note')).to.include({ old_value: 'null', new_value: null });
         expect(find('customer_transactions', 1, 'detailed_work_description')).to.include({ old_value: 'undefined', new_value: null });
         expect(find('customer_payments', 1, 'note')).to.include({ old_value: 'null', new_value: null });
         expect(find('customer_payments', 1, 'payment_reference_number')).to.include({ old_value: 'undefined', new_value: null });
         expect(find('customer_writeoffs', 1, 'note')).to.include({ old_value: 'undefined', new_value: null });

         // And the actual column values were changed to match.
         const tx1 = await db('customer_transactions').where({ transaction_id: 1 }).first();
         expect(tx1.transaction_type).to.equal('Time');
         expect(tx1.note).to.equal(null);
         expect(tx1.detailed_work_description).to.equal(null);
      });

      it('is idempotent: a second run with no new dirty rows changes nothing and logs nothing new', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_transactions').insert(transactionRow(ref, { transaction_id: 1, transaction_type: 'time', note: 'null' }));

         await db.transaction(trx => trx.raw(migrationSql()));
         const countAfterFirst = Number((await db('ledger_normalization_log').count('*'))[0].count);
         expect(countAfterFirst).to.be.greaterThan(0);

         await db.transaction(trx => trx.raw(migrationSql()));
         const countAfterSecond = Number((await db('ledger_normalization_log').count('*'))[0].count);
         expect(countAfterSecond).to.equal(countAfterFirst);

         const tx1 = await db('customer_transactions').where({ transaction_id: 1 }).first();
         expect(tx1.transaction_type).to.equal('Time');
      });

      it('unconditional cleanup (casing, literal null/undefined) still runs even though the flip manifest is empty', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_transactions').insert(transactionRow(ref, { transaction_id: 1, transaction_type: 'charge', note: 'undefined' }));
         // Also seed an arithmetically-eligible-but-unreviewed positive parent, to confirm its
         // presence doesn't block the unconditional steps from running.
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));

         await db.transaction(trx => trx.raw(migrationSql()));

         const tx1 = await db('customer_transactions').where({ transaction_id: 1 }).first();
         expect(tx1.transaction_type).to.equal('Charge');
         expect(tx1.note).to.equal(null);
      });
   });

   describe('idempotency end-to-end (F2 + F3 together)', () => {
      it('running twice in a row with a matching manifest changes nothing new on the second run', async () => {
         const ref = await seedReferenceData(db, { accountId: 1, customerIds: [1] });
         await db('customer_invoices').insert(invoiceDefaults(ref, 1, { customer_invoice_id: 4, total_payments: 100, invoice_number: 'INV-4' }));
         await db('customer_payments').insert(paymentDefaults(ref, 1, { payment_id: 6, payment_amount: -100, customer_invoice_id: 4 }));
         const sql = withManifestRows(
            `INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES\n   (1, 1, 4, 100.00, -100.00, ARRAY[6]);`
         );

         await db.transaction(trx => trx.raw(sql));
         const afterFirst = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         const logCountFirst = Number((await db('ledger_normalization_log').count('*'))[0].count);

         // Second run: the manifest's expected_old_total (100.00) no longer matches the live
         // value (-100.00, already flipped), so the gated UPDATE naturally excludes it — proving
         // the manifest itself can't cause a double-flip.
         await db.transaction(trx => trx.raw(sql));
         const afterSecond = await db('customer_invoices').where({ customer_invoice_id: 4 }).first();
         const logCountSecond = Number((await db('ledger_normalization_log').count('*'))[0].count);

         expect(Number(afterFirst.total_payments)).to.equal(-100);
         expect(Number(afterSecond.total_payments)).to.equal(-100);
         expect(logCountSecond).to.equal(logCountFirst);
      });
   });
});

function transactionRow(ref, overrides) {
   return Object.assign(
      {
         account_id: ref.accountId,
         customer_id: 1,
         logged_for_user_id: ref.userId,
         created_by_user_id: ref.userId,
         general_work_description_id: ref.gwdId,
         transaction_date: '2026-01-01',
         unit_cost: 0,
         total_transaction: 0,
         is_transaction_billable: true,
         is_excess_to_subscription: false
      },
      overrides
   );
}

function writeoffRow(ref, overrides) {
   return Object.assign(
      {
         account_id: ref.accountId,
         customer_id: 1,
         created_by_user_id: ref.userId,
         writeoff_date: '2026-01-01',
         transaction_type: 'Write Off',
         writeoff_reason: 'Other'
      },
      overrides
   );
}
