/**
 * Minimal in-memory stand-in for the slice of knex used by the Billing Review
 * code (cascadeEdit + billingReview-service). Not a SQL engine — just enough
 * query-builder surface to exercise the ledger logic without a database:
 *
 *   db(table).where(obj | col, val | col, op, val | fn).andWhere/orWhere/whereNot/
 *     whereNull/whereNotNull/whereIn/orderBy/limit/offset/forUpdate/select/first/
 *     update()[.returning()]/insert().returning()/sum/min/del, `await builder` → rows
 *   db.transaction(cb) → snapshot + ROLLBACK on throw (nested = savepoint)
 *   db.raw('clock_timestamp()' | 'now()') as an insert/update VALUE → a
 *     strictly increasing wall-clock Date, resolved when the row is written
 *     (recorded in db._calls.raws); any other raw value throws.
 *
 * db._calls.queries records { table, forUpdate, filters } per executed query,
 * `filters` being the plain-object where() arguments (e.g. which customer row a
 * ledger lock selected).
 *
 * Table aliases ('customer_jobs as cj') and column prefixes ('cj.x') are
 * stripped; joins are no-ops (only used for optional label lookups).
 */
const PRIMARY_KEYS = Object.freeze({
   customer_invoices: 'customer_invoice_id',
   customer_transactions: 'transaction_id',
   customer_jobs: 'customer_job_id',
   customers: 'customer_id',
   timesheet_entries: 'timesheet_entry_id',
   ai_reviewer_corrections: 'correction_id',
   ai_category_training_examples: 'training_id'
});

const _clone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const _table = name => String(name).split(/\s+as\s+/i)[0].trim();
const _col = c => {
   const s = String(c);
   const i = s.lastIndexOf('.');
   return i >= 0 ? s.slice(i + 1) : s;
};

// Comparable key: Dates and date-like strings by time, numeric strings by value.
const _key = v => {
   if (v instanceof Date) return v.getTime();
   if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const t = new Date(v.length === 10 ? `${v}T00:00:00` : v).getTime();
      if (!Number.isNaN(t)) return t;
   }
   if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
   return v;
};

const _eq = (a, b) => {
   if (b === null || b === undefined) return a === null || a === undefined;
   if (a === null || a === undefined) return false;
   if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
   return _key(a) === _key(b) || String(a) === String(b);
};

const _cmp = test => (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && test(_key(a), _key(b));
const OPS = {
   '=': _eq,
   '<>': (a, b) => !_eq(a, b),
   '!=': (a, b) => !_eq(a, b),
   '>': _cmp((a, b) => a > b),
   '<': _cmp((a, b) => a < b),
   '>=': _cmp((a, b) => a >= b),
   '<=': _cmp((a, b) => a <= b)
};

const RAW = Symbol('stubDb.raw');
const CLOCK_SQL = /^\s*(clock_timestamp|now|current_timestamp|transaction_timestamp|statement_timestamp)\s*(\(\s*\))?\s*$/i;

const buildStubDb = (tables = {}) => {
   const store = {};
   for (const [name, rows] of Object.entries(tables)) store[name] = rows.map(r => ({ ...r }));
   const calls = { queries: [], raws: [] };

   // Wall clock that never repeats or goes backwards, like consecutive
   // clock_timestamp() calls on one DB server.
   let lastClockMs = 0;
   const tick = () => {
      lastClockMs = Math.max(Date.now(), lastClockMs + 1);
      return new Date(lastClockMs);
   };
   const raw = (sql, bindings) => ({ [RAW]: true, sql: String(sql), bindings });
   const resolveRaws = (table, row) => {
      const out = { ...row };
      for (const [column, value] of Object.entries(out)) {
         if (!value || value[RAW] !== true) continue;
         if (!CLOCK_SQL.test(value.sql)) throw new Error(`stubDb: unsupported raw value for ${table}.${column}: ${value.sql}`);
         calls.raws.push({ table, column, sql: value.sql });
         out[column] = tick();
      }
      return out;
   };

   const _nextId = table => {
      const pk = PRIMARY_KEYS[table];
      const rows = store[table] || [];
      return rows.reduce((m, r) => Math.max(m, Number(r[pk]) || 0), 0) + 1;
   };

   const makeBuilder = tableName => {
      const table = _table(tableName);
      const clauses = [];
      const orders = [];
      let limitN = null;
      const filters = [];
      const b = { _forUpdate: false };

      const predicate = args => {
         if (args.length === 1 && typeof args[0] === 'function') {
            const sub = makeBuilder(table);
            args[0].call(sub, sub);
            return row => (sub._clauses.length ? sub._test(row) : true);
         }
         if (args.length === 1 && args[0] && typeof args[0] === 'object') {
            const entries = Object.entries(args[0]);
            return row => entries.every(([k, v]) => _eq(row[_col(k)], v));
         }
         if (args.length === 2) return row => _eq(row[_col(args[0])], args[1]);
         if (args.length === 3) {
            const op = OPS[args[1]];
            if (!op) throw new Error(`stubDb: unsupported operator ${args[1]}`);
            return row => op(row[_col(args[0])], args[2]);
         }
         throw new Error('stubDb: unsupported where() form');
      };
      const add = (bool, pred) => {
         clauses.push({ bool, pred });
         return b;
      };

      b._clauses = clauses;
      b._test = row =>
         clauses.reduce((acc, { bool, pred }, i) => {
            if (i === 0) return pred(row);
            return bool === 'or' ? acc || pred(row) : acc && pred(row);
         }, true);

      b.where = (...args) => {
         if (args.length === 1 && args[0] && typeof args[0] === 'object') filters.push({ ...args[0] });
         return add('and', predicate(args));
      };
      b.andWhere = b.where;
      b.orWhere = (...args) => add('or', predicate(args));
      b.whereNot = (...args) => {
         const p = predicate(args);
         return add('and', row => !p(row));
      };
      b.whereNull = c => add('and', row => row[_col(c)] === null || row[_col(c)] === undefined);
      b.whereNotNull = c => add('and', row => row[_col(c)] !== null && row[_col(c)] !== undefined);
      b.whereIn = (c, list) => add('and', row => (list || []).some(v => _eq(row[_col(c)], v)));
      b.orderBy = (c, dir) => {
         if (Array.isArray(c)) c.forEach(o => orders.push({ c: _col(o.column), dir: String(o.order || 'asc').toLowerCase() }));
         else orders.push({ c: _col(c), dir: String(dir || 'asc').toLowerCase() });
         return b;
      };
      b.limit = n => {
         limitN = n;
         return b;
      };
      b.offset = () => b;
      b.forUpdate = () => {
         b._forUpdate = true;
         b._lockMode = 'FOR UPDATE';
         return b;
      };
      // Customer ledger locks are FOR NO KEY UPDATE (see ledger-helpers.
      // lockCustomerLedger); the specs only care that a row lock was taken.
      b.forNoKeyUpdate = () => {
         b._forUpdate = true;
         b._lockMode = 'FOR NO KEY UPDATE';
         return b;
      };
      b.join = () => b;
      b.leftJoin = () => b;
      b.innerJoin = () => b;
      b.select = () => b;

      const rows = () => {
         calls.queries.push({ table, forUpdate: b._forUpdate, filters });
         let out = (store[table] || []).filter(r => b._test(r));
         if (orders.length) {
            out = [...out].sort((x, y) => {
               for (const { c, dir } of orders) {
                  const a = _key(x[c]);
                  const z = _key(y[c]);
                  if (a === z) continue;
                  if (a === null || a === undefined) return 1;
                  if (z === null || z === undefined) return -1;
                  const r = a < z ? -1 : 1;
                  return dir === 'desc' ? -r : r;
               }
               return 0;
            });
         }
         if (limitN !== null) out = out.slice(0, limitN);
         return out.map(r => ({ ...r }));
      };

      b.first = async () => rows()[0];
      b.then = (resolve, reject) => Promise.resolve().then(rows).then(resolve, reject);
      // `await builder.update(patch)` → affected count; `.update(patch).returning()`
      // → the updated rows (the write happens once, on first use).
      b.update = patch => {
         let hits = null;
         const run = () => {
            if (hits) return hits;
            hits = (store[table] || []).filter(r => b._test(r));
            const resolved = hits.length ? resolveRaws(table, patch) : patch;
            hits.forEach(h => Object.assign(h, resolved));
            return hits;
         };
         return {
            returning: async () => run().map(r => ({ ...r })),
            then: (resolve, reject) => Promise.resolve().then(() => run().length).then(resolve, reject)
         };
      };
      b.del = async () => {
         const before = (store[table] || []).length;
         store[table] = (store[table] || []).filter(r => !b._test(r));
         return before - store[table].length;
      };
      b.insert = row => {
         const list = Array.isArray(row) ? row : [row];
         store[table] = store[table] || [];
         const pk = PRIMARY_KEYS[table];
         const inserted = list.map(r => {
            const copy = resolveRaws(table, r);
            if (pk && (copy[pk] === null || copy[pk] === undefined)) copy[pk] = _nextId(table);
            store[table].push(copy);
            return { ...copy };
         });
         return {
            returning: async () => inserted.map(r => ({ ...r })),
            then: (resolve, reject) => Promise.resolve(inserted).then(resolve, reject)
         };
      };
      b.sum = obj => {
         const [alias, field] = Object.entries(obj)[0];
         const total = rows().reduce((a, r) => a + Number(r[_col(field)] || 0), 0);
         return Promise.resolve([{ [alias]: total }]);
      };
      b.min = obj => {
         const [alias, field] = Object.entries(obj)[0];
         const agg = () => {
            const vals = rows()
               .map(r => r[_col(field)])
               .filter(v => v !== null && v !== undefined);
            return { [alias]: vals.length ? vals.reduce((m, v) => (_key(v) < _key(m) ? v : m)) : null };
         };
         return { first: async () => agg(), then: (resolve, reject) => Promise.resolve([agg()]).then(resolve, reject) };
      };
      return b;
   };

   const db = name => makeBuilder(name);
   db.raw = raw;
   db.transaction = async cb => {
      const snapshot = _clone(store);
      const trx = name => makeBuilder(name);
      trx.raw = raw;
      trx.isTransaction = true;
      trx.transaction = db.transaction;
      try {
         return await cb(trx);
      } catch (e) {
         for (const k of Object.keys(store)) if (!(k in snapshot)) delete store[k];
         for (const k of Object.keys(snapshot)) store[k] = snapshot[k];
         throw e;
      }
   };
   db._store = store;
   db._calls = calls;
   return db;
};

// Await a promise that should reject; returns the error (or null).
const caught = async promise => {
   try {
      await promise;
   } catch (e) {
      return e;
   }
   return null;
};

module.exports = { buildStubDb, caught };
