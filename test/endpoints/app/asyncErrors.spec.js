/**
 * Fix 1 (systemic): async route handlers without try/catch used to crash the
 * process on Node 20 — Express 4 never forwards a rejected promise from an
 * async handler to next(err), so it escaped as an unhandled rejection.
 *
 * The fix is `require('express-async-errors')` as the very first require in
 * src/app.js, which monkey-patches Express's Router/Route prototypes (once,
 * process-wide) so every route method wraps its handler and calls next(err)
 * on rejection automatically — no per-route try/catch required.
 *
 * Requiring src/app.js below exercises that exact require chain, and because
 * the patch is applied to the shared `express` module (not to one app
 * instance), a throwaway router built afterwards with a bare `express.Router()`
 * inherits the same protection. That lets this test prove the real fix
 * without needing the DB/auth stack the full app depends on.
 */
require('../../../src/app');
const express = require('express');
const supertest = global.supertest || require('supertest');

describe('fix 1: express-async-errors prevents async-handler rejections from crashing the process', () => {
   // Mirrors src/app.js's own error-handling contract (status/message JSON).
   const buildThrowawayApp = () => {
      const app = express();
      const throwawayRouter = express.Router();

      // Deliberately no try/catch — this is the exact shape of bug described
      // in the review (e.g. recurringCustomer-router.js's routes before this
      // fix): an async handler that just throws/rejects.
      throwawayRouter.get('/boom', async () => {
         throw new Error('simulated rejection from an async handler with no try/catch');
      });

      // Also cover a handler that rejects via an awaited promise rather than
      // a synchronous throw, since that's the more common real-world shape
      // (an awaited knex query rejecting).
      throwawayRouter.get('/boom-async-await', async (req, res) => {
         await Promise.reject(new Error('simulated rejected awaited promise'));
         res.status(200).json({ unreachable: true });
      });

      app.use('/test', throwawayRouter);

      app.use((err, req, res, next) => {
         res.status(err.status || 500).json({ message: err.message, status: err.status || 500 });
      });

      return app;
   };

   it('returns a 500 JSON body instead of hanging when a handler throws synchronously inside an async function', async () => {
      const app = buildThrowawayApp();
      const res = await supertest(app).get('/test/boom');
      expect(res.status).to.equal(500);
      expect(res.body).to.deep.equal({
         message: 'simulated rejection from an async handler with no try/catch',
         status: 500
      });
   });

   it('returns a 500 JSON body instead of hanging when a handler rejects an awaited promise', async () => {
      const app = buildThrowawayApp();
      const res = await supertest(app).get('/test/boom-async-await');
      expect(res.status).to.equal(500);
      expect(res.body).to.deep.equal({
         message: 'simulated rejected awaited promise',
         status: 500
      });
   });

   it('does not affect a handler that resolves normally', async () => {
      const app = buildThrowawayApp();
      const router = express.Router();
      router.get('/ok', async (req, res) => {
         res.status(200).json({ ok: true });
      });
      app.use('/test2', router);
      const res = await supertest(app).get('/test2/ok');
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ ok: true });
   });
});
