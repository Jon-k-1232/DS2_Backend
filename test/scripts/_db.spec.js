/**
 * scripts/_db.js host selection (finding F4, round-3 review).
 *
 * The bug: `DB_HOST || DB_PROD_HOST || DB_DEV_HOST` silently preferred a PROD host over a DEV
 * host whenever both happened to be present in process.env — e.g. a leftover DB_PROD_HOST from
 * an earlier makeDb() call in the same process (dotenv never overwrites an already-set
 * process.env var), or a stray export in the parent shell. No DB connection is attempted here —
 * constructing a knex client is pure config assembly, so these are fast, no throwaway DB needed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// PGHOST included (2026-09 second follow-up review, "restore PGHOST in cleanup"): a test that
// sets it must have it captured by the shared beforeEach/afterEach save-and-restore below, same
// as every other var here — an ad hoc `delete process.env.PGHOST` in one test's own cleanup would
// wipe out a real ambient PGHOST the shell had set before this suite ever ran, instead of
// restoring it.
const ENV_KEYS = ['DS2_ENV_FILE', 'DB_HOST', 'DB_DEV_HOST', 'DB_PROD_HOST', 'DB_DEV_PORT', 'DB_SSL_DISABLE', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD', 'PGHOST'];

describe('scripts/_db.js — makeDb host selection', () => {
   let tmpDir;
   let savedEnv;
   const created = [];

   before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-db-test-'));
   });
   after(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
   });

   beforeEach(() => {
      savedEnv = {};
      ENV_KEYS.forEach(k => {
         savedEnv[k] = process.env[k];
         delete process.env[k];
      });
      // Every scripts/_db.js require is fresh state (it re-reads dotenv/fs on every call), so no
      // module-cache reset is needed between cases — only process.env needs isolating.
   });
   afterEach(async () => {
      ENV_KEYS.forEach(k => {
         if (savedEnv[k] === undefined) delete process.env[k];
         else process.env[k] = savedEnv[k];
      });
      await Promise.all(created.splice(0).map(db => db.destroy()));
   });

   const writeEnvFile = (name, lines) => {
      const file = path.join(tmpDir, name);
      fs.writeFileSync(file, lines.join('\n') + '\n');
      return file;
   };

   const makeDbFresh = opts => {
      delete require.cache[require.resolve('../../scripts/_db')];
      const db = require('../../scripts/_db').makeDb(opts);
      created.push(db);
      return db;
   };

   it('resolves the host from the env file DS2_ENV_FILE names (dev file -> DB_DEV_HOST)', () => {
      const devFile = writeEnvFile('dev.env', ['DB_DEV_HOST=sandbox-dev.internal', 'DATABASE_USER=u', 'DATABASE_PASSWORD=p']);
      process.env.DS2_ENV_FILE = devFile;
      const db = makeDbFresh({ envFile: devFile, database: 'ds2_dev' });
      expect(db.client.config.connection.host).to.equal('sandbox-dev.internal');
   });

   it('resolves the host from the env file DS2_ENV_FILE names (prod file -> DB_PROD_HOST) — legitimate prod scripts keep working', () => {
      const prodFile = writeEnvFile('prod.env', ['DB_PROD_HOST=rds-prod.internal', 'DATABASE_USER=u', 'DATABASE_PASSWORD=p']);
      process.env.DS2_ENV_FILE = prodFile;
      const db = makeDbFresh({ envFile: prodFile, database: 'ds2_prod' });
      expect(db.client.config.connection.host).to.equal('rds-prod.internal');
   });

   it('BYPASS (round-3 report): never prefers DB_PROD_HOST over DB_DEV_HOST when both exist in process.env', () => {
      // Simulates the exact leftover-ambient-env scenario the report describes: an earlier
      // makeDb() call (e.g. an audit script against prod, or a previous test in the same mocha
      // process) already set DB_PROD_HOST in process.env; dotenv will never overwrite it. A
      // second, dev-targeted makeDb() call must NOT silently pick it up.
      process.env.DB_PROD_HOST = 'rds-prod.internal';
      const devFile = writeEnvFile('dev2.env', ['DB_DEV_HOST=sandbox-dev.internal', 'DATABASE_USER=u', 'DATABASE_PASSWORD=p']);
      process.env.DS2_ENV_FILE = devFile;
      const db = makeDbFresh({ envFile: devFile, database: 'ds2_dev' });
      expect(db.client.config.connection.host).to.equal('sandbox-dev.internal');
      expect(db.client.config.connection.host).to.not.equal('rds-prod.internal');
   });

   it('an explicit process.env.DB_HOST always wins, regardless of the resolved env file', () => {
      const prodFile = writeEnvFile('prod2.env', ['DB_PROD_HOST=rds-prod.internal']);
      process.env.DS2_ENV_FILE = prodFile;
      process.env.DB_HOST = 'explicit-override.internal';
      const db = makeDbFresh({ envFile: prodFile, database: 'ds2_prod' });
      expect(db.client.config.connection.host).to.equal('explicit-override.internal');
   });

   it('N3: a file with no explicit host throws before pg can inherit PGHOST or fall back to localhost', () => {
      // Old behavior (pre-N3): this resolved to `host: undefined` and was documented as "fails
      // fast" — but it doesn't. node-postgres treats an undefined host as "unset" and silently
      // falls back to process.env.PGHOST, then to its own localhost default, so a hostless file
      // could connect to an arbitrary ambient host without looksLikeProd ever seeing it (it only
      // ever sees `host: undefined`). makeDb() must now refuse synchronously instead of ever
      // returning such a client.
      const emptyFile = writeEnvFile('empty.env', ['DATABASE_USER=u']);
      process.env.DS2_ENV_FILE = emptyFile;
      expect(() => makeDbFresh({ envFile: emptyFile, database: 'ds2_dev' })).to.throw(/No explicit database host/);
   });

   it('N3: an ambient PGHOST does not rescue a hostless file — makeDb() still throws rather than letting pg resolve it', () => {
      // PGHOST is one of ENV_KEYS, so the describe-level beforeEach/afterEach already saved
      // whatever it was before this suite ran and will restore exactly that afterward — no
      // test-local delete needed (an unconditional delete here would have clobbered a real
      // ambient PGHOST from the shell instead of restoring it).
      const emptyFile = writeEnvFile('empty2.env', ['DATABASE_USER=u']);
      process.env.DS2_ENV_FILE = emptyFile;
      process.env.PGHOST = 'billing-prod.example.invalid';
      expect(() => makeDbFresh({ envFile: emptyFile, database: 'ds2_dev' })).to.throw(/No explicit database host/);
   });

   it('N3: a second makeDb() call for a DIFFERENT file in the same process is not influenced by the first file\'s values (no dotenv.config() mutation of process.env)', () => {
      // Old behavior (pre-N3): makeDb() called dotenv.config({ path }) as a side effect on every
      // call. dotenv never overwrites an already-set process.env var, so DATABASE_USER/
      // DATABASE_PASSWORD/DATABASE_NAME/DB_DEV_PORT read straight off process.env by the FIRST
      // call would silently survive into a SECOND call for a completely different env file later
      // in the same process (config-probe.log's "two-file-calls" case).
      const first = writeEnvFile('first.env', ['DB_HOST=first-host.internal', 'DATABASE_NAME=first_db', 'DATABASE_USER=first_user', 'DATABASE_PASSWORD=first_secret', 'DB_DEV_PORT=5432']);
      const second = writeEnvFile('second.env', ['DB_DEV_HOST=127.0.0.1', 'DATABASE_NAME=second_db', 'DATABASE_USER=second_user', 'DATABASE_PASSWORD=second_secret', 'DB_DEV_PORT=5433']);

      process.env.DS2_ENV_FILE = first;
      const db1 = makeDbFresh({ envFile: first, database: 'ds2_dev' });
      expect(db1.client.config.connection).to.include({ host: 'first-host.internal', database: 'first_db', user: 'first_user', password: 'first_secret', port: 5432 });

      process.env.DS2_ENV_FILE = second;
      const db2 = makeDbFresh({ envFile: second, database: 'ds2_dev' });
      expect(db2.client.config.connection, 'second call must resolve entirely from its own file, not leftovers from the first').to.include({
         host: '127.0.0.1',
         database: 'second_db',
         user: 'second_user',
         password: 'second_secret',
         port: 5433
      });
   });

   it('DATABASE_NAME / DATABASE_USER / DB_SSL_DISABLE from the resolved file flow through to the connection', () => {
      const file = writeEnvFile('full.env', ['DB_DEV_HOST=127.0.0.1', 'DB_DEV_PORT=5433', 'DATABASE_USER=ds2', 'DATABASE_PASSWORD=ds2local', 'DATABASE_NAME=ds2_local', 'DB_SSL_DISABLE=true']);
      process.env.DS2_ENV_FILE = file;
      const db = makeDbFresh({ envFile: file, database: 'ds2_dev' });
      expect(db.client.config.connection).to.include({ host: '127.0.0.1', port: 5433, user: 'ds2', password: 'ds2local', database: 'ds2_local', ssl: false });
   });
});
