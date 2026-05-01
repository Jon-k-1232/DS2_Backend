const notificationsService = require('../../../src/endpoints/notifications/notifications-service');

const buildDb = ({ rows = [] } = {}) => {
   const store = { notifications: rows };
   const _build = table => {
      const state = { where: {}, isNull: null };
      const builder = {};
      builder.where = (a, op, val) => {
         if (typeof a === 'function') {
            const subState = { ors: [] };
            const sub = {
               whereNull: f => { subState.ors.push({ type: 'isNull', field: f }); return sub; },
               orWhere: (f, opp, vv) => { subState.ors.push({ type: 'gt', field: f, val: vv }); return sub; }
            };
            a(sub);
            state.subQuery = subState;
            return builder;
         }
         if (typeof a === 'object') Object.assign(state.where, a);
         else state.where[a] = val;
         return builder;
      };
      builder.whereNull = f => { state.isNull = f; return builder; };
      builder.orderBy = () => builder;
      builder.limit = () => builder;
      builder.update = updates => {
         const matching = store[table].filter(r => Object.entries(state.where).every(([k, v]) => r[k] === v) && (!state.isNull || r[state.isNull] == null));
         for (const m of matching) Object.assign(m, updates);
         return { returning: () => Promise.resolve(matching.map(m => ({ ...m }))) };
      };
      builder.insert = rows => {
         const arr = Array.isArray(rows) ? rows : [rows];
         arr.forEach((r, i) => store[table].push({ notification_id: store[table].length + 1, created_at: new Date(), read_at: null, ...r }));
         return { returning: () => Promise.resolve(arr.map((r, i) => store[table][store[table].length - arr.length + i])) };
      };
      builder.count = () => {
         const matching = store[table].filter(r =>
            Object.entries(state.where).every(([k, v]) => r[k] === v) &&
            (!state.isNull || r[state.isNull] == null)
         );
         return Promise.resolve([{ count: matching.length }]);
      };
      builder.then = (resolve, reject) => {
         const matching = store[table].filter(r =>
            Object.entries(state.where).every(([k, v]) => r[k] === v) &&
            (!state.isNull || r[state.isNull] == null)
         );
         return Promise.resolve(matching).then(resolve, reject);
      };
      return builder;
   };
   const db = table => _build(table);
   db._store = store;
   return db;
};

describe('notifications-service', () => {
   it('inserts a notification with the provided fields', async () => {
      const db = buildDb();
      const row = await notificationsService.insertNotification(db, {
         accountId: 9001,
         userId: 7,
         type: 'rows_held_for_review',
         title: '12 rows need review',
         body: 'Auto: 38 / Held: 12',
         payload: { autoInserted: 38, held: 12 }
      });
      expect(row.title).to.equal('12 rows need review');
      expect(row.account_id).to.equal(9001);
      expect(JSON.parse(row.payload)).to.deep.equal({ autoInserted: 38, held: 12 });
   });

   it('rejects insertion with missing fields', async () => {
      const db = buildDb();
      let caught = null;
      try {
         await notificationsService.insertNotification(db, { accountId: 9001 });
      } catch (e) { caught = e; }
      expect(caught).to.be.an('error');
   });

   it('insertForUsers fans out to every recipient', async () => {
      const db = buildDb();
      const inserted = await notificationsService.insertForUsers(db, {
         accountId: 9001,
         userIds: [7, 8, 13],
         type: 'tracker_upload_processed',
         title: 'Done',
         payload: { autoInserted: 50, held: 0 }
      });
      expect(inserted).to.have.lengthOf(3);
      expect(db._store.notifications.map(n => n.user_id).sort((a, b) => a - b)).to.deep.equal([7, 8, 13]);
   });

   it('insertForUsers is a no-op for empty list', async () => {
      const db = buildDb();
      const result = await notificationsService.insertForUsers(db, { accountId: 9001, userIds: [], type: 't', title: 't' });
      expect(result).to.deep.equal([]);
   });

   it('serializes payload as JSON when given an object', async () => {
      const db = buildDb();
      await notificationsService.insertNotification(db, {
         accountId: 9001,
         userId: 7,
         type: 't',
         title: 't',
         payload: { foo: 'bar', n: 42 }
      });
      const stored = db._store.notifications[0].payload;
      expect(typeof stored).to.equal('string');
      expect(JSON.parse(stored)).to.deep.equal({ foo: 'bar', n: 42 });
   });
});
