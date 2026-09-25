'use strict';
const { assertScenarioEnvironment } = require('../../scripts/scenarios/guard');
const { Scenario, expect, ok } = require('./_scenario');
const routes = require('../fixtures/path-matrix-routes.json');

// A refusal must preserve every committed table, including evidence and queue
// metadata. PostgreSQL sequences intentionally are not transactional.
class PathScenario extends Scenario {
   async allState() {
      assertScenarioEnvironment();
      const tables = (await this.db.raw("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
      const sql = tables.map(t => `SELECT ?::text AS table_name, count(*)::text AS rows, md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '')) AS digest FROM ?? t`).join(' UNION ALL ');
      // PostgreSQL may execute UNION ALL arms in parallel; table order is not
      // a database change. Sort before comparing the complete row digests.
      return (await this.db.raw(sql, tables.flatMap(t => [t,t]))).rows.sort((a,b)=>a.table_name.localeCompare(b.table_name));
   }
   async refused(action, http, status, message) {
      const before = await this.allState();
      const res = await action();
      expect(res.status, JSON.stringify(res.body)).to.equal(http);
      if (status !== undefined) expect(res.body.status, JSON.stringify(res.body)).to.equal(status);
      expect(String(res.body.message || res.body.error || ''), JSON.stringify(res.body)).to.match(message);
      const after = await this.allState();
      const changes = after.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index])).map(row => row.table_name);
      expect(after, 'refusal must preserve every committed row, including audit and queue metadata; changed: '+changes.join(', ')).to.deep.equal(before);
      return res;
   }
   async stub(object, key, replacement, action) {
      assertScenarioEnvironment();
      const original = object[key];
      expect(original, `stub target ${key}`).to.be.a('function');
      let calls = 0;
      object[key] = function (...args) { calls++; return replacement.apply(this,args); };
      try { const result = await action(); expect(calls, `injected boundary ${key} must be reached`).to.be.above(0); return result; }
      finally { object[key] = original; }
   }
   async fail(object, key, action, message='path-matrix injected failure') {
      return this.stub(object,key,async()=>{throw Error(message);},action);
   }
   async queryFault(pattern, action, { after=0, message='path-matrix injected database failure', empty=false }={}) {
      assertScenarioEnvironment();
      const proto = Object.getPrototypeOf(this.db.client);
      const original = proto.query; let matches=0, failures=0;
      proto.query = function(connection,query,...rest) {
         const sql = typeof query==='string'?query:query.sql;
         if (!/AS table_name/.test(sql) && pattern.test(sql) && matches++>=after) {
            failures++;
            if(empty) { query.response={command:'UPDATE',rowCount:0,rows:[]}; return Promise.resolve(query); }
            return Promise.reject(Error(message));
         }
         return original.call(this,connection,query,...rest);
      };
      try { const result=await action();expect(failures,'database fault must be reached').to.be.above(0);return result; }
      finally { proto.query=original; }
   }
}
function url(route, params={}) {
   return route.path.replace(':accountID',String(params.accountID ?? 1))
      .replace(/:([A-Za-z]+)/g,(_,name)=>String(params[name] ?? (name==='userID'||name==='queryUserID'?1:2147483646)))
      .replace('*','retired');
}
module.exports={PathScenario,expect,ok,routes,url};
