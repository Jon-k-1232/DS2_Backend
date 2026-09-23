/**
 * Fix 9 (part 1): express.json()'s default 100kb limit was too small for a
 * month-end "select all" invoice-creation / billing-review payload (every
 * outstanding customer + line detail), which can approach that ceiling.
 * src/app.js now sets `express.json({ limit: '1mb' })`.
 *
 * The body-size check runs in app-level middleware BEFORE any router's
 * requireAuth, so this can be verified with no token and no DB at all: an
 * oversized-for-the-OLD-default body must get PAST the json-parsing layer
 * (proven by hitting the auth check next, i.e. 401 — not 413) on any POST
 * route. A body that's still too big for the NEW 1mb cap must still 413.
 */
const supertest = global.supertest || require('supertest');
const app = require('../../../src/app');

// Any real POST route works, since the size check happens before requireAuth
// regardless of which router eventually would have handled it.
const ROUTE = '/customer/createCustomer/9001/90013';

const bigJsonBody = sizeBytes => {
   // { customer: { padding: "aaaa...aaaa" } } — pad to roughly sizeBytes.
   const overhead = 30;
   return { customer: { padding: 'a'.repeat(Math.max(0, sizeBytes - overhead)) } };
};

describe('fix 9: express.json() body size limit raised from 100kb to 1mb', () => {
   it('accepts a ~300kb body (over the OLD 100kb default, under the NEW 1mb cap) — proven by reaching auth (401), not a 413', async () => {
      const res = await supertest(app).post(ROUTE).send(bigJsonBody(300 * 1024));
      expect(res.status).to.not.equal(413);
      expect(res.status).to.equal(401); // no Authorization header — confirms the body was parsed and requireAuth ran
   });

   it('still rejects a body over the NEW 1mb cap with 413 (the limit is raised, not removed)', async () => {
      const res = await supertest(app).post(ROUTE).send(bigJsonBody(2 * 1024 * 1024));
      expect(res.status).to.equal(413);
   });
});
