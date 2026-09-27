'use strict';
// Enumerate the actual Express contracts so new routes cannot silently escape
// the round-two login/role matrix. Feature suites supply valid object fixtures.
const routes=[];
function add(router,prefix,feature,role,filter=()=>true){
 for(const layer of router.stack){if(!layer.route || !filter(layer.route.path))continue;
  for(const method of Object.keys(layer.route.methods))routes.push({method,path:prefix+(layer.route.path==='/'?'':layer.route.path),feature,role:typeof role==='function'?role(layer.route.path,method):role});
 }
}
add(require('../../src/endpoints/billingEntities/entities-router'),'/billing-entities','H1',(p,m)=>m!=='get'?'admin':p==='/transfers'?'employee':['/','/balances','/cutover/candidates'].includes(p)?'manager':'admin');
add(require('../../src/endpoints/payments/payments-router'),'/payments','H2',(p,m)=>m==='get' || p==='/receipts'?'manager':'admin',p=>p==='/open-obligations' || p.startsWith('/receipts'));
add(require('../../src/endpoints/payments/credits-router'),'/credits','H2',(p,m)=>m==='get'?'manager':'admin');
const corrections=require('../../src/endpoints/corrections/corrections-router');
for(const [name,prefix]of [['invoices','/invoices'],['credits','/credits'],['memos','/credit-memos'],['refunds','/refunds'],['voids','/invoice-voids']])add(corrections[name],prefix,'H3',(p,m)=>m==='get'?'manager':'admin');
add(require('../../src/endpoints/recurringCustomer/recurring-billing-router'),'/recurringCustomer','H4','manager');
add(require('../../src/endpoints/analytics/analytics-router'),'/analytics','H5','super admin',p=>p.startsWith('/billingPerformance/'));
module.exports=routes;
