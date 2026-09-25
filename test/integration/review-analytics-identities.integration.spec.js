const { bootHttp, uniqueName, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');

describe('F35 analytics stable identities', function () {
   let h, f, actor, customers = [], users = [], name;
   before(async function () {
      h = await bootHttp.call(this); f = fixture(h); name = uniqueName('F35');
      for (let i = 0; i < 2; i++) {
         const [user] = await h.db('users').insert({ account_id: 9001, email: `${name}-${i}@example.test`, display_name: name,
            job_title: 'Test', cost_rate: 0, billing_rate: 100, access_level: 'Super Admin', is_user_active: true }).returning('*');
         users.push(user); const c = await f.customer({ display_name: name }); customers.push(c);
         await f.transaction(c, await f.job(c), { loggedForUserID: user.user_id, transactionDate: '2090-01-09', quantity: i+1, totalTransaction: (i+1)*100 });
      }
      actor = users[0];
   });
   after(async () => { if (h) { await f.cleanup(); await h.db('users').where({ account_id: 9001 }).whereIn('user_id', users.map(u=>u.user_id)).del(); await h.close(); } });
   const get = (path, suffix = '') => h.request.get(`${path}/9001/${actor.user_id}${suffix}?year=2090`).set('Authorization', `Bearer ${h.mint('admin', actor)}`);
   it('returns two customers and their IDs in the time report and CSV', async () => {
      const body = expectEnvelopeOk(await get('/analytics/timeAllocation'));
      const rows = body.timeAllocation.byCustomer.filter(r => r.customer === name);
      expect(rows).to.have.length(2);
      expect(rows.map(r => r.customer_id)).to.have.members(customers.map(c=>c.customer_id));
      expect(rows.map(r=>r.hours)).to.have.members([1,2]);
      const csv = await get('/analytics/timeAllocation', '/export');
      expect(csv.status).to.equal(200);
      for (const c of customers) expect(csv.text).to.include(`${c.customer_id}`);
   });
   it('returns distinct weekly capacity rows for employees with the same display name', async () => {
      const body = expectEnvelopeOk(await get('/analytics/taxSeasonCapacity'));
      const rows = body.taxSeasonCapacity.current.filter(r => r.employee === name);
      expect(rows).to.have.length(2);
      expect(rows.map(r=>r.user_id)).to.have.members(users.map(u=>u.user_id));
      expect(rows.map(r=>r.hours)).to.have.members([1,2]);
   });
});
