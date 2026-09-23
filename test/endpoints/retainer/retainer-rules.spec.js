/**
 * Retainer lookups that decide which rows a payment delete may touch and what
 * the retainer picker offers. Query shapes are checked with a connection-less
 * knex (toSQL only); behaviour against real rows lives in
 * test/integration/payment-reversal.integration.spec.js.
 */
const knex = require('knex')({ client: 'pg' });
const retainersService = require('../../../src/endpoints/retainer/retainer-service');
const { restoreDataTypesRetainersTableOnCreate, restoreDataTypesRetainersTableOnUpdate } = require('../../../src/endpoints/retainer/retainerObjects');

describe('payment → retainer draw linkage (ledger-helpers.resolveRetainerDrawForPayment)', () => {
   const { legacyRetainerDrawCandidatesQuery, resolveRetainerDrawForPayment, retainerDrawMarker, parseRetainerDrawId } = require('../../../src/endpoints/payments/ledger-helpers');
   const explodingDb = () => {
      throw new Error('must not query');
   };

   // Minimal knex stand-in for the exact-marker path: `trx(table).select(...).where(filter).first()`
   // and `trx(table).where(filter).first()` over an in-memory retainer table.
   const fakeTrx = rows => () => {
      let filter = {};
      const chain = {
         select: () => chain,
         where: f => {
            filter = f;
            return chain;
         },
         first: async () => rows.find(r => Object.entries(filter).every(([k, v]) => Number(r[k]) === Number(v)))
      };
      return chain;
   };
   const root = { retainer_id: 5, parent_retainer_id: null, account_id: 1, customer_id: 7 };
   const draw = { retainer_id: 9, parent_retainer_id: 5, account_id: 1, customer_id: 7, current_amount: -180 };
   const payment = extra => ({ payment_id: 3, customer_id: 7, retainer_id: 5, note: `memo ${retainerDrawMarker(9)}`, ...extra });

   it('never queries for a payment that is not retainer-funded (a null chain id once matched every root retainer)', async () => {
      expect(await resolveRetainerDrawForPayment(explodingDb, 1, { payment_id: 3, customer_id: 7, retainer_id: null, note: retainerDrawMarker(9) })).to.equal(null);
      expect(await resolveRetainerDrawForPayment(explodingDb, 1, null)).to.equal(null);
   });

   it('the marker round-trips', () => {
      expect(retainerDrawMarker(42)).to.equal('[retainer_draw:42]');
      expect(parseRetainerDrawId(`paid [applied to INV-1; customer referenced INV-0] ${retainerDrawMarker(42)}`)).to.equal(42);
      expect(parseRetainerDrawId('no marker')).to.equal(null);
   });

   it('returns exactly the marked draw row', async () => {
      expect(await resolveRetainerDrawForPayment(fakeTrx([root, draw]), 1, payment())).to.deep.equal(draw);
      // A payment that referenced a snapshot id of the chain resolves to the same root.
      expect(await resolveRetainerDrawForPayment(fakeTrx([root, draw, { ...draw, retainer_id: 8, current_amount: -250 }]), 1, payment({ retainer_id: 8 }))).to.deep.equal(draw);
   });

   it('refuses a marker that names a missing row, a root, another customer’s draw or another chain’s draw — never guesses', async () => {
      const cases = [
         [[root], 'no longer exists'],
         [[root, { ...draw, parent_retainer_id: null }], 'is a retainer, not a draw-down entry'],
         [[root, { ...draw, customer_id: 99 }], 'belongs to a different customer'],
         [[root, { ...draw, parent_retainer_id: 77 }], 'is not a draw on retainer #5']
      ];
      for (const [rows, fragment] of cases) {
         let error = null;
         try {
            await resolveRetainerDrawForPayment(fakeTrx(rows), 1, payment());
         } catch (err) {
            error = err;
         }
         expect(error, fragment).to.be.an('error');
         expect(error.message).to.include(`Payment #3 records retainer draw #9, but that row ${fragment}`);
         expect(error.code).to.equal('RETAINER_DRAW_MISMATCH');
         expect(error.isLedgerRule).to.equal(true);
      }
   });

   it('legacy window: child rows of the chain, same customer, ±1 s of the payment, not claimed by another payment’s marker, no "closest" ordering', () => {
      const { sql, bindings } = legacyRetainerDrawCandidatesQuery(knex, 1, { rootRetainerId: 5, customerId: 7, paymentId: 3 }).toSQL();
      expect(sql).to.include('"r"."parent_retainer_id" = ?');
      expect(sql).to.include('"r"."customer_id" = ?');
      expect(sql).to.include('"p"."payment_id" = ?');
      expect(sql).to.include("interval '1 second'");
      expect(sql).to.include('not exists');
      expect(sql).to.include("claimed.note LIKE ('%[retainer_draw:' || r.retainer_id || ']%')");
      expect(sql).to.include('claimed.payment_id <> p.payment_id');
      expect(sql, 'every candidate is returned; the caller needs exactly one').to.not.include('ABS(');
      expect(sql.toLowerCase()).to.not.include('is null');
      expect(bindings).to.include.members([1, 5, 7, 3]);
   });

   it('the "closest timestamp" lookup is gone from retainer-service', () => {
      expect(retainersService.getRetainerBySameTime).to.equal(undefined);
   });
});

describe('retainer-service.getMostRecentRecordOfCustomerRetainers — picker', () => {
   it('ranks every row of the chain first, then keeps the latest only when it still has a balance', () => {
      const { sql } = retainersService.getMostRecentRecordOfCustomerRetainers(knex, 1, 7).toSQL();
      const [inner, outer] = sql.split(' as "sub"');
      expect(inner).to.include('ROW_NUMBER() OVER (PARTITION BY COALESCE(parent_retainer_id, retainer_id) ORDER BY created_at DESC, retainer_id DESC)');
      expect(inner, 'balance filter must not run before ROW_NUMBER').to.not.include('current_amount');
      expect(outer).to.include('"rn" = ?');
      expect(outer).to.include('"current_amount" < ?');
      expect(outer).to.include('"is_retainer_active" = ?');
   });
});

describe('retainer object mappers', () => {
   it('create: stored negative, always a new chain root', () => {
      const row = restoreDataTypesRetainersTableOnCreate({ parentRetainerID: 9, customerID: 7, accountID: 1, unitCost: 300, typeOfHold: 'Retainer', loggedByUserID: 21 });
      expect(row.parent_retainer_id).to.equal(null);
      expect(row.starting_amount).to.equal(-300);
      expect(row.current_amount).to.equal(-300);
      expect(row.is_retainer_active).to.equal(true);
      expect(row.note).to.equal(null);
   });

   it('update: never carries a client balance, active flag, parent or creator', () => {
      const row = restoreDataTypesRetainersTableOnUpdate({ retainerID: 4, parentRetainerID: 2, customerID: 7, unitCost: -400, currentAmount: -10, typeOfHold: 'Retainer', loggedByUserID: 21 });
      expect(row.starting_amount).to.equal(-400);
      ['current_amount', 'is_retainer_active', 'parent_retainer_id', 'created_by_user_id'].forEach(key => expect(row, key).to.not.have.property(key));
      expect(row.note).to.equal(undefined);
   });
});
