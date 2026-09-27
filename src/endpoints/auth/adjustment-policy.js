'use strict';
// Decide authority before business/form validation. Route-local requireAdmin
// guards remain the final gate; malformed selections never bypass a 403.
function isAdjustment(req) {
 if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return false;
 const path=req.originalUrl.split('?')[0];
 return /^\/writeOffs\/(createWriteOffs|updateWriteOffs|deleteWriteOffs)\//.test(path)
  || /^\/retainers\/[^/]+\/events\//.test(path)
  || (/^\/duplicates\/[^/]+\/resolve\//.test(path) && req.body?.action==='remove')
  || /^\/payments\/reversePayment\//.test(path)
  || /^\/payments\/receipts\/[^/]+\/(applications\/[^/]+\/correct|exceptions|reversals|resolve|cancellations)$/.test(path)
  || /^\/invoices\/[^/]+\/(exceptions(?:\/|$)|credit-memos$|void-rebill(?:\/preview)?$)/.test(path)
  || /^\/credit-memos\/[^/]+\/reversals$/.test(path)
  || /^\/credits\/(transfers|[^/]+\/refunds)$/.test(path)
  || /^\/billing-entities\/transfers$/.test(path);
}
module.exports={isAdjustment};
