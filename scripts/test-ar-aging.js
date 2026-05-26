require('dotenv').config({ path: '.env.prod' });
const knex = require('knex')({
   client: 'pg',
   connection: {
      host: process.env.DB_PROD_HOST,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: 'ds2_prod',
      port: 5432,
      ssl: { rejectUnauthorized: false }
   },
   pool: { min: 0, max: 2 }
});
const svc = require('../src/endpoints/accountsReceivable/accounts-receivable-service');
const fmt = n => `$${Number(n || 0).toFixed(2)}`;

(async () => {
   const { rows, totalCount } = await svc.getAging(knex, 1, { limit: 8, offset: 0 });
   console.log('totalCount:', totalCount);
   console.log('first 8 (oldest debt first):');
   rows.forEach(r => {
      const name = (r.display_name || '').slice(0, 30).padEnd(30);
      console.log(
         `  cid=${String(r.customer_id).padEnd(4)} ${name} days=${String(r.days_outstanding).padStart(4)} ` +
            `out=${fmt(r.total_outstanding).padStart(10)}  ` +
            `[0-30=${fmt(r.bucket_0_30)} 31-60=${fmt(r.bucket_31_60)} 61-90=${fmt(r.bucket_61_90)} >90=${fmt(r.bucket_over_90)}] ` +
            `lastPmt=${r.last_payment_date ? new Date(r.last_payment_date).toISOString().slice(0, 10) : '—'} ` +
            `work-since=${r.has_work_since_last_payment}`
      );
   });

   console.log('\nsearch "red rock":');
   const r2 = await svc.getAging(knex, 1, { limit: 5, offset: 0, search: 'red rock' });
   r2.rows.forEach(r =>
      console.log(`  cid=${r.customer_id} ${r.display_name} days=${r.days_outstanding} out=${fmt(r.total_outstanding)}`)
   );

   console.log('\nsearch "wild west":');
   const r3 = await svc.getAging(knex, 1, { limit: 5, offset: 0, search: 'wild west' });
   r3.rows.forEach(r =>
      console.log(`  cid=${r.customer_id} ${r.display_name} days=${r.days_outstanding} out=${fmt(r.total_outstanding)}`)
   );

   await knex.destroy();
})().catch(e => {
   console.error('ERR', e.message);
   console.error(e.stack);
   process.exit(1);
});
