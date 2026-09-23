/**
 * HTTP route coverage: src/endpoints/timeTracking/timeTracking-router.js
 * (mounted /time-tracking) and src/endpoints/timesheets/timesheets-router.js
 * (mounted /timesheets). POST /time-tracking/upload is exercised end to end in
 * tracker-excel-end-to-end.integration.spec.js; every other route is covered
 * here: happy path with DB / S3 proof, 401 (no token, unprovisioned identity),
 * 403 other tenant (both directions), the self-vs-privileged owner rule,
 * not-found handling, the template upload → list → latest → delete round trip,
 * and POST /timesheets/ai/kickoff with stubbed AWS.
 *
 *   DS2_ENV_FILE=.env.local npx mocha --require test/setup.js \
 *     test/integration/coverage-timetracking-timesheets.integration.spec.js --exit --timeout 180000
 *
 * Gate baseline (src/app.js:141-142 at the time of writing —
 * `app.use('/timesheets', requireAuth, timesheetsRouter)` / `app.use('/time-tracking',
 * requireAuth, timeTrackingRouter)`): both routers are mounted with requireAuth only. timeTracking-router registers enforceAccountId on :accountID AND
 * enforceSelfOrPrivileged on :userID (the file OWNER); timesheets-router
 * registers ONLY enforceAccountId (timesheets-router.js:5) and has no role or
 * owner check anywhere, although the frontend wraps the page that calls it
 * (Tracking Administration) in ManagerAndAdminProtectedAccessRoute
 * (DS2_Frontend/src/Routes/PrimaryRouter.js:139-149). Those gaps are recorded
 * as it.skip + DEFECT below.
 *
 * Fixtures: the spec creates one customer ('Coverage TT <run>') with a
 * General Consulting job, and uploads (through the real route) three trackers:
 * T1 Eliza, current month, 3 lines; T2 Eliza, previous month, 1 line; T3 Bob,
 * current month, 1 line. Template versions uploaded by the round trip are
 * deleted again (the original 'latest' is never touched). Account 1 is only
 * ever READ (to prove isolation).
 */
const zlib = require('zlib');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const dayjs = require('dayjs');
const { expect } = require('chai');
const { SESClient } = require('@aws-sdk/client-ses');
const { bootHttp, expectEnvelopeOk } = require('./_http');
const { buildTrackerFromTemplate } = require('../fixtures/buildTrackerFromTemplate');
const { installStubbedAws, installFailClosedAws, SEED_GWD_ID } = require('../fixtures/integrationHelpers');
const { getObject, putObject, deleteObject, listObjects } = require('../../src/utils/s3');

const A = 9001;
const FOREIGN_ACCOUNT = 1; // read-only reference tenant
const ADMIN = 90013;
const ELIZA = 90011;
const BOB = 90012;
const INACTIVE_USER = 90014;
const SUPER_ADMIN = 21; // account 1 — only ever used for global template versions + refused requests
const NOT_FOUND_ID = 999999999;
const JOB_TYPE_GENERAL_CONSULTING = 900204;
const ENTITY_JKA = 'James F. Kimmel & Associates';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TIME_TRACKING_ROOT = 'James_F__Kimmel___Associates/time_tracking';
const TRACKER_VERSIONS_ROOT = `${TIME_TRACKING_ROOT}/tracker_versions`;
const PROCESSED_ROOT = `${TIME_TRACKING_ROOT}/processed`;
const ENTRY_SAFE_COLUMNS = [
   'timesheet_entry_id', 'account_id', 'user_id', 'employee_name', 'timesheet_name', 'time_tracker_start_date', 'time_tracker_end_date', 'date', 'entity',
   'category', 'company_name', 'first_name', 'last_name', 'duration', 'notes', 'is_processed', 'is_deleted', 'created_at'
];

const TODAY = dayjs().startOf('day');
const MONTH_START = TODAY.startOf('month');
const CUR_START = TODAY.subtract(4, 'day').isBefore(MONTH_START) ? MONTH_START : TODAY.subtract(4, 'day');
const CUR_END = TODAY;
const PREV_START = TODAY.subtract(1, 'month').startOf('month');
const PREV_END = PREV_START.add(4, 'day');
const iso = d => d.format('YYYY-MM-DD');

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, d => 'abcdefghij'[Number(d)]).toUpperCase();
const COV_NAME = `Coverage TT ${RUN}`;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const byNumber = (a, b) => a - b;
const binaryParser = (res, cb) => {
   const chunks = [];
   res.on('data', chunk => chunks.push(Buffer.from(chunk)));
   res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const jsonBody = res => (Buffer.isBuffer(res.body) ? JSON.parse(res.body.toString('utf8') || '{}') : res.body);
const sheetColumnA = (wb, name) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }).map(r => r[0]).filter(v => v !== undefined && v !== '') : null);

const sesSends = [];
const stubSes = () => {
   const own = Object.prototype.hasOwnProperty.call(SESClient.prototype, 'send');
   const original = SESClient.prototype.send;
   SESClient.prototype.send = async function stubbedSesSend(command) {
      sesSends.push(command.input);
      return { MessageId: `stub-${sesSends.length}` };
   };
   return () => {
      if (own) SESClient.prototype.send = original;
      else delete SESClient.prototype.send;
   };
};
const setEnv = vars => {
   const previous = {};
   Object.entries(vars).forEach(([key, value]) => {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
   });
   return () =>
      Object.entries(previous).forEach(([key, value]) => {
         if (value === undefined) delete process.env[key];
         else process.env[key] = value;
      });
};

describe('time-tracking + timesheets routes: HTTP coverage (account 9001)', function () {
   this.timeout(180_000);

   let h;
   let db;
   let aws;
   let restoreSes = () => {};
   let restoreEnv = () => {};
   const created = { customers: [], s3Keys: [], timesheetNames: [], templateKeys: [], userIds: [] };
   let maxNotificationId = 0;
   let maxTemplateDownloadId = 0;
   let templateBuffer;
   let originalTemplateName;
   let covCustomer;
   let covJobId;
   const T = {}; // T1 / T2 / T3 -> { body, entries: [...] }
   let foreignEntry; // one account-1 timesheet row, read-only
   let otherEliza; // C6: a SECOND 'Eliza Smith' in this SAME account, different user_id/rate
   let manager; // C12: a manager-role user in this SAME account (no seeded manager identity exists)

   // ── helpers ────────────────────────────────────────────────────────────────
   const getBinary = (identity, url, query = {}) => h.as(identity).get(url).query(query).buffer(true).parse(binaryParser);
   // Authenticate as an arbitrary DB user by email (for otherEliza/manager,
   // which have no entry in _http.js's fixed IDENTITIES map) — requireAuth
   // resolves the real user row from the JWT's `sub` (email) alone, so the
   // token's own `user_id` claim is irrelevant.
   const asCustom = email => {
      const token = h.mint('employee', { email });
      const wrap = method => url => h.request[method](url).set('Authorization', `Bearer ${token}`);
      return { get: wrap('get'), post: wrap('post'), put: wrap('put'), delete: wrap('delete') };
   };
   const getBinaryAs = (agent, url, query = {}) => agent.get(url).query(query).buffer(true).parse(binaryParser);
   const rawPost = (agent, url, buffer, { fileName = 'tracker.xlsx', fileType = XLSX_MIME, query } = {}) => {
      let req = agent.post(url);
      if (query) req = req.query(query);
      req = req.set('Content-Type', 'application/octet-stream').set('x-file-type', fileType);
      if (fileName !== null) req = req.set('x-file-name', encodeURIComponent(fileName));
      return req.send(buffer);
   };

   // 401 (no token / unprovisioned identity) and 403 (tenant mismatch, both ways).
   const expectAuthGuards = async (method, pathFor, { send, raw } = {}) => {
      const call = (agent, url) => {
         if (raw) return rawPost(agent, url, raw);
         const req = agent[method](url);
         return send !== undefined ? req.send(send) : req;
      };
      const noToken = await call(h.anonymous, pathFor(A, ADMIN));
      expect(noToken.status, 'no token').to.equal(401);
      const stranger = await call(h.as('stranger'), pathFor(A, ADMIN));
      expect(stranger.status, 'token for an unprovisioned email').to.equal(401);
      const foreign = await call(h.as('admin'), pathFor(FOREIGN_ACCOUNT, ADMIN));
      expect(foreign.status, 'account-9001 admin addressing account 1').to.equal(403);
      expect(jsonBody(foreign).message).to.equal('Account access denied');
      const reverse = await call(h.as('superAdmin'), pathFor(A, SUPER_ADMIN));
      expect(reverse.status, 'account-1 super admin addressing account 9001').to.equal(403);
      expect(jsonBody(reverse).message).to.equal('Account access denied');
   };

   const createCustomer = async displayName => {
      expectEnvelopeOk(
         await h
            .as('admin')
            .post(`/customer/createCustomer/${A}/${ADMIN}`)
            .send({
               customer: {
                  accountID: A,
                  userID: ADMIN,
                  loggedByUserID: ADMIN,
                  customerBusinessName: displayName,
                  customerName: 'Coverage Tester',
                  isCommercialCustomer: true,
                  isCustomerActive: true,
                  isCustomerBillable: true,
                  isCustomerRecurring: false,
                  customerStreet: '2 Coverage Ct',
                  customerCity: 'Tempe',
                  customerState: 'AZ',
                  customerZip: '85281',
                  customerEmail: `coverage+${RUN.toLowerCase()}@example.test`,
                  customerPhone: '5550108888',
                  isCustomerAddressActive: true,
                  isCustomerPhysicalAddress: true,
                  isCustomerBillingAddress: true,
                  isCustomerMailingAddress: true
               }
            }),
         'createCustomer'
      );
      const row = await db('customers').where({ account_id: A, display_name: displayName }).first();
      created.customers.push(row.customer_id);
      return row;
   };

   const buildTracker = ({ employeeName, start, end, rows }) =>
      buildTrackerFromTemplate({
         templateBuffer,
         employeeName,
         startDate: iso(start),
         endDate: iso(end),
         rows: rows.map(r => ({ date: iso(r.date), entity: ENTITY_JKA, category: r.category, companyName: COV_NAME, duration: r.duration, timeRange: '', notes: r.notes }))
      });

   let lastUploadSecond = 0;
   const uploadTracker = async (key, ownerId, spec) => {
      while (Math.floor(Date.now() / 1000) <= lastUploadSecond) await sleep(50);
      const buffer = buildTracker(spec);
      const res = await rawPost(h.as('admin'), `/time-tracking/upload/${A}/${ADMIN}`, buffer, { fileName: `${key}_${RUN}.xlsx`, query: { ownerUserID: ownerId } });
      expect(res.status, `${key} upload: ${JSON.stringify(res.body).slice(0, 300)}`).to.equal(201);
      lastUploadSecond = Math.floor(Date.now() / 1000);
      created.s3Keys.push(res.body.storedKey);
      created.timesheetNames.push(res.body.fileName);
      const entries = await db('timesheet_entries').where({ account_id: A, user_id: ownerId, timesheet_name: res.body.fileName }).orderBy('timesheet_entry_id', 'asc');
      expect(entries, `${key} rows`).to.have.lengthOf(spec.rows.length);
      T[key] = { body: res.body, buffer, entries, ownerId };
   };

   const waitFor = async (probe, label, { timeoutMs = 30_000, intervalMs = 150 } = {}) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
         const value = await probe();
         if (value) return value;
         await sleep(intervalMs);
      }
      throw new Error(`timed out waiting for ${label}`);
   };

   const linkedTransactions = entryId =>
      db('ai_category_training_examples as a').join('customer_transactions as t', 't.transaction_id', 'a.transaction_id').where({ 'a.account_id': A, 'a.timesheet_entry_id': entryId }).select('t.*');

   // ── setup / teardown ───────────────────────────────────────────────────────
   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
      restoreSes = stubSes();
      aws = installStubbedAws();
      restoreEnv = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'off', INTERNAL_CUSTOMER_IDS: '' });
      maxNotificationId = Number((await db('notifications').max({ id: 'notification_id' }).first()).id || 0);
      maxTemplateDownloadId = Number((await db('template_downloads').max({ id: 'template_download_id' }).first()).id || 0);

      const tpl = await getBinary('admin', `/time-tracking/template/latest/${A}/${ADMIN}`);
      expect(tpl.status).to.equal(200);
      templateBuffer = tpl.body;
      originalTemplateName = tpl.headers['x-tracker-filename'];

      covCustomer = await createCustomer(COV_NAME);
      expectEnvelopeOk(
         await h
            .as('admin')
            .post(`/jobs/createJob/${A}/${ADMIN}`)
            .send({ job: { accountID: A, userID: ADMIN, loggedByUserID: ADMIN, customerID: covCustomer.customer_id, jobTypeID: JOB_TYPE_GENERAL_CONSULTING, quoteAmount: 0, agreedJobAmount: 0, currentJobTotal: 0, jobStatus: null, isJobComplete: false, isQuote: false, note: 'coverage' } }),
         'createJob'
      );
      covJobId = (await db('customer_jobs').where({ account_id: A, customer_id: covCustomer.customer_id }).whereNull('parent_job_id').first()).customer_job_id;

      // C6: a second 'Eliza Smith' in this SAME account (two employees can
      // share a display name) — inserted directly since createUser is super
      // admin only and the seeded superAdmin identity belongs to account 1,
      // not 9001. Different email (unique-while-active), different rate.
      [otherEliza] = await db('users')
         .insert({ account_id: A, email: `eliza.other+${RUN.toLowerCase()}@example.test`, display_name: 'Eliza Smith', cost_rate: 30, billing_rate: 60, job_title: 'Accountant', access_level: 'employee', is_user_active: true })
         .returning('*');
      created.userIds.push(otherEliza.user_id);

      // C12: a manager-role user in this SAME account — no seeded identity in
      // _http.js IDENTITIES has access_level 'manager'.
      [manager] = await db('users')
         .insert({ account_id: A, email: `manager+${RUN.toLowerCase()}@example.test`, display_name: 'Cov Manager', cost_rate: 40, billing_rate: 0, job_title: 'Manager', access_level: 'manager', is_user_active: true })
         .returning('*');
      created.userIds.push(manager.user_id);

      await uploadTracker('T1', ELIZA, {
         employeeName: 'Eliza Smith',
         start: CUR_START,
         end: CUR_END,
         rows: [
            { date: CUR_START, category: 'Phone Call', duration: 30, notes: `Coverage call on quarterly estimates ${RUN}` },
            { date: CUR_END, category: 'Email', duration: 45, notes: `Coverage follow-up email ${RUN}` },
            { date: CUR_END, category: 'Email', duration: 15, notes: `Coverage scratch line ${RUN}` }
         ]
      });
      await uploadTracker('T2', ELIZA, { employeeName: 'Eliza Smith', start: PREV_START, end: PREV_END, rows: [{ date: PREV_START.add(1, 'day'), category: 'Client Meeting', duration: 60, notes: `Coverage prior-month review ${RUN}` }] });
      await uploadTracker('T3', BOB, { employeeName: 'Bob Jones', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Phone Call', duration: 20, notes: `Coverage call by Bob ${RUN}` }] });

      foreignEntry = await db('timesheet_entries').where({ account_id: FOREIGN_ACCOUNT }).orderBy('timesheet_entry_id', 'asc').first();
   });

   after(async () => {
      restoreEnv();
      restoreSes();
      installFailClosedAws();
      if (db) {
         const entryIds = created.timesheetNames.length ? await db('timesheet_entries').where({ account_id: A }).whereIn('timesheet_name', created.timesheetNames).pluck('timesheet_entry_id') : [];
         const txnIds = [
            ...(created.customers.length ? await db('customer_transactions').where({ account_id: A }).whereIn('customer_id', created.customers).pluck('transaction_id') : []),
            ...(entryIds.length ? await db('ai_category_training_examples').where({ account_id: A }).whereIn('timesheet_entry_id', entryIds).whereNotNull('transaction_id').pluck('transaction_id') : [])
         ];
         if (entryIds.length) {
            await db('ai_category_training_examples').where({ account_id: A }).whereIn('timesheet_entry_id', entryIds).del();
            await db('ai_call_log').where({ account_id: A }).whereIn('timesheet_entry_id', entryIds).del();
            await db('ai_time_tracker_transaction_suggestions').where({ account_id: A }).whereIn('timesheet_entry_id', entryIds).del();
            await db('timesheet_entries').where({ account_id: A }).whereIn('timesheet_entry_id', entryIds).del();
         }
         if (txnIds.length) {
            await db('ai_category_training_examples').whereIn('transaction_id', [...new Set(txnIds)]).del();
            await db('customer_transactions').where({ account_id: A }).whereIn('transaction_id', [...new Set(txnIds)]).del();
         }
         if (created.customers.length) {
            await db('customer_jobs').where({ account_id: A }).whereIn('customer_id', created.customers).del();
            await db('customer_information').where({ account_id: A }).whereIn('customer_id', created.customers).del();
            await db('customers').where({ account_id: A }).whereIn('customer_id', created.customers).del();
         }
         await db('notifications')
            .where({ account_id: A })
            .where('notification_id', '>', maxNotificationId)
            .whereIn('type', ['tracker_upload_processed', 'rows_held_for_review', 'new_customer_needs_addition'])
            .del();
         await db('template_downloads').where({ account_id: A }).where('template_download_id', '>', maxTemplateDownloadId).del();
      }
      for (const key of [...new Set([...created.s3Keys, ...created.templateKeys])]) {
         // never the template that was 'latest' when the run started
         if (path.basename(key) === originalTemplateName) continue;
         await deleteObject(key).catch(() => {});
      }
      if (h) await h.close();
   });

   // ═══════════════════════════ /time-tracking ═══════════════════════════════
   describe('GET /time-tracking/users/:accountID/:userID', () => {
      it('admin: every ACTIVE user of the account (inactive excluded) with only id / name / email / role', async () => {
         const res = await h.as('admin').get(`/time-tracking/users/${A}/${ADMIN}`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const ids = res.body.users.map(u => u.userId);
         expect(ids).to.include.members([ELIZA, BOB, ADMIN]);
         expect(ids).to.not.include(INACTIVE_USER);
         const dbActive = await db('users').where({ account_id: A, is_user_active: true }).pluck('user_id');
         expect([...ids].sort(byNumber)).to.deep.equal([...dbActive].sort(byNumber));
         const eliza = res.body.users.find(u => u.userId === ELIZA);
         expect(eliza).to.deep.equal({ userId: ELIZA, displayName: 'Eliza Smith', email: 'eliza+test@example.com', accessLevel: 'employee' });
      });

      it('employee (self): only their own row', async () => {
         const res = await h.as('employee').get(`/time-tracking/users/${A}/${ELIZA}`);
         expect(res.status).to.equal(200);
         expect(res.body.users).to.deep.equal([{ userId: ELIZA, displayName: 'Eliza Smith', email: 'eliza+test@example.com', accessLevel: 'employee' }]);
      });

      it('employee addressing another :userID -> 403', async () => {
         const res = await h.as('employee').get(`/time-tracking/users/${A}/${BOB}`);
         expect(res.status).to.equal(403);
         expect(res.body.message).to.equal('Access denied for this user');
      });

      it('unknown :userID, or a user of another tenant -> 404', async () => {
         const unknown = await h.as('admin').get(`/time-tracking/users/${A}/${NOT_FOUND_ID}`);
         expect(unknown.status).to.equal(404);
         expect(unknown.body.message).to.equal('Unable to locate user details for upload.');
         const foreignUser = await h.as('admin').get(`/time-tracking/users/${A}/${SUPER_ADMIN}`);
         expect(foreignUser.status).to.equal(404);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/time-tracking/users/${acct}/${user}`);
      });
   });

   describe('GET /time-tracking/history/:accountID/:userID', () => {
      it('admin: lists the owner’s stored uploads (name = stored file name, gzip size, newest first); another employee’s files are absent', async () => {
         const res = await h.as('admin').get(`/time-tracking/history/${A}/${ELIZA}`);
         expect(res.status).to.equal(200);
         const keys = res.body.history.map(x => x.key);
         expect(keys).to.include.members([T.T1.body.storedKey, T.T2.body.storedKey]);
         expect(keys).to.not.include(T.T3.body.storedKey);
         const t1 = res.body.history.find(x => x.key === T.T1.body.storedKey);
         const stored = await getObject(T.T1.body.storedKey);
         expect(t1).to.include({ id: T.T1.body.storedKey, fileName: T.T1.body.fileName, size: stored.body.length });
         expect(dayjs(t1.uploadedAt).isValid()).to.equal(true);
         const times = res.body.history.map(x => new Date(x.uploadedAt).getTime());
         expect(times).to.deep.equal([...times].sort((a, b) => b - a));
      });

      it('employee (self) sees their own list; another owner’s history -> 403', async () => {
         const own = await h.as('employee').get(`/time-tracking/history/${A}/${ELIZA}`);
         expect(own.status).to.equal(200);
         expect(own.body.history.map(x => x.key)).to.include(T.T1.body.storedKey);
         const other = await h.as('employee').get(`/time-tracking/history/${A}/${BOB}`);
         expect(other.status).to.equal(403);
      });

      it('unknown owner -> 404', async () => {
         const res = await h.as('admin').get(`/time-tracking/history/${A}/${NOT_FOUND_ID}`);
         expect(res.status).to.equal(404);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/time-tracking/history/${acct}/${user}`);
      });

      // FIXED (was DEFECT): the processed-tracker key had no account segment — every
      // account's user named "Eliza Smith" shared one processed/<Last_First>/ folder,
      // and /history + /history/download authorized by that shared prefix alone. NEW
      // uploads now write under an account-scoped primary prefix (buildProcessedPrefixes
      // in timeTracking-router.js, mirroring the <account_name_slug>/time_tracking/...
      // convention the template route uses), and the old flat layout is still read (for
      // production's pre-fix history) but only trusted for file names this account's own
      // timesheet_entries actually recorded (filterLegacyObjectsToOwner /
      // legacyKeyBelongsToOwner). Simulated here by writing the exact key the OLD upload
      // route would have produced for a same-named user of another account (the sandbox's
      // account 1 has no such user).
      it('another account’s same-named user’s upload is neither listed nor downloadable', async () => {
         const foreignKey = `${PROCESSED_ROOT}/Smith_Eliza/Smith_Eliza_OtherTenant_${RUN}.xlsx.gz`;
         created.s3Keys.push(foreignKey);
         await putObject(foreignKey, zlib.gzipSync(Buffer.from('tracker uploaded in another account')), 'application/gzip', { 'original-content-type': XLSX_MIME });
         const res = await h.as('admin').get(`/time-tracking/history/${A}/${ELIZA}`);
         const download = await getBinary('employee', `/time-tracking/history/download/${A}/${ELIZA}`, { key: foreignKey });
         expect({ listed: res.body.history.map(x => x.key).includes(foreignKey), downloadStatus: download.status }).to.deep.equal({ listed: false, downloadStatus: 403 });
      });
   });

   describe('GET /time-tracking/history/download/:accountID/:userID', () => {
      it('admin downloads the owner’s tracker: the original workbook bytes, its content type and file name', async () => {
         const res = await getBinary('admin', `/time-tracking/history/download/${A}/${ELIZA}`, { key: T.T1.body.storedKey });
         expect(res.status).to.equal(200);
         expect(sha256(res.body)).to.equal(sha256(T.T1.buffer));
         expect(res.headers['x-tracker-filename']).to.equal(T.T1.body.fileName);
         expect(res.headers['content-type']).to.match(new RegExp(`^${XLSX_MIME.replace(/\./g, '\\.')}`));
         expect(res.headers['content-disposition']).to.equal(`attachment; filename="${T.T1.body.fileName}"`);
      });

      it('employee downloads their own tracker', async () => {
         const res = await getBinary('employee', `/time-tracking/history/download/${A}/${ELIZA}`, { key: T.T2.body.storedKey });
         expect(res.status).to.equal(200);
         expect(sha256(res.body)).to.equal(sha256(T.T2.buffer));
      });

      it('missing key -> 400; a key outside the owner’s folder (another employee’s tracker, the template) -> 403', async () => {
         const missing = await h.as('admin').get(`/time-tracking/history/download/${A}/${ELIZA}`);
         expect(missing.status).to.equal(400);
         expect(missing.body.message).to.equal('An S3 object key is required to download the file.');
         const bobs = await h.as('admin').get(`/time-tracking/history/download/${A}/${ELIZA}`).query({ key: T.T3.body.storedKey });
         expect(bobs.status).to.equal(403);
         expect(bobs.body.message).to.equal('You do not have access to this file.');
         const template = await h.as('employee').get(`/time-tracking/history/download/${A}/${ELIZA}`).query({ key: `${TRACKER_VERSIONS_ROOT}/${originalTemplateName}` });
         expect(template.status).to.equal(403);
      });

      it('employee addressing another owner -> 403', async () => {
         const res = await h.as('employee').get(`/time-tracking/history/download/${A}/${BOB}`).query({ key: T.T3.body.storedKey });
         expect(res.status).to.equal(403);
         expect(res.body.message).to.equal('Access denied for this user');
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/time-tracking/history/download/${acct}/${user}?key=${encodeURIComponent(T.T1.body.storedKey)}`);
      });

      // FIXED (was DEFECT): timeTracking-router.js awaited getObject() with no NoSuchKey
      // handling; the SDK error has no `.status`, so asyncHandler handed it to the app
      // error handler, which answered 500. The download route now catches NoSuchKey and
      // answers 404. Key is built from T1's own real (account-scoped) stored key with
      // just the file name swapped, so it is unambiguously "inside the owner's folder".
      it('a key inside the owner’s folder that does not exist -> 404', async () => {
         const missingKey = T.T1.body.storedKey.replace(/[^/]+$/, `missing_${RUN}.xlsx.gz`);
         const res = await h.as('admin').get(`/time-tracking/history/download/${A}/${ELIZA}`).query({ key: missingKey });
         expect(res.status).to.equal(404);
      });
   });

   describe('GET /time-tracking/download/by-name/:accountID/:userID', () => {
      it('admin downloads an employee’s tracker by the timesheet_name stored on its entry rows', async () => {
         const res = await getBinary('admin', `/time-tracking/download/by-name/${A}/${ADMIN}`, { ownerUserID: ELIZA, timesheetName: T.T1.entries[0].timesheet_name });
         expect(res.status).to.equal(200);
         expect(sha256(res.body)).to.equal(sha256(T.T1.buffer));
         expect(res.headers['x-tracker-filename']).to.equal(T.T1.body.fileName);
      });

      it('a spaced variant of the stored name resolves to the same file (legacy name fallback)', async () => {
         const res = await getBinary('admin', `/time-tracking/download/by-name/${A}/${ADMIN}`, { ownerUserID: ELIZA, timesheetName: T.T2.body.fileName.replace(/_/g, ' ') });
         expect(res.status).to.equal(200);
         expect(sha256(res.body)).to.equal(sha256(T.T2.buffer));
      });

      it('employee: own tracker -> 200; another owner’s tracker -> 403', async () => {
         const own = await getBinary('employee', `/time-tracking/download/by-name/${A}/${ELIZA}`, { ownerUserID: ELIZA, timesheetName: T.T1.body.fileName });
         expect(own.status).to.equal(200);
         const other = await h.as('employee').get(`/time-tracking/download/by-name/${A}/${ELIZA}`).query({ ownerUserID: BOB, timesheetName: T.T3.body.fileName });
         expect(other.status).to.equal(403);
         expect(other.body.message).to.equal('You are not authorized to download this tracker.');
      });

      it('missing params -> 400; a path-like name -> 400; unknown name -> 404; owner outside the account -> 404', async () => {
         const missing = await h.as('admin').get(`/time-tracking/download/by-name/${A}/${ADMIN}`).query({ ownerUserID: ELIZA });
         expect(missing.status).to.equal(400);
         const traversal = await h.as('admin').get(`/time-tracking/download/by-name/${A}/${ADMIN}`).query({ ownerUserID: ELIZA, timesheetName: `../Jones_Bob/${T.T3.body.fileName}` });
         expect(traversal.status).to.equal(400);
         expect(traversal.body.message).to.equal('Invalid timesheet name provided.');
         const unknown = await h.as('admin').get(`/time-tracking/download/by-name/${A}/${ADMIN}`).query({ ownerUserID: ELIZA, timesheetName: `Smith_Eliza_never_uploaded_${RUN}.xlsx` });
         expect(unknown.status).to.equal(404);
         expect(unknown.body.message).to.match(/could not locate that time tracker/);
         const foreignOwner = await h.as('admin').get(`/time-tracking/download/by-name/${A}/${ADMIN}`).query({ ownerUserID: SUPER_ADMIN, timesheetName: T.T1.body.fileName });
         expect(foreignOwner.status).to.equal(404);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/time-tracking/download/by-name/${acct}/${user}?ownerUserID=${ELIZA}&timesheetName=${encodeURIComponent(T.T1.body.fileName)}`);
      });
   });

   // C6: two employees who share a display name WITHIN THE SAME ACCOUNT (the
   // "another account's same-named user" test above covers the CROSS-account
   // flat-legacy-layout case; this covers the gap the reviewer found — the
   // FORMER primary layout, processed/<accountFolder>/<Last_First>/, was
   // account-scoped but keyed by SANITIZED DISPLAY NAME, so two same-named
   // employees IN ONE account resolved to the identical folder and one could
   // list/download the other's files. New uploads write under
   // processed/<accountFolder>/user_<id>/ (immutable, never shared); the old
   // name-keyed folder is still read for pre-fix history, but only ever
   // trusted for the file names THIS owner's own timesheet_entries history
   // actually recorded — simulated here the same way the cross-account test
   // above simulates its own legacy object.
   describe('same-named employees within ONE account do not share history/downloads (C6)', () => {
      const ACCOUNT_LEGACY_PREFIX = `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/Smith_Eliza/`;
      let otherElizaFileName;
      let otherElizaKey;

      before(async () => {
         otherElizaFileName = `OtherEliza_${RUN}.xlsx`;
         otherElizaKey = `${ACCOUNT_LEGACY_PREFIX}${otherElizaFileName}.gz`;
         created.s3Keys.push(otherElizaKey);
         await putObject(otherElizaKey, zlib.gzipSync(Buffer.from('other Eliza private workbook bytes')), 'application/gzip', { 'original-content-type': XLSX_MIME });
         // The row this account's own history actually attributes to
         // otherEliza (her OWN user_id) — this is what makes the object
         // legitimately hers, not just its file name.
         const [row] = await db('timesheet_entries')
            .insert({
               account_id: A,
               user_id: otherEliza.user_id,
               employee_name: 'Eliza Smith',
               timesheet_name: otherElizaFileName,
               time_tracker_start_date: iso(CUR_START),
               time_tracker_end_date: iso(CUR_END),
               date: iso(CUR_END),
               entity: ENTITY_JKA,
               category: 'Phone Call',
               company_name: COV_NAME,
               duration: 30,
               notes: `otherEliza private line ${RUN}`
            })
            .returning('timesheet_entry_id');
         created.timesheetNames.push(otherElizaFileName);
         return row;
      });

      it('the REAL Eliza (90011) does not see the other Eliza’s legacy-layout file in her history', async () => {
         const res = await h.as('admin').get(`/time-tracking/history/${A}/${ELIZA}`);
         expect(res.status).to.equal(200);
         expect(res.body.history.map(x => x.key)).to.not.include(otherElizaKey);
      });

      it('the REAL Eliza (90011) cannot download the other Eliza’s legacy-layout file even though it sits under the shared name folder', async () => {
         const res = await h.as('admin').get(`/time-tracking/history/download/${A}/${ELIZA}`).query({ key: otherElizaKey });
         expect(res.status).to.equal(403);
      });

      it('/download/by-name for the real Eliza 404s for a name only the OTHER Eliza owns (no owned matching file — 200 with any non-victim bytes is still wrong)', async () => {
         const res = await getBinary('admin', `/time-tracking/download/by-name/${A}/${ADMIN}`, { ownerUserID: ELIZA, timesheetName: otherElizaFileName });
         // The real Eliza's OWN upload history (getAllTimesheetNamesEverUsedByEmployee)
         // has no row named otherElizaFileName at all, so resolving to ANYTHING
         // here — even a third, unrelated object — would be wrong. The only
         // correct response is 404.
         expect(res.status, JSON.stringify(res.body).slice(0, 300)).to.equal(404);
      });

      it('the OTHER Eliza (as herself) DOES see and can download her own legacy-layout file — the fix attributes it correctly, not just hides it from everyone', async () => {
         const list = await asCustom(otherEliza.email).get(`/time-tracking/history/${A}/${otherEliza.user_id}`);
         expect(list.status).to.equal(200);
         expect(list.body.history.map(x => x.key)).to.include(otherElizaKey);
         const download = await getBinaryAs(asCustom(otherEliza.email), `/time-tracking/history/download/${A}/${otherEliza.user_id}`, { key: otherElizaKey });
         expect(download.status).to.equal(200);
         // The route decompresses before sending — compare against the
         // original (uncompressed) bytes, not gunzip(download.body) again.
         expect(sha256(download.body)).to.equal(sha256(Buffer.from('other Eliza private workbook bytes')));
      });
   });

   describe('GET /time-tracking/template/latest/:accountID/:userID', () => {
      it('flag off (default): the stored latest template is served unchanged to any authenticated user of the account', async () => {
         const res = await getBinary('employee', `/time-tracking/template/latest/${A}/${ELIZA}`);
         expect(res.status).to.equal(200);
         expect(res.headers['x-tracker-filename']).to.equal(originalTemplateName);
         const stored = await getObject(`${TRACKER_VERSIONS_ROOT}/${originalTemplateName}`);
         expect(sha256(res.body)).to.equal(sha256(stored.body));
         expect(res.headers['x-tracker-customers'], 'no dynamic re-stamp when the flag is off').to.equal(undefined);
      });

      it('flag on for the account: hidden lookup sheets are re-stamped from account 9001’s own catalogs; counts in headers; audit row written', async () => {
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            const res = await getBinary('admin', `/time-tracking/template/latest/${A}/${ADMIN}`);
            expect(res.status).to.equal(200);
            expect(res.headers['content-type']).to.match(/spreadsheetml\.sheet/);
            const wb = XLSX.read(res.body, { type: 'buffer' });
            const customers = sheetColumnA(wb, '__customers').slice(1);
            const employees = sheetColumnA(wb, '__employees').slice(1);
            const categories = sheetColumnA(wb, '__categories').slice(1);
            expect(Number(res.headers['x-tracker-customers'])).to.equal(customers.length);
            expect(Number(res.headers['x-tracker-employees'])).to.equal(employees.length);
            expect(Number(res.headers['x-tracker-categories'])).to.equal(categories.length);
            const dbCustomers = await db('customers').where({ account_id: A, is_customer_active: true }).pluck('display_name');
            expect([...customers].sort()).to.deep.equal([...dbCustomers].sort());
            expect(customers).to.include.members(['Acme Corp', COV_NAME]);
            const dbEmployees = await db('users').where({ account_id: A, is_user_active: true }).pluck('display_name');
            expect([...employees].sort()).to.deep.equal([...dbEmployees].sort());
            expect(employees).to.not.include('Sam Inactive');
            const dbCategories = await db('customer_general_work_descriptions').where({ account_id: A, is_general_work_description_active: true }).pluck('general_work_description');
            expect([...categories].sort()).to.deep.equal([...dbCategories].sort());
            expect(wb.SheetNames[0]).to.equal('Time');
            const audit = await db('template_downloads').where({ account_id: A, user_id: ADMIN }).where('template_download_id', '>', maxTemplateDownloadId).orderBy('template_download_id', 'desc').first();
            expect(audit).to.include({ customer_count: customers.length, employee_count: employees.length, category_count: categories.length });
         } finally {
            restore();
         }
      });

      it('employee addressing another :userID -> 403', async () => {
         const res = await h.as('employee').get(`/time-tracking/template/latest/${A}/${BOB}`);
         expect(res.status).to.equal(403);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/time-tracking/template/latest/${acct}/${user}`);
      });

      // FIXED (was DEFECT) for the flag-ON path: template-builder.js buildTemplate()
      // already scoped the hidden __customers / __employees / __categories sheets to
      // the requesting account (_readCatalogs filters on account_id), but left the
      // VISIBLE 'Employee Names' sheet untouched, so a re-stamped template still
      // displayed whichever account's staff the base workbook was last captured
      // from. buildTemplate now also overwrites 'Employee Names' with the requesting
      // account's own active staff (_replaceVisibleNameList; see also the unit
      // coverage in test/endpoints/timeTracking/template-builder.spec.js).
      it('the flag-on (re-stamped) template served to account 9001 carries no other tenant’s customer or staff names', async () => {
         const foreignCustomers = new Set(await db('customers').where({ account_id: FOREIGN_ACCOUNT }).pluck('display_name'));
         const foreignStaff = new Set(await db('users').where({ account_id: FOREIGN_ACCOUNT }).pluck('display_name'));
         const leaked = wb => ({
            customers: (sheetColumnA(wb, '__customers') || []).filter(n => foreignCustomers.has(n)).length,
            staff: [...(sheetColumnA(wb, '__employees') || []), ...(sheetColumnA(wb, 'Employee Names') || [])].filter(n => foreignStaff.has(n)).length
         });
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         let dynamicRes;
         try {
            dynamicRes = await getBinary('employee', `/time-tracking/template/latest/${A}/${ELIZA}`);
         } finally {
            restore();
         }
         expect(leaked(XLSX.read(dynamicRes.body, { type: 'buffer' }))).to.deep.equal({ customers: 0, staff: 0 });
      });

      // STILL A DEFECT, left skipped — see the flag-on test just above for the part
      // that IS fixed. This flag-OFF half is irreconcilable with the OTHER (green,
      // not-DEFECT) test in this same describe block, "flag off (default): the
      // stored latest template is served unchanged...", which pins the flag-off
      // response to being BYTE-IDENTICAL to whatever object currently sits at
      // tracker_versions/<latest> (sha256 equality, and x-tracker-customers must be
      // `undefined` — i.e. no re-stamp at all). That object is a single firm-wide
      // key (timeTracking-router.js TRACKER_VERSIONS_ROOT, unchanged by this pass
      // per the defect's own fix instructions — only "build the customer and staff
      // lists from the requesting account only" was in scope, not relocating the
      // template's storage key) shared by every account in the sandbox, including
      // account 1, and it is a captured prod snapshot that already has account 1's
      // real client/staff names baked into its cells — not something this route can
      // launder without either (a) making the flag-off path stop being a pure
      // passthrough (breaking the test above), or (b) rewriting the shared stored
      // S3 object's bytes out from under every other concurrently-running spec that
      // reads it (tracker-excel-end-to-end.integration.spec.js's step (1) included),
      // which is a data change, not a code fix, and outside this pass's scope.
      // Flagging for a human call: either the flag-off "unchanged" contract needs to
      // become "unchanged AND account-scoped" (a product decision, not just a bug
      // fix), or the static template object itself needs to be re-captured/scrubbed
      // out of band.
      it.skip('the flag-off (static passthrough) template served to account 9001 carries no other tenant’s customer or staff names — DEFECT, see comment above', async () => {
         const foreignCustomers = new Set(await db('customers').where({ account_id: FOREIGN_ACCOUNT }).pluck('display_name'));
         const foreignStaff = new Set(await db('users').where({ account_id: FOREIGN_ACCOUNT }).pluck('display_name'));
         const leaked = wb => ({
            customers: (sheetColumnA(wb, '__customers') || []).filter(n => foreignCustomers.has(n)).length,
            staff: [...(sheetColumnA(wb, '__employees') || []), ...(sheetColumnA(wb, 'Employee Names') || [])].filter(n => foreignStaff.has(n)).length
         });
         const staticRes = await getBinary('admin', `/time-tracking/template/latest/${A}/${ADMIN}`);
         expect(leaked(XLSX.read(staticRes.body, { type: 'buffer' }))).to.deep.equal({ customers: 0, staff: 0 });
      });
   });

   // Template round trip: upload (super admin) -> list -> latest -> delete -> latest restored.
   let uploadedTemplate; // { storedKey, fileName }
   describe('POST /time-tracking/template/upload/:accountID/:userID', () => {
      it('super admin uploads a new version: 201, stored under tracker_versions/ byte-for-byte, and it becomes the latest template', async () => {
         const res = await rawPost(h.as('superAdmin'), `/time-tracking/template/upload/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`, templateBuffer, { fileName: `coverage copy ${RUN}.xlsx` });
         expect(res.status, JSON.stringify(res.body)).to.equal(201);
         uploadedTemplate = res.body;
         created.templateKeys.push(res.body.storedKey);
         expect(res.body.message).to.equal('Tracker template uploaded successfully.');
         expect(res.body.fileName).to.match(/^timeTracker_[A-Za-z]+-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}[AP]M\.xlsx$/);
         expect(res.body.storedKey).to.equal(`${TRACKER_VERSIONS_ROOT}/${res.body.fileName}`);
         expect(res.body.fileName).to.not.equal(originalTemplateName);

         const stored = await getObject(res.body.storedKey);
         expect(sha256(stored.body)).to.equal(sha256(templateBuffer));
         expect(stored.metadata.contentType).to.equal(XLSX_MIME);
         expect(decodeURIComponent(stored.metadata.userMetadata['original-filename'])).to.equal(`coverage copy ${RUN}.xlsx`);

         const latest = await getBinary('admin', `/time-tracking/template/latest/${A}/${ADMIN}`);
         expect(latest.status).to.equal(200);
         expect(latest.headers['x-tracker-filename']).to.equal(res.body.fileName);
         expect(sha256(latest.body)).to.equal(sha256(templateBuffer));
      });

      it('only a super admin may upload: account admin and employee -> 403; nothing is written', async () => {
         const before = (await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).length;
         const admin = await rawPost(h.as('admin'), `/time-tracking/template/upload/${A}/${ADMIN}`, templateBuffer, { fileName: 'admin.xlsx' });
         expect(admin.status).to.equal(403);
         expect(admin.body.message).to.equal('Unauthorized');
         const employee = await rawPost(h.as('employee'), `/time-tracking/template/upload/${A}/${ELIZA}`, templateBuffer, { fileName: 'employee.xlsx' });
         expect(employee.status).to.equal(403);
         expect((await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).length).to.equal(before);
      });

      it('missing x-file-name -> 400; a file over 1 MB -> 400', async () => {
         const noName = await rawPost(h.as('superAdmin'), `/time-tracking/template/upload/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`, templateBuffer, { fileName: null });
         expect(noName.status).to.equal(400);
         expect(noName.body.message).to.equal('Missing file metadata. Please include the original file name.');
         const big = await rawPost(h.as('superAdmin'), `/time-tracking/template/upload/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`, Buffer.alloc(1024 * 1024 + 1), { fileName: 'big.xlsx' });
         expect(big.status).to.equal(400);
         expect(big.body.message).to.equal('File exceeds the 1MB size limit.');
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         const noToken = await rawPost(h.anonymous, `/time-tracking/template/upload/${A}/${ADMIN}`, templateBuffer);
         expect(noToken.status).to.equal(401);
         const stranger = await rawPost(h.as('stranger'), `/time-tracking/template/upload/${A}/${ADMIN}`, templateBuffer);
         expect(stranger.status).to.equal(401);
         const reverse = await rawPost(h.as('superAdmin'), `/time-tracking/template/upload/${A}/${SUPER_ADMIN}`, templateBuffer);
         expect(reverse.status).to.equal(403);
         expect(reverse.body.message).to.equal('Account access denied');
      });
   });

   describe('GET /time-tracking/template/list/:accountID/:userID', () => {
      it('admin: every version newest first — the new upload on top, the original still listed', async () => {
         const res = await h.as('admin').get(`/time-tracking/template/list/${A}/${ADMIN}`);
         expect(res.status).to.equal(200);
         const { templates } = res.body;
         expect(templates[0]).to.include({ id: uploadedTemplate.storedKey, key: uploadedTemplate.storedKey, fileName: uploadedTemplate.fileName, size: templateBuffer.length });
         expect(templates.map(t => t.fileName)).to.include(originalTemplateName);
         templates.forEach(t => expect(t.fileName).to.match(/^timetracker_/i));
      });

      it('super admin may list; employee -> 403 (admin only)', async () => {
         const sa = await h.as('superAdmin').get(`/time-tracking/template/list/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`);
         expect(sa.status).to.equal(200);
         expect(sa.body.templates.map(t => t.key)).to.include(uploadedTemplate.storedKey);
         const employee = await h.as('employee').get(`/time-tracking/template/list/${A}/${ELIZA}`);
         expect(employee.status).to.equal(403);
         expect(employee.body.message).to.equal('Admin access required.');
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/time-tracking/template/list/${acct}/${user}`);
      });

      // FIXED (was DEFECT, C12): authorization used to check the SELECTED
      // URL user's own record (ensureAdminAccess(userRecord)) rather than the
      // authenticated caller. enforceSelfOrPrivileged lets a manager address
      // any :userID, so a manager naming an admin's id in the URL "borrowed"
      // that admin's role and got 200. It now checks req.user (the actual
      // caller) — a manager is refused regardless of whose id is in the URL.
      it('a manager addressing an ADMIN\'s URL id cannot borrow that admin\'s role (403)', async () => {
         const res = await asCustom(manager.email).get(`/time-tracking/template/list/${A}/${ADMIN}`);
         expect(res.status).to.equal(403);
         expect(res.body.message).to.equal('Admin access required.');
      });
   });

   describe('DELETE /time-tracking/template/delete/:accountID/:userID', () => {
      it('refuses bad requests without deleting anything: no key / outside tracker_versions / the folder / a non-template name -> 400; employee -> 403', async () => {
         const url = `/time-tracking/template/delete/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`;
         const cases = [
            [{}, 'S3 key is required to delete a template.'],
            [{ key: `${PROCESSED_ROOT}/Smith_Eliza/${T.T1.body.fileName}.gz` }, 'Invalid template key.'],
            [{ key: `${TRACKER_VERSIONS_ROOT}/` }, 'Invalid template key.'],
            [{ key: `${TRACKER_VERSIONS_ROOT}/notes_${RUN}.txt` }, 'Only tracker template files can be deleted.']
         ];
         for (const [body, message] of cases) {
            const res = await h.as('superAdmin').delete(url).send(body);
            expect(res.status, JSON.stringify(body)).to.equal(400);
            expect(res.body.message).to.equal(message);
         }
         const employee = await h.as('employee').delete(`/time-tracking/template/delete/${A}/${ELIZA}`).send({ key: uploadedTemplate.storedKey });
         expect(employee.status).to.equal(403);
         expect((await getObject(uploadedTemplate.storedKey)).body.length).to.equal(templateBuffer.length);
         expect((await getObject(T.T1.body.storedKey)).body.length).to.be.greaterThan(0);
      });

      it('401 without a valid identity; 403 across tenants (nothing deleted)', async () => {
         await expectAuthGuards('delete', (acct, user) => `/time-tracking/template/delete/${acct}/${user}`, { send: { key: uploadedTemplate.storedKey } });
         expect((await getObject(uploadedTemplate.storedKey)).body.length).to.equal(templateBuffer.length);
      });

      it('super admin deletes the uploaded version: 204, gone from S3 and the list, and the original is the latest template again', async () => {
         const res = await h.as('superAdmin').delete(`/time-tracking/template/delete/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`).send({ key: uploadedTemplate.storedKey });
         expect(res.status).to.equal(204);
         let gone = null;
         try {
            await getObject(uploadedTemplate.storedKey);
         } catch (e) {
            gone = e;
         }
         expect(gone && gone.name, 'object removed').to.equal('NoSuchKey');
         const list = await h.as('admin').get(`/time-tracking/template/list/${A}/${ADMIN}`);
         expect(list.body.templates.map(t => t.key)).to.not.include(uploadedTemplate.storedKey);
         const latest = await getBinary('admin', `/time-tracking/template/latest/${A}/${ADMIN}`);
         expect(latest.headers['x-tracker-filename']).to.equal(originalTemplateName);
         const original = await getObject(`${TRACKER_VERSIONS_ROOT}/${originalTemplateName}`);
         expect(sha256(latest.body)).to.equal(sha256(original.body));
      });

      // FIXED (was DEFECT): upload of a firm-wide template version is super-admin
      // only, but delete used to run ensureAdminAccess ('admin' OR 'super admin') on
      // the caller's own account, while the key is the single hard-coded
      // TRACKER_VERSIONS_ROOT — so an ADMIN of any tenant (here account 9001) could
      // delete the template every tenant downloads. /template/delete now requires
      // requireSuperAdmin, the same gate as /template/upload.
      it('an account admin (not super admin) cannot delete a firm-wide template version', async () => {
         const up = await rawPost(h.as('superAdmin'), `/time-tracking/template/upload/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`, templateBuffer, { fileName: `sacrificial ${RUN}.xlsx` });
         expect(up.status).to.equal(201);
         created.templateKeys.push(up.body.storedKey);
         const res = await h.as('admin').delete(`/time-tracking/template/delete/${A}/${ADMIN}`).send({ key: up.body.storedKey });
         expect(res.status).to.equal(403);
         expect((await getObject(up.body.storedKey)).body.length).to.equal(templateBuffer.length);
      });
   });

   // ════════════════════════════ /timesheets ═════════════════════════════════
   describe('GET /timesheets/getTimesheetEntries/:accountID/:userID', () => {
      it('admin: the account’s unprocessed entries (safe columns only), with page metadata that matches the table', async () => {
         const res = await h.as('admin').get(`/timesheets/getTimesheetEntries/${A}/${ADMIN}`).query({ limit: 500 });
         expect(res.status).to.equal(200);
         const rows = res.body.outstandingTimesheetEntries;
         const mine = [...T.T1.entries, ...T.T2.entries, ...T.T3.entries].map(e => e.timesheet_entry_id);
         expect(rows.map(r => r.timesheet_entry_id)).to.include.members(mine);
         rows.forEach(r => expect(r.account_id).to.equal(A));
         rows.filter(r => mine.includes(r.timesheet_entry_id)).forEach(r => expect(Object.keys(r)).to.have.members(ENTRY_SAFE_COLUMNS));
         const total = Number((await db('timesheet_entries').where({ account_id: A, is_processed: false, is_deleted: false }).count({ n: '*' }).first()).n);
         expect(res.body.pagination).to.deep.equal({ page: 1, limit: 500, totalItems: total, totalPages: Math.ceil(total / 500) });
      });

      it('pagination: page 2 of limit 1 returns one row; a huge limit is capped at 500', async () => {
         const page2 = await h.as('admin').get(`/timesheets/getTimesheetEntries/${A}/${ADMIN}`).query({ page: 2, limit: 1 });
         expect(page2.status).to.equal(200);
         expect(page2.body.outstandingTimesheetEntries).to.have.lengthOf(1);
         expect(page2.body.pagination).to.include({ page: 2, limit: 1 });
         expect(page2.body.pagination.totalPages).to.equal(page2.body.pagination.totalItems);
         const capped = await h.as('admin').get(`/timesheets/getTimesheetEntries/${A}/${ADMIN}`).query({ limit: 100000 });
         expect(capped.body.pagination.limit).to.equal(500);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/timesheets/getTimesheetEntries/${acct}/${user}`);
      });

      // FIXED (was DEFECT): getPaginationParams throws a plain Error on page=0; the
      // route now parses pagination through parsePagination(), which answers 400
      // instead of letting the generic catch turn it into a 500.
      it('invalid pagination (page=0) -> 400', async () => {
         const res = await h.as('admin').get(`/timesheets/getTimesheetEntries/${A}/${ADMIN}`).query({ page: 0 });
         expect(res.status).to.equal(400);
      });

      // FIXED (was DEFECT): the timesheets router had no role or owner gate at all,
      // while the only UI using these routes is Manager/Admin-only. Firm-wide reads
      // (this route, and countsByEmployee) now require manager+ (requireManagerOrAbove
      // in timesheets-router.js).
      it('a plain employee cannot read the whole account’s pending entries', async () => {
         const res = await h.as('employee').get(`/timesheets/getTimesheetEntries/${A}/${ELIZA}`).query({ limit: 500 });
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID', () => {
      it('admin: only the queried employee’s pending entries; grid rows carry ai_status; totals match the table', async () => {
         const res = await h.as('admin').get(`/timesheets/getTimesheetEntriesByUserID/${ELIZA}/${A}/${ADMIN}`).query({ limit: 500 });
         expect(res.status).to.equal(200);
         const rows = res.body.outstandingTimesheetEntries;
         rows.forEach(r => expect(r.user_id).to.equal(ELIZA));
         const ids = rows.map(r => r.timesheet_entry_id);
         expect(ids).to.include.members([...T.T1.entries, ...T.T2.entries].map(e => e.timesheet_entry_id));
         expect(ids).to.not.include(T.T3.entries[0].timesheet_entry_id);
         const gridRow = res.body.grid.rows.find(r => r.timesheet_entry_id === T.T1.entries[0].timesheet_entry_id);
         expect(gridRow).to.include({ ai_status: null, duration: 30, company_name: COV_NAME });
         const total = Number((await db('timesheet_entries').where({ account_id: A, user_id: ELIZA, is_processed: false, is_deleted: false }).count({ n: '*' }).first()).n);
         expect(res.body.pagination.totalItems).to.equal(total);
      });

      it('employee may read their own queue; an unknown employee is an empty page', async () => {
         const own = await h.as('employee').get(`/timesheets/getTimesheetEntriesByUserID/${ELIZA}/${A}/${ELIZA}`).query({ limit: 500 });
         expect(own.status).to.equal(200);
         own.body.outstandingTimesheetEntries.forEach(r => expect(r.user_id).to.equal(ELIZA));
         const unknown = await h.as('admin').get(`/timesheets/getTimesheetEntriesByUserID/${NOT_FOUND_ID}/${A}/${ADMIN}`);
         expect(unknown.status).to.equal(200);
         expect(unknown.body.outstandingTimesheetEntries).to.deep.equal([]);
         expect(unknown.body.pagination.totalItems).to.equal(0);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/timesheets/getTimesheetEntriesByUserID/${ELIZA}/${acct}/${user}`);
      });

      // FIXED (was DEFECT): :queryUserID (the entries' owner) was never checked against
      // the caller. timesheets-router.js now registers enforceSelfOrPrivileged (the same
      // helper timeTracking-router.js uses) on :queryUserID.
      it('an employee cannot read another employee’s pending entries', async () => {
         const res = await h.as('employee').get(`/timesheets/getTimesheetEntriesByUserID/${BOB}/${A}/${ELIZA}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID', () => {
      it('admin: one summary row per uploaded tracker, internal ids stripped, count matches the table', async () => {
         const res = await h.as('admin').get(`/timesheets/getAllTimesheetsForEmployeeByUserID/${ELIZA}/${A}/${ADMIN}`).query({ limit: 500 });
         expect(res.status).to.equal(200);
         const rows = res.body.allEmployeeTimesheets;
         const t1 = rows.filter(r => r.timesheet_name === T.T1.body.fileName);
         const t2 = rows.filter(r => r.timesheet_name === T.T2.body.fileName);
         expect(t1, 'one row per tracker').to.have.lengthOf(1);
         expect(t2).to.have.lengthOf(1);
         expect(Object.keys(t1[0])).to.have.members(['employee_name', 'timesheet_name', 'time_tracker_start_date', 'time_tracker_end_date', 'created_at']);
         expect(t1[0].employee_name).to.equal('Eliza Smith');
         expect(dayjs(t1[0].time_tracker_start_date).format('YYYY-MM-DD')).to.equal(iso(CUR_START));
         expect(dayjs(t2[0].time_tracker_end_date).format('YYYY-MM-DD')).to.equal(iso(PREV_END));
         expect(rows.map(r => r.timesheet_name)).to.not.include(T.T3.body.fileName);
         const distinct = Number((await db('timesheet_entries').where({ account_id: A, user_id: ELIZA, is_deleted: false }).countDistinct({ n: 'timesheet_name' }).first()).n);
         expect(res.body.pagination.totalItems).to.equal(distinct);
         expect(res.body.grid.rows.map(r => r.timesheet_name)).to.include(T.T1.body.fileName);
      });

      it('employee may list their own trackers', async () => {
         const res = await h.as('employee').get(`/timesheets/getAllTimesheetsForEmployeeByUserID/${ELIZA}/${A}/${ELIZA}`).query({ limit: 500 });
         expect(res.status).to.equal(200);
         expect(res.body.allEmployeeTimesheets.map(r => r.timesheet_name)).to.include(T.T2.body.fileName);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/timesheets/getAllTimesheetsForEmployeeByUserID/${ELIZA}/${acct}/${user}`);
      });

      // FIXED (was DEFECT): same missing owner check as getTimesheetEntriesByUserID,
      // same fix (enforceSelfOrPrivileged on :queryUserID).
      it('an employee cannot list another employee’s trackers', async () => {
         const res = await h.as('employee').get(`/timesheets/getAllTimesheetsForEmployeeByUserID/${BOB}/${A}/${ELIZA}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID', () => {
      it('admin: only trackers whose window lies inside the CURRENT month (T1 yes, last month’s T2 no)', async () => {
         const res = await h.as('admin').get(`/timesheets/fetchTimesheetsByMonth/${ELIZA}/${A}/${ADMIN}`).query({ limit: 500 });
         expect(res.status).to.equal(200);
         const names = res.body.employeeTimesheetsForMonth.map(r => r.timesheet_name);
         expect(names).to.include(T.T1.body.fileName);
         expect(names).to.not.include(T.T2.body.fileName);
         expect(names).to.not.include(T.T3.body.fileName);
         res.body.employeeTimesheetsForMonth.forEach(r => expect(r).to.not.have.any.keys('timesheet_entry_id', 'account_id', 'user_id', 'rn'));
         const inMonth = Number(
            (await db('timesheet_entries').where({ account_id: A, user_id: ELIZA, is_deleted: false }).where('time_tracker_start_date', '>=', iso(MONTH_START)).where('time_tracker_end_date', '<=', iso(TODAY.endOf('month'))).countDistinct({ n: 'timesheet_name' }).first()).n
         );
         expect(res.body.pagination.totalItems).to.equal(inMonth);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/timesheets/fetchTimesheetsByMonth/${ELIZA}/${acct}/${user}`);
      });

      // FIXED (was DEFECT): same missing owner check, same fix (enforceSelfOrPrivileged
      // on :queryUserID).
      it('an employee cannot read another employee’s monthly trackers', async () => {
         const res = await h.as('employee').get(`/timesheets/fetchTimesheetsByMonth/${BOB}/${A}/${ELIZA}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /timesheets/countsByEmployee/:accountID/:userID', () => {
      it('admin: one row per active user with pending-entry / tracker / AI-status counts that match the tables', async () => {
         const res = await h.as('admin').get(`/timesheets/countsByEmployee/${A}/${ADMIN}`);
         expect(res.status).to.equal(200);
         const rows = res.body.timesheetsByEmployees;
         const activeIds = await db('users').where({ account_id: A, is_user_active: true }).pluck('user_id');
         expect(rows.map(r => r.user_id).sort(byNumber)).to.deep.equal([...activeIds].sort(byNumber));
         for (const userId of [ELIZA, BOB]) {
            const row = rows.find(r => r.user_id === userId);
            const base = () => db('timesheet_entries').where({ account_id: A, user_id: userId, is_deleted: false });
            const pending = Number((await base().where({ is_processed: false }).count({ n: '*' }).first()).n);
            const trackers = Number((await base().countDistinct({ n: 'timesheet_name' }).first()).n);
            const monthTrackers = Number((await base().where('time_tracker_start_date', '>=', iso(MONTH_START)).where('time_tracker_end_date', '<=', iso(TODAY.endOf('month'))).countDistinct({ n: 'timesheet_name' }).first()).n);
            const aiCount = async statuses =>
               Number(
                  (await db('ai_time_tracker_transaction_suggestions as s').join('timesheet_entries as te', 'te.timesheet_entry_id', 's.timesheet_entry_id').where({ 's.account_id': A, 'te.user_id': userId, 'te.is_deleted': false, 'te.is_processed': false }).whereIn('s.status', statuses).count({ n: '*' }).first()).n
               );
            expect(row, `row for ${userId}`).to.deep.equal({
               display_name: userId === ELIZA ? 'Eliza Smith' : 'Bob Jones',
               user_id: userId,
               transaction_count: pending,
               trackers_to_date: trackers,
               trackers_by_month: monthTrackers,
               ai_processing_count: await aiCount(['processing', 'pending']),
               ai_completed_count: await aiCount(['completed', 'applied']),
               ai_failed_count: await aiCount(['failed'])
            });
         }
         expect(rows.find(r => r.user_id === ELIZA).transaction_count).to.be.at.least(4); // T1 (3) + T2 (1)
         expect(res.body.grid.rows).to.have.lengthOf(rows.length);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('get', (acct, user) => `/timesheets/countsByEmployee/${acct}/${user}`);
      });

      // FIXED (was DEFECT): no role gate. Firm-wide reads now require manager+
      // (requireManagerOrAbove), same as getTimesheetEntries.
      it('a plain employee cannot read every colleague’s counts', async () => {
         const res = await h.as('employee').get(`/timesheets/countsByEmployee/${A}/${ELIZA}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('POST /timesheets/ai/kickoff/:accountID/:userID', () => {
      it('flag off -> 503 and nothing is processed; no timesheet_name / entry_ids -> 400', async () => {
         const entryId = T.T1.entries[0].timesheet_entry_id;
         const off = await h.as('admin').post(`/timesheets/ai/kickoff/${A}/${ADMIN}`).send({ entry_ids: [entryId] });
         expect(off.status).to.equal(503);
         expect(off.body).to.include({ status: 503 });
         await sleep(300);
         expect((await db('timesheet_entries').where({ timesheet_entry_id: entryId }).first()).is_processed).to.equal(false);
         const empty = await h.as('admin').post(`/timesheets/ai/kickoff/${A}/${ADMIN}`).send({});
         expect(empty.status).to.equal(400);
         expect(empty.body.message).to.equal('Provide timesheet_name or entry_ids to kick off auto-ingest.');
      });

      it('flag on + entry_ids: 202, the background orchestrator (stubbed Bedrock) auto-inserts the line once and notifies staff', async () => {
         const entry = T.T1.entries[0]; // 30 min, Eliza ($75)
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            const promptsBefore = aws.categoryPrompts().length;
            const res = await h.as('admin').post(`/timesheets/ai/kickoff/${A}/${ADMIN}`).send({ entry_ids: [entry.timesheet_entry_id] });
            expect(res.status).to.equal(202);
            expect(res.body).to.deep.equal({ status: 202, message: 'Auto-ingest job accepted and running in background.', entryIdsCount: 1 });
            const note = await waitFor(
               () => db('notifications').where({ account_id: A, user_id: ADMIN }).where('notification_id', '>', maxNotificationId).where('type', 'tracker_upload_processed').orderBy('notification_id', 'desc').first(),
               'kickoff notification'
            );
            expect(note.title).to.equal('1 rows auto-applied');
            expect(note.payload).to.include({ autoInserted: 1, held: 0 });
            expect(aws.categoryPrompts().length).to.equal(promptsBefore + 1);
            const row = await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first();
            expect(row).to.include({ is_processed: true, hold_reason: null, matched_user_id: ELIZA, suggested_customer_id: covCustomer.customer_id });
            const txns = await linkedTransactions(entry.timesheet_entry_id);
            expect(txns).to.have.lengthOf(1);
            expect(txns[0]).to.include({ customer_id: covCustomer.customer_id, customer_job_id: covJobId, transaction_type: 'Time', is_transaction_billable: true, created_by_user_id: ADMIN, general_work_description_id: SEED_GWD_ID });
            expect([Number(txns[0].quantity), Number(txns[0].unit_cost), Number(txns[0].total_transaction)]).to.deep.equal([0.5, 75, 37.5]);
         } finally {
            restore();
         }
      });

      it('flag on + timesheet_name, called by the tracker OWNER: kicks off exactly that tracker’s pending lines', async () => {
         const entry = T.T2.entries[0]; // 60 min, last month
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            const res = await h.as('employee').post(`/timesheets/ai/kickoff/${A}/${ELIZA}`).send({ timesheet_name: T.T2.body.fileName });
            expect(res.status).to.equal(202);
            expect(res.body.entryIdsCount).to.equal(1);
            await waitFor(async () => (await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first()).is_processed, 'T2 processed');
            const txns = await linkedTransactions(entry.timesheet_entry_id);
            expect(txns).to.have.lengthOf(1);
            expect([Number(txns[0].quantity), Number(txns[0].unit_cost), Number(txns[0].total_transaction)]).to.deep.equal([1, 75, 75]);
            expect(txns[0].created_by_user_id).to.equal(ELIZA);
            expect(dayjs(txns[0].transaction_date).format('YYYY-MM-DD')).to.equal(iso(PREV_START.add(1, 'day')));
            await waitFor(() => db('notifications').where({ account_id: A, user_id: ELIZA }).where('notification_id', '>', maxNotificationId).first(), 'owner notification');
         } finally {
            restore();
         }
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('post', (acct, user) => `/timesheets/ai/kickoff/${acct}/${user}`, { send: { entry_ids: [T.T1.entries[1].timesheet_entry_id] } });
      });

      // FIXED (was DEFECT): the timesheet_name lookup used to be keyed on the URL
      // :userID — the CALLER — not the tracker's owner, so an admin/manager kicking
      // off an employee's tracker by name always found 0 lines (observed:
      // entryIdsCount 0 for a 2-pending-line tracker). timesheets-service.js's
      // getEntriesByTimesheetName now filters by (account, timesheet_name) alone,
      // since a timesheet_name is already unique to one upload/owner.
      //
      // Uses its own dedicated tracker (T5) rather than T1: T1's remaining pending
      // lines (entries[1]/[2]) are relied on elsewhere in this file (moveToTransactions
      // / deleteTimesheetEntry auth-guard checks) to still be unprocessed, and this
      // test — now that it actually works — would otherwise auto-ingest them.
      it('an admin can kick off an employee’s tracker by timesheet_name', async () => {
         await uploadTracker('T5', ELIZA, {
            employeeName: 'Eliza Smith',
            start: CUR_START,
            end: CUR_END,
            rows: [
               { date: CUR_END, category: 'Phone Call', duration: 12, notes: `Coverage kickoff-by-name line A ${RUN}` },
               { date: CUR_END, category: 'Email', duration: 8, notes: `Coverage kickoff-by-name line B ${RUN}` }
            ]
         });
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            const res = await h.as('admin').post(`/timesheets/ai/kickoff/${A}/${ADMIN}`).send({ timesheet_name: T.T5.body.fileName });
            expect(res.status).to.equal(202);
            expect(res.body.entryIdsCount).to.equal(2);
            await waitFor(
               async () => {
                  const rows = await db('timesheet_entries').whereIn('timesheet_entry_id', T.T5.entries.map(e => e.timesheet_entry_id));
                  return rows.length && rows.every(r => r.is_processed) ? rows : null;
               },
               'T5 (kicked off by name) fully processed'
            );
         } finally {
            restore();
         }
      });

      // FIXED (was DEFECT, C2): kickoff had no owner-authorization check at
      // all on either entry_ids or timesheet_name, and used the URL :userID
      // (never validated against the caller) as the actor. A non-privileged
      // employee naming another employee's tracker/entries is now refused;
      // T3 (Bob's) is still pending at this point in the file (consumed by
      // the moveToTransactions tests further below), so using it here proves
      // the refusal without disturbing it for them.
      it('an employee cannot kick off another employee\'s tracker by entry_ids (403), and nothing is processed', async () => {
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            const bobEntryId = T.T3.entries[0].timesheet_entry_id;
            const res = await h.as('employee').post(`/timesheets/ai/kickoff/${A}/${ELIZA}`).send({ entry_ids: [bobEntryId] });
            expect(res.status).to.equal(403);
            await sleep(200);
            expect((await db('timesheet_entries').where({ timesheet_entry_id: bobEntryId }).first()).is_processed).to.equal(false);
         } finally {
            restore();
         }
      });

      it('an employee cannot kick off another employee\'s tracker by timesheet_name (403), and nothing is processed', async () => {
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            const res = await h.as('employee').post(`/timesheets/ai/kickoff/${A}/${ELIZA}`).send({ timesheet_name: T.T3.body.fileName });
            expect(res.status).to.equal(403);
            await sleep(200);
            expect((await db('timesheet_entries').where({ timesheet_entry_id: T.T3.entries[0].timesheet_entry_id }).first()).is_processed).to.equal(false);
         } finally {
            restore();
         }
      });

      it('the URL :userID cannot spoof the actor — the transaction records the AUTHENTICATED caller even when the URL names someone else', async () => {
         await uploadTracker('T6', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Phone Call', duration: 18, notes: `Coverage actor-spoof-check line ${RUN}` }] });
         const restore = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'test', TIME_TRACKER_AI_TEST_ACCOUNT_IDS: String(A) });
         try {
            // Admin is privileged, so the ownership guard doesn't block this —
            // but the URL claims :userID = ELIZA, a different person than the
            // real (admin) caller.
            const entryId = T.T6.entries[0].timesheet_entry_id;
            const res = await h.as('admin').post(`/timesheets/ai/kickoff/${A}/${ELIZA}`).send({ entry_ids: [entryId] });
            expect(res.status).to.equal(202);
            await waitFor(async () => (await db('timesheet_entries').where({ timesheet_entry_id: entryId }).first()).is_processed, 'T6 processed');
            const txns = await linkedTransactions(entryId);
            expect(txns).to.have.lengthOf(1);
            // created_by_user_id (loggedByUserID) is the AUTHENTICATED admin,
            // never the URL's ELIZA.
            expect(txns[0].created_by_user_id).to.equal(ADMIN);
         } finally {
            restore();
         }
      });
   });

   describe('POST /timesheets/moveToTransactions/:accountID/:userID', () => {
      const movePayload = (entry, overrides = {}) => ({
         entry: {
            timesheetEntryID: entry.timesheet_entry_id,
            customerID: covCustomer.customer_id,
            customerJobID: covJobId,
            selectedRetainerID: null,
            customerInvoicesID: null,
            loggedForUserID: entry.user_id,
            loggedByUserID: ADMIN,
            selectedGeneralWorkDescriptionID: SEED_GWD_ID,
            detailedJobDescription: entry.notes,
            transactionDate: dayjs(entry.date).format('YYYY-MM-DD'),
            transactionType: 'Time',
            isInAdditionToMonthlyCharge: false,
            note: '',
            minutes: entry.duration,
            ...overrides
         }
      });

      it('an internal customer (INTERNAL_CUSTOMER_IDS) is stored NON-billable even when the reviewer sends billable=true, and stale hundredth-hour pricing is ignored (C5-3)', async () => {
         const entry = T.T3.entries[0]; // Bob, 20 min at $90 -> ceil(20/6)=4 -> 0.4h -> 0.4 x 90 = $36.00
         const restore = setEnv({ INTERNAL_CUSTOMER_IDS: String(covCustomer.customer_id) });
         try {
            // quantity/totalTransaction below are the STALE pre-C1 hundredth-hour
            // values (20/60=0.333->0.33h; 0.33x90=29.70) — deliberately wrong, to
            // prove the server recomputes rather than trusting them.
            const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(movePayload(entry, { quantity: 0.33, unitCost: 90, totalTransaction: 29.7, isTransactionBillable: true }));
            expect(res.status, JSON.stringify(res.body)).to.equal(200);
         } finally {
            restore();
         }
         const txns = await linkedTransactions(entry.timesheet_entry_id);
         expect(txns).to.have.lengthOf(1);
         expect(txns[0]).to.include({ is_transaction_billable: false, customer_id: covCustomer.customer_id, logged_for_user_id: BOB });
         // ceil(20/6)=4 -> 0.4h; 0.4 x 90 = 36.00 — NOT the stale 0.33h/$29.70 submitted above.
         expect([Number(txns[0].quantity), Number(txns[0].unit_cost), Number(txns[0].total_transaction)], 'stale client input must be ignored and recomputed').to.deep.equal([0.4, 90, 36]);
         expect((await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first()).is_processed).to.equal(true);
      });

      it('invalid or missing timesheetEntryID -> 400', async () => {
         for (const entry of [{ timesheetEntryID: 'abc' }, { timesheetEntryID: 0 }, {}]) {
            const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send({ entry });
            expect(res.status, JSON.stringify(entry)).to.equal(400);
            expect(res.body.message).to.equal('A valid timesheetEntryID is required to move a timesheet entry to transactions.');
         }
      });

      it('another tenant’s entry id -> 409; nothing is written and the account-1 row is untouched', async () => {
         const before = await db('timesheet_entries').where({ timesheet_entry_id: foreignEntry.timesheet_entry_id }).first();
         const txnBefore = Number((await db('customer_transactions').where({ account_id: A }).count({ n: '*' }).first()).n);
         const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(movePayload(foreignEntry, { quantity: 1, unitCost: 75, totalTransaction: 75, isTransactionBillable: true }));
         expect(res.status).to.equal(409);
         const afterRow = await db('timesheet_entries').where({ timesheet_entry_id: foreignEntry.timesheet_entry_id }).first();
         expect(afterRow).to.deep.equal(before);
         expect(Number((await db('customer_transactions').where({ account_id: A }).count({ n: '*' }).first()).n)).to.equal(txnBefore);
      });

      it('401 without a valid identity; 403 across tenants', async () => {
         await expectAuthGuards('post', (acct, user) => `/timesheets/moveToTransactions/${acct}/${user}`, { send: movePayload(T.T1.entries[1], { quantity: 0.75, unitCost: 75, totalTransaction: 56.25, isTransactionBillable: true }) });
         expect((await db('timesheet_entries').where({ timesheet_entry_id: T.T1.entries[1].timesheet_entry_id }).first()).is_processed).to.equal(false);
      });

      // FIXED (was DEFECT): a missing `entry` object used to reach
      // sanitizeFields(undefined) -> Object.entries(undefined) TypeError, caught as a
      // 500. The route now validates `entry` is present before sanitizing it.
      it('a body without `entry` -> 400', async () => {
         const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send({});
         expect(res.status).to.equal(400);
      });

      // FIXED (was DEFECT): no role/owner gate — any authenticated user could post a
      // tracker line to billing with client-chosen customer / job / quantity / unit
      // cost / total. moveToTransactions now requires manager+ (requireManagerOrAbove),
      // matching the Manager/Admin-only manual-apply UI.
      it('a plain employee cannot move a tracker line to billing', async () => {
         const res = await h.as('employee').post(`/timesheets/moveToTransactions/${A}/${ELIZA}`).send(movePayload(T.T1.entries[1], { quantity: 0.75, unitCost: 75, totalTransaction: 56.25, isTransactionBillable: true }));
         expect(res.status).to.equal(403);
      });

      // FIXED (was DEFECT, C4): the legacy manual apply only checked
      // internal-customer status, defaulting to billable=true otherwise — a
      // held Doctor Appointment row (non-work) applied with no explicit
      // billable field (or even billable=true) used to bill it. Now forced
      // non-billable from the STORED entry via isNonWorkEntry.
      it('a Doctor Appointment (non-work) row is applied non-billable ($0 billable) even though the reviewer sends billable=true', async () => {
         await uploadTracker('T7', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Doctor Appointment', duration: 60, notes: `annual physical ${RUN}` }] });
         const entry = T.T7.entries[0];
         const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(movePayload(entry, { quantity: 1, unitCost: 75, totalTransaction: 75, isTransactionBillable: true }));
         expect(res.status, JSON.stringify(res.body)).to.equal(200);
         const txns = await linkedTransactions(entry.timesheet_entry_id);
         expect(txns).to.have.lengthOf(1);
         expect(txns[0]).to.include({ is_transaction_billable: false }); // hours/value still recorded: quantity 1, total 75
         expect(Number(txns[0].total_transaction)).to.equal(75);
      });

      // FIXED (was DEFECT, C8): general_work_description_id was never scoped
      // to this account (only the employee was) — a valid FK to ANOTHER
      // tenant's work description (account 1's id=1, "Interview") was
      // accepted. Refused (400) with nothing written; the claim rolls back.
      it('another tenant\'s general_work_description_id -> 400, nothing written', async () => {
         const entry = T.T1.entries[2];
         const before = await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first();
         const txnBefore = Number((await db('customer_transactions').where({ account_id: A }).count({ n: '*' }).first()).n);
         const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(movePayload(entry, { selectedGeneralWorkDescriptionID: 1, quantity: 0.25, unitCost: 75, totalTransaction: 18.75, isTransactionBillable: true }));
         expect(res.status, JSON.stringify(res.body)).to.equal(400);
         const afterRow = await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first();
         expect(afterRow).to.deep.equal(before); // claim rolled back — still pending
         expect(Number((await db('customer_transactions').where({ account_id: A }).count({ n: '*' }).first()).n)).to.equal(txnBefore);
      });

      // C8: loggedByUserID is always the authenticated caller.
      it('loggedByUserID is the authenticated caller, never a client-supplied value', async () => {
         await uploadTracker('T8', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Phone Call', duration: 30, notes: `loggedByUserID spoof check ${RUN}` }] });
         const entry = T.T8.entries[0];
         const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(movePayload(entry, { loggedByUserID: ELIZA, quantity: 0.5, unitCost: 75, totalTransaction: 37.5, isTransactionBillable: true }));
         expect(res.status, JSON.stringify(res.body)).to.equal(200);
         const txns = await linkedTransactions(entry.timesheet_entry_id);
         expect(txns[0].created_by_user_id).to.equal(ADMIN); // never ELIZA, despite the request body
      });
   });

   describe('DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID', () => {
      // A dedicated, never-auto-ingested entry: by this point T1/T2/T3's lines have
      // all been swept up by earlier ai/kickoff and moveToTransactions tests above
      // (including the kick-off-by-owner-name test, which — now that
      // timesheets-service.js's getEntriesByTimesheetName resolves the TRACKER's
      // real owner instead of the caller — actually processes T1's remaining
      // pending lines), so none of them can be relied on to still be unprocessed
      // here. Uploaded with the AI flag at its suite default (off), so nothing
      // auto-ingests it.
      before(async () => {
         await uploadTracker('T4', ELIZA, {
            employeeName: 'Eliza Smith',
            start: CUR_START,
            end: CUR_END,
            rows: [{ date: CUR_END, category: 'Phone Call', duration: 10, notes: `Coverage delete-target line ${RUN}` }]
         });
      });

      it('admin soft-deletes an unprocessed entry: 200, is_deleted, gone from the pending queues and counts', async () => {
         const entry = T.T4.entries[0];
         const res = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${entry.timesheet_entry_id}/${A}/${ADMIN}`);
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('Successfully deleted timesheet entry.');
         const row = await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first();
         expect(row).to.include({ is_deleted: true, is_processed: false });
         const queue = await h.as('admin').get(`/timesheets/getTimesheetEntries/${A}/${ADMIN}`).query({ limit: 500 });
         expect(queue.body.outstandingTimesheetEntries.map(r => r.timesheet_entry_id)).to.not.include(entry.timesheet_entry_id);
      });

      it('another tenant’s entry id is refused and the account-1 row is untouched', async () => {
         const before = await db('timesheet_entries').where({ timesheet_entry_id: foreignEntry.timesheet_entry_id }).first();
         const res = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${foreignEntry.timesheet_entry_id}/${A}/${ADMIN}`);
         expect(res.status).to.be.at.least(400);
         expect(await db('timesheet_entries').where({ timesheet_entry_id: foreignEntry.timesheet_entry_id }).first()).to.deep.equal(before);
      });

      it('401 without a valid identity; 403 across tenants (nothing deleted)', async () => {
         const entry = T.T1.entries[1];
         await expectAuthGuards('delete', (acct, user) => `/timesheets/deleteTimesheetEntry/${entry.timesheet_entry_id}/${acct}/${user}`);
         expect((await db('timesheet_entries').where({ timesheet_entry_id: entry.timesheet_entry_id }).first()).is_deleted).to.equal(false);
      });

      // FIXED (was DEFECT): getSingleTimesheetEntry returned undefined for an unknown id
      // and the route dereferenced it (`foundEntry.is_deleted = true`), so a not-found
      // became a TypeError answered as 500. The route now checks for a missing row and
      // answers 404.
      it('an unknown entry id -> 404', async () => {
         const res = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${NOT_FOUND_ID}/${A}/${ADMIN}`);
         expect(res.status).to.equal(404);
      });

      // FIXED (was DEFECT): no role/owner gate. The route now requires manager+ for
      // any delete (matching moveToTransactions), so a plain employee is refused
      // regardless of whose entry it is.
      it('an employee cannot delete another employee’s entry', async () => {
         const res = await h.as('employee').delete(`/timesheets/deleteTimesheetEntry/${T.T3.entries[0].timesheet_entry_id}/${A}/${ELIZA}`);
         expect(res.status).to.equal(403);
         expect((await db('timesheet_entries').where({ timesheet_entry_id: T.T3.entries[0].timesheet_entry_id }).first()).is_deleted).to.equal(false);
      });
   });

   // C9 (P2, after C3): deletion must actually enable the advertised
   // "delete then re-upload the corrected tracker" workflow — but a
   // PROCESSED row (billed) must still block a duplicate re-ingest even if
   // it also carries is_deleted=true (legacy/inconsistent data; C3 refuses
   // new deletes of processed rows going forward, but old data can still
   // have both flags set). Exercised end-to-end through the real upload
   // route and the real Postgres retained-history predicate
   // (trackerDuplicates.js _retainedHistory), not just the pure planner.
   describe('tracker duplicate detection after a delete (C9)', () => {
      it('deleting an UNPROCESSED row, then re-uploading the corrected tracker, inserts it (not treated as a duplicate of the deleted row)', async () => {
         const notes = `C9 delete-then-reupload check ${RUN}`;
         await uploadTracker('T9a', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Tax', duration: 40, notes }] });
         const original = T.T9a.entries[0];
         expect(original.is_processed).to.equal(false);

         const del = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${original.timesheet_entry_id}/${A}/${ADMIN}`);
         expect(del.status).to.equal(200);
         expect((await db('timesheet_entries').where({ timesheet_entry_id: original.timesheet_entry_id }).first())).to.include({ is_processed: false, is_deleted: true });

         // Re-upload the SAME period + SAME row content as a "corrected" file.
         await uploadTracker('T9b', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Tax', duration: 40, notes }] });
         expect(T.T9b.body.inserted_count).to.equal(1);
         expect(T.T9b.body.duplicates_skipped).to.deep.equal([]);
      });

      it('a PROCESSED row that also carries is_deleted=true (legacy data shape) still blocks a duplicate re-upload', async () => {
         const notes = `C9 processed-still-blocks check ${RUN}`;
         await uploadTracker('T9c', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Tax', duration: 22, notes }] });
         const original = T.T9c.entries[0];

         const applied = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send({
            entry: {
               timesheetEntryID: original.timesheet_entry_id,
               customerID: covCustomer.customer_id,
               customerJobID: covJobId,
               selectedRetainerID: null,
               customerInvoicesID: null,
               loggedForUserID: original.user_id,
               selectedGeneralWorkDescriptionID: SEED_GWD_ID,
               detailedJobDescription: notes,
               transactionDate: dayjs(original.date).format('YYYY-MM-DD'),
               transactionType: 'Time',
               isInAdditionToMonthlyCharge: false,
               note: '',
               minutes: original.duration,
               quantity: 0.4,
               unitCost: 75,
               totalTransaction: 30,
               isTransactionBillable: true
            }
         });
         expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
         // Simulates legacy/inconsistent data (C3 refuses this combination for
         // NEW deletes going forward) so the dedupe predicate's own handling of
         // it — independent of how it arose — is what's under test here.
         await db('timesheet_entries').where({ timesheet_entry_id: original.timesheet_entry_id }).update({ is_deleted: true });
         expect(await db('timesheet_entries').where({ timesheet_entry_id: original.timesheet_entry_id }).first()).to.include({ is_processed: true, is_deleted: true });

         const res = await uploadTracker('T9d', ELIZA, { employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Tax', duration: 22, notes }] }).catch(err => err);
         // uploadTracker's own assertion expects 201; a rejected (409) upload
         // throws there, so recover the raw response for this negative case.
         if (res instanceof Error) {
            const buffer = buildTracker({ employeeName: 'Eliza Smith', start: CUR_START, end: CUR_END, rows: [{ date: CUR_END, category: 'Tax', duration: 22, notes }] });
            const raw = await rawPost(h.as('admin'), `/time-tracking/upload/${A}/${ADMIN}`, buffer, { fileName: `T9d_retry_${RUN}.xlsx`, query: { ownerUserID: ELIZA } });
            expect(raw.status, JSON.stringify(raw.body)).to.equal(409);
            expect(raw.body.duplicates_skipped_count || (raw.body.duplicate_of ? 1 : 0)).to.be.at.least(1);
         } else {
            throw new Error(`expected the re-upload to be rejected as a duplicate, but it succeeded: ${JSON.stringify(res.body)}`);
         }
      });
   });
});
