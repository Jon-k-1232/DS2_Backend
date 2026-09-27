const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { environmentSwitchEnabled } = require('../src/utils/environmentSwitches');

// Load actual callers/sender with isolated dependencies, restoring the process
// cache immediately. No fake can leak into another spec in the full unit run.
const fresh = (relative, stubs = {}) => {
   const filename = require.resolve(path.resolve(__dirname, '..', relative));
   const previous = require.cache[filename];
   const load = Module._load;
   delete require.cache[filename];
   Module._load = function (request, parent, isMain) {
      if (parent?.filename === filename && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      return load.call(this, request, parent, isMain);
   };
   try { return require(filename); }
   finally {
      Module._load = load;
      delete require.cache[filename];
      if (previous) require.cache[filename] = previous;
   }
};

describe('H0 email and scheduled automation switches', () => {
   const keys = ['NODE_ENV', 'SEND_REAL_EMAIL', 'RUN_SCHEDULED_AUTOMATIONS', 'EMAIL_OUTBOX_DIR'];
   let savedEnv, savedConsole, logs, warnings, temporaryDirectory, constructed, commands, sender, sesError;
   const suppressed = () => logs.filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(row => row.event === 'email_suppressed');
   const makeSender = (from = 'sender@example.invalid') => fresh('src/utils/email/sendEmail.js', {
      '../../../config': { FROM_EMAIL: from },
      '@aws-sdk/client-ses': {
         SESClient: class {
            constructor() { constructed += 1; }
            async send(command) {
               commands.push(command.input);
               if (sesError) throw sesError;
               return { MessageId: 'stubbed-message-id' };
            }
         },
         SendEmailCommand: class { constructor(input) { this.input = input; } }
      }
   });
   const message = { recipientEmails: 'staff@example.invalid', subject: 'Synthetic notice', body: 'Synthetic body' };

   beforeEach(() => {
      savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
      process.env.NODE_ENV = 'test';
      process.env.SEND_REAL_EMAIL = 'false';
      process.env.RUN_SCHEDULED_AUTOMATIONS = 'false';
      delete process.env.EMAIL_OUTBOX_DIR;
      logs = []; warnings = []; commands = []; constructed = 0; sesError = null;
      savedConsole = { log: console.log, warn: console.warn, error: console.error };
      console.log = (...args) => logs.push(args.join(' '));
      console.warn = (...args) => warnings.push(args.join(' '));
      console.error = (...args) => warnings.push(args.join(' '));
      sender = makeSender();
   });
   afterEach(() => {
      keys.forEach(key => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; });
      Object.assign(console, savedConsole);
      if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
   });

   for (const name of ['SEND_REAL_EMAIL', 'RUN_SCHEDULED_AUTOMATIONS']) {
      for (const nodeEnv of ['production', 'development', 'test', undefined]) {
         for (const value of [undefined, 'true', 'false']) {
            const expected = value === 'true' || (nodeEnv === 'production' && value !== 'false');
            it(`${name}: ${nodeEnv || 'unset environment'}, ${value || 'unset flag'} => ${expected}`, () => {
               expect(environmentSwitchEnabled(name, { NODE_ENV: nodeEnv, [name]: value })).to.equal(expected);
            });
         }
      }
      it(`${name}: empty/malformed flags use the environment default, not truthiness`, () => {
         for (const value of ['', 'FALSE', 'TRUE', ' false ', ' true ', '0', '1', 'yes']) {
            expect(environmentSwitchEnabled(name, { NODE_ENV: 'production', [name]: value })).to.equal(true);
            expect(environmentSwitchEnabled(name, { NODE_ENV: 'staging', [name]: value })).to.equal(false);
         }
         expect(environmentSwitchEnabled(name, { NODE_ENV: 'Production' })).to.equal(false);
      });
   }

   for (const [nodeEnv, value, enabled] of [
      ['production', undefined, true], ['production', 'false', false], ['production', 'true', true],
      ['development', undefined, false], ['development', 'false', false], ['development', 'true', true]
   ]) {
      it(`actual sender honors ${nodeEnv}/${value || 'default'} without a real SES client`, async () => {
         process.env.NODE_ENV = nodeEnv;
         if (value === undefined) delete process.env.SEND_REAL_EMAIL; else process.env.SEND_REAL_EMAIL = value;
         const result = await sender.sendEmail(message);
         expect(constructed).to.equal(enabled ? 1 : 0);
         expect(commands).to.have.length(enabled ? 1 : 0);
         expect(suppressed()).to.have.length(enabled ? 0 : 1);
         expect(result.MessageId).to.equal(enabled ? 'stubbed-message-id' : null);
      });
   }

   it('suppresses without FROM_EMAIL and logs all normalized recipients and a UTC timestamp', async () => {
      sender = makeSender(null);
      const result = await sender.sendEmail({ ...message, recipientEmails: ' a@example.invalid, b@example.invalid ', cc: [' c@example.invalid ', null], bcc: 'd@example.invalid' });
      expect(result).to.include({ suppressed: true, MessageId: null, outboxPath: null });
      expect(suppressed()).to.have.length(1);
      expect(suppressed()[0]).to.include({ subject: message.subject, from: null });
      expect(suppressed()[0].to).to.deep.equal(['a@example.invalid', 'b@example.invalid']);
      expect(suppressed()[0].cc).to.deep.equal(['c@example.invalid']);
      expect(suppressed()[0].bcc).to.deep.equal(['d@example.invalid']);
      expect(new Date(suppressed()[0].timestamp).toISOString()).to.equal(suppressed()[0].timestamp);
      expect(suppressed()[0]).not.to.have.property('body');
      expect(constructed).to.equal(0);
   });

   it('rejects invalid input without an outbox write or SES construction', async () => {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-email-test-'));
      process.env.EMAIL_OUTBOX_DIR = temporaryDirectory;
      for (const input of [undefined, { subject: 'No recipients', recipientEmails: [] }, { recipientEmails: message.recipientEmails }]) {
         let error;
         try { await sender.sendEmail(input); } catch (caught) { error = caught; }
         expect(error).to.be.instanceOf(Error);
      }
      expect(fs.readdirSync(temporaryDirectory)).to.deep.equal([]);
      expect(suppressed()).to.have.length(0);
      expect(constructed).to.equal(0);
   });

   it('writes separate private JSON messages concurrently with content and attachment metadata only', async () => {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-email-test-'));
      process.env.EMAIL_OUTBOX_DIR = path.join(temporaryDirectory, 'private-outbox');
      const results = await Promise.all(Array.from({ length: 8 }, () => sender.sendEmail({ ...message,
         subject: '../cannot-choose-a-path', html: '<p>Preview</p>',
         attachments: [{ filename: 'test.txt', contentType: 'text/plain', content: 'not retained', path: '/private/not-read' }]
      })));
      expect(new Set(results.map(row => row.outboxPath)).size).to.equal(8);
      expect(fs.statSync(process.env.EMAIL_OUTBOX_DIR).mode & 0o777).to.equal(0o700);
      for (const result of results) {
         expect(path.dirname(result.outboxPath)).to.equal(process.env.EMAIL_OUTBOX_DIR);
         expect(fs.statSync(result.outboxPath).mode & 0o777).to.equal(0o600);
         const row = JSON.parse(fs.readFileSync(result.outboxPath, 'utf8'));
         expect(row).to.include({ body: 'Synthetic body', html: '<p>Preview</p>', event: 'email_suppressed' });
         expect(row.attachments).to.deep.equal([{ filename: 'test.txt', contentType: 'text/plain' }]);
         expect(row.id).to.equal(result.suppressionId);
      }
      expect(constructed).to.equal(0);
   });

   for (const operation of ['mkdir', 'writeFile']) {
      it(`outbox ${operation} failure warns and remains successful suppression, with no SES fallback`, async () => {
         process.env.EMAIL_OUTBOX_DIR = '/unused-stubbed-path';
         const original = fs.promises[operation];
         const originalMkdir = fs.promises.mkdir;
         if (operation === 'writeFile') fs.promises.mkdir = async () => {};
         fs.promises[operation] = async () => { throw new Error('synthetic outbox failure'); };
         try {
            const result = await sender.sendEmail(message);
            expect(result).to.include({ suppressed: true, outboxPath: null });
            expect(warnings.some(line => line.includes('email_outbox_failed'))).to.equal(true);
            expect(constructed).to.equal(0);
         } finally { fs.promises[operation] = original; fs.promises.mkdir = originalMkdir; }
      });
   }

   it('preserves the SES payload/result when enabled and never writes an outbox', async () => {
      process.env.SEND_REAL_EMAIL = 'true';
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-email-test-'));
      process.env.EMAIL_OUTBOX_DIR = temporaryDirectory;
      const result = await sender.sendEmail({ ...message, html: '<p>Body</p>', cc: 'copy@example.invalid', bcc: ['hidden@example.invalid'], attachments: [{ filename: 'unsupported.txt' }] });
      expect(result).to.deep.equal({ MessageId: 'stubbed-message-id' });
      expect(commands[0].Source).to.equal('sender@example.invalid');
      expect(commands[0].Destination).to.deep.equal({ ToAddresses: ['staff@example.invalid'], CcAddresses: ['copy@example.invalid'], BccAddresses: ['hidden@example.invalid'] });
      expect(commands[0].Message).to.deep.equal({ Subject: { Data: 'Synthetic notice', Charset: 'UTF-8' }, Body: { Text: { Data: 'Synthetic body', Charset: 'UTF-8' }, Html: { Data: '<p>Body</p>', Charset: 'UTF-8' } } });
      expect(fs.readdirSync(temporaryDirectory)).to.deep.equal([]);
      expect(warnings.some(line => line.includes('Attachments are not supported'))).to.equal(true);
   });

   it('requires FROM_EMAIL only when enabled and propagates enabled SES rejection', async () => {
      process.env.SEND_REAL_EMAIL = 'true';
      let failure;
      try { await makeSender(null).sendEmail(message); } catch (error) { failure = error; }
      expect(failure.message).to.equal('Missing FROM_EMAIL configuration.');
      expect(constructed).to.equal(0);
      sesError = new Error('stubbed SES failure');
      failure = null;
      try { await sender.sendEmail(message); } catch (error) { failure = error; }
      expect(failure).to.equal(sesError);
      expect(commands).to.have.length(1);
      expect(suppressed()).to.have.length(0);
   });

   it('turning off a sender with a cached SES client prevents any further send', async () => {
      process.env.SEND_REAL_EMAIL = 'true';
      await sender.sendEmail(message);
      process.env.SEND_REAL_EMAIL = 'false';
      expect((await sender.sendEmail(message)).suppressed).to.equal(true);
      expect(constructed).to.equal(1);
      expect(commands).to.have.length(1);
   });

   const trackerInput = {
      billingStaffEmails: ['billing@example.invalid'], adminEmails: ['admin@example.invalid'],
      userRecord: { display_name: 'Synthetic Staff', email: 'staff@example.invalid' },
      accountRecord: { account_name: 'Synthetic Firm' }, metadata: {},
      storedFileName: 'synthetic.xlsx', originalFileName: 'synthetic.xlsx', entryCount: 2,
      errors: ['Synthetic validation problem'], error: new Error('Synthetic upload failure')
   };
   const callerCases = [
      ['tracker validated', 'sendValidationSuccessEmail', 'Time Tracker Ready for Billing', 'billing@example.invalid'],
      ['tracker validation failure', 'sendValidationFailureEmail', 'Time Tracker Validation Failed', 'admin@example.invalid'],
      ['tracker system error', 'sendSystemErrorEmail', 'Time Tracker Upload Error', 'admin@example.invalid'],
      ['Thursday reminder', 'sendThursdayReminderEmails', 'due tomorrow', 'staff@example.invalid'],
      ['Friday reminder', 'sendFridayReminderEmails', 'due today', 'staff@example.invalid'],
      ['missing tracker reminder', 'sendMissingTrackerReminderEmails', "Submit last week's", 'staff@example.invalid'],
      ['processed timesheet success', 'success', 'Timesheet Processed Successfully', 'staff@example.invalid'],
      ['automation failure', 'failure', 'DS2 Automation Error', 'staff@example.invalid']
   ];
   const invokeCaller = async method => {
      if (method === 'success') return fresh('src/utils/email/sendSuccessEmail.js', { './sendEmail': sender })('staff@example.invalid', 'synthetic.xlsx');
      if (method === 'failure') return fresh('src/utils/email/failureMessages.js', { './sendEmail': sender })(9001, 'synthetic failure', 'Synthetic automation', 'staff@example.invalid');
      if (method.startsWith('sendValidation') || method === 'sendSystemErrorEmail') {
         return fresh('src/timeTrackerValidation/notifications.js', { '../utils/email/sendEmail': sender })[method](trackerInput);
      }
      const query = { where() { return this; }, andWhere() { return this; }, andWhereBetween() { return this; }, count() { return this; }, async first() { return { count: '0' }; } };
      const reminders = fresh('src/automations/automationScripts/timeTrackerReminders.js', {
         '../../utils/email/sendEmail': sender,
         '../../utils/db': () => query,
         '../../endpoints/account/account-service': { getAccount: async () => [{ account_name: 'Synthetic Firm' }] },
         '../../endpoints/account/automation-settings-service': { getEnabledAccountIds: async () => [9001], getRecipientUserIds: async () => [90011] },
         '../../endpoints/user/user-service': { getActiveAccountUsers: async () => [{ user_id: 90011, display_name: 'Synthetic Staff', email: 'staff@example.invalid' }] }
      });
      return reminders[method]();
   };
   for (const [label, method, subject, recipient] of callerCases) {
      for (const enabled of [false, true]) {
         it(`${label} uses the actual shared sender with email ${enabled ? 'on (stubbed)' : 'off'}`, async () => {
            process.env.SEND_REAL_EMAIL = String(enabled);
            if (!enabled) sender = makeSender(null);
            await invokeCaller(method);
            expect(commands).to.have.length(enabled ? 1 : 0);
            expect(constructed).to.equal(enabled ? 1 : 0);
            expect(suppressed()).to.have.length(enabled ? 0 : 1);
            const actualSubject = enabled ? commands[0].Message.Subject.Data : suppressed()[0].subject;
            const actualRecipients = enabled ? commands[0].Destination.ToAddresses : suppressed()[0].to;
            expect(actualSubject).to.include(subject);
            expect(actualRecipients).to.deep.equal([recipient]);
            if (!enabled) expect(logs.some(line => /\] Sent |email sent to/.test(line))).to.equal(false);
         });
      }
   }

   for (const [nodeEnv, value, enabled] of [
      ['production', undefined, true], ['production', 'false', false], ['production', 'true', true],
      ['development', undefined, false], ['development', 'false', false], ['development', 'true', true],
      ['test', undefined, false], ['test', 'true', true]
   ]) {
      it(`orchestrator registers jobs only when enabled: ${nodeEnv}/${value || 'default'}`, () => {
         process.env.NODE_ENV = nodeEnv;
         if (value === undefined) delete process.env.RUN_SCHEDULED_AUTOMATIONS; else process.env.RUN_SCHEDULED_AUTOMATIONS = value;
         let scheduled = 0;
         const orchestrator = fresh('src/automations/automationOrchestrator.js', {
            'node-schedule': { scheduleJob: () => { scheduled += 1; } },
            './automationScripts/timeTrackerReminders': {}
         });
         orchestrator.scheduledAutomations();
         expect(scheduled).to.equal(enabled ? 3 : 0);
      });
      it(`app startup calls the scheduler only when enabled: ${nodeEnv}/${value || 'default'}`, () => {
         process.env.NODE_ENV = nodeEnv;
         if (value === undefined) delete process.env.RUN_SCHEDULED_AUTOMATIONS; else process.env.RUN_SCHEDULED_AUTOMATIONS = value;
         let starts = 0;
         fresh('src/app.js', {
            dotenv: { config: () => {} },
            './automations/automationOrchestrator': { scheduledAutomations: () => { starts += 1; } }
         });
         expect(starts).to.equal(enabled ? 1 : 0);
      });
   }
});
