/**
 * Fix 7: user-router must refuse deactivating/deleting yourself, refuse
 * removing the last active Super Admin in the account, and normalise
 * access_level to the canonical set on create/update (reject others).
 *
 * Driven through the real Express app against the sandbox DB fixture account
 * 9001. Creates one throwaway Super Admin (90097) to exercise the
 * last-active-super-admin guard, and always restores/removes whatever it
 * touched in `after`. Skipped when the sandbox DB is unreachable.
 */
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('../../integration/_setup');
const jwt = require('jsonwebtoken');
const supertest = global.supertest || require('supertest');
const app = require('../../../src/app');
const config = require('../../../config');

const A = TEST_ACCOUNT_ID; // 9001
const ADMIN_ID = TEST_ADMIN_USER_ID; // 90013, access_level 'admin' (not super admin)
const ADMIN_EMAIL = 'admin+test@example.com';
const SOLE_SUPER_ADMIN_ID = 90097; // throwaway, created in before() / removed in after()
const SOLE_SUPER_ADMIN_EMAIL = 'solesuperadmin+test@example.com';
const SECOND_SUPER_ADMIN_ID = 90096; // throwaway, created only in the "not last" test
const SECOND_SUPER_ADMIN_EMAIL = 'secondsuperadmin+test@example.com';

describe('integration: user-router self-service and last-super-admin guards (fix 7)', function () {
   this.timeout(30_000);

   let db;
   let superAdminToken;
   let priorSuperAdmins = [];
   const cleanupUserIds = [SOLE_SUPER_ADMIN_ID, SECOND_SUPER_ADMIN_ID];

   const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);
   const put = (url, token, body) => authed(supertest(app).put(url), token).send(body);
   const del = (url, token) => authed(supertest(app).delete(url), token);

   // updateUser is a full-object PUT (no partial-update semantics), so every
   // call must resend the target's OWN current email — otherwise it silently
   // changes users.email out from under a JWT that was minted with the old
   // email as `subject` (authService.getUserByEmail looks up by email), which
   // would 401 that token on every subsequent request in the suite. This is a
   // property of this test harness, not of the fix under test.
   const EMAIL_BY_ID = {
      [SOLE_SUPER_ADMIN_ID]: SOLE_SUPER_ADMIN_EMAIL,
      [SECOND_SUPER_ADMIN_ID]: SECOND_SUPER_ADMIN_EMAIL
   };
   const baseUserBody = (userId, overrides) => ({
      userID: userId,
      accountID: A,
      userDisplayName: 'Guard Test User',
      userEmail: EMAIL_BY_ID[userId],
      costRate: 10,
      billingRate: 20,
      role: 'Staff',
      accessLevel: 'Super Admin',
      isUserActive: true,
      ...overrides
   });

   before(async function () {
      db = await requireDb.call(this);
      app.set('db', db);
      // See roleGates.integration.spec.js for why this line is needed: when
      // running as part of the full test:unit sweep, config.js can be cached
      // with a stale/empty JWT_SECRET by an earlier-loaded spec file.
      config.JWT_SECRET = process.env.JWT_SECRET || config.JWT_SECRET;

      // Other integration harnesses may promote their fixture admin. Isolate
      // this sole-admin assertion and restore all prior roles afterwards.
      priorSuperAdmins = await db('users').where({account_id:A}).whereNotIn('user_id',cleanupUserIds).whereRaw("lower(access_level) = 'super admin'").select('user_id','access_level');
      if(priorSuperAdmins.length) await db('users').where({account_id:A}).whereIn('user_id',priorSuperAdmins.map(u=>u.user_id)).update({access_level:'Admin'});
      await db('users')
         .insert({
            user_id: SOLE_SUPER_ADMIN_ID,
            account_id: A,
            email: SOLE_SUPER_ADMIN_EMAIL,
            display_name: 'Sole Super Admin',
            job_title: 'Owner',
            access_level: 'Super Admin',
            is_user_active: true
         })
         .onConflict('user_id')
         .merge();

      superAdminToken = jwt.sign({ user_id: SOLE_SUPER_ADMIN_ID }, config.JWT_SECRET, {
         subject: SOLE_SUPER_ADMIN_EMAIL,
         expiresIn: '2h',
         algorithm: 'HS256'
      });
   });

   after(async () => {
      if (db) {
         for(const user of priorSuperAdmins) await db('users').where({account_id:A,user_id:user.user_id}).update({access_level:user.access_level});
         for (const id of cleanupUserIds) {
            await db('users').where({ user_id: id, account_id: A }).del();
         }
      }
      await closeDb();
   });

   describe('DELETE /user/deleteUser — self-delete guard', () => {
      it('refuses when the caller tries to delete their own account', async () => {
         const res = await del(`/user/deleteUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken);
         expect(res.body.status).to.equal(400);
         expect(res.body.message).to.match(/cannot delete your own/i);

         const stillActive = await db('users').where({ user_id: SOLE_SUPER_ADMIN_ID, account_id: A }).first();
         expect(stillActive.is_user_active).to.equal(true);
      });
   });

   describe('PUT /user/updateUser — self-deactivate guard', () => {
      it('refuses when the caller tries to deactivate their own account', async () => {
         const body = baseUserBody(SOLE_SUPER_ADMIN_ID, { isUserActive: false });
         const res = await put(`/user/updateUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken, { user: body });
         expect(res.body.status).to.equal(400);
         expect(res.body.message).to.match(/cannot deactivate your own/i);

         const stillActive = await db('users').where({ user_id: SOLE_SUPER_ADMIN_ID, account_id: A }).first();
         expect(stillActive.is_user_active).to.equal(true);
      });

      it('allows the caller to edit an unrelated field on their own account (self-guard is scoped to deactivation, not all self-edits)', async () => {
         const body = baseUserBody(SOLE_SUPER_ADMIN_ID, { billingRate: 42 });
         const res = await put(`/user/updateUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken, { user: body });
         expect(res.body.status).to.equal(200);
         const row = await db('users').where({ user_id: SOLE_SUPER_ADMIN_ID, account_id: A }).first();
         expect(Number(row.billing_rate)).to.equal(42);
      });
   });

   describe('last-active-Super-Admin guard', () => {
      // DELETE /user/deleteUser: the only HTTP-reachable path to the guard's
      // "refuse" branch would be a super admin deleting the sole OTHER super
      // admin — but with only one super admin total, the only person who
      // could call deleteUser AT ALL (requireSuperAdmin) IS that one super
      // admin, and deleting themselves is intercepted by the self-delete
      // guard first. So deleteUser's "refuse" branch is exercised here via
      // its "allow" branch (not-last), and the "refuse" branch is exercised
      // below via updateUser's self-demotion path, which the self-deactivate
      // guard does NOT cover (that guard only looks at is_user_active, not
      // access_level) — both call the same assertNotLastSuperAdmin check.
      it('DELETE /user/deleteUser allows removing a Super Admin when another active Super Admin remains', async () => {
         await db('users')
            .insert({
               user_id: SECOND_SUPER_ADMIN_ID,
               account_id: A,
               email: SECOND_SUPER_ADMIN_EMAIL,
               display_name: 'Second Super Admin',
               job_title: 'Owner',
               access_level: 'Super Admin',
               is_user_active: true
            })
            .onConflict('user_id')
            .merge();

         const res = await del(`/user/deleteUser/${A}/${SECOND_SUPER_ADMIN_ID}`, superAdminToken);
         expect(res.body.status).to.equal(200);

         const row = await db('users').where({ user_id: SECOND_SUPER_ADMIN_ID, account_id: A }).first();
         expect(row, 'the non-last super admin should actually be gone').to.not.exist;
      });

      it('PUT /user/updateUser refuses to demote the account\'s only active Super Admin away from Super Admin', async () => {
         const body = baseUserBody(SOLE_SUPER_ADMIN_ID, { accessLevel: 'Admin' });
         const res = await put(`/user/updateUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken, { user: body });
         expect(res.body.status).to.equal(400);
         expect(res.body.message).to.match(/last active super admin/i);

         const row = await db('users').where({ user_id: SOLE_SUPER_ADMIN_ID, account_id: A }).first();
         expect(row.access_level).to.equal('Super Admin');
      });

      it('PUT /user/updateUser allows demoting a Super Admin when another active Super Admin remains', async () => {
         await db('users')
            .insert({
               user_id: SECOND_SUPER_ADMIN_ID,
               account_id: A,
               email: SECOND_SUPER_ADMIN_EMAIL,
               display_name: 'Second Super Admin',
               job_title: 'Owner',
               access_level: 'Super Admin',
               is_user_active: true
            })
            .onConflict('user_id')
            .merge();

         const body = baseUserBody(SECOND_SUPER_ADMIN_ID, { accessLevel: 'Manager' });
         const res = await put(`/user/updateUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken, { user: body });
         expect(res.body.status).to.equal(200);

         const row = await db('users').where({ user_id: SECOND_SUPER_ADMIN_ID, account_id: A }).first();
         expect(row.access_level).to.equal('Manager');
      });
   });

   describe('access_level normalisation on create/update', () => {
      it('PUT /user/updateUser rejects a non-canonical access_level with 400', async () => {
         const body = baseUserBody(SOLE_SUPER_ADMIN_ID, { accessLevel: 'employee' });
         const res = await put(`/user/updateUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken, { user: body });
         expect(res.body.status).to.equal(400);
         expect(res.body.message).to.match(/Invalid access level/i);

         const row = await db('users').where({ user_id: SOLE_SUPER_ADMIN_ID, account_id: A }).first();
         expect(row.access_level).to.equal('Super Admin');
      });

      it('PUT /user/updateUser accepts a lowercase canonical value and stores it in canonical casing', async () => {
         const body = baseUserBody(SOLE_SUPER_ADMIN_ID, { accessLevel: 'super admin', billingRate: 55 });
         const res = await put(`/user/updateUser/${A}/${SOLE_SUPER_ADMIN_ID}`, superAdminToken, { user: body });
         expect(res.body.status).to.equal(200);
         const row = await db('users').where({ user_id: SOLE_SUPER_ADMIN_ID, account_id: A }).first();
         expect(row.access_level).to.equal('Super Admin');
      });
   });
});
