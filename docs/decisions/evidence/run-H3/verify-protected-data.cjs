'use strict';
// Run from DS2_Backend. This verifier only connects to the authorized local copy.
const fs = require('fs');
const path = require('path');
const { Client } = require(path.resolve('node_modules/pg'));
const out = __dirname;
const before = JSON.parse(fs.readFileSync(path.join(out, 'account1-before.json')));
const corrections = ['credit_memos', 'credit_memo_lines', 'credit_memo_reversals',
  'invoice_voids', 'rebill_links', 'client_refunds', 'correction_postings'];
const referenceCounts = { customers: 338, customer_transactions: 39052,
  customer_payments: 1005, customer_writeoffs: 657, customer_invoices: 2253,
  timesheet_entries: 28255, users: 23 };
const client = new Client({ host: '127.0.0.1', port: 5433, user: 'ds2',
  password: 'ds2local', database: 'ds2_local', ssl: false });
(async () => {
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const after = {};
    for (const table of Object.keys(before)) {
      if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected census table');
      const result = await client.query(`SELECT count(*)::integer AS count,
        md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '')) AS digest
        FROM ${table} t WHERE account_id=1`);
      after[table] = result.rows[0];
    }
    const correctionCounts = {};
    for (const table of corrections) {
      correctionCounts[table] = (await client.query(`SELECT count(*)::integer AS count FROM ${table} WHERE account_id=1`)).rows[0].count;
    }
    const audit = (await client.query('SELECT ds2_verify_audit(1) AS result')).rows[0].result;
    await client.query('ROLLBACK');
    const changes = Object.keys(before).filter(table => JSON.stringify(before[table]) !== JSON.stringify(after[table]));
    const referenceMismatches = Object.keys(referenceCounts).filter(table => after[table].count !== referenceCounts[table]);
    const report = { checked_at: new Date().toISOString(), connection: '127.0.0.1:5433/ds2_local',
      method: 'Read-only repeatable-read count and sorted whole-row MD5 comparison against captured H3 before evidence.',
      reference_basis: 'Retained reference census in the H2 results and FINAL_REPORT; no connection to ds2_ref_20260922.',
      unchanged: changes.length === 0, changed_tables: changes,
      retained_reference_counts: referenceCounts, reference_mismatches: referenceMismatches,
      correction_rows: correctionCounts, audit };
    fs.writeFileSync(path.join(out, 'account1-after.json'), JSON.stringify(after, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'account1-verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (changes.length || referenceMismatches.length || Object.values(correctionCounts).some(Boolean) || !audit.valid || audit.checked_events !== before.audit_events.count) process.exitCode = 1;
  } finally { await client.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
