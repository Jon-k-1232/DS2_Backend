'use strict';
const crypto=require('crypto');
// SQL rowsets without ORDER BY have no stable presentation order (the old
// readers themselves change with parallel scan scheduling). Canonicalize those
// sets and object keys only. Every value, type, record and calculated decimal is
// retained; ordered public reports are compared separately without this step.
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value && typeof value==='object' && !(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const bytes=value=>JSON.stringify(canonical(value));
const digest=value=>crypto.createHash('sha256').update(bytes(value)).digest('hex');
module.exports={canonical,bytes,digest};
