/* eslint-disable no-console */
/*
   Walks a list of customer names, runs the SAME calculateInvoices engine the
   Create Invoice page uses, and prints a per-customer breakdown:

      - matched customer (display_name / business_name / customer_id)
      - lastBillDate
      - parent_invoice rows still showing remaining > 0 (old "outstanding" view)
      - chain-aware getOutstandingInvoices result (what we now feed the engine)
      - calculated invoice_total (what the user will see in the UI)
      - sanity flag if old-view total >> new-view total (rolling-balance pattern)
*/

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

const invoiceService = require('../src/endpoints/invoice/invoice-service');
const { fetchInitialQueryItems } = require('../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');

const ACCOUNT_ID = 1;

const NAMES = [
   'Wild West Jeep Tours',
   'Walk and Talk',
   'Alexander and Bonnie Arndt and Wheeler',
   'Exodus Sales Collective, LLC',
   'Charles and Rose Lieb',
   'Catapult Strategic Design',
   'David Ropars',
   'Isaias and Virginia Colop-Xec',
   'Ivan Halvorson',
   'Jake and Jessie Guenther',
   'Janet Limmer',
   'John and Colleen Cappelli',
   'Jonathon and Kathy Kimmel',
   'Keith and Jackie Kimbrell',
   "Keith's Landscaping",
   'Lori Metcalf',
   'Raul and Debbie Aizcorbe',
   'Mesquite Electric',
   'Richard Rizzo Electric, Inc',
   'K&R Restaurant',
   'Robert Younadim',
   'Umta Enterprises',
   'Garden of Eden',
   'Pita Heaven',
   'Roost Denver Inc',
   'Orange Tree Pool Service, LLC',
   'Red Rock Windows and Doors',
   'Tomo Buncic',
   'OPACS, INC',
   'Tricia Schafer',
   'Tyson Cahoon'
];

const fmt = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function resolveCustomer(name) {
   const norm = name.toLowerCase();
   const rows = await knex('customers')
      .select('customer_id', 'display_name', 'business_name', 'customer_name')
      .where('account_id', ACCOUNT_ID)
      .andWhere(b =>
         b.whereRaw('LOWER(display_name) = ?', [norm])
            .orWhereRaw('LOWER(business_name) = ?', [norm])
            .orWhereRaw('LOWER(customer_name) = ?', [norm])
      );
   if (rows.length) return rows[0];

   const like = `%${norm}%`;
   const fuzzy = await knex('customers')
      .select('customer_id', 'display_name', 'business_name', 'customer_name')
      .where('account_id', ACCOUNT_ID)
      .andWhere(b =>
         b.whereRaw('LOWER(display_name) LIKE ?', [like])
            .orWhereRaw('LOWER(business_name) LIKE ?', [like])
            .orWhereRaw('LOWER(customer_name) LIKE ?', [like])
      )
      .limit(2);
   return fuzzy[0] || null;
}

async function auditCustomer(name) {
   const customer = await resolveCustomer(name);
   if (!customer) {
      console.log(`\n=== ${name} ===  ❌ NOT FOUND`);
      return;
   }

   const cid = customer.customer_id;
   const lastBillRow = await invoiceService.getLastInvoiceDatesByCustomerID(knex, ACCOUNT_ID, [cid]);
   const lastBillDate = lastBillRow[cid];

   // Raw parent-invoice view: every standalone parent with remaining > 0 (old "outstanding")
   const rawOpenParents = await knex('customer_invoices')
      .select('customer_invoice_id', 'invoice_number', 'invoice_date', 'beginning_balance', 'total_charges', 'remaining_balance_on_invoice', 'is_invoice_paid_in_full', 'parent_invoice_id')
      .where('account_id', ACCOUNT_ID)
      .andWhere('customer_id', cid)
      .andWhere('parent_invoice_id', null)
      .andWhere('remaining_balance_on_invoice', '>', 0)
      .orderBy('invoice_date', 'desc');

   const oldOutstandingTotal = rawOpenParents.reduce((s, r) => s + Number(r.remaining_balance_on_invoice || 0), 0);

   // Run the actual engine the page uses
   const invoicesToCreate = [{ customer_id: cid, showWriteOffs: false }];
   const invoicesToCreateMap = { [cid]: invoicesToCreate[0] };
   let computedTotal = null;
   let chainOutstanding = null;
   let engineError = null;
   try {
      const qd = await fetchInitialQueryItems(knex, invoicesToCreateMap, ACCOUNT_ID);
      chainOutstanding = qd.customerOutstandingInvoices[cid] || [];
      const calc = calculateInvoices(invoicesToCreate, qd);
      computedTotal = Number(calc[0]?.invoiceTotal || 0);
   } catch (e) {
      engineError = e.message;
   }

   const chainOutstandingTotal = chainOutstanding ? chainOutstanding.filter(r => !r.parent_invoice_id || r.parent_invoice_id === r.customer_invoice_id).reduce((s, r) => s + Number(r.remaining_balance_on_invoice || 0), 0) : null;

   const inflation = oldOutstandingTotal > 0 && computedTotal != null ? oldOutstandingTotal - computedTotal : 0;
   const flag = inflation > 100 ? '  ⚠️  ROLLED-FORWARD (old view inflated)' : '';

   console.log(`\n=== ${customer.display_name || customer.business_name || customer.customer_name} (cid=${cid}) ===${flag}`);
   console.log(`   lastBillDate:          ${lastBillDate ? new Date(lastBillDate).toISOString().slice(0, 10) : '(none)'}`);
   console.log(`   open parent invoices:  ${rawOpenParents.length}`);
   if (rawOpenParents.length && rawOpenParents.length <= 6) {
      rawOpenParents.forEach(r => {
         const d = new Date(r.invoice_date).toISOString().slice(0, 10);
         console.log(`      ${r.invoice_number}  ${d}  bb=${fmt(r.beginning_balance)}  chg=${fmt(r.total_charges)}  rem=${fmt(r.remaining_balance_on_invoice)}`);
      });
   } else if (rawOpenParents.length > 6) {
      rawOpenParents.slice(0, 3).forEach(r => {
         const d = new Date(r.invoice_date).toISOString().slice(0, 10);
         console.log(`      ${r.invoice_number}  ${d}  bb=${fmt(r.beginning_balance)}  chg=${fmt(r.total_charges)}  rem=${fmt(r.remaining_balance_on_invoice)}`);
      });
      console.log(`      … and ${rawOpenParents.length - 3} more`);
   }
   console.log(`   raw outstanding sum:   ${fmt(oldOutstandingTotal)}  (every open parent counted)`);
   if (chainOutstandingTotal != null) console.log(`   chain-gated parents:   ${fmt(chainOutstandingTotal)}  (post-fix view)`);
   if (engineError) {
      console.log(`   ❌ engine error: ${engineError}`);
   } else {
      console.log(`   ➡  invoice_total:      ${fmt(computedTotal)}   (what the Create-Invoice page now shows)`);
   }
}

(async () => {
   for (const n of NAMES) {
      try {
         await auditCustomer(n);
      } catch (e) {
         console.log(`\n=== ${n} ===  ❌ ${e.message}`);
      }
   }
   await knex.destroy();
})();
