/* eslint-disable no-console */
/* Diagnostic: show full invoice tree (parents + children) for one customer */
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
   pool: { min: 0, max: 4 }
});

const cidArg = process.argv[2];
if (!cidArg) {
   console.log('usage: node scripts/diag-customer.js <customer_id>');
   process.exit(1);
}
const cid = Number(cidArg);
const fmt = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

(async () => {
   const cust = await knex('customers').where('customer_id', cid).first();
   console.log(`\n=== ${cust?.display_name || cust?.business_name} (cid=${cid}) ===\n`);

   const parents = await knex('customer_invoices')
      .where('customer_id', cid)
      .andWhere('account_id', 1)
      .andWhere('parent_invoice_id', null)
      .orderBy('invoice_date', 'desc');

   console.log(`PARENTS (parent_invoice_id IS NULL): ${parents.length}`);
   for (const p of parents) {
      const d = new Date(p.invoice_date).toISOString().slice(0, 10);
      console.log(`  ${p.invoice_number}  cid_invoice_id=${p.customer_invoice_id}  ${d}  bb=${fmt(p.beginning_balance)}  chg=${fmt(p.total_charges)}  rem=${fmt(p.remaining_balance_on_invoice)}  paid=${p.is_invoice_paid_in_full}`);
      const children = await knex('customer_invoices')
         .where('parent_invoice_id', p.customer_invoice_id)
         .andWhereNot('customer_invoice_id', p.customer_invoice_id)
         .orderBy('created_at', 'desc');
      if (children.length) {
         console.log(`    children: ${children.length}`);
         children.forEach(c => {
            const cd = new Date(c.created_at).toISOString().slice(0, 10);
            console.log(`       ${c.invoice_number}  ${cd}  rem=${fmt(c.remaining_balance_on_invoice)}  paid=${c.is_invoice_paid_in_full}`);
         });
      }
   }

   // Total of all rows with remaining > 0
   const totalOpen = parents.reduce((s, r) => s + Number(r.remaining_balance_on_invoice || 0), 0);
   console.log(`\nSum of open parent remainders: ${fmt(totalOpen)}`);

   await knex.destroy();
})();
