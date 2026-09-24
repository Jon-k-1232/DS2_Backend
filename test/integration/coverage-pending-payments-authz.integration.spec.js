/**
 * HTTP-level coverage for the pendingPayments S3-authorization gaps
 * (review/full-audit-2026-09, finding 3 — the same finding class as
 * coverage-downloads-authz.integration.spec.js, but a separate S3 object
 * model: this feature keys off a client-supplied FILENAME, not a full key).
 *
 * src/endpoints/pendingPayments/pendingPayments-router.js had three
 * independent problems, all now fixed via
 * src/utils/downloadAuthorization.js's isSafeBareFilename and
 * pendingPayments-service.js's accountOwnsSourceFile /
 * PAYMENTS_AUTOMATION_ACCOUNT_ID:
 *
 *  1. NO filename hygiene on upload / delete / preview — a filename
 *     containing '..', a path separator, a backslash, or a residual '%'
 *     (double-encoding) could reach the S3 key unexamined.
 *
 *  2. NO ownership check on delete or preview — both took a client-supplied
 *     filename, built a key under the single SHARED, hardcoded prefixes
 *     (PAYMENTS_PENDING_PREFIX / PAYMENTS_PROCESSED_PREFIX — both scoped to
 *     account 1's slug, James_F__Kimmel___Associates, no matter which
 *     account asked), and touched S3 with no check that the requesting
 *     account had any row referencing that filename. Confirmed exploitable:
 *     DELETE with a fileName matching zero DB rows still fell through to a
 *     real S3 delete call and answered 200 "success" (see the old, now-fixed
 *     "GAP" test this replaced in coverage-payments-pending.integration.spec.js).
 *     Fixed by requiring a customer_payments_processed row for
 *     (account_id, source_file) — the only record of which account a file
 *     belongs to, since the S3 object itself carries no per-account
 *     partition — before either route ever calls S3; a miss is a 404,
 *     deliberately indistinguishable from "this file never existed."
 *
 *  3. Upload has NO per-account isolation at all: it writes to the exact
 *     same account-1 prefix regardless of which account is asking. Unlike
 *     delete/preview, there is no account-scoped fallback available for
 *     upload — exactly one production Lambda (DS2_Lambdas/Process_Payment_Images)
 *     polls this exact prefix, hardcoded, with no per-account template (see
 *     that Lambda's config.py). Giving another account its own prefix would
 *     accept their file and then silently never process it (an orphan S3
 *     object, no DB row, since only that Lambda ever inserts into
 *     customer_payments_processed) — worse than a clear refusal. Fixed by
 *     gating upload to PAYMENTS_AUTOMATION_ACCOUNT_ID (1) and refusing every
 *     other account with 403.
 *
 * Fixture: account 9001 (test/fixtures/seed.sql), admin 90013. Account 1 is
 * used strictly READ-ONLY (superAdmin identity, one validation-failure
 * request only — never a real upload/delete/preview) — this spec never
 * uploads, deletes, or otherwise mutates any account-1 object, matching
 * coverage-downloads-authz.integration.spec.js's own convention.
 *
 * A real second tenant able to legitimately own a pending-payment row does
 * not exist in this sandbox (only the Lambda ever inserts such rows, and it
 * is wired to account 1 alone) — so "account 9001 previews/deletes an object
 * it does not own" is exercised the practical way available here: a real
 * object is seeded directly into MinIO under the shared prefix with NO
 * customer_payments_processed row for ANY account, which is exactly what
 * accountOwnsSourceFile sees when the object belongs to some other account
 * (a row scoped to a different account_id is likewise invisible to account
 * 9001's lookup) — the code path exercised is identical either way.
 *
 * Run:
 *   DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js \
 *     test/integration/coverage-pending-payments-authz.integration.spec.js --exit --timeout 180000
 */
const { bootHttp, uniqueName } = require('./_http');
const { TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { putObject, getObject, deleteObject } = require('../../src/utils/s3');
const { PAYMENTS_PENDING_PREFIX } = require('../../src/endpoints/pendingPayments/pendingPayments-service');

const A = TEST_ACCOUNT_ID; // 9001 — fixture account. Never account 1.
const U = TEST_ADMIN_USER_ID; // 90013
const REAL_ACCOUNT_ID = 1; // prod copy — READ-ONLY in this spec; never uploaded/deleted/previewed.
const REAL_SUPERADMIN_USER_ID = 21; // admin@jimkimmel.com — matches _http.js IDENTITIES.superAdmin.

describe('integration: coverage — pendingPayments S3 authorization (HTTP)', function () {
   this.timeout(180_000);

   let h;
   let db;
   const s3Keys = [];
   const createdPendingIds = [];

   const makeOwnedFile = async (accountID, amount = 10) => {
      const fileName = `${uniqueName('coverage-ppauthz')}.pdf`;
      const key = `${PAYMENTS_PENDING_PREFIX}/${fileName}`;
      const bytes = Buffer.from(`%PDF-1.4 coverage-pending-payments-authz fixture bytes for ${fileName}`);
      await putObject(key, bytes, 'application/pdf');
      s3Keys.push(key);
      const [row] = await db('customer_payments_processed')
         .insert({
            account_id: accountID,
            customer_name: uniqueName('COVPPAUTHZ'),
            payment_amount: amount,
            payment_reference_number: '0000',
            payment_date: new Date(),
            form_of_payment: 'Check',
            note: 'coverage-pending-payments-authz fixture',
            source_file: fileName
         })
         .returning('*');
      createdPendingIds.push(row.payment_id);
      return { fileName, key, bytes, row };
   };

   const makeUnownedFile = async () => {
      // A REAL, fetchable object under the shared prefix with NO DB row for
      // any account — the practical stand-in for "some other account's
      // file" (see file header). accountOwnsSourceFile must refuse this for
      // account 9001 exactly as it would a genuinely foreign row.
      const fileName = `${uniqueName('coverage-ppauthz-unowned')}.pdf`;
      const key = `${PAYMENTS_PENDING_PREFIX}/${fileName}`;
      const bytes = Buffer.from(`%PDF-1.4 coverage-pending-payments-authz UNOWNED fixture bytes for ${fileName} — must never be served or deleted by account 9001`);
      await putObject(key, bytes, 'application/pdf');
      s3Keys.push(key);
      return { fileName, key, bytes };
   };

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
   });

   after(async () => {
      if (createdPendingIds.length) {
         await db('customer_payments_processed').whereIn('payment_id', createdPendingIds).del();
      }
      for (const key of new Set(s3Keys.filter(Boolean))) {
         await deleteObject(key).catch(() => {});
      }
      await h.close();
   });

   // ══════════════════════════════════════════════════════════════════════
   // POST /pending-payments/upload/:accountID/:userID — account-1-only gate
   // ══════════════════════════════════════════════════════════════════════
   describe('POST /pending-payments/upload/:accountID/:userID', () => {
      const upload = (identity, accountID, uid, fileName, buf) =>
         h
            .as(identity)
            .post(`/pending-payments/upload/${accountID}/${uid}`)
            .set('Content-Type', 'application/octet-stream')
            .set('x-file-name', encodeURIComponent(fileName))
            .set('x-file-type', 'application/pdf')
            .send(buf);

      it('403: a non-owner account (9001) is refused before any S3 write, even with an otherwise perfectly valid request', async () => {
         const fileName = `${uniqueName('coverage-ppauthz-upload')}.pdf`;
         const res = await upload('admin', A, U, fileName, Buffer.from('a well-formed pdf payload'));
         expect(res.status).to.equal(403);
         expect(res.body.message).to.be.a('string').and.not.equal('');

         let exists = true;
         try {
            await getObject(`${PAYMENTS_PENDING_PREFIX}/${fileName}`);
         } catch (e) {
            exists = false;
         }
         expect(exists, 'nothing was written to the shared prefix').to.equal(false);
      });

      it('400: filename hygiene rejects traversal, a leading slash, a backslash, an embedded slash, and a residual percent (account 9001 — hygiene runs before the account gate)', async () => {
         const variants = [
            '../../../etc/passwd.pdf',
            '/etc/passwd.pdf',
            'sub\\dir\\evil.pdf',
            'sub/dir/evil.pdf',
            `%2e%2e%2f${uniqueName('double-encoded')}.pdf`
         ];
         for (const fileName of variants) {
            const res = await upload('admin', A, U, fileName, Buffer.from('x'));
            expect(res.status, fileName).to.equal(400);
         }
      });

      it('the owner account (1) is unaffected by the new gate — still 400, not 403, for an invalid extension; no real upload is attempted', async () => {
         // Proves Number(accountID) !== PAYMENTS_AUTOMATION_ACCOUNT_ID is a
         // no-op for the actual owner: falls through to the pre-existing
         // extension check, which still 400s (not the new 403) — via a
         // request that was always going to fail validation, so nothing is
         // ever written to account 1's real prefix.
         const res = await upload('superAdmin', REAL_ACCOUNT_ID, REAL_SUPERADMIN_USER_ID, `${uniqueName('owner-check')}.png`, Buffer.from('not checked anyway'));
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('Only PDF files are accepted.');
      });
   });

   // ══════════════════════════════════════════════════════════════════════
   // DELETE /pending-payments/file/:accountID/:userID — DB ownership
   // ══════════════════════════════════════════════════════════════════════
   describe('DELETE /pending-payments/file/:accountID/:userID', () => {
      it('400: filename hygiene rejects traversal, a backslash, an embedded slash, and a residual percent', async () => {
         const variants = ['../../../etc/passwd.pdf', 'sub\\dir\\evil.pdf', 'sub/dir/evil.pdf', `%2e%2e%2f${uniqueName('x')}.pdf`];
         for (const fileName of variants) {
            const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName });
            expect(res.status, fileName).to.equal(400);
            expect(res.body.message).to.equal('Invalid file name.');
         }
      });

      it('404: a REAL, fetchable object with no owning row for this account is refused — the object is left untouched', async () => {
         const { fileName, key, bytes } = await makeUnownedFile();
         const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName });
         expect(res.status).to.equal(404);
         expect(res.body.message).to.equal('File not found.');

         const obj = await getObject(key);
         expect(Buffer.compare(obj.body, bytes), 'the object was never touched').to.equal(0);
      });

      it('200: an object this account DOES own (per the DB) is deleted normally — the fix does not break legitimate access', async () => {
         const { fileName, key } = await makeOwnedFile(A);
         const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName });
         expect(res.status).to.equal(200);

         let exists = true;
         try {
            await getObject(key);
         } catch (e) {
            exists = false;
         }
         expect(exists, 'the owned object was removed').to.equal(false);
      });
   });

   // ══════════════════════════════════════════════════════════════════════
   // GET /pending-payments/file-preview/:accountID/:userID — DB ownership
   // ══════════════════════════════════════════════════════════════════════
   describe('GET /pending-payments/file-preview/:accountID/:userID', () => {
      it('400: filename hygiene rejects traversal, a backslash, an embedded slash, and a residual percent', async () => {
         const variants = ['../../../etc/passwd.pdf', 'sub\\dir\\evil.pdf', 'sub/dir/evil.pdf', `%2e%2e%2f${uniqueName('x')}.pdf`];
         for (const fileName of variants) {
            const res = await h.as('admin').get(`/pending-payments/file-preview/${A}/${U}?fileName=${encodeURIComponent(fileName)}`);
            expect(res.status, fileName).to.equal(400);
            expect(res.body.message).to.equal('Invalid file name.');
         }
      });

      it('404: a REAL, fetchable object with no owning row for this account is never streamed back', async () => {
         const { fileName, bytes } = await makeUnownedFile();
         const res = await h.as('admin').get(`/pending-payments/file-preview/${A}/${U}?fileName=${encodeURIComponent(fileName)}`);
         expect(res.status).to.equal(404);
         expect(res.body.message).to.equal('File not found.');
         const bodyBuf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(JSON.stringify(res.body));
         expect(bodyBuf.includes(bytes), 'the foreign object bytes were never included in the response').to.equal(false);
      });

      it('200: an object this account DOES own (per the DB) previews normally — the fix does not break legitimate access', async () => {
         const { fileName, bytes } = await makeOwnedFile(A);
         const res = await h.as('admin').get(`/pending-payments/file-preview/${A}/${U}?fileName=${encodeURIComponent(fileName)}`);
         expect(res.status).to.equal(200);
         const bodyBuf = Buffer.isBuffer(res.body) && res.body.length ? res.body : Buffer.from(res.text || '', 'binary');
         expect(bodyBuf.equals(bytes)).to.equal(true);
      });
   });
});
