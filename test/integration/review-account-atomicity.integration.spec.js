const { bootHttp, uniqueName, expectEnvelopeOk } = require('./_http');
const service = require('../../src/endpoints/account/automation-settings-service');
const accountService = require('../../src/endpoints/account/account-service');

describe('F19 atomic automation settings', function () {
   let h, settings, recipients;
   const key = 'thursday_reminder_emails';
   before(async function () {
      h = await bootHttp.call(this);
      settings = await h.db('account_automation_settings').where({ account_id: 9001 });
      recipients = await h.db('account_automation_recipients').where({ account_id: 9001 });
   });
   beforeEach(async () => { await service.updateAutomationSetting(h.db, 9001, key, { isEnabled: false, recipientUserIds: [90011] }); });
   after(async () => {
      if (!h) return;
      await h.db('account_automation_recipients').where({ account_id: 9001 }).del();
      await h.db('account_automation_settings').where({ account_id: 9001 }).del();
      if (settings.length) await h.db('account_automation_settings').insert(settings);
      if (recipients.length) await h.db('account_automation_recipients').insert(recipients);
      await h.close();
   });
   const state = async () => ({ enabled: (await h.db('account_automation_settings').where({ account_id: 9001, automation_key: key }).first()).is_enabled, recipients: await service.getRecipientUserIds(h.db, 9001, key) });
   it('keeps enabled and recipients unchanged when a foreign recipient is rejected', async () => {
      const res = await h.as('admin').put('/account/automations/9001/90013').send({ automationKey: key, isEnabled: true, recipientUserIds: [21] });
      expect(res.status).to.equal(400);
      expect(await state()).to.deep.equal({ enabled: false, recipients: [90011] });
   });
   it('rolls back both settings when a later replacement write fails', async () => {
      const replace = service.replaceAutomationRecipients; let res;
      try {
         service.replaceAutomationRecipients = async (...args) => { await replace.apply(service, args); throw new Error('F19 replacement failure'); };
         res = await h.as('admin').put('/account/automations/9001/90013').send({ automationKey: key, isEnabled: true, recipientUserIds: [90013] });
      } finally { service.replaceAutomationRecipients = replace; }
      expect(res.status).to.equal(500);
      expect(await state()).to.deep.equal({ enabled: false, recipients: [90011] });
   });
});

describe('F20 atomic account provisioning', function () {
   let h, actor, token; const names = [];
   before(async function () {
      h = await bootHttp.call(this);
      [actor] = await h.db('users').insert({ account_id: 9001, email: `${uniqueName('F20')}@example.com`, display_name: 'F20 fixture', job_title: 'Fixture', access_level: 'Super Admin', is_user_active: true }).returning('*');
      token = h.mint('admin', { user_id: actor.user_id, email: actor.email });
   });
   after(async () => {
      if (!h) return;
      const ids = (await h.db('accounts').whereIn('account_name', names)).map(r => r.account_id).filter(id => id !== 1 && id !== 9001);
      await h.db('account_information').whereIn('account_id', ids).del();
      await h.db('accounts').whereIn('account_id', ids).del();
      await h.db('users').where({ account_id: 9001, user_id: actor.user_id }).del();
      await h.close();
   });
   const create = account => h.request.post('/account/createAccount').set('Authorization', `Bearer ${token}`).send({ account });
   it('rejects an overlength address without reserving an account or slug', async () => {
      const name = uniqueName('F20-address'); names.push(name);
      const res = await create({ account_name: name, account_type: 'Business', is_account_active: true, account_state: 'Arizona' });
      expect(await h.db('accounts').where({ account_name: name })).to.have.lengthOf(0);
      expect(res.status).to.equal(400);
   });
   it('rolls back account/slug when address persistence fails after validation', async () => {
      const name = uniqueName('F20-rollback'); names.push(name);
      const insert = accountService.createAccountInformation; let res;
      try {
         accountService.createAccountInformation = async () => { throw new Error('F20 address write failed'); };
         res = await create({ account_name: name, account_type: 'Business', is_account_active: true, account_state: 'AZ' });
      } finally { accountService.createAccountInformation = insert; }
      expect(res.status).to.equal(500);
      expect(await h.db('accounts').where({ account_name: name })).to.have.lengthOf(0);
      expectEnvelopeOk(await create({ account_name: name, account_type: 'Business', is_account_active: true, account_state: 'AZ' }));
      const rows = await h.db('accounts').where({ account_name: name });
      expect(rows).to.have.lengthOf(1);
      expect(await h.db('account_information').where({ account_id: rows[0].account_id })).to.have.lengthOf(1);
   });
});
