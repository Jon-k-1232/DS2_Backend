const {historicalBalance}=require('../../../src/endpoints/payments/legacy-obligations');
describe('Legacy snapshots use the billing calendar at the UTC day boundary',()=>{
 const root={customer_invoice_id:1,parent_invoice_id:null,invoice_date:'2026-09-01',created_at_exact:'2026-09-01 12:00:00',remaining_balance_on_invoice:'300.00'};
 const paid={...root,customer_invoice_id:2,parent_invoice_id:1,created_at_exact:'2026-09-27 01:00:00',remaining_balance_on_invoice:'120.00'};
 it('a 6pm Arizona payment remains visible in that day’s AR report',()=>expect(historicalBalance([root,paid],{asOf:'2026-09-26',recordedThrough:'2026-09-27T02:00:00Z'})).eq(12000));
 it('yesterday and a knowledge cutoff before the payment retain the original balance',()=>{
  expect(historicalBalance([root,paid],{asOf:'2026-09-25',recordedThrough:'2026-09-27T02:00:00Z'})).eq(30000);
  expect(historicalBalance([root,paid],{asOf:'2026-09-26',recordedThrough:'2026-09-27T00:30:00Z'})).eq(30000);
 });
});
