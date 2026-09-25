const { bootHttp, uniqueName } = require('./_http');
const service = require('../../src/endpoints/user/user-service');

describe('F29 active Super Admin guards', function () {
   let h, users = [], actor;
   before(async function () { h = await bootHttp.call(this); });
   const add = async () => {
      const name = uniqueName('F29');
      const [u] = await h.db('users').insert({ account_id: 9001, email: `${name}@example.test`, display_name: name,
         job_title: 'Test Admin', cost_rate: 0, billing_rate: 0, access_level: 'Super Admin', is_user_active: true }).returning('*');
      users.push(u.user_id); return u;
   };
   beforeEach(async () => { actor = await add(); });
   afterEach(async () => { await h.db('users').where({ account_id: 9001 }).whereIn('user_id', users).del(); users = []; });
   after(async () => { if (h) await h.close(); });
   const update = (u, fields) => h.request.put(`/user/updateUser/9001/${u.user_id}`)
      .set('Authorization', `Bearer ${h.mint('admin', u)}`).send({ user: { userID: u.user_id, accessLevel: 'Super Admin', ...fields } });
   for (const value of ['false', 'true', 0, 1, null]) it(`rejects nonboolean active value ${JSON.stringify(value)} before writing`, async () => {
      const result = await update(actor, { isUserActive: value });
      expect(result.status).to.equal(400);
      expect((await h.db('users').where({ account_id: 9001, user_id: actor.user_id }).first()).is_user_active).to.equal(true);
   });
   it('preserves active status when omitted and still rejects boolean self-deactivation', async () => {
      expect((await update(actor, {})).status).to.equal(200);
      expect((await update(actor, { isUserActive: false })).status).to.equal(400);
   });
   it('serializes concurrent self-demotions so one active Super Admin remains', async () => {
      const other = await add();
      const original = service.countActiveSuperAdmins;
      let enter, release, calls = 0, first, second;
      const entered = new Promise(r => { enter = r; });
      const gate = new Promise(r => { release = r; });
      service.countActiveSuperAdmins = async (...args) => {
         const count = await original(...args);
         if (++calls === 1) { enter(); await gate; }
         return count;
      };
      try {
         first = update(actor, { accessLevel: 'Admin' }).then(r => r);
         await entered;
         second = update(other, { accessLevel: 'Admin' }).then(r => r);
         let observed = false;
         for (let i = 0; i < 100 && !observed; i++) {
            const { rows } = await h.db.raw("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%accounts%'");
            observed = calls > 1 || rows.length > 0;
            if (!observed) await new Promise(r => setTimeout(r, 20));
         }
         expect(observed).to.equal(true);
         release();
         const results = await Promise.all([first, second]);
         expect(results.map(r => r.status).sort()).to.deep.equal([200, 400]);
         const remaining = await h.db('users').where({ account_id: 9001, is_user_active: true, access_level: 'Super Admin' }).whereIn('user_id', users);
         expect(remaining).to.have.length(1);
      } finally { release(); service.countActiveSuperAdmins = original; await Promise.all([first, second]); }
   });
});
