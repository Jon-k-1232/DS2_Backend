/**
 * HTTP-level coverage for cross-tenant S3 download authorization
 * (review/full-audit-2026-09, findings 1 & 3).
 *
 * FINDING 1 — GET /invoices/downloadFile/:accountID/:userID?fileLocation=<key>
 * fetched whatever S3 key it was given, with no check that the key actually
 * belonged to the authenticated account. The URL's :accountID is
 * authenticated (enforceAccountId guarantees req.user.account_id ===
 * :accountID), but that only proves who is asking — it says nothing about
 * whose object the key points at. Astra's reproduction: as account 9001's
 * admin, obtain the shared time-tracking template's key from
 * GET /time-tracking/template/list/9001/90013, then hand that SAME key to
 * GET /invoices/downloadFile/9001/90013?fileLocation=<key> — both 200,
 * SHA-256-identical to the shared object, containing account-1 staff names.
 * Fixed in invoice-router.js (see utils/downloadAuthorization.js) by
 * resolving the areas of the bucket the AUTHENTICATED account actually owns
 * (its own invoicing exports, its own audit PDFs) and refusing anything else
 * — including the shared template and any other account's prefix — with a
 * 403, before ever calling S3.
 *
 * FINDING 2 — account_company_logo (accounts.account_company_logo) is a
 * free-text field an account admin could set to ANY string, which then flowed
 * straight into getObject() in two places: account-router.js's own
 * fetchAccountLogo (GET /account/AccountInformation, which hands the bytes
 * back to the client as base64) and addInvoiceDetail.js's loadCompanyLogo
 * (embedded into every generated invoice/statement PDF). Fixed with a
 * dedicated resolver (utils/downloadAuthorization.js resolveOwnLogoPrefixes,
 * deliberately separate from resolveOwnDownloadPrefixes above — a logo key is
 * trusted for a different purpose than a generic file download) at THREE
 * points: (1) PUT /account/updateAccount now validates a non-empty value
 * against the account's own `${slug}/app/assets/` prefix before it is ever
 * written, 400 otherwise; (2) fetchAccountLogo re-checks a value already on
 * record (from before that validation existed) before calling getObject,
 * falling back to this account's own default key instead of a hardcoded
 * account-1 one; (3) loadCompanyLogo does the same before embedding a logo
 * into a generated PDF. All three fall back to "no logo" rather than 500 or
 * leaking another object's bytes. See the third describe block below.
 *
 * FINDING 3 — the shared, firm-wide tracker template (tracker_versions/) had
 * no owner enforcement on mutation: any super admin of ANY account could
 * upload/delete it (timeTracking-router.js /template/upload, /template/delete
 * — role-gated, not account-gated), and GET /template/list handed back the
 * owner's raw S3 keys (and therefore its account-name slug) to every admin —
 * exactly the key finding 1 then used. Fixed by gating upload/delete to
 * TEMPLATE_OWNER_ACCOUNT_ID (default 1, env-overridable) and having
 * /template/list return `{ templates: [], managedByOwnerAccount: true }` for
 * every other account (chosen over a 403 so the existing frontend — which
 * does `response.data?.templates || []` — renders a clean empty state with
 * no code change required; DS2_Frontend/src/Pages/TimeTracking/TemplateUpdate/
 * UpdateTimeTrackerTemplate.js additionally surfaces an explanatory banner
 * off the new `managedByOwnerAccount` flag).
 *
 * Fixture: account 9001 (test/fixtures/seed.sql), admin 90013. No super admin
 * exists in the 9001 fixture, so `before` mints a temporary one (same pattern
 * as coverage-invoices-audit-ar-analytics.integration.spec.js's
 * tempSuperAdmin) and removes it in `after`. Account 1 is used strictly
 * READ-ONLY via the persistent `superAdmin` identity from _http.js — this
 * spec never uploads, deletes, or otherwise mutates the real shared tracker
 * template or any other account-1 object. The non-owner upload/delete tests
 * prove their 403 comes from the owner-account gate itself (which runs
 * before any S3 call) via a before/after listing comparison, never from "the
 * targeted object didn't exist anyway".
 *
 * Run:
 *   DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js \
 *     test/integration/coverage-downloads-authz.integration.spec.js --exit --timeout 180000
 */
const fs = require('fs');
const { bootHttp, uniqueName } = require('./_http');
const { TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { putObject, deleteObject, listObjects } = require('../../src/utils/s3');
const { sanitizeAccountName } = require('../../src/utils/invoicePath');
const { loadCompanyLogo } = require('../../src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail');

const NO_IMAGE_PATH = require('path').join(__dirname, '../../src/images/noImage.png');

const A = TEST_ACCOUNT_ID; // 9001 — fixture account. Never account 1.
const U = TEST_ADMIN_USER_ID; // 90013
const REAL_ACCOUNT_ID = 1; // prod copy — READ-ONLY in this spec.
const REAL_SUPERADMIN_USER_ID = 21; // admin@jimkimmel.com — matches _http.js IDENTITIES.superAdmin.
const REAL_ACCOUNT_SLUG = 'James_F__Kimmel___Associates'; // sanitizeAccountName('James F. Kimmel & Associates') — see timeTracking-router.js's own TIME_TRACKING_ROOT constant. Never written to here.
const TRACKER_VERSIONS_ROOT = `${REAL_ACCOUNT_SLUG}/time_tracking/tracker_versions`; // mirrors timeTracking-router.js

describe('integration: coverage — cross-tenant download authorization (HTTP)', function () {
   this.timeout(180_000);

   let h;
   let db;
   const s3Keys = [];
   let accountSlug; // account 9001's own slug, computed the same way the app does
   let account9001Name; // account 9001's raw account_name, for loadCompanyLogo's own sanitizeAccountName call
   let tempSuperAdmin = null; // { user_id, email, token } — account 9001, removed in `after`

   const asTemp = () => {
      const token = tempSuperAdmin.token;
      const wrap = method => url => h.request[method](url).set('Authorization', `Bearer ${token}`);
      return { get: wrap('get'), post: wrap('post'), delete: wrap('delete') };
   };

   const rawPost = (agent, url, buffer, { fileName = 'tracker.xlsx', fileType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } = {}) => {
      let req = agent.post(url);
      req = req.set('Content-Type', 'application/octet-stream').set('x-file-type', fileType);
      if (fileName !== null) req = req.set('x-file-name', encodeURIComponent(fileName));
      return req.send(buffer);
   };

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;

      const account = await db('accounts').where({ account_id: A }).first();
      accountSlug = sanitizeAccountName(account.account_name);
      account9001Name = account.account_name;

      // No super admin exists in the 9001 fixture (seed.sql: 90011/90012
      // employee, 90013 admin) — mint one for the account-9001-scoped
      // template-mutation tests (same pattern as
      // coverage-invoices-audit-ar-analytics.integration.spec.js).
      const tempEmail = `${uniqueName('covdownloadsa').toLowerCase()}@example.test`;
      const [tempUser] = await db('users')
         .insert({ account_id: A, email: tempEmail, display_name: 'Coverage Temp Super Admin (downloads-authz)', job_title: 'Auditor', access_level: 'super admin', is_user_active: true })
         .returning(['user_id', 'email']);
      tempSuperAdmin = { user_id: tempUser.user_id, email: tempUser.email, token: h.mint('admin', { user_id: tempUser.user_id, email: tempUser.email }) };
   });

   after(async () => {
      for (const key of new Set(s3Keys.filter(Boolean))) {
         await deleteObject(key).catch(() => {});
      }
      if (tempSuperAdmin) {
         await db('users').where({ user_id: tempSuperAdmin.user_id }).del();
      }
      await h.close();
   });

   // ══════════════════════════════════════════════════════════════════════
   // GET /invoices/downloadFile/:accountID/:userID — finding 1
   // ══════════════════════════════════════════════════════════════════════
   describe('GET /invoices/downloadFile/:accountID/:userID — key ownership', () => {
      let ownKey;
      const ownBytes = Buffer.from('%PDF-1.4 coverage-downloads-authz own-prefix fixture bytes');

      before(async () => {
         // The one area this account is actually allowed to be served bytes
         // from through this route: its own invoicing prefix.
         ownKey = `${accountSlug}/invoicing/coverage-downloads-authz/${uniqueName('own')}.pdf`;
         await putObject(ownKey, ownBytes, 'application/pdf');
         s3Keys.push(ownKey);
      });

      it('200 with identical bytes for a key the test placed under the caller\'s own invoicing prefix', async () => {
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(ownKey)}`);
         expect(res.status).to.equal(200);
         expect(Buffer.isBuffer(res.body), 'body is a Buffer').to.equal(true);
         expect(Buffer.compare(res.body, ownBytes)).to.equal(0);
         expect(res.headers['content-disposition']).to.include(ownKey.split('/').pop());
      });

      it('403 and no bytes for the shared time-tracking template key, even though it is real and currently live', async () => {
         // Obtained via the OWNER's own legitimate list call (finding 3 means
         // account 9001 can no longer discover this key on its own — see the
         // template-ownership describe block below — so this simulates an
         // attacker who already knows a real key some other way).
         const ownerList = await h.as('superAdmin').get(`/time-tracking/template/list/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(ownerList.status).to.equal(200);
         expect(ownerList.body.templates.length, 'a live shared template must exist to exercise this').to.be.greaterThan(0);
         const sharedTemplateKey = ownerList.body.templates[0].key;
         expect(sharedTemplateKey.startsWith(`${TRACKER_VERSIONS_ROOT}/`)).to.equal(true);

         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(sharedTemplateKey)}`);
         expect(res.status).to.equal(403);
         expect(res.headers['content-disposition']).to.equal(undefined);
         expect(res.body.message).to.be.a('string').and.not.equal('');
      });

      it('403 for a key under a DIFFERENT account\'s own invoicing prefix (account 1)', async () => {
         // Never created in S3 — the authorization check runs, and refuses,
         // before any S3 call, so the key does not need to exist.
         const foreignKey = `${REAL_ACCOUNT_SLUG}/invoicing/final_invoices/not-9001s/zipped_files.zip`;
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(foreignKey)}`);
         expect(res.status).to.equal(403);
      });

      it('403 for path traversal, a leading slash, a backslash, and a residual (double-encoded) percent', async () => {
         const variants = [
            `${accountSlug}/invoicing/../../../etc/passwd`, // '..' anywhere is refused, even after a valid-looking prefix
            `/${accountSlug}/invoicing/evil.zip`, // leading '/'
            `${accountSlug}\\invoicing\\evil.zip`, // backslash
            `${accountSlug}/invoicing/%2e%2e%2fdouble-encoded-${uniqueName('x')}.zip` // literal '%' surviving Express's one decode = a second layer of encoding
         ];
         for (const variant of variants) {
            const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(variant)}`);
            expect(res.status, variant).to.be.oneOf([400, 403]);
         }
      });

      it('400 for a missing fileLocation query param (unchanged)', async () => {
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.include('Invalid or no file path');
      });
   });

   // ══════════════════════════════════════════════════════════════════════
   // Template version management is owner-account-only — finding 3
   // ══════════════════════════════════════════════════════════════════════
   describe('Shared tracker template — owner-account-only mutation, non-owner list', () => {
      it('GET /time-tracking/template/list as a NON-owner admin (9001) returns no raw keys or slug', async () => {
         const res = await h.as('admin').get(`/time-tracking/template/list/${A}/${U}`);
         expect(res.status).to.equal(200);
         expect(res.body.templates).to.deep.equal([]);
         expect(res.body.managedByOwnerAccount).to.equal(true);
      });

      it('GET /time-tracking/template/list as the OWNER (account 1, superAdmin) is unchanged — READ-ONLY', async () => {
         const res = await h.as('superAdmin').get(`/time-tracking/template/list/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body.managedByOwnerAccount).to.equal(undefined);
         expect(Array.isArray(res.body.templates)).to.equal(true);
         expect(res.body.templates.length).to.be.greaterThan(0);
         const [tpl] = res.body.templates;
         expect(tpl).to.include.keys('id', 'key', 'fileName', 'uploadedAt', 'size');
         expect(tpl.key.startsWith(`${TRACKER_VERSIONS_ROOT}/`)).to.equal(true);
      });

      it('POST /time-tracking/template/upload as a NON-owner super admin (9001) -> 403; nothing written', async () => {
         const before = (await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).map(o => o.Key).sort();
         const res = await rawPost(asTemp(), `/time-tracking/template/upload/${A}/${tempSuperAdmin.user_id}`, Buffer.from('coverage-downloads-authz malicious upload attempt — must never be written'), { fileName: `malicious-${uniqueName('x')}.xlsx` });
         expect(res.status).to.equal(403);
         const after = (await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).map(o => o.Key).sort();
         expect(after).to.deep.equal(before);
      });

      it('DELETE /time-tracking/template/delete as a NON-owner super admin (9001) -> 403; nothing removed', async () => {
         const before = (await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).map(o => o.Key).sort();
         expect(before.length, 'a live shared template must exist to exercise this').to.be.greaterThan(0);
         // The owner check runs before the key is even inspected, so a key
         // that does not correspond to a real object still proves the gate —
         // no real object is ever put at risk by this request.
         const res = await asTemp().delete(`/time-tracking/template/delete/${A}/${tempSuperAdmin.user_id}`).send({ key: `${TRACKER_VERSIONS_ROOT}/timetracker_should-never-be-deleted.xlsx` });
         expect(res.status).to.equal(403);
         const after = (await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).map(o => o.Key).sort();
         expect(after).to.deep.equal(before);
      });

      it('owner-account super admin is unaffected by the new gate (still 400, not 403, for an invalid key) — READ path only, no mutation attempted', async () => {
         // Proves the new `Number(accountID) !== TEMPLATE_OWNER_ACCOUNT_ID`
         // check is a no-op for the actual owner: it falls through to the
         // pre-existing validation, which still rejects a non-tracker key
         // with 400 (not the new 403) — and it does so via a key that was
         // never real, so nothing is deleted.
         const res = await h.as('superAdmin').delete(`/time-tracking/template/delete/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`).send({ key: `${TRACKER_VERSIONS_ROOT}/not-a-template.txt` });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('Only tracker template files can be deleted.');
      });
   });

   // ══════════════════════════════════════════════════════════════════════
   // The exact cross-route regression from finding 1
   // ══════════════════════════════════════════════════════════════════════
   describe('FIXED (was DEFECT) — finding 1\'s exact cross-route bypass', () => {
      it('the original two-step exploit (steal the key from /template/list, redeem it at /invoices/downloadFile) is blocked at BOTH steps', async () => {
         // Step 1, as originally reproduced: account 9001's admin lists
         // templates hoping to read off the shared object's key.
         const listRes = await h.as('admin').get(`/time-tracking/template/list/${A}/${U}`);
         expect(listRes.status).to.equal(200);
         expect(listRes.body.templates, 'step 1 is now closed: no key to steal').to.deep.equal([]);

         // Step 2, defense in depth: even an attacker who already has a real,
         // currently-live template key (learned some other way — logs, a
         // shared ticket, this spec's own read via the legitimate owner path)
         // cannot redeem it through invoice-router.js's downloadFile, which
         // is the actual route Astra's report bypassed the template guard
         // through.
         const ownerList = await h.as('superAdmin').get(`/time-tracking/template/list/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         const sharedTemplateKey = ownerList.body.templates[0].key;

         const bypassAttempt = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(sharedTemplateKey)}`);
         expect(bypassAttempt.status, 'invoice-router.js downloadFile must not serve the shared template to a foreign account').to.equal(403);
         expect(bypassAttempt.headers['content-disposition'], 'no file was ever attached to the response').to.equal(undefined);

         // NOTE: this spec deliberately does not also exercise
         // /time-tracking/template/latest here — that route's own guard
         // (the one finding 1 bypassed) is covered by
         // coverage-timetracking-timesheets.integration.spec.js and depends
         // on template-builder.js, which is out of this spec's area.
      });
   });

   // ══════════════════════════════════════════════════════════════════════
   // account_company_logo — finding 2
   // ══════════════════════════════════════════════════════════════════════
   describe('account_company_logo — write-time validation and read-time authorization', () => {
      let originalLogoValue;
      let ownLogoKey;
      let foreignAreaKey;
      // Both start with a real PNG signature so a successful-but-unauthorized
      // fetch would be indistinguishable from a real logo if the gate being
      // tested here were missing — the refusal has to come from authorization,
      // never from "it doesn't look like an image."
      const ownLogoBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('coverage-downloads-authz own-logo-prefix fixture bytes')]);
      const foreignAreaBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('coverage-downloads-authz NOT-a-logo fixture bytes — must never be served as account 9001\'s logo')]);

      before(async () => {
         originalLogoValue = (await db('accounts').where({ account_id: A }).first()).account_company_logo;

         ownLogoKey = `${accountSlug}/app/assets/${uniqueName('coverage-logo')}.png`;
         await putObject(ownLogoKey, ownLogoBytes, 'image/png');
         s3Keys.push(ownLogoKey);

         // A REAL, fetchable object that legitimately belongs to account
         // 9001 — just not under its logo area. Proves a refusal is about
         // AUTHORIZATION, not about the object failing to exist/fetch.
         foreignAreaKey = `${accountSlug}/invoicing/${uniqueName('coverage-logo-not-a-logo')}/x.png`;
         await putObject(foreignAreaKey, foreignAreaBytes, 'image/png');
         s3Keys.push(foreignAreaKey);
      });

      afterEach(async () => {
         // Every test below either leaves the row alone or deliberately
         // changes it — always restore the original so later tests (and
         // other specs sharing this sandbox) see it unchanged.
         await db('accounts').where({ account_id: A }).update({ account_company_logo: originalLogoValue });
      });

      describe('PUT /account/updateAccount — write-time key validation', () => {
         it('200: accepts a key under the callers own logo prefix', async () => {
            const res = await h.as('admin').put('/account/updateAccount').send({ account: { account_company_logo: ownLogoKey } });
            expect(res.status).to.equal(200);
            const row = await db('accounts').where({ account_id: A }).first();
            expect(row.account_company_logo).to.equal(ownLogoKey);
         });

         it('200: an explicit clear (empty string) is always allowed', async () => {
            await db('accounts').where({ account_id: A }).update({ account_company_logo: ownLogoKey });
            const res = await h.as('admin').put('/account/updateAccount').send({ account: { account_company_logo: '' } });
            expect(res.status).to.equal(200);
            const row = await db('accounts').where({ account_id: A }).first();
            expect(row.account_company_logo).to.equal('');
         });

         it('400: refuses a REAL, fetchable key that is simply not under this accounts own logo prefix — nothing is written', async () => {
            const res = await h.as('admin').put('/account/updateAccount').send({ account: { account_company_logo: foreignAreaKey } });
            expect(res.status).to.equal(400);
            expect(res.body.message).to.equal('Invalid logo file key.');
            const row = await db('accounts').where({ account_id: A }).first();
            expect(row.account_company_logo).to.equal(originalLogoValue);
         });

         it('400: refuses a key under a DIFFERENT accounts own logo prefix (account 1, never written to) — nothing is written', async () => {
            const res = await h.as('admin').put('/account/updateAccount').send({ account: { account_company_logo: `${REAL_ACCOUNT_SLUG}/app/assets/logo.png` } });
            expect(res.status).to.equal(400);
            const row = await db('accounts').where({ account_id: A }).first();
            expect(row.account_company_logo).to.equal(originalLogoValue);
         });

         it('400: refuses path traversal, a leading slash, a backslash, and a residual percent — nothing is written', async () => {
            const variants = [
               `${accountSlug}/app/assets/../../../etc/passwd`,
               `/${accountSlug}/app/assets/evil.png`,
               `${accountSlug}\\app\\assets\\evil.png`,
               `${accountSlug}/app/assets/%2e%2e%2fevil.png`
            ];
            for (const variant of variants) {
               const res = await h.as('admin').put('/account/updateAccount').send({ account: { account_company_logo: variant } });
               expect(res.status, variant).to.equal(400);
            }
            const row = await db('accounts').where({ account_id: A }).first();
            expect(row.account_company_logo).to.equal(originalLogoValue);
         });

         it('a request that omits account_company_logo entirely leaves the stored value untouched', async () => {
            await db('accounts').where({ account_id: A }).update({ account_company_logo: ownLogoKey });
            const res = await h.as('admin').put('/account/updateAccount').send({ account: { account_statement: 'Thank you for your business.' } });
            expect(res.status).to.equal(200);
            const row = await db('accounts').where({ account_id: A }).first();
            expect(row.account_company_logo).to.equal(ownLogoKey);
         });
      });

      describe('GET /account/AccountInformation/:accountID/:userID — read-time authorization', () => {
         it('serves back the exact bytes of a key under the callers own logo prefix', async () => {
            await db('accounts').where({ account_id: A }).update({ account_company_logo: ownLogoKey });
            const res = await h.as('admin').get(`/account/AccountInformation/${A}/${U}`);
            expect(res.status).to.equal(200);
            const { accountData } = res.body.account;
            expect(accountData.account_logo_s3_key).to.equal(ownLogoKey);
            expect(accountData.account_logo_base64).to.equal(ownLogoBytes.toString('base64'));
         });

         it('never fetches, and never leaks, a REAL fetchable object outside the logo prefix (simulated legacy bad data) — no 500', async () => {
            // Written directly to the DB — PUT /updateAccount's own
            // validation (tested above) would refuse this over HTTP; this
            // proves the READ side also guards a bad value already on
            // record from before that validation existed.
            await db('accounts').where({ account_id: A }).update({ account_company_logo: foreignAreaKey });
            const res = await h.as('admin').get(`/account/AccountInformation/${A}/${U}`);
            expect(res.status, 'must never 500').to.equal(200);
            const { accountData } = res.body.account;
            expect(accountData.account_logo_base64).to.not.equal(foreignAreaBytes.toString('base64'));
            expect(accountData.account_logo_source).to.equal('unavailable');
         });
      });

      describe('loadCompanyLogo (addInvoiceDetail.js) — read-time authorization used when a statement/invoice PDF is built', () => {
         it('embeds the exact bytes of a key under the accounts own logo prefix', async () => {
            const buffer = await loadCompanyLogo({ account_company_logo: ownLogoKey, account_name: account9001Name });
            expect(Buffer.isBuffer(buffer)).to.equal(true);
            expect(Buffer.compare(buffer, ownLogoBytes)).to.equal(0);
         });

         it('falls back to "no logo" — never throws, never returns the foreign objects bytes — for a REAL fetchable key outside the accounts own logo prefix', async () => {
            const buffer = await loadCompanyLogo({ account_company_logo: foreignAreaKey, account_name: account9001Name });
            expect(Buffer.isBuffer(buffer)).to.equal(true);
            expect(Buffer.compare(buffer, foreignAreaBytes)).to.not.equal(0);
            expect(Buffer.compare(buffer, fs.readFileSync(NO_IMAGE_PATH))).to.equal(0);
         });

         it('falls back to "no logo" for a key under a different accounts own logo prefix (account 1) — no cross-tenant embed', async () => {
            const buffer = await loadCompanyLogo({ account_company_logo: `${REAL_ACCOUNT_SLUG}/app/assets/logo.png`, account_name: account9001Name });
            expect(Buffer.isBuffer(buffer)).to.equal(true);
            expect(Buffer.compare(buffer, fs.readFileSync(NO_IMAGE_PATH))).to.equal(0);
         });

         it('statement build never 500s even when the stored key is completely malformed', async () => {
            const buffer = await loadCompanyLogo({ account_company_logo: '../../../etc/passwd', account_name: account9001Name });
            expect(Buffer.isBuffer(buffer)).to.equal(true);
            expect(Buffer.compare(buffer, fs.readFileSync(NO_IMAGE_PATH))).to.equal(0);
         });
      });
   });
});
