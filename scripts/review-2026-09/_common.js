'use strict';
const fs = require('fs');
const path = require('path');
const { makeDb } = require('../_db');

function csv(rows, columns) {
  const keys = columns || [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (!keys.length) keys.push('status');
  const cell = value => {
    let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Protect spreadsheet users from formulas; preserve genuine signed numbers.
    if (/^[=+@\-\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [keys.map(cell).join(','), ...rows.map(row => keys.map(k => cell(row[k])).join(','))].join('\n') + '\n';
}
function emit(prefix, label, rows, columns) {
  console.log(`\n${label}: ${rows.length} row(s)`);
  console.table(rows);
  fs.writeFileSync(`${prefix}.${label}.csv`, csv(rows, columns));
}
const cents = value => {
  if (value == null) throw new Error('Cannot treat NULL money as zero');
  const s = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money: ${s}`);
  const [whole, fraction = ''] = s.replace('-', '').split('.');
  return (s.startsWith('-') ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
};
const money = n => `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, '0')}`;
const sum = (rows, key) => money(rows.reduce((n, r) => n + cents(r[key]), 0n));
async function run(name, repairable, analyze, repair) {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!['--apply', '--i-know-this-is-prod'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  const apply = args.has('--apply');
  if (apply && !repairable) throw new Error(`${name} is read-only; --apply is not supported`);
  if (!process.env.DS2_ENV_FILE || !process.env.DATABASE_NAME) throw new Error('Set DS2_ENV_FILE and DATABASE_NAME explicitly (run from DS2_Backend).');
  const db = makeDb({ poolMax: 1 });
  try {
    const identity = (await db.raw('SELECT current_database() AS database, current_user AS role')).rows[0];
    if (apply && identity.database === 'ds2_local') throw new Error('--apply is forbidden on ds2_local. Use ds2_repair_test.');
    if (apply && identity.database === 'ds2_prod' && !args.has('--i-know-this-is-prod')) throw new Error('Refusing ds2_prod: --i-know-this-is-prod required.');
    // Generated evidence goes to out/ (gitignored) so the script folder stays clean. N5 fix:
    // tests must never write into or delete this shared operator directory — DS2_REVIEW_OUT_DIR
    // lets a caller (test/scripts/review-2026-09.spec.js) redirect output to a private temp dir.
    const outDir = process.env.DS2_REVIEW_OUT_DIR || path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const prefix = path.join(outDir, `${name}.${identity.database.replace(/[^a-zA-Z0-9_-]/g, '_')}.${apply ? 'apply' : 'dry-run'}`);
    console.log(JSON.stringify({ ...identity, account_id: 1, mode: apply ? 'APPLY' : 'READ ONLY' }));
    let summary;
    await db.transaction(async trx => {
      await trx.raw(apply ? 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE' : 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await trx.raw("SET LOCAL lock_timeout = '10s'");
      if (apply) await trx.raw('LOCK TABLE customers, customer_jobs, customer_invoices, customer_transactions, customer_payments, customer_writeoffs IN SHARE ROW EXCLUSIVE MODE');
      const result = await analyze(trx);
      emit(prefix, 'report', result.rows, result.columns);
      for (const [label, rows] of Object.entries(result.details || {})) emit(prefix, label, rows);
      summary = result.summary;
      if (apply) {
        const changes = await repair(trx, result);
        emit(prefix, 'before', changes.before);
        emit(prefix, 'after', changes.after);
        summary = { ...summary, changed_rows: changes.before.length };
      }
    });
    fs.writeFileSync(`${prefix}.summary.json`, JSON.stringify({ ...identity, account_id: 1, mode: apply ? 'apply' : 'dry-run', run_at: new Date().toISOString(), ...summary }, null, 2) + '\n');
    console.log(`SUMMARY ${JSON.stringify(summary)}`);
    console.log(`Evidence prefix: ${prefix}`);
  } finally { await db.destroy(); }
}
function main(...args) { run(...args).catch(error => { console.error(error.stack); process.exitCode = 1; }); }
async function rows(db, sql, bindings = []) { return (await db.raw(sql, bindings)).rows; }
async function changeRows(db, table, key, targets, mutate) {
  const before = [], after = [];
  for (const target of targets) {
    const id = target[key];
    const oldResult = await db(table).select(db.raw('to_jsonb(??) AS row', [table])).where(key, id).first();
    const old = oldResult?.row;
    if (!old) throw new Error(`Missing ${table} ${id}`);
    before.push(old);
    // Print before performing the write, in addition to durable CSV evidence.
    console.log('BEFORE'); console.table([old]);
    await mutate(target, old);
    const updatedResult = await db(table).select(db.raw('to_jsonb(??) AS row', [table])).where(key, id).first();
    const updated = updatedResult?.row;
    after.push(updated || { [key]: id, state: 'DELETED' });
    console.log('AFTER'); console.table([after[after.length - 1]]);
  }
  return { before, after };
}
module.exports = { main, rows, emit, cents, money, sum, changeRows, csv };
