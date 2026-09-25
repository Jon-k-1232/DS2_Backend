const path = require('path');
const zlib = require('zlib');
const dayjs = require('dayjs');
const { bootHttp, uniqueName } = require('./_http');
const { buildTrackerFromTemplate } = require('../fixtures/buildTrackerFromTemplate');
const notifications = require('../../src/timeTrackerValidation/notifications');
const runner = require('../../src/endpoints/timesheets/auto-ingest-runner');
const staff = require('../../src/endpoints/timeTrackerStaff/timeTrackerStaff-service');
const s3 = require('../../src/utils/s3');

describe('F28 committed tracker upload outcome', function () {
   let h, original, note;
   before(async function () {
      original = { admin: notifications.getAdminRecipients, error: notifications.sendSystemErrorEmail,
         success: notifications.sendValidationSuccessEmail, allowed: runner._isAccountAllowed, staff: staff.listActiveEmailsByAccount };
      notifications.getAdminRecipients = async () => [];
      notifications.sendSystemErrorEmail = notifications.sendValidationSuccessEmail = async () => ({});
      runner._isAccountAllowed = () => false;
      staff.listActiveEmailsByAccount = async () => { throw new Error('staff lookup unavailable'); };
      h = await bootHttp.call(this);
      note = uniqueName('F28');
   });
   after(async () => {
      if (h) {
         const rows = await h.db('timesheet_entries').where({ account_id: 9001, notes: note });
         for (const row of rows) {
            const owners = await h.db('tracker_file_owners').where({ account_id: 9001 }).where('s3_key', 'like', `%/${row.timesheet_name}.gz`);
            for (const owner of owners) { await s3.deleteObject(owner.s3_key); await h.db('tracker_file_owners').where({ account_id: 9001, s3_key: owner.s3_key }).del(); }
         }
         await h.db('timesheet_entries').where({ account_id: 9001, notes: note }).del();
         await h.close();
      }
      notifications.getAdminRecipients = original.admin; notifications.sendSystemErrorEmail = original.error;
      notifications.sendValidationSuccessEmail = original.success; runner._isAccountAllowed = original.allowed;
      staff.listActiveEmailsByAccount = original.staff;
   });
   it('returns 201 and the saved identifier despite recipient lookup failure; retry is duplicate', async () => {
      const date = dayjs().format('YYYY-MM-DD');
      const buffer = buildTrackerFromTemplate({ templatePath: path.join(__dirname, '../fixtures/timetrackers/real-base.xlsx'),
         employeeName: 'Eliza Smith', startDate: date, endDate: date,
         rows: [{ date, entity: 'James F. Kimmel & Associates', category: 'Client Meeting', companyName: 'Acme Corp', duration: 60, notes: note }] });
      const upload = () => h.as('admin').post('/time-tracking/upload/9001/90011')
         .set('Content-Type', 'application/octet-stream').set('x-file-name', `${note}.xlsx`)
         .set('x-file-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
      const result = await upload();
      const rows = await h.db('timesheet_entries').where({ account_id: 9001, notes: note });
      expect(rows, JSON.stringify(result.body)).to.have.length(1);
      const owner = await h.db('tracker_file_owners').where({ account_id: 9001 }).where('s3_key', 'like', `%/${rows[0].timesheet_name}.gz`).first();
      expect(owner).to.exist;
      const object = await s3.getObject(owner.s3_key);
      expect(zlib.gunzipSync(object.body).equals(buffer)).to.equal(true);
      const retry = await upload();
      expect(retry.status).to.equal(409);
      expect(result.status, JSON.stringify(result.body)).to.equal(201);
      expect(result.body.storedKey).to.equal(owner.s3_key);
      expect(result.body.inserted_count).to.equal(1);
   });
});
