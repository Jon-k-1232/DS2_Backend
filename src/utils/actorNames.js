'use strict';

// Presentation only: never add mutable names to an issued payload or ledger fingerprint.
// Inactive staff remain valid historical actors. Never resolve a name across accounts.
async function actorNames(db, accountId, records, actorKey='actor_id', nameKey='actor_name') {
 const ids=[...new Set(records.map(r=>r[actorKey]).filter(Boolean))];
 const users=ids.length ? await db('public.users').select('user_id','display_name').where({account_id:accountId}).whereIn('user_id',ids) : [];
 const names=new Map(users.map(u=>[String(u.user_id),u.display_name]));
 return records.map(r=>({...r,[nameKey]:r[actorKey] ? names.get(String(r[actorKey])) || 'Name not recorded' : 'System'}));
}
module.exports=actorNames;
