'use strict';
const {ruleError}=require('../endpoints/payments/ledger-helpers');
function lookupParams(query) {
 const number=(key,fallback,max)=>{const v=query[key]??fallback;if(!['number','string'].includes(typeof v) || !/^[1-9]\d*$/.test(String(v)) || Number(v)>max)throw ruleError(`Invalid ${key}.`,400);return Number(v);};
 const page=number('page',1,1000000),limit=number('limit',20,100);
 if(query.search!=null && (typeof query.search!=='string' || query.search.length>200))throw ruleError('Search must be at most 200 characters.',400);
 if(query.sort!=null && typeof query.sort!=='string')throw ruleError('Invalid sort column.',400);
 const direction=query.direction || 'asc';if(!['asc','desc'].includes(direction))throw ruleError('Invalid sort direction.',400);
 return {page,limit,offset:(page-1)*limit,searchTerm:(query.search||'').trim(),sort:query.sort || undefined,direction};
}
module.exports={lookupParams};
