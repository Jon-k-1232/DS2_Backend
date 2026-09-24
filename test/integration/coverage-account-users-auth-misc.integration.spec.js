/**
 * HTTP-level route coverage for:
 *   src/endpoints/account/**            (AccountInformation, automations, updateAccount, createAccount)
 *   src/endpoints/user/**               (createUser, updateUser, deleteUser, fetchSingleUser)
 *   src/endpoints/auth/**                (google, renew, logout)
 *   src/endpoints/notifications/**      (list, unread-count, mark-read, mark-all-read)
 *   src/endpoints/health/**             (healthz, healthz/check, api/health/check)
 *   src/endpoints/initialData/**        (initialBlob — auth categories only; field-stripping
 *                                         already covered by initialDataUserFields.integration.spec.js)
 *   src/endpoints/recurringCustomer/**  (create, list, update, delete)
 *   src/endpoints/timeTrackerStaff/**   (CRUD)
 *   src/endpoints/customer/**           (the routes NOT already covered by
 *                                         customerCrud.integration.spec.js: activeCustomers list+search,
 *                                         customerByID, deactivate warnings, delete refusal via a
 *                                         non-write-off linked row)
 *
 * Driven through the real Express app (src/app) via the shared harness
 * (test/integration/_http.js) against the sandbox DB fixture account 9001
 * (test/fixtures/seed.sql). Every row this spec creates uses a COV-prefixed
 * unique name or a dedicated 909xx id (clear of seed.sql's 900xx range and of
 * the 90096-90098 throwaway ids already used by roleGates.integration.spec.js
 * / userGuards.integration.spec.js) and is removed in `after`. Account 1 is
 * NEVER mutated — every account-1 touch here is a read-only SELECT used to
 * prove a 9001 token cannot reach or change it. Skipped entirely when the
 * sandbox DB is unreachable (see _setup.requireDb via bootHttp).
 *
 * Four product defects previously encoded as `it.skip` with `// DEFECT:`
 * evidence are now fixed and asserted directly — see the customerByID/
 * fetchSingleUser not-found tests, the updateRecurringCustomer happy-path
 * test, and the createUser isActive:false test.
 */
const { bootHttp, uniqueName } = require('./_http');
const { sanitizeAccountName } = require('../../src/utils/invoicePath');

describe('integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer', function () {
   this.timeout(60_000);

   let h, db, A, ADMIN_ID, EMPLOYEE_ID;

   // ── Throwaway fixture users (account 9001), namespaced 909xx ───────────────
   const SUPER_ID = 90961;
   const SUPER_EMAIL = 'cov-superadmin+test@example.com';
   const DELETE_TARGET_ID = 90962;
   const DELETE_TARGET_EMAIL = 'cov-deleteme+test@example.com';
   const UPDATE_TARGET_ID = 90963;
   const UPDATE_TARGET_EMAIL = 'cov-updateme+test@example.com';
   const TTS_CREATE_USER_ID = 90964;
   const TTS_CREATE_USER_EMAIL = 'cov-tts-create+test@example.com';
   const TTS_UPDATE_USER_ID = 90965;
   const TTS_UPDATE_USER_EMAIL = 'cov-tts-update+test@example.com';
   const TTS_DELETE_USER_ID = 90966;
   const TTS_DELETE_USER_EMAIL = 'cov-tts-delete+test@example.com';
   const ALL_THROWAWAY_USER_IDS = [SUPER_ID, DELETE_TARGET_ID, UPDATE_TARGET_ID, TTS_CREATE_USER_ID, TTS_UPDATE_USER_ID, TTS_DELETE_USER_ID];

   let superToken;

   // Wrap an arbitrary raw JWT the same way h.as() wraps its four canonical
   // identities, for throwaway fixture users the shared harness doesn't know about.
   const withToken = token => ({
      get: url => h.request.get(url).set('Authorization', `Bearer ${token}`),
      post: url => h.request.post(url).set('Authorization', `Bearer ${token}`),
      put: url => h.request.put(url).set('Authorization', `Bearer ${token}`),
      delete: url => h.request.delete(url).set('Authorization', `Bearer ${token}`)
   });

   // Standard "no token / expired token / unprovisioned stranger" 401 trio,
   // reused under every route's own describe block.
   const itRejectsUnauthenticated = (method, urlFn) => {
      it('401s with no token at all', async () => {
         const res = await h.anonymous[method](urlFn());
         expect(res.status).to.equal(401);
      });
      it('401s with an expired token', async () => {
         const expired = h.mint('admin', { expiresIn: '-1s' });
         const res = await withToken(expired)[method](urlFn());
         expect(res.status).to.equal(401);
      });
      it('401s a stranger (unprovisioned email)', async () => {
         const res = await h.as('stranger')[method](urlFn());
         expect(res.status).to.equal(401);
      });
   };

   // Cleanup trackers
   const createdUserIds = [];
   const createdAccountIds = [];
   const createdCustomerIds = [];
   const createdNotificationIds = [];

   let account9001Before, accountInfo9001Before;
   let account1Snapshot, account1UsersCountBefore, account1RecurringCountBefore;

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
      A = h.accountID; // 9001
      ADMIN_ID = h.adminUserID; // 90013
      EMPLOYEE_ID = h.employeeUserID; // 90011

      // Throwaway fixture users for this spec.
      await db('users')
         .insert({ user_id: SUPER_ID, account_id: A, email: SUPER_EMAIL, display_name: 'COV Super Admin', job_title: 'Owner', access_level: 'Super Admin', is_user_active: true })
         .onConflict('user_id')
         .merge();
      await db('users')
         .insert({ user_id: DELETE_TARGET_ID, account_id: A, email: DELETE_TARGET_EMAIL, display_name: 'COV Delete Target', job_title: 'Staff', access_level: 'User', is_user_active: true })
         .onConflict('user_id')
         .merge();
      await db('users')
         .insert({ user_id: UPDATE_TARGET_ID, account_id: A, email: UPDATE_TARGET_EMAIL, display_name: 'COV Update Target', job_title: 'Staff', access_level: 'User', is_user_active: true })
         .onConflict('user_id')
         .merge();

      superToken = h.mint('admin', { user_id: SUPER_ID, email: SUPER_EMAIL });

      // Read-only account-1 snapshots — used to PROVE account 1 stays
      // untouched by any 9001-scoped call this spec makes. Never written to.
      account1Snapshot = await db('accounts').where({ account_id: 1 }).first();
      account1UsersCountBefore = Number((await db('users').where({ account_id: 1 }).count({ c: '*' }).first()).c);
      account1RecurringCountBefore = Number((await db('recurring_customers').where({ account_id: 1 }).count({ c: '*' }).first()).c);

      // account 9001 snapshot for the updateAccount tests (restored in after()).
      account9001Before = await db('accounts').where({ account_id: A }).first();
      accountInfo9001Before = await db('account_information').where({ account_id: A }).first();
   });

   after(async function () {
      this.timeout(60_000);

      // Restore account 9001 to its exact pre-suite state.
      if (account9001Before) {
         await db('accounts').where({ account_id: A }).update({
            account_name: account9001Before.account_name,
            account_type: account9001Before.account_type,
            is_account_active: account9001Before.is_account_active,
            account_statement: account9001Before.account_statement,
            account_interest_statement: account9001Before.account_interest_statement,
            account_invoice_template_option: account9001Before.account_invoice_template_option,
            account_company_logo: account9001Before.account_company_logo,
            created_at: account9001Before.created_at
         });
      }
      if (accountInfo9001Before) {
         await db('account_information').where({ account_info_id: accountInfo9001Before.account_info_id }).update({
            account_street: accountInfo9001Before.account_street,
            account_city: accountInfo9001Before.account_city,
            account_state: accountInfo9001Before.account_state,
            account_zip: accountInfo9001Before.account_zip,
            account_email: accountInfo9001Before.account_email,
            account_phone: accountInfo9001Before.account_phone,
            is_this_address_active: accountInfo9001Before.is_this_address_active,
            is_account_physical_address: accountInfo9001Before.is_account_physical_address,
            is_account_billing_address: accountInfo9001Before.is_account_billing_address,
            is_account_mailing_address: accountInfo9001Before.is_account_mailing_address,
            created_at: accountInfo9001Before.created_at
         });
      }

      // Remove every throwaway row this spec created.
      for (const id of createdCustomerIds) {
         await db('customers').where({ account_id: A, customer_id: id }).del(); // cascades info/jobs/recurring
      }
      for (const id of createdNotificationIds) {
         await db('notifications').where({ account_id: A, notification_id: id }).del();
      }
      for (const id of [...createdUserIds, ...ALL_THROWAWAY_USER_IDS]) {
         await db('users').where({ account_id: A, user_id: id }).del();
      }
      for (const id of createdAccountIds) {
         await db('account_information').where({ account_id: id }).del();
         await db('accounts').where({ account_id: id }).del();
      }

      // Prove account 1 is exactly as it was before this spec ran.
      const account1After = await db('accounts').where({ account_id: 1 }).first();
      const account1UsersCountAfter = Number((await db('users').where({ account_id: 1 }).count({ c: '*' }).first()).c);
      const account1RecurringCountAfter = Number((await db('recurring_customers').where({ account_id: 1 }).count({ c: '*' }).first()).c);
      if (account1Snapshot) {
         if (account1After.account_name !== account1Snapshot.account_name || String(account1After.updated_at) !== String(account1Snapshot.updated_at)) {
            // Intentionally not asserting here (after() failures are noisy) — see the
            // dedicated in-suite assertions below for the real proof. This is a
            // best-effort extra guard logged for visibility only.
            console.error('WARNING: account 1 accounts row differs after the suite ran', { before: account1Snapshot, after: account1After });
         }
      }
      if (account1UsersCountAfter !== account1UsersCountBefore) {
         console.error(`WARNING: account 1 users count changed (${account1UsersCountBefore} -> ${account1UsersCountAfter})`);
      }
      if (account1RecurringCountAfter !== account1RecurringCountBefore) {
         console.error(`WARNING: account 1 recurring_customers count changed (${account1RecurringCountBefore} -> ${account1RecurringCountAfter})`);
      }

      await h.close();
   });

   // =========================================================================
   // ACCOUNT
   // =========================================================================

   describe('GET /account/AccountInformation/:accountID/:userID', () => {
      it('happy path: returns the account row + logo metadata for the caller\'s own account', async () => {
         const res = await h.as('admin').get(`/account/AccountInformation/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const data = res.body.account.accountData;
         expect(data.account_id).to.equal(A);
         const dbRow = await db('accounts').where({ account_id: A }).first();
         expect(data.account_name).to.equal(dbRow.account_name);
         expect(data).to.have.property('account_logo_source');
      });

      itRejectsUnauthenticated('get', () => `/account/AccountInformation/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/account/AccountInformation/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" (non-admin) caller — requireAdmin gate', async () => {
         const res = await h.as('employee').get(`/account/AccountInformation/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });

      // not-found: N/A — account_information always exists for the caller's own
      // seeded account (enforceAccountId guarantees accountID === req.user.account_id,
      // and seed.sql always provisions account_information for 9001), and this spec
      // must not delete that shared fixture row to force the 404 branch.
   });

   describe('GET /account/automations/:accountID/:userID', () => {
      it('happy path: returns all 4 known automation definitions with defaults', async () => {
         const res = await h.as('admin').get(`/account/automations/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200);
         const keys = res.body.automations.map(a => a.key).sort();
         expect(keys).to.deep.equal(['ai_training_weekly_upload', 'friday_reminder_emails', 'missing_tracker_reminders', 'thursday_reminder_emails'].sort());
         expect(res.body.availableUsers).to.be.an('array');
      });

      itRejectsUnauthenticated('get', () => `/account/automations/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/account/automations/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" (non-admin) caller — requireAdmin gate', async () => {
         const res = await h.as('employee').get(`/account/automations/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /account/automations/:accountID/:userID', () => {
      const KEY = 'thursday_reminder_emails';
      let settingBefore, recipientsBefore;

      before(async () => {
         settingBefore = await db('account_automation_settings').where({ account_id: A, automation_key: KEY }).first();
         recipientsBefore = (await db('account_automation_recipients').where({ account_id: A, automation_key: KEY }).select('user_id')).map(r => r.user_id);
      });

      after(async () => {
         if (settingBefore) {
            await db('account_automation_settings').where({ account_id: A, automation_key: KEY }).update({ is_enabled: settingBefore.is_enabled });
         } else {
            await db('account_automation_settings').where({ account_id: A, automation_key: KEY }).del();
         }
         await db('account_automation_recipients').where({ account_id: A, automation_key: KEY }).del();
         if (recipientsBefore.length) {
            await db('account_automation_recipients').insert(recipientsBefore.map(user_id => ({ account_id: A, automation_key: KEY, user_id })));
         }
      });

      it('happy path: toggles isEnabled and replaces recipientUserIds, proven in the DB', async () => {
         const res = await h.as('admin').put(`/account/automations/${A}/${ADMIN_ID}`).send({ automationKey: KEY, isEnabled: false, recipientUserIds: [EMPLOYEE_ID] });
         expect(res.status).to.equal(200);
         expect(res.body.automation.isEnabled).to.equal(false);
         expect(res.body.automation.recipientUserIds).to.deep.equal([EMPLOYEE_ID]);

         const settingRow = await db('account_automation_settings').where({ account_id: A, automation_key: KEY }).first();
         expect(settingRow.is_enabled).to.equal(false);
         const recipientRows = await db('account_automation_recipients').where({ account_id: A, automation_key: KEY }).select('user_id');
         expect(recipientRows.map(r => r.user_id)).to.deep.equal([EMPLOYEE_ID]);
      });

      it('validation failure: an unknown automationKey is refused with 400', async () => {
         const res = await h.as('admin').put(`/account/automations/${A}/${ADMIN_ID}`).send({ automationKey: 'not_a_real_key', isEnabled: false });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/invalid automation key/i);
      });

      itRejectsUnauthenticated('put', () => `/account/automations/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').put(`/account/automations/1/21`).send({ automationKey: KEY, isEnabled: true });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" (non-admin) caller — requireAdmin gate', async () => {
         const res = await h.as('employee').put(`/account/automations/${A}/${EMPLOYEE_ID}`).send({ automationKey: KEY, isEnabled: true });
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /account/updateAccount', () => {
      it('happy path: updates the caller\'s own account (9001) and is provable in the DB', async () => {
         const newStatement = uniqueName('COV-statement');
         const body = {
            account_id: A,
            account_name: account9001Before.account_name,
            account_type: account9001Before.account_type,
            is_account_active: account9001Before.is_account_active,
            account_statement: newStatement,
            account_interest_statement: account9001Before.account_interest_statement,
            account_invoice_template_option: account9001Before.account_invoice_template_option,
            account_info_id: accountInfo9001Before.account_info_id,
            account_street: accountInfo9001Before.account_street,
            account_city: accountInfo9001Before.account_city,
            account_state: accountInfo9001Before.account_state,
            account_zip: accountInfo9001Before.account_zip,
            account_email: accountInfo9001Before.account_email,
            account_phone: accountInfo9001Before.account_phone,
            is_this_address_active: accountInfo9001Before.is_this_address_active,
            is_account_physical_address: accountInfo9001Before.is_account_physical_address,
            is_account_billing_address: accountInfo9001Before.is_account_billing_address,
            is_account_mailing_address: accountInfo9001Before.is_account_mailing_address
         };
         const res = await h.as('admin').put('/account/updateAccount').send({ account: body });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);

         const row = await db('accounts').where({ account_id: A }).first();
         expect(row.account_statement).to.equal(newStatement);
      });

      it('account-1-untouchable: account_id:1 injected in the body is ignored — account_id is taken from the caller\'s own session (9001), never the body', async () => {
         const before1 = await db('accounts').where({ account_id: 1 }).first();
         const newStatement = uniqueName('COV-injection-statement');
         const body = {
            account_id: 1, // deliberate cross-tenant injection attempt
            account_name: account9001Before.account_name,
            account_type: account9001Before.account_type,
            is_account_active: account9001Before.is_account_active,
            account_statement: newStatement,
            account_interest_statement: account9001Before.account_interest_statement,
            account_invoice_template_option: account9001Before.account_invoice_template_option,
            account_info_id: accountInfo9001Before.account_info_id,
            account_street: accountInfo9001Before.account_street,
            account_city: accountInfo9001Before.account_city,
            account_state: accountInfo9001Before.account_state,
            account_zip: accountInfo9001Before.account_zip,
            account_email: accountInfo9001Before.account_email,
            account_phone: accountInfo9001Before.account_phone,
            is_this_address_active: accountInfo9001Before.is_this_address_active,
            is_account_physical_address: accountInfo9001Before.is_account_physical_address,
            is_account_billing_address: accountInfo9001Before.is_account_billing_address,
            is_account_mailing_address: accountInfo9001Before.is_account_mailing_address
         };
         const res = await h.as('admin').put('/account/updateAccount').send({ account: body });
         expect(res.status).to.equal(200);

         // Read-only proof: account 1 is byte-for-byte unchanged...
         const after1 = await db('accounts').where({ account_id: 1 }).first();
         expect(after1.account_name).to.equal(before1.account_name);
         expect(after1.account_statement).to.equal(before1.account_statement);
         expect(String(after1.created_at)).to.equal(String(before1.created_at));
         // ...while account 9001 (the caller's real account) DID receive the update,
         // proving the request was actually processed (not merely a no-op/silent drop).
         const after9001 = await db('accounts').where({ account_id: A }).first();
         expect(after9001.account_statement).to.equal(newStatement);
      });

      it('validation failure: an explicit null for a required field (account_type) raises a real 500 (no NOT NULL guard before the DB)', async () => {
         // Note: knex's .update() silently DROPS undefined-valued keys from the
         // SET clause (the column is simply left untouched), so merely omitting
         // account_type from the body is not a validation failure — it has to be
         // sent as an explicit null to reach the NOT NULL constraint.
         const body = {
            account_id: A,
            account_name: account9001Before.account_name,
            account_type: null,
            is_account_active: true,
            account_info_id: accountInfo9001Before.account_info_id,
            is_this_address_active: true,
            is_account_physical_address: true,
            is_account_billing_address: true,
            is_account_mailing_address: true
         };
         const res = await h.as('admin').put('/account/updateAccount').send({ account: body });
         expect(res.status).to.equal(500);
      });

      itRejectsUnauthenticated('put', () => '/account/updateAccount');

      it('403s an "employee" (non-admin) caller — requireAdmin gate', async () => {
         const res = await h.as('employee').put('/account/updateAccount').send({ account: { account_id: A } });
         expect(res.status).to.equal(403);
      });

      // no :accountID in the URL, so "cross-tenant in URL" doesn't apply here —
      // covered instead by the account-1-untouchable body-injection test above.

      // Regression coverage for the DEFECT where the combined endpoint
      // synthesized is_account_active:false / a fresh created_at for whichever
      // half of the payload the caller's form didn't send, and could persist
      // one table's write while the other silently failed. The two frontend
      // forms (formObjectForUpdateAccountPost / formObjectForAccountAddressUpdate,
      // SharedPostObjects.js) each submit only their own half — these mirror
      // that real payload shape rather than the full-object bodies above.
      describe('partial-payload regressions (business-only / address-only forms)', () => {
         it('business-settings-only save (formObjectForUpdateAccountPost shape) leaves is_account_active and created_at untouched', async () => {
            const before = await db('accounts').where({ account_id: A }).first();
            expect(before.is_account_active).to.equal(true);

            const newStatement = uniqueName('COV-business-only-statement');
            const body = {
               account_name: before.account_name,
               account_type: before.account_type,
               account_statement: newStatement,
               account_interest_statement: before.account_interest_statement,
               account_invoice_template_option: before.account_invoice_template_option
               // No is_account_active, created_at, or account_information field —
               // exactly what the business-settings form sends.
            };
            const res = await h.as('admin').put('/account/updateAccount').send({ account: body });
            expect(res.status).to.equal(200);

            const after = await db('accounts').where({ account_id: A }).first();
            expect(after.account_statement).to.equal(newStatement);
            expect(after.is_account_active).to.equal(true);
            expect(String(after.created_at)).to.equal(String(before.created_at));

            // account_information must not have been touched at all.
            const infoAfter = await db('account_information').where({ account_id: A }).first();
            expect(infoAfter.account_info_id).to.equal(accountInfo9001Before.account_info_id);
            expect(infoAfter.account_street).to.equal(accountInfo9001Before.account_street);
         });

         it('address-only save (formObjectForAccountAddressUpdate shape) leaves is_account_active and created_at untouched', async () => {
            const before = await db('accounts').where({ account_id: A }).first();
            const infoBefore = await db('account_information').where({ account_id: A }).first();
            expect(before.is_account_active).to.equal(true);

            const newStreet = uniqueName('COV-address-only-street');
            const body = {
               account_info_id: infoBefore.account_info_id,
               account_street: newStreet,
               account_city: infoBefore.account_city,
               account_state: infoBefore.account_state,
               account_zip: infoBefore.account_zip,
               account_email: infoBefore.account_email,
               account_phone: infoBefore.account_phone,
               is_this_address_active: infoBefore.is_this_address_active,
               is_account_physical_address: infoBefore.is_account_physical_address,
               is_account_billing_address: infoBefore.is_account_billing_address,
               is_account_mailing_address: infoBefore.is_account_mailing_address
               // No account_name / is_account_active / any accounts-table field —
               // exactly what the address form sends.
            };
            const res = await h.as('admin').put('/account/updateAccount').send({ account: body });
            expect(res.status).to.equal(200);

            const infoAfter = await db('account_information').where({ account_info_id: infoBefore.account_info_id }).first();
            expect(infoAfter.account_street).to.equal(newStreet);

            const after = await db('accounts').where({ account_id: A }).first();
            expect(after.is_account_active).to.equal(true);
            expect(after.account_name).to.equal(before.account_name);
            expect(String(after.created_at)).to.equal(String(before.created_at));
         });

         it('address fields with a missing or invalid account_info_id → 400, and nothing is written', async () => {
            const before = await db('accounts').where({ account_id: A }).first();
            const infoBefore = await db('account_information').where({ account_id: A }).first();
            const baseAddress = {
               account_street: uniqueName('COV-should-not-persist'),
               is_this_address_active: true,
               is_account_physical_address: true,
               is_account_billing_address: true,
               is_account_mailing_address: true
            };

            const missing = await h.as('admin').put('/account/updateAccount').send({ account: baseAddress });
            expect(missing.status).to.equal(400);

            const invalid = await h.as('admin').put('/account/updateAccount').send({ account: { ...baseAddress, account_info_id: 0 } });
            expect(invalid.status).to.equal(400);

            const afterInfo = await db('account_information').where({ account_id: A }).first();
            expect(afterInfo.account_street).to.equal(infoBefore.account_street);
            const after = await db('accounts').where({ account_id: A }).first();
            expect(after.account_name).to.equal(before.account_name);
         });

         it('a well-formed but nonexistent account_info_id rolls back the account fields written in the same request (single transaction)', async () => {
            const before = await db('accounts').where({ account_id: A }).first();
            const infoBefore = await db('account_information').where({ account_id: A }).first();
            const newStatement = uniqueName('COV-should-roll-back');
            const body = {
               account_name: before.account_name,
               account_type: before.account_type,
               account_statement: newStatement,
               account_interest_statement: before.account_interest_statement,
               account_invoice_template_option: before.account_invoice_template_option,
               account_info_id: 999999999, // passes the >0-integer check but matches no real row
               account_street: uniqueName('COV-should-not-persist-either'),
               is_this_address_active: true,
               is_account_physical_address: true,
               is_account_billing_address: true,
               is_account_mailing_address: true
            };
            const res = await h.as('admin').put('/account/updateAccount').send({ account: body });
            expect(res.status).to.equal(500);

            // The account (business-fields) write ran first inside the transaction
            // and would have committed under the old two-independent-writes code —
            // proving it didn't is what proves the transaction actually rolled back.
            const after = await db('accounts').where({ account_id: A }).first();
            expect(after.account_statement).to.equal(before.account_statement);
            expect(after.account_statement).to.not.equal(newStatement);

            const infoAfter = await db('account_information').where({ account_id: A }).first();
            expect(infoAfter.account_street).to.equal(infoBefore.account_street);
         });
      });
   });

   describe('POST /account/createAccount', () => {
      it('happy path: a Super Admin can provision a brand-new account (not account 1 or 9001), proven in the DB', async () => {
         const name = uniqueName('COV-Account');
         const res = await withToken(superToken).post('/account/createAccount').send({
            account: {
               account_name: name,
               account_type: 'business',
               is_account_active: true,
               account_statement: 'stmt',
               account_interest_statement: 'interest stmt',
               account_street: '1 Coverage Way',
               account_city: 'Phoenix',
               account_state: 'AZ',
               account_zip: '85001',
               account_email: 'coverage@example.com',
               account_phone: '5551234567',
               is_this_address_active: true,
               is_account_physical_address: true,
               is_account_billing_address: true,
               is_account_mailing_address: true
            }
         });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const newId = res.body.account.returnedFields.account_id;
         expect(newId).to.be.a('number');
         createdAccountIds.push(newId);

         const row = await db('accounts').where({ account_id: newId }).first();
         expect(row.account_name).to.equal(name);
      });

      // review/full-audit-2026-09 finding 1 (Astra round 9): account-service.js's
      // createAccount now assigns storage_slug (accounts.storage_slug) at
      // creation time, mirroring migration 020's own collision rule — see
      // src/utils/storageSlug.js. sanitizeAccountName() maps every
      // non-alphanumeric character to '_' individually, so a hyphen and a
      // space are indistinguishable to it: two DIFFERENT uniqueName()-based
      // account names built by swapping one hyphen for a space sanitize to
      // the IDENTICAL base slug, exercising the real collision path through
      // the real HTTP route (not just the migration's SQL — see
      // test/scripts/migration-020.spec.js for that half).
      it('two accounts whose names sanitize to the same base slug get distinct storage_slug values — the second is suffixed with its own account_id', async () => {
         const base = uniqueName('COV-Collide');
         const collidingName = base.replace('-', ' '); // same sanitized slug as `base`, different raw string

         const create = name =>
            withToken(superToken)
               .post('/account/createAccount')
               .send({ account: { account_name: name, account_type: 'business', is_account_active: true } });

         const firstRes = await create(base);
         expect(firstRes.status).to.equal(200);
         const firstId = firstRes.body.account.returnedFields.account_id;
         createdAccountIds.push(firstId);

         const secondRes = await create(collidingName);
         expect(secondRes.status).to.equal(200);
         const secondId = secondRes.body.account.returnedFields.account_id;
         createdAccountIds.push(secondId);

         expect(secondId).to.be.greaterThan(firstId); // sequence only ever increases

         const [firstRow, secondRow] = await Promise.all([
            db('accounts').where({ account_id: firstId }).first(),
            db('accounts').where({ account_id: secondId }).first()
         ]);
         const expectedBaseSlug = sanitizeAccountName(base);
         expect(firstRow.storage_slug).to.equal(expectedBaseSlug); // lower id keeps the bare slug
         expect(secondRow.storage_slug).to.equal(`${expectedBaseSlug}_${secondId}`); // higher id is suffixed with ITS OWN id
         expect(firstRow.storage_slug).to.not.equal(secondRow.storage_slug);
      });

      // review/full-audit-2026-09 finding 3 (Astra round 10): the test above
      // proves the collision RULE is right; it says nothing about two
      // requests actually racing. Reproduced on disposable clones: two REAL
      // concurrent createAccount calls for 'R10 Race' and 'R10_Race' (which
      // sanitize to the identical base) both read "is the base taken?" as
      // false before EITHER had inserted, so both tried to insert the same
      // bare slug — one succeeded, the other 500'd on 23505. Fixed by
      // resolveNewAccountStorageSlug taking a transaction-held advisory lock
      // before picking a candidate (src/utils/storageSlug.js) plus a
      // retry-once-on-conflict in account-service.js's createAccount. Two
      // genuinely concurrent HTTP requests through the real pooled db
      // connection (pool max > 1 — see src/utils/db.js) exercise the same
      // race a single JS process's Promise.all would.
      it('two CONCURRENT create-account requests whose names sanitize to the same base slug both succeed, each with a distinct storage_slug', async () => {
         const base = uniqueName('COV-R10-Race');
         const collidingName = base.replace(/-/g, ' '); // identical sanitized slug, different raw string

         const create = name =>
            withToken(superToken)
               .post('/account/createAccount')
               .send({ account: { account_name: name, account_type: 'business', is_account_active: true } });

         const [resA, resB] = await Promise.all([create(base), create(collidingName)]);

         expect(resA.status, JSON.stringify(resA.body)).to.equal(200);
         expect(resB.status, JSON.stringify(resB.body)).to.equal(200);

         const idA = resA.body.account.returnedFields.account_id;
         const idB = resB.body.account.returnedFields.account_id;
         createdAccountIds.push(idA, idB);

         const [rowA, rowB] = await Promise.all([db('accounts').where({ account_id: idA }).first(), db('accounts').where({ account_id: idB }).first()]);

         // Which of the two wins the bare base slug is a genuine race (it
         // depends on which transaction's advisory-lock acquisition lands
         // first) — never asserted here. What must always hold: both
         // succeeded, both got a real slug, the two differ, and whichever one
         // was NOT the bare base is suffixed with ITS OWN account_id (never
         // the other's).
         const expectedBase = sanitizeAccountName(base);
         expect(rowA.storage_slug).to.not.equal(rowB.storage_slug);
         const candidates = [
            { id: idA, slug: rowA.storage_slug },
            { id: idB, slug: rowB.storage_slug }
         ];
         const bareWinners = candidates.filter(c => c.slug === expectedBase);
         const suffixedLosers = candidates.filter(c => c.slug !== expectedBase);
         expect(bareWinners, JSON.stringify(candidates)).to.have.length(1);
         expect(suffixedLosers, JSON.stringify(candidates)).to.have.length(1);
         expect(suffixedLosers[0].slug).to.equal(`${expectedBase}_${suffixedLosers[0].id}`);
      });

      // review/full-audit-2026-09 finding 4 (Astra round 10): even run
      // strictly SEQUENTIALLY (no race at all), the old code always tried
      // exactly one suffixed candidate (`${base}_${newAccountId}`) and never
      // re-checked it — so a create could still fail outright if some
      // unrelated, already-existing account's OWN bare slug happened to equal
      // that exact string. Reproduced here by directly pre-occupying the
      // slug the naive algorithm would have picked, with an unrelated row
      // inserted straight into the table (standing in for "some earlier,
      // differently-named account already happened to hold this string") —
      // the fixed resolveNewAccountStorageSlug must escalate past it to
      // `_2` instead of 500ing on a duplicate-key insert.
      it('a sequential create whose naive `_<id>` candidate is already occupied by an unrelated account escalates to `_<id>_2` instead of failing', async () => {
         const fooName = uniqueName('COV-R10-Foo');
         const fooRes = await withToken(superToken)
            .post('/account/createAccount')
            .send({ account: { account_name: fooName, account_type: 'business', is_account_active: true } });
         expect(fooRes.status, JSON.stringify(fooRes.body)).to.equal(200);
         const fooId = fooRes.body.account.returnedFields.account_id;
         createdAccountIds.push(fooId);
         const expectedBase = sanitizeAccountName(fooName);
         expect((await db('accounts').where({ account_id: fooId }).first()).storage_slug).to.equal(expectedBase);

         // Reserve the id the NEXT createAccount call will receive (nothing
         // else consumes this sequence between here and that call, since
         // mocha runs `it` blocks one at a time), and pre-occupy the exact
         // suffixed slug a naive, unchecked algorithm would compute for it —
         // standing in for an unrelated account that already held this exact
         // string before the colliding create below ever ran.
         const {
            rows: [{ id: reservedId }]
         } = await db.raw("SELECT nextval(pg_get_serial_sequence('accounts', 'account_id')) AS id");
         const occupantId = Number(reservedId);
         const nextRealId = occupantId + 1;
         const occupiedSlug = `${expectedBase}_${nextRealId}`;
         await db('accounts').insert({
            account_id: occupantId,
            account_name: uniqueName('COV-R10-Occupant'),
            account_type: 'business',
            is_account_active: true,
            storage_slug: occupiedSlug
         });
         createdAccountIds.push(occupantId);

         const collideRes = await withToken(superToken)
            .post('/account/createAccount')
            .send({ account: { account_name: fooName.replace(/-/g, ' '), account_type: 'business', is_account_active: true } });
         expect(collideRes.status, JSON.stringify(collideRes.body)).to.equal(200);
         const collideId = collideRes.body.account.returnedFields.account_id;
         createdAccountIds.push(collideId);
         expect(collideId, 'sequence prediction must hold for this test to be meaningful').to.equal(nextRealId);

         const collideRow = await db('accounts').where({ account_id: collideId }).first();
         expect(collideRow.storage_slug).to.not.equal(occupiedSlug);
         expect(collideRow.storage_slug).to.equal(`${expectedBase}_${collideId}_2`);
      });

      it('validation failure: an empty account body raises a real 500 (NOT NULL account_name)', async () => {
         const res = await withToken(superToken).post('/account/createAccount').send({ account: {} });
         expect(res.status).to.equal(500);
      });

      itRejectsUnauthenticated('post', () => '/account/createAccount');

      it('403s an "employee" caller — requireSuperAdmin gate', async () => {
         const res = await h.as('employee').post('/account/createAccount').send({ account: {} });
         expect(res.status).to.equal(403);
      });

      it('403s a plain "admin" caller — Super Admin is strictly narrower than Admin', async () => {
         const res = await h.as('admin').post('/account/createAccount').send({ account: {} });
         expect(res.status).to.equal(403);
      });

      // no :accountID in the URL (N/A cross-tenant); not-found N/A (this creates).
   });

   // =========================================================================
   // USER
   // =========================================================================

   describe('POST /user/createUser/:accountID/:userID', () => {
      afterEach(async () => {
         for (const id of createdUserIds.splice(0)) {
            await db('users').where({ account_id: A, user_id: id }).del();
         }
      });

      it('happy path: a Super Admin creates a new user, proven in the DB', async () => {
         const email = `${uniqueName('cov-createuser')}@example.com`;
         const res = await withToken(superToken).post(`/user/createUser/${A}/${SUPER_ID}`).send({
            user: { userDisplayName: 'COV New User', userEmail: email, costRate: 10, billingRate: 20, role: 'Staff', accessLevel: 'User', isActive: true }
         });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);

         const row = await db('users').where({ account_id: A, email }).first();
         expect(row, 'new user row must exist').to.exist;
         expect(row.display_name).to.equal('COV New User');
         expect(row.access_level).to.equal('User');
         createdUserIds.push(row.user_id);
      });

      // DEFECT: restoreDataTypesUserOnCreate (src/endpoints/user/userObjects.js:34)
      // computes `is_user_active: Boolean(userData.isActive) || true`, which is
      // ALWAYS true regardless of the input (Boolean(false) || true === true).
      // Verified 2026-09-23: POSTing isActive:false still inserts is_user_active
      // = true. A caller can never create a pre-deactivated user through this route.
      it('honours isActive:false on create', async () => {
         const email = `${uniqueName('cov-inactive-createuser')}@example.com`;
         const res = await withToken(superToken).post(`/user/createUser/${A}/${SUPER_ID}`).send({
            user: { userDisplayName: 'COV Inactive User', userEmail: email, costRate: 10, billingRate: 20, role: 'Staff', accessLevel: 'User', isActive: false }
         });
         expect(res.status).to.equal(200);
         const row = await db('users').where({ account_id: A, email }).first();
         createdUserIds.push(row.user_id);
         expect(row.is_user_active).to.equal(false);
      });

      it('validation failure: a non-canonical accessLevel is refused with 400 before any DB write', async () => {
         const email = `${uniqueName('cov-badrole')}@example.com`;
         const res = await withToken(superToken).post(`/user/createUser/${A}/${SUPER_ID}`).send({
            user: { userDisplayName: 'COV Bad Role', userEmail: email, costRate: 10, billingRate: 20, role: 'Staff', accessLevel: 'bogus-role' }
         });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/invalid access level/i);
         const row = await db('users').where({ account_id: A, email }).first();
         expect(row, 'no row should have been written').to.not.exist;
      });

      itRejectsUnauthenticated('post', () => `/user/createUser/${A}/${SUPER_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await withToken(superToken).post(`/user/createUser/1/21`).send({ user: {} });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireSuperAdmin gate', async () => {
         const res = await h.as('employee').post(`/user/createUser/${A}/${EMPLOYEE_ID}`).send({ user: {} });
         expect(res.status).to.equal(403);
      });

      it('403s a plain "admin" caller — Super Admin is strictly narrower than Admin', async () => {
         const res = await h.as('admin').post(`/user/createUser/${A}/${ADMIN_ID}`).send({ user: {} });
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /user/updateUser/:accountID/:userID', () => {
      const targetBody = overrides => ({
         userID: UPDATE_TARGET_ID,
         accountID: A,
         userDisplayName: 'COV Update Target',
         userEmail: UPDATE_TARGET_EMAIL,
         costRate: 10,
         billingRate: 20,
         role: 'Staff',
         accessLevel: 'User',
         isUserActive: true,
         ...overrides
      });

      it('happy path: a Super Admin updates a different user\'s record, proven in the DB', async () => {
         const res = await withToken(superToken).put(`/user/updateUser/${A}/${SUPER_ID}`).send({ user: targetBody({ billingRate: 33 }) });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const row = await db('users').where({ user_id: UPDATE_TARGET_ID, account_id: A }).first();
         expect(Number(row.billing_rate)).to.equal(33);
      });

      it('validation failure: a non-canonical accessLevel is refused with 400 and does not change the row', async () => {
         const before = await db('users').where({ user_id: UPDATE_TARGET_ID, account_id: A }).first();
         const res = await withToken(superToken).put(`/user/updateUser/${A}/${SUPER_ID}`).send({ user: targetBody({ accessLevel: 'not-a-role' }) });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/invalid access level/i);
         const after = await db('users').where({ user_id: UPDATE_TARGET_ID, account_id: A }).first();
         expect(after.access_level).to.equal(before.access_level);
      });

      it('not-found: updating a nonexistent userID silently no-ops with 200 (GAP — no 404/affected-row check)', async () => {
         const res = await withToken(superToken).put(`/user/updateUser/${A}/${SUPER_ID}`).send({ user: targetBody({ userID: 90969999 }) });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const ghost = await db('users').where({ user_id: 90969999, account_id: A }).first();
         expect(ghost, 'no row should have been created for the nonexistent target').to.not.exist;
      });

      itRejectsUnauthenticated('put', () => `/user/updateUser/${A}/${SUPER_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await withToken(superToken).put(`/user/updateUser/1/21`).send({ user: targetBody() });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireSuperAdmin gate', async () => {
         const res = await h.as('employee').put(`/user/updateUser/${A}/${EMPLOYEE_ID}`).send({ user: targetBody() });
         expect(res.status).to.equal(403);
      });

      it('403s a plain "admin" caller — Super Admin is strictly narrower than Admin', async () => {
         const res = await h.as('admin').put(`/user/updateUser/${A}/${ADMIN_ID}`).send({ user: targetBody() });
         expect(res.status).to.equal(403);
      });
   });

   describe('DELETE /user/deleteUser/:accountID/:userID', () => {
      it('happy path: a Super Admin deletes a different plain user, proven gone from the DB', async () => {
         const res = await withToken(superToken).delete(`/user/deleteUser/${A}/${DELETE_TARGET_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const row = await db('users').where({ user_id: DELETE_TARGET_ID, account_id: A }).first();
         expect(row, 'target user must be gone').to.not.exist;
      });

      it('not-found: deleting a nonexistent userID silently no-ops with 200 (GAP — no 404)', async () => {
         const res = await withToken(superToken).delete(`/user/deleteUser/${A}/90969998`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
      });

      itRejectsUnauthenticated('delete', () => `/user/deleteUser/${A}/90969997`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await withToken(superToken).delete(`/user/deleteUser/1/21`);
         expect(res.status).to.equal(403);
         // Read-only proof account 1's real super admin (21) survives.
         const stillThere = await db('users').where({ user_id: 21, account_id: 1 }).first();
         expect(stillThere).to.exist;
      });

      it('403s an "employee" caller — requireSuperAdmin gate', async () => {
         const res = await h.as('employee').delete(`/user/deleteUser/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });

      it('403s a plain "admin" caller — Super Admin is strictly narrower than Admin', async () => {
         const res = await h.as('admin').delete(`/user/deleteUser/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /user/fetchSingleUser/:accountID/:userID', () => {
      it('happy path: a caller fetches their own record and it matches the DB row', async () => {
         const res = await h.as('employee').get(`/user/fetchSingleUser/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(200);
         const dbRow = await db('users').where({ user_id: EMPLOYEE_ID, account_id: A }).first();
         expect(res.body.activeUserData.activeUser.email).to.equal(dbRow.email);
         expect(res.body.activeUserData.activeUser.display_name).to.equal(dbRow.display_name);
      });

      // DEFECT: user-router.js's fetchSingleUser (src/endpoints/user/user-router.js:159-163)
      // destructures `const [activeUser] = await accountUserService.fetchUser(...)`.
      // For a userID with no matching row, activeUser is undefined, and
      // createGrid(undefined) (src/utils/gridFunctions.js:7) does `data[0]` on
      // undefined and throws a TypeError. There is no local try/catch on this
      // route, so express-async-errors forwards it to the global handler, which
      // answers a real HTTP 500 "Cannot read properties of undefined (reading
      // '0')" instead of a clean 404. Verified 2026-09-23 with a privileged
      // (admin) caller against a nonexistent numeric userID.
      it('returns 404 for a privileged caller looking up a nonexistent userID', async () => {
         const res = await h.as('admin').get(`/user/fetchSingleUser/${A}/90969996`);
         expect(res.status).to.equal(404);
      });

      itRejectsUnauthenticated('get', () => `/user/fetchSingleUser/${A}/${EMPLOYEE_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/user/fetchSingleUser/1/21`);
         expect(res.status).to.equal(403);
      });

      // self-vs-privileged role behaviour (self OK, other-non-privileged 403,
      // privileged-other OK) is already exhaustively covered by
      // roleGates.integration.spec.js — not re-derived here.
   });

   // =========================================================================
   // AUTH
   // =========================================================================

   describe('POST /auth/google', () => {
      it('400s when the credential is missing', async () => {
         const res = await h.anonymous.post('/auth/google').send({});
         expect(res.status).to.equal(400);
         expect(res.body.error).to.match(/missing google credential/i);
      });

      it('401s when the credential is not a valid Google ID token', async () => {
         const res = await h.anonymous.post('/auth/google').send({ credential: 'not-a-real-jwt' });
         expect(res.status).to.equal(401);
         expect(res.body.status).to.equal(401);
      });

      it('carries rate-limit headers (authLimiter applies to every /auth/* route)', async () => {
         const res = await h.anonymous.post('/auth/google').send({});
         const keys = Object.keys(res.headers).filter(k => k.toLowerCase().startsWith('ratelimit'));
         expect(keys.length, `expected RateLimit-* headers, got: ${Object.keys(res.headers).join(', ')}`).to.be.greaterThan(0);
      });

      // No happy-path test: a real 200 requires a live Google-signed ID token,
      // which cannot be produced offline in this sandbox.
   });

   describe('POST /auth/renew', () => {
      it('happy path: a valid token is renewed — 200 and a fresh ds2_auth cookie is set', async () => {
         const res = await h.as('admin').post('/auth/renew');
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const setCookie = res.headers['set-cookie'] || [];
         expect(setCookie.some(c => c.startsWith('ds2_auth=') && !c.includes('ds2_auth=;'))).to.equal(true);
      });

      it('401s with no token', async () => {
         const res = await h.anonymous.post('/auth/renew');
         expect(res.status).to.equal(401);
      });

      it('401s with an expired token', async () => {
         const expired = h.mint('admin', { expiresIn: '-1s' });
         const res = await withToken(expired).post('/auth/renew');
         expect(res.status).to.equal(401);
         expect(res.body.message).to.match(/expired/i);
      });

      it('401s a stranger (unprovisioned email)', async () => {
         const res = await h.as('stranger').post('/auth/renew');
         expect(res.status).to.equal(401);
      });

      it('carries rate-limit headers', async () => {
         const res = await h.as('admin').post('/auth/renew');
         const keys = Object.keys(res.headers).filter(k => k.toLowerCase().startsWith('ratelimit'));
         expect(keys.length).to.be.greaterThan(0);
      });
   });

   describe('POST /auth/logout', () => {
      it('happy path: clears the ds2_auth cookie even with no token at all (logout needs no auth)', async () => {
         const res = await h.anonymous.post('/auth/logout');
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const setCookie = res.headers['set-cookie'] || [];
         expect(setCookie.some(c => c.startsWith('ds2_auth=') && /Expires=Thu, 01 Jan 1970/.test(c))).to.equal(true);
      });

      it('also clears the cookie when a valid token IS presented', async () => {
         const res = await h.as('admin').post('/auth/logout');
         expect(res.status).to.equal(200);
         const setCookie = res.headers['set-cookie'] || [];
         expect(setCookie.some(c => c.startsWith('ds2_auth=') && /Expires=Thu, 01 Jan 1970/.test(c))).to.equal(true);
      });

      it('carries rate-limit headers', async () => {
         const res = await h.anonymous.post('/auth/logout');
         const keys = Object.keys(res.headers).filter(k => k.toLowerCase().startsWith('ratelimit'));
         expect(keys.length).to.be.greaterThan(0);
      });
   });

   // =========================================================================
   // NOTIFICATIONS
   // =========================================================================

   describe('GET /notifications/:accountID/:userID', () => {
      let unread1, unread2, alreadyRead;

      before(async () => {
         const rows = await db('notifications')
            .insert([
               { account_id: A, user_id: EMPLOYEE_ID, type: 'coverage_test', title: uniqueName('COV-notif-unread-older'), created_at: new Date(Date.now() - 3000) },
               { account_id: A, user_id: EMPLOYEE_ID, type: 'coverage_test', title: uniqueName('COV-notif-unread-newer'), created_at: new Date(Date.now() - 1000) },
               { account_id: A, user_id: EMPLOYEE_ID, type: 'coverage_test', title: uniqueName('COV-notif-read'), read_at: new Date(Date.now() - 500), created_at: new Date(Date.now() - 2000) }
            ])
            .returning('*');
         [unread1, unread2, alreadyRead] = rows;
         createdNotificationIds.push(unread1.notification_id, unread2.notification_id, alreadyRead.notification_id);
      });

      it('happy path: lists the caller\'s own notifications, newest first, proven against the DB', async () => {
         const res = await h.as('employee').get(`/notifications/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(200);
         const titles = res.body.notifications.map(n => n.title);
         expect(titles).to.include(unread1.title);
         expect(titles).to.include(unread2.title);
         expect(titles).to.include(alreadyRead.title);
         const ourOrder = titles.filter(t => [unread1.title, unread2.title, alreadyRead.title].includes(t));
         expect(ourOrder).to.deep.equal([unread2.title, alreadyRead.title, unread1.title]);
      });

      it('unreadOnly=true filters out already-read notifications', async () => {
         const res = await h.as('employee').get(`/notifications/${A}/${EMPLOYEE_ID}?unreadOnly=true`);
         expect(res.status).to.equal(200);
         const titles = res.body.notifications.map(n => n.title);
         expect(titles).to.include(unread1.title);
         expect(titles).to.include(unread2.title);
         expect(titles).to.not.include(alreadyRead.title);
      });

      itRejectsUnauthenticated('get', () => `/notifications/${A}/${EMPLOYEE_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('employee').get(`/notifications/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" reading a DIFFERENT user\'s notifications (self-or-privileged)', async () => {
         const res = await h.as('employee').get(`/notifications/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /notifications/:accountID/:userID/unread-count', () => {
      let inserted = [];

      before(async () => {
         const rows = await db('notifications')
            .insert([
               { account_id: A, user_id: ADMIN_ID, type: 'coverage_test', title: uniqueName('COV-unreadcount-1') },
               { account_id: A, user_id: ADMIN_ID, type: 'coverage_test', title: uniqueName('COV-unreadcount-2') }
            ])
            .returning('*');
         inserted = rows;
         createdNotificationIds.push(...rows.map(r => r.notification_id));
      });

      it('happy path: count increases by exactly the number of unread rows this test added', async () => {
         const before = Number((await db('notifications').where({ account_id: A, user_id: ADMIN_ID }).whereNull('read_at').count({ c: '*' }).first()).c) - inserted.length;
         const res = await h.as('admin').get(`/notifications/${A}/${ADMIN_ID}/unread-count`);
         expect(res.status).to.equal(200);
         expect(res.body.count).to.equal(before + inserted.length);
      });

      itRejectsUnauthenticated('get', () => `/notifications/${A}/${ADMIN_ID}/unread-count`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/notifications/1/21/unread-count`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" reading a DIFFERENT user\'s unread-count (self-or-privileged)', async () => {
         const res = await h.as('employee').get(`/notifications/${A}/${ADMIN_ID}/unread-count`);
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /notifications/:notificationID/:accountID/:userID/read', () => {
      let target;

      before(async () => {
         [target] = await db('notifications')
            .insert({ account_id: A, user_id: EMPLOYEE_ID, type: 'coverage_test', title: uniqueName('COV-notif-tomark') })
            .returning('*');
         createdNotificationIds.push(target.notification_id);
      });

      it('happy path: marks the caller\'s own notification read, proven in the DB', async () => {
         const res = await h.as('employee').put(`/notifications/${target.notification_id}/${A}/${EMPLOYEE_ID}/read`);
         expect(res.status).to.equal(200);
         expect(res.body.notification.read_at).to.not.equal(null);
         const row = await db('notifications').where({ notification_id: target.notification_id }).first();
         expect(row.read_at).to.not.equal(null);
      });

      it('not-found: a nonexistent notificationID returns a clean 404', async () => {
         const res = await h.as('employee').put(`/notifications/999999999/${A}/${EMPLOYEE_ID}/read`);
         expect(res.status).to.equal(404);
      });

      itRejectsUnauthenticated('put', () => `/notifications/${target.notification_id}/${A}/${EMPLOYEE_ID}/read`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('employee').put(`/notifications/${target.notification_id}/1/21/read`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" marking read on behalf of a DIFFERENT user (self-or-privileged)', async () => {
         const res = await h.as('employee').put(`/notifications/${target.notification_id}/${A}/${ADMIN_ID}/read`);
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /notifications/:accountID/:userID/read-all', () => {
      let rows = [];

      before(async () => {
         rows = await db('notifications')
            .insert([
               { account_id: A, user_id: EMPLOYEE_ID, type: 'coverage_test', title: uniqueName('COV-readall-1') },
               { account_id: A, user_id: EMPLOYEE_ID, type: 'coverage_test', title: uniqueName('COV-readall-2') }
            ])
            .returning('*');
         createdNotificationIds.push(...rows.map(r => r.notification_id));
      });

      it('happy path: marks every one of the caller\'s unread notifications read, proven in the DB', async () => {
         const res = await h.as('employee').put(`/notifications/${A}/${EMPLOYEE_ID}/read-all`);
         expect(res.status).to.equal(200);
         const stillUnread = await db('notifications')
            .whereIn('notification_id', rows.map(r => r.notification_id))
            .whereNull('read_at');
         expect(stillUnread).to.have.length(0);
      });

      itRejectsUnauthenticated('put', () => `/notifications/${A}/${EMPLOYEE_ID}/read-all`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('employee').put(`/notifications/1/21/read-all`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" marking another user\'s notifications read-all (self-or-privileged)', async () => {
         const res = await h.as('employee').put(`/notifications/${A}/${ADMIN_ID}/read-all`);
         expect(res.status).to.equal(403);
      });
   });

   // =========================================================================
   // HEALTH
   // =========================================================================

   describe('GET /healthz', () => {
      it('happy path: 200 ok, no auth required, no DB probe', async () => {
         const res = await h.anonymous.get('/healthz');
         expect(res.status).to.equal(200);
         expect(res.body).to.deep.equal({ status: 'ok' });
      });
   });

   describe('GET /healthz/check', () => {
      it('happy path: 200 with a real DB probe against the sandbox', async () => {
         const res = await h.anonymous.get('/healthz/check');
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal('ok');
         expect(res.body.db).to.equal('ok');
      });
   });

   describe('GET /api/health/check', () => {
      it('happy path: 200 with a real DB probe against the sandbox (same handler, different mount)', async () => {
         const res = await h.anonymous.get('/api/health/check');
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal('ok');
         expect(res.body.db).to.equal('ok');
      });
   });

   // =========================================================================
   // INITIALDATA
   // =========================================================================

   describe('GET /initialData/initialBlob/:accountID/:userID', () => {
      // Field-stripping (cost_rate/billing_rate/email for non-privileged
      // callers) and payload-shape stability are already exhaustively covered
      // by initialDataUserFields.integration.spec.js — only the auth
      // categories are added here.
      it('happy path (light): 200 with the customersList key present', async () => {
         const res = await h.as('admin').get(`/initialData/initialBlob/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body).to.have.property('customersList');
      });

      itRejectsUnauthenticated('get', () => `/initialData/initialBlob/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/initialData/initialBlob/1/21`);
         expect(res.status).to.equal(403);
      });

      // No role gate on this route by design (every authenticated role needs
      // the app shell) — not re-tested here.
   });

   // =========================================================================
   // RECURRINGCUSTOMER
   // =========================================================================

   describe('POST /recurringCustomer/createRecurringCustomer/:accountID/:userID', () => {
      let customerId;

      before(async () => {
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: uniqueName('COV-RC-Customer'), display_name: uniqueName('COV-RC-Customer'), is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false })
            .returning('*');
         customerId = cust.customer_id;
         createdCustomerIds.push(customerId);
         await db('customer_information').insert({
            account_id: A, customer_id: customerId, is_this_address_active: true,
            is_customer_physical_address: true, is_customer_billing_address: true, is_customer_mailing_address: true,
            created_by_user_id: ADMIN_ID
         });
      });

      it('happy path: honours the chosen start date and active flag, proven in the DB', async () => {
         const res = await h.as('admin').post(`/recurringCustomer/createRecurringCustomer/${A}/${ADMIN_ID}`).send({
            recurringCustomer: { customerID: customerId, subscriptionFrequency: 'Monthly', billingCycle: 1, recurringAmount: 100, startDate: '2026-01-15', isActive: true, userID: ADMIN_ID }
         });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);

         const row = await db('recurring_customers').where({ account_id: A, customer_id: customerId }).first();
         expect(row, 'recurring_customers row must exist').to.exist;
         expect(row.is_recurring_customer_active).to.equal(true);
         // pg returns a DATE column as a JS Date; String(date) gives a verbose
         // locale form ("Thu Jan 15 2026 ..."), so compare via ISO instead.
         expect(new Date(row.start_date).toISOString().slice(0, 10)).to.equal('2026-01-15');

         const custRow = await db('customers').where({ customer_id: customerId }).first();
         expect(custRow.is_recurring, 'customers.is_recurring must flip true as a side effect').to.equal(true);
      });

      it('validation failure: a missing customerID raises a real 500 (no request-shape guard before the DB)', async () => {
         const res = await h.as('admin').post(`/recurringCustomer/createRecurringCustomer/${A}/${ADMIN_ID}`).send({
            recurringCustomer: { subscriptionFrequency: 'Monthly', billingCycle: 1, recurringAmount: 100, userID: ADMIN_ID }
         });
         expect(res.status).to.equal(500);
      });

      itRejectsUnauthenticated('post', () => `/recurringCustomer/createRecurringCustomer/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').post(`/recurringCustomer/createRecurringCustomer/1/21`).send({ recurringCustomer: {} });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').post(`/recurringCustomer/createRecurringCustomer/${A}/${EMPLOYEE_ID}`).send({ recurringCustomer: {} });
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID', () => {
      let customerId, recurringId;

      before(async () => {
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: uniqueName('COV-RC-List-Customer'), display_name: uniqueName('COV-RC-List-Customer'), is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false })
            .returning('*');
         customerId = cust.customer_id;
         createdCustomerIds.push(customerId);
         await db('customer_information').insert({
            account_id: A, customer_id: customerId, is_this_address_active: true,
            is_customer_physical_address: true, is_customer_billing_address: true, is_customer_mailing_address: true,
            created_by_user_id: ADMIN_ID
         });
         const [rc] = await db('recurring_customers').insert({
            account_id: A, customer_id: customerId, subscription_frequency: 'Monthly', bill_on_date: 1,
            recurring_bill_amount: 50, start_date: '2026-02-01', is_recurring_customer_active: true, created_by_user_id: ADMIN_ID
         }).returning('*');
         recurringId = rc.recurring_customer_id;
      });

      it('happy path: the list includes the fixture row just inserted', async () => {
         const res = await h.as('admin').get(`/recurringCustomer/getActiveRecurringCustomers/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200);
         const ids = res.body.activeRecurringCustomersData.activeRecurringCustomers.map(r => r.recurring_customer_id);
         expect(ids).to.include(recurringId);
      });

      itRejectsUnauthenticated('get', () => `/recurringCustomer/getActiveRecurringCustomers/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/recurringCustomer/getActiveRecurringCustomers/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').get(`/recurringCustomer/getActiveRecurringCustomers/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /recurringCustomer/updateRecurringCustomer', () => {
      let customerId, recurringId;

      before(async () => {
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: uniqueName('COV-RC-Update-Customer'), display_name: uniqueName('COV-RC-Update-Customer'), is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: true })
            .returning('*');
         customerId = cust.customer_id;
         createdCustomerIds.push(customerId);
         await db('customer_information').insert({
            account_id: A, customer_id: customerId, is_this_address_active: true,
            is_customer_physical_address: true, is_customer_billing_address: true, is_customer_mailing_address: true,
            created_by_user_id: ADMIN_ID
         });
         const [rc] = await db('recurring_customers').insert({
            account_id: A, customer_id: customerId, subscription_frequency: 'Monthly', bill_on_date: 1,
            recurring_bill_amount: 50, start_date: '2026-02-01', is_recurring_customer_active: true, created_by_user_id: ADMIN_ID
         }).returning('*');
         recurringId = rc.recurring_customer_id;
      });

      // DEFECT: the route (src/endpoints/recurringCustomer/recurringCustomer-router.js
      // updateRecurringCustomer handler) calls
      // `restoreDataTypesRecurringCustomerTableOnUpdate(sanitizedUpdatedRecurringCustomer)`
      // with only ONE argument, but the mapper's signature is `(data, customer_id)`
      // and sets `customer_id: Number(customer_id)`. With no second argument,
      // customer_id is always NaN, and Postgres rejects NaN for an integer
      // column — so this endpoint 500s on every call, valid or not. Verified
      // 2026-09-23: "invalid input syntax for type integer: NaN". Contrast with
      // customer-router.js's updateCustomer handler, which correctly calls the
      // SAME mapper as `restoreDataTypesRecurringCustomerTableOnUpdate(sanitizedUpdatedCustomer, customerID)`.
      it('updates a recurring customer\'s billing amount', async () => {
         const res = await h.as('admin').put('/recurringCustomer/updateRecurringCustomer').send({
            recurringCustomer: { recurringCustomerID: recurringId, subscriptionFrequency: 'Monthly', billingCycle: 1, recurringAmount: 175, userID: ADMIN_ID }
         });
         expect(res.status).to.equal(200);
         const row = await db('recurring_customers').where({ recurring_customer_id: recurringId }).first();
         expect(Number(row.recurring_bill_amount)).to.equal(175);
      });

      itRejectsUnauthenticated('put', () => '/recurringCustomer/updateRecurringCustomer');

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').put('/recurringCustomer/updateRecurringCustomer').send({ recurringCustomer: {} });
         expect(res.status).to.equal(403);
      });

      // no :accountID in the URL (N/A cross-tenant) — account_id is forced
      // server-side to req.user.account_id either way, and the DEFECT test
      // above is itself the strongest possible proof account 1 is unreachable
      // through this route: every call fails before any write is attempted.
   });

   describe('DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId', () => {
      let customerId, recurringId;

      beforeEach(async () => {
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: uniqueName('COV-RC-Delete-Customer'), display_name: uniqueName('COV-RC-Delete-Customer'), is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: true })
            .returning('*');
         customerId = cust.customer_id;
         createdCustomerIds.push(customerId);
         await db('customer_information').insert({
            account_id: A, customer_id: customerId, is_this_address_active: true,
            is_customer_physical_address: true, is_customer_billing_address: true, is_customer_mailing_address: true,
            created_by_user_id: ADMIN_ID
         });
         const [rc] = await db('recurring_customers').insert({
            account_id: A, customer_id: customerId, subscription_frequency: 'Monthly', bill_on_date: 1,
            recurring_bill_amount: 50, start_date: '2026-02-01', is_recurring_customer_active: true, created_by_user_id: ADMIN_ID
         }).returning('*');
         recurringId = rc.recurring_customer_id;
      });

      it('happy path: soft-deletes (is_recurring_customer_active -> false), proven in the DB', async () => {
         const res = await h.as('admin').delete(`/recurringCustomer/deleteRecurringCustomer/${A}/${recurringId}`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         const row = await db('recurring_customers').where({ recurring_customer_id: recurringId }).first();
         expect(row.is_recurring_customer_active).to.equal(false);
         // Note (RISK, minor inconsistency): unlike customer-router.js's
         // updateCustomer path (which stamps end_date: dayjs().format() when it
         // turns recurring off), this dedicated delete route only flips
         // is_recurring_customer_active — end_date is left exactly as it was.
      });

      it('returns a clean 404 for a nonexistent recurringCustomerId', async () => {
         const res = await h.as('admin').delete(`/recurringCustomer/deleteRecurringCustomer/${A}/999999999`);
         expect(res.status).to.equal(404);
      });

      itRejectsUnauthenticated('delete', () => `/recurringCustomer/deleteRecurringCustomer/${A}/${recurringId}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').delete(`/recurringCustomer/deleteRecurringCustomer/1/1`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').delete(`/recurringCustomer/deleteRecurringCustomer/${A}/${recurringId}`);
         expect(res.status).to.equal(403);
      });
   });

   // =========================================================================
   // TIMETRACKERSTAFF
   // =========================================================================

   describe('GET /time-tracker-staff/:accountID/:userID', () => {
      it('happy path: the seeded staff row (90013) is present with the expected shape', async () => {
         const res = await h.as('admin').get(`/time-tracker-staff/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body).to.have.all.keys('staff', 'availableUsers', 'activeStaffUserIds');
         expect(res.body.activeStaffUserIds).to.include(ADMIN_ID);
      });

      itRejectsUnauthenticated('get', () => `/time-tracker-staff/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/time-tracker-staff/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').get(`/time-tracker-staff/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('POST /time-tracker-staff/:accountID/:userID', () => {
      before(async () => {
         await db('users')
            .insert({ user_id: TTS_CREATE_USER_ID, account_id: A, email: TTS_CREATE_USER_EMAIL, display_name: 'COV TTS Create', job_title: 'Staff', access_level: 'User', is_user_active: true })
            .onConflict('user_id')
            .merge();
      });

      it('happy path: adds a user as time-tracker staff, proven in the DB (201)', async () => {
         const res = await h.as('admin').post(`/time-tracker-staff/${A}/${ADMIN_ID}`).send({ userIds: [TTS_CREATE_USER_ID] });
         expect(res.status).to.equal(201);
         expect(res.body.activeStaffUserIds).to.include(TTS_CREATE_USER_ID);
         const row = await db('time_tracker_staff').where({ user_id: TTS_CREATE_USER_ID }).first();
         expect(row).to.exist;
         expect(row.is_active).to.equal(true);
      });

      it('validation failure: an empty userIds array is refused with 400', async () => {
         const res = await h.as('admin').post(`/time-tracker-staff/${A}/${ADMIN_ID}`).send({ userIds: [] });
         expect(res.status).to.equal(400);
      });

      itRejectsUnauthenticated('post', () => `/time-tracker-staff/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').post(`/time-tracker-staff/1/21`).send({ userIds: [TTS_CREATE_USER_ID] });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').post(`/time-tracker-staff/${A}/${EMPLOYEE_ID}`).send({ userIds: [TTS_CREATE_USER_ID] });
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /time-tracker-staff/:accountID/:userID/:staffID', () => {
      let staffId;

      before(async () => {
         await db('users')
            .insert({ user_id: TTS_UPDATE_USER_ID, account_id: A, email: TTS_UPDATE_USER_EMAIL, display_name: 'COV TTS Update', job_title: 'Staff', access_level: 'User', is_user_active: true })
            .onConflict('user_id')
            .merge();
         const [row] = await db('time_tracker_staff').insert({ user_id: TTS_UPDATE_USER_ID, is_active: true }).onConflict('user_id').merge().returning('*');
         staffId = row.id;
      });

      it('happy path: toggles is_active, proven in the DB', async () => {
         const res = await h.as('admin').put(`/time-tracker-staff/${A}/${ADMIN_ID}/${staffId}`).send({ isActive: false });
         expect(res.status).to.equal(200);
         const row = await db('time_tracker_staff').where({ id: staffId }).first();
         expect(row.is_active).to.equal(false);
      });

      it('validation failure: a non-boolean isActive is refused with 400', async () => {
         const res = await h.as('admin').put(`/time-tracker-staff/${A}/${ADMIN_ID}/${staffId}`).send({ isActive: 'nope' });
         expect(res.status).to.equal(400);
      });

      it('not-found: a nonexistent staffID silently no-ops with 200 (GAP — no 404)', async () => {
         const res = await h.as('admin').put(`/time-tracker-staff/${A}/${ADMIN_ID}/999999999`).send({ isActive: true });
         expect(res.status).to.equal(200);
      });

      itRejectsUnauthenticated('put', () => `/time-tracker-staff/${A}/${ADMIN_ID}/${staffId}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').put(`/time-tracker-staff/1/21/${staffId}`).send({ isActive: true });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').put(`/time-tracker-staff/${A}/${EMPLOYEE_ID}/${staffId}`).send({ isActive: true });
         expect(res.status).to.equal(403);
      });
   });

   describe('DELETE /time-tracker-staff/:accountID/:userID/:staffID', () => {
      let staffId;

      before(async () => {
         await db('users')
            .insert({ user_id: TTS_DELETE_USER_ID, account_id: A, email: TTS_DELETE_USER_EMAIL, display_name: 'COV TTS Delete', job_title: 'Staff', access_level: 'User', is_user_active: true })
            .onConflict('user_id')
            .merge();
         const [row] = await db('time_tracker_staff').insert({ user_id: TTS_DELETE_USER_ID, is_active: true }).onConflict('user_id').merge().returning('*');
         staffId = row.id;
      });

      it('happy path: removes the staff row, proven in the DB', async () => {
         const res = await h.as('admin').delete(`/time-tracker-staff/${A}/${ADMIN_ID}/${staffId}`);
         expect(res.status).to.equal(200);
         const row = await db('time_tracker_staff').where({ id: staffId }).first();
         expect(row).to.not.exist;
      });

      it('not-found: a nonexistent staffID silently no-ops with 200 (GAP — no 404)', async () => {
         const res = await h.as('admin').delete(`/time-tracker-staff/${A}/${ADMIN_ID}/999999999`);
         expect(res.status).to.equal(200);
      });

      itRejectsUnauthenticated('delete', () => `/time-tracker-staff/${A}/${ADMIN_ID}/999999998`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').delete(`/time-tracker-staff/1/21/999999998`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').delete(`/time-tracker-staff/${A}/${EMPLOYEE_ID}/999999998`);
         expect(res.status).to.equal(403);
      });
   });

   // =========================================================================
   // CUSTOMER (routes not already covered by customerCrud.integration.spec.js)
   // =========================================================================

   describe('GET /customer/activeCustomers/:accountID/:userID', () => {
      it('happy path: paginated, includes the seeded Acme fixture, correct pagination metadata', async () => {
         const res = await h.as('admin').get(`/customer/activeCustomers/${A}/${ADMIN_ID}?page=1&limit=50`);
         expect(res.status).to.equal(200);
         const { activeCustomers, pagination } = res.body.customersList.activeCustomerData;
         expect(activeCustomers.map(c => c.customer_id)).to.include(900101);
         expect(pagination.page).to.equal(1);
         expect(pagination.limit).to.equal(50);
         expect(pagination.totalItems).to.be.at.least(activeCustomers.length);
      });

      it('search proof: ?search=Acme finds the fixture customer; a non-matching term finds nothing', async () => {
         const hit = await h.as('admin').get(`/customer/activeCustomers/${A}/${ADMIN_ID}?search=Acme`);
         expect(hit.status).to.equal(200);
         expect(hit.body.customersList.activeCustomerData.activeCustomers.map(c => c.customer_id)).to.include(900101);

         const miss = await h.as('admin').get(`/customer/activeCustomers/${A}/${ADMIN_ID}?search=zzz-no-such-customer-zzz`);
         expect(miss.status).to.equal(200);
         expect(miss.body.customersList.activeCustomerData.activeCustomers).to.have.length(0);
      });

      it('validation failure: a negative page number is refused with 400', async () => {
         const res = await h.as('admin').get(`/customer/activeCustomers/${A}/${ADMIN_ID}?page=-1`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/invalid pagination/i);
      });

      itRejectsUnauthenticated('get', () => `/customer/activeCustomers/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/customer/activeCustomers/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').get(`/customer/activeCustomers/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID', () => {
      it('happy path: returns the full customer profile bundle for the seeded Acme fixture', async () => {
         const res = await h.as('admin').get(`/customer/activeCustomers/customerByID/${A}/${ADMIN_ID}/900101`);
         expect(res.status).to.equal(200);
         expect(res.body.customerData.customerData.customer_id).to.equal(900101);
         expect(res.body.customerRetainerData).to.have.property('customerRetainers');
         expect(res.body.customerPaymentData).to.have.property('customerPayments');
         expect(res.body.customerInvoiceData).to.have.property('customerInvoices');
         expect(res.body.customerTransactionData).to.have.property('customerTransactions');
         expect(res.body.customerJobData).to.have.property('customerJobs');
      });

      // DEFECT: customer-router.js's customerByID handler (src/endpoints/customer/customer-router.js:125-136)
      // destructures `const [[customerContactData], ...] = await Promise.all([...])`.
      // For a customerID with no matching row, customerContactData is undefined,
      // and `createGrid(customerContactData)` (src/utils/gridFunctions.js:7) does
      // `data[0]` on undefined and throws a TypeError. The route's own catch
      // block reports this as a generic HTTP-200-with-body-500 "Cannot read
      // properties of undefined (reading '0')" instead of a clean 404. Verified
      // 2026-09-23 against a privileged (admin) caller with a nonexistent numeric
      // customerID.
      it('returns 404 for a nonexistent customerID', async () => {
         const res = await h.as('admin').get(`/customer/activeCustomers/customerByID/${A}/${ADMIN_ID}/999999999`);
         expect(res.status).to.equal(404);
      });

      itRejectsUnauthenticated('get', () => `/customer/activeCustomers/customerByID/${A}/${ADMIN_ID}/900101`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').get(`/customer/activeCustomers/customerByID/1/21/900101`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').get(`/customer/activeCustomers/customerByID/${A}/${EMPLOYEE_ID}/900101`);
         expect(res.status).to.equal(403);
      });
   });

   describe('PUT /customer/updateCustomer/:accountID/:userID (deactivate -> warnings[])', () => {
      let customerId, infoId;

      beforeEach(async () => {
         const name = uniqueName('COV-Deactivate-Customer');
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: name, display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false })
            .returning('*');
         customerId = cust.customer_id;
         createdCustomerIds.push(customerId);
         const [info] = await db('customer_information').insert({
            account_id: A, customer_id: customerId, is_this_address_active: true,
            is_customer_physical_address: true, is_customer_billing_address: true, is_customer_mailing_address: true,
            created_by_user_id: ADMIN_ID
         }).returning('*');
         infoId = info.customer_info_id;
      });

      const deactivateBody = () => ({
         customerID: customerId,
         accountID: A,
         customerInfoID: infoId,
         userID: ADMIN_ID,
         customerFirstName: 'Fixture',
         customerLastName: uniqueName('COV-Deactivated'),
         customerName: uniqueName('COV-Deactivated'),
         isCommercialCustomer: false,
         isCustomerActive: false,
         isCustomerBillable: true,
         isCustomerRecurring: false,
         isCustomerAddressActive: true,
         isCustomerPhysicalAddress: true,
         isCustomerBillingAddress: true,
         isCustomerMailingAddress: true
      });

      it('happy path: deactivating a clean customer (no balance/unbilled work) succeeds with an empty warnings array', async () => {
         const res = await h.as('admin').put(`/customer/updateCustomer/${A}/${ADMIN_ID}`).send({ customer: deactivateBody() });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(res.body.warnings).to.deep.equal([]);
         const row = await db('customers').where({ customer_id: customerId }).first();
         expect(row.is_customer_active).to.equal(false);
      });

      it('not-found: a nonexistent customerID silently no-ops with 200 (GAP — no 404/affected-row check)', async () => {
         const res = await h.as('admin').put(`/customer/updateCustomer/${A}/${ADMIN_ID}`).send({
            customer: { ...deactivateBody(), customerID: 999999999, customerInfoID: 999999999 }
         });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
      });

      itRejectsUnauthenticated('put', () => `/customer/updateCustomer/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').put(`/customer/updateCustomer/1/21`).send({ customer: deactivateBody() });
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').put(`/customer/updateCustomer/${A}/${EMPLOYEE_ID}`).send({ customer: deactivateBody() });
         expect(res.status).to.equal(403);
      });
   });

   describe('DELETE /customer/deleteCustomer/:customerID/:accountID/:userID (refusal with linked rows)', () => {
      let customerId;

      before(async () => {
         const name = uniqueName('COV-DeleteRefusal-Customer');
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: name, display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false })
            .returning('*');
         customerId = cust.customer_id;
         createdCustomerIds.push(customerId);
         await db('customer_information').insert({
            account_id: A, customer_id: customerId, is_this_address_active: true,
            is_customer_physical_address: true, is_customer_billing_address: true, is_customer_mailing_address: true,
            created_by_user_id: ADMIN_ID
         });
         // Linked row type deliberately different from customerCrud.integration.spec.js
         // (which covers the write-offs guard) — this one exercises the jobs guard.
         await db('customer_jobs').insert({ account_id: A, customer_id: customerId, job_type_id: 900201, is_quote: false, created_by_user_id: ADMIN_ID });
      });

      it('happy path: refuses to delete a customer with a linked job, customer survives', async () => {
         const res = await h.as('admin').delete(`/customer/deleteCustomer/${customerId}/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200); // body-level failure convention
         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.match(/jobs/i);
         const row = await db('customers').where({ customer_id: customerId }).first();
         expect(row, 'customer must not have been deleted').to.exist;
      });

      it('not-found: a nonexistent customerID returns a clean 404 envelope', async () => {
         const res = await h.as('admin').delete(`/customer/deleteCustomer/999999999/${A}/${ADMIN_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(404);
         expect(res.body.message).to.equal('No matching customer record found.');
      });

      it('refuses to delete a customer with a recurring-billing row (guard keyed by customer_id, not recurring_customer_id), then deletes once it is gone', async () => {
         const name = uniqueName('COV-DeleteRefusal-Recurring');
         const [cust] = await db('customers')
            .insert({ account_id: A, business_name: null, customer_name: name, display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: true })
            .returning('*');
         createdCustomerIds.push(cust.customer_id);
         const [recurring] = await db('recurring_customers')
            .insert({ account_id: A, customer_id: cust.customer_id, subscription_frequency: 'Monthly', bill_on_date: 1, recurring_bill_amount: 100, start_date: '2026-01-15', is_recurring_customer_active: true, created_by_user_id: ADMIN_ID })
            .returning('*');
         // The recurring row's own id never equals the customer id here, which is
         // exactly the case the old guard missed.
         expect(recurring.recurring_customer_id).to.not.equal(cust.customer_id);

         const refused = await h.as('admin').delete(`/customer/deleteCustomer/${cust.customer_id}/${A}/${ADMIN_ID}`);
         expect(refused.body.status).to.equal(500);
         expect(refused.body.message).to.match(/recurring/i);
         expect(await db('customers').where({ customer_id: cust.customer_id }).first(), 'customer must survive').to.exist;

         await db('recurring_customers').where({ recurring_customer_id: recurring.recurring_customer_id }).delete();
         const deleted = await h.as('admin').delete(`/customer/deleteCustomer/${cust.customer_id}/${A}/${ADMIN_ID}`);
         expect(deleted.status).to.equal(200);
         expect(deleted.body.status).to.equal(200);
         expect(await db('customers').where({ customer_id: cust.customer_id }).first()).to.equal(undefined);
      });

      itRejectsUnauthenticated('delete', () => `/customer/deleteCustomer/${customerId}/${A}/${ADMIN_ID}`);

      it('403s when the URL account is not the caller\'s own (cross-tenant)', async () => {
         const res = await h.as('admin').delete(`/customer/deleteCustomer/${customerId}/1/21`);
         expect(res.status).to.equal(403);
      });

      it('403s an "employee" caller — requireManagerOrAdmin gate', async () => {
         const res = await h.as('employee').delete(`/customer/deleteCustomer/${customerId}/${A}/${EMPLOYEE_ID}`);
         expect(res.status).to.equal(403);
      });
   });
});
