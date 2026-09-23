/* eslint-disable no-console */
// Smoke-print the Accounts Receivable aging service (read-only).
//   node scripts/test-ar-aging.js                                             # prod
//   DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/test-ar-aging.js   # sandbox
const knex = require('./_db').makeDb({ envFile: '.env.prod', database: 'ds2_prod', poolMax: 2 });
const svc = require('../src/endpoints/accountsReceivable/accounts-receivable-service');
const fmt = n => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = d => (d ? new Date(d).toISOString().slice(0, 10) : '—');

// Field names are the service's response shape: oldest_days is STATEMENT age
// (days since statement_date); oldest_open_charge_days is the real receivable
// age (oldest billed charge still unpaid, FIFO).
const line = r =>
   `  cid=${String(r.customer_id).padEnd(4)} ${(r.display_name || '').slice(0, 30).padEnd(30)} ` +
   `stmt=${fmtDate(r.statement_date)} (${String(r.oldest_days).padStart(4)}d) ` +
   `oldestOpen=${fmtDate(r.oldest_open_charge_date)} (${r.oldest_open_charge_days == null ? '—' : `${r.oldest_open_charge_days}d`}) ` +
   `out=${fmt(r.total_outstanding).padStart(10)}  ` +
   `[0-30=${fmt(r.bucket_0_30)} 31-60=${fmt(r.bucket_31_60)} 61-90=${fmt(r.bucket_61_90)} >90=${fmt(r.bucket_over_90)}] ` +
   `lastPmt=${fmtDate(r.last_payment_date)} work-since=${r.has_work_since_last_payment}` +
   `${r.statement_count > 1 ? ` statements=${r.statement_count}` : ''}${r.is_customer_active === false ? ' INACTIVE' : ''}`;

(async () => {
   const { rows, totalCount } = await svc.getAging(knex, 1, { limit: 8, offset: 0 });
   console.log('totalCount:', totalCount);
   console.log('first 8 (oldest statement first):');
   rows.forEach(r => console.log(line(r)));

   console.log('\nsearch "red rock":');
   const r2 = await svc.getAging(knex, 1, { limit: 5, offset: 0, search: 'red rock' });
   r2.rows.forEach(r => console.log(line(r)));

   console.log('\nsearch "wild west":');
   const r3 = await svc.getAging(knex, 1, { limit: 5, offset: 0, search: 'wild west' });
   r3.rows.forEach(r => console.log(line(r)));

   await knex.destroy();
})().catch(e => {
   console.error('ERR', e.message);
   console.error(e.stack);
   process.exit(1);
});
