'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
const storage = new AsyncLocalStorage();

// Knex creates transaction clients from the dialect prototype, not the pool
// instance. Install at that one execution boundary so standalone legacy writes,
// explicit transactions, cascades and async ingestion use the same context.
const PgClient = require('knex/lib/dialects/postgres');
const originalQuery = PgClient.prototype.query;
const control = /^\s*(?:begin|commit|rollback|savepoint|release|set)\b/i;
const writes = /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:insert|update|delete|with)\b/i;
async function setContext(client, connection, ctx) {
   const user = ctx.request?.user || ctx.user;
   const req = ctx.request;
   const source = req ? `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}` : ctx.source;
   await originalQuery.call(client, connection, {
      sql: "SELECT set_config('app.actor_user_id', ?, true), set_config('app.actor_name', ?, true), set_config('app.audit_source', ?, true), set_config('app.correlation_id', ?, true), set_config('app.audit_reason', ?, true)",
      bindings: [user?.user_id ? String(user.user_id) : '', user?.display_name || '', source || 'system/application', ctx.correlationId, ctx.reason || '']
   });
   // Acquire the chain lock BEFORE customer/user/job locks. Acquiring it only
   // in an AFTER trigger could deadlock an employee deletion against a work
   // insert that already held the chain lock and waited for that employee FK.
   // Explicit read-only snapshots must stay nonblocking (and may be concurrent
   // with the writer used to validate their repeatable-read behavior).
   const accountId=user?.account_id || ctx.accountId;
   if(accountId && !connection.__ds2AuditReadOnly && connection.__ds2AuditAccountLocked!==Number(accountId)) {
      await originalQuery.call(client,connection,{sql:'SELECT pg_advisory_xact_lock(260026, ?::integer)',bindings:[Number(accountId)]});
      connection.__ds2AuditAccountLocked=Number(accountId);
   }
}
PgClient.prototype.query = async function auditQuery(connection, query) {
   const ctx = storage.getStore();
   const sql = typeof query === 'string' ? query : query.sql;
   if (!ctx) return originalQuery.call(this, connection, query);
   // SET TRANSACTION must precede the first query, including set_config.
   // Refresh context on transaction queries, after those control statements.
   if (control.test(sql)) {
      if(/^\s*begin\b/i.test(sql)){connection.__ds2AuditAccountLocked=null;connection.__ds2AuditReadOnly=/read\s+only/i.test(sql);}
      if(/^\s*set\s+transaction\b/i.test(sql) && /read\s+(only|write)/i.test(sql))connection.__ds2AuditReadOnly=/read\s+only/i.test(sql);
      const result=await originalQuery.call(this, connection, query);
      // PostgreSQL releases locks obtained inside a rolled-back savepoint.
      // Reacquire before the next business query even when the outer request
      // transaction continues; any earlier surviving lock is simply reentrant.
      if(/^\s*rollback\b/i.test(sql))connection.__ds2AuditAccountLocked=null;
      if(/^\s*(commit|rollback)\b/i.test(sql) && !/\bto\b/i.test(sql)){connection.__ds2AuditAccountLocked=null;connection.__ds2AuditReadOnly=false;}
      return result;
   }
   if (this.transacting) {
      await setContext(this, connection, ctx);
      return originalQuery.call(this, connection, query);
   }
   if (!writes.test(sql)) return originalQuery.call(this, connection, query);
   // Legacy one-statement writes also get atomic context and trigger capture.
   connection.__ds2AuditAccountLocked=null;connection.__ds2AuditReadOnly=false;
   await originalQuery.call(this, connection, 'BEGIN');
   try {
      await setContext(this, connection, ctx);
      const result = await originalQuery.call(this, connection, query);
      await originalQuery.call(this, connection, 'COMMIT');
      return result;
   } catch (error) {
      await originalQuery.call(this, connection, 'ROLLBACK');
      throw error;
   } finally {
      connection.__ds2AuditAccountLocked=null;connection.__ds2AuditReadOnly=false;
   }
};
function middleware(req, res, next) {
   const correlationId = randomUUID();
   res.setHeader('X-Correlation-ID', correlationId);
   storage.run({ request: req, correlationId }, next);
}
function asSystem(source, fn) {
   const parent=storage.getStore();
   return storage.run({ source, accountId:parent?.request?.user?.account_id || parent?.accountId, correlationId: parent?.correlationId || randomUUID() }, fn);
}
module.exports = { middleware, asSystem, storage };
