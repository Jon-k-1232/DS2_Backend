const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const {
   buildTemplate,
   _resetCacheForTest,
   _addLookupSheet,
   _applyDataValidation,
   COLLAPSE_WINDOW_MS
} = require('../../../src/endpoints/timeTracking/template-builder');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'timetrackers', 'clean.xlsx');

const buildStubDb = () => {
   const customers = [
      { customer_id: 1, account_id: 9001, display_name: 'Acme Corp', is_customer_active: true },
      { customer_id: 2, account_id: 9001, display_name: 'Globex', is_customer_active: true },
      { customer_id: 3, account_id: 9001, display_name: 'Wayne Enterprises', is_customer_active: true }
   ];
   const users = [
      { user_id: 7, account_id: 9001, display_name: 'Eliza Smith', is_user_active: true },
      { user_id: 8, account_id: 9001, display_name: 'Bob Jones', is_user_active: true }
   ];
   const categories = [
      { customer_job_category_id: 90001, account_id: 9001, customer_job_category: 'Tax Compliance', is_job_category_active: true },
      { customer_job_category_id: 90002, account_id: 9001, customer_job_category: 'Bookkeeping', is_job_category_active: true }
   ];
   const downloads = [];

   const _build = (table) => {
      const state = { where: {} };
      const builder = {
         where: obj => { Object.assign(state.where, obj); return builder; },
         orderBy: () => builder,
         select: (...fields) => {
            const dataset = table === 'customers' ? customers : table === 'users' ? users : categories;
            const matching = dataset.filter(r => Object.entries(state.where).every(([k, v]) => r[k] === v));
            return Promise.resolve(matching.map(m => {
               const out = {};
               for (const f of fields) out[f] = m[f];
               return out;
            }));
         },
         insert: row => {
            downloads.push({ ...row });
            return Promise.resolve();
         }
      };
      return builder;
   };
   const db = table => _build(table);
   db._downloads = downloads;
   db._customers = customers;
   db._users = users;
   db._categories = categories;
   return db;
};

describe('template-builder', () => {
   afterEach(() => _resetCacheForTest());

   it('injects __customers, __employees, __categories hidden sheets', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      const { buffer, counts } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer });
      expect(counts).to.deep.equal({ customers: 3, employees: 2, categories: 2 });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      const customerSheet = wb.getWorksheet('__customers');
      const employeeSheet = wb.getWorksheet('__employees');
      const categorySheet = wb.getWorksheet('__categories');

      expect(customerSheet).to.exist;
      expect(employeeSheet).to.exist;
      expect(categorySheet).to.exist;

      expect(customerSheet.state).to.equal('veryHidden');
      expect(employeeSheet.state).to.equal('veryHidden');
      expect(categorySheet.state).to.equal('veryHidden');

      expect(customerSheet.getCell('A1').value).to.equal('Customer');
      expect(customerSheet.getCell('A2').value).to.equal('Acme Corp');
      expect(customerSheet.getCell('A4').value).to.equal('Wayne Enterprises');

      // Stub returns insertion order; real DB sorts alphabetically via orderBy.
      // Just assert both names appear; ordering is verified at the integration test.
      const empValues = [];
      for (let r = 2; r <= 4; r++) {
         const v = employeeSheet.getCell(`A${r}`).value;
         if (v != null) empValues.push(v);
      }
      expect(empValues).to.have.members(['Eliza Smith', 'Bob Jones']);

      const catValues = [];
      for (let r = 2; r <= 4; r++) {
         const v = categorySheet.getCell(`A${r}`).value;
         if (v != null) catValues.push(v);
      }
      expect(catValues).to.have.members(['Tax Compliance', 'Bookkeeping']);
   });

   it('writes a template_downloads audit row', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer });
      expect(db._downloads).to.have.lengthOf(1);
      expect(db._downloads[0]).to.deep.include({ account_id: 9001, user_id: 7, customer_count: 3, employee_count: 2, category_count: 2 });
   });

   it('returns the cached buffer within the collapse window', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      const fixedNow = () => 1_000_000;
      const a = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });
      const b = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(a.buffer).to.equal(b.buffer);
      // Audit row only written on the first build.
      expect(db._downloads).to.have.lengthOf(1);
   });

   it('rebuilds when the collapse window expires', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      let t = 1_000_000;
      const moveTime = ms => { t += ms; };
      const fixedNow = () => t;
      await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });
      moveTime(COLLAPSE_WINDOW_MS + 1);
      await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(db._downloads).to.have.lengthOf(2);
   });

   it('rebuilds for a different user (no cache cross-contamination)', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      const fixedNow = () => 1_000_000;
      await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });
      await buildTemplate({ db, accountId: 9001, userId: 8, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(db._downloads).to.have.lengthOf(2);
      expect(db._downloads[0].user_id).to.equal(7);
      expect(db._downloads[1].user_id).to.equal(8);
   });

   it('reflects new customers immediately on next download', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      let t = 0;
      const fixedNow = () => t;

      await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });

      // New customer added between downloads.
      db._customers.push({ customer_id: 999, account_id: 9001, display_name: 'New Co Just Added', is_customer_active: true });
      t += COLLAPSE_WINDOW_MS + 1;

      const next = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer, now: fixedNow });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(next.buffer);
      const customerSheet = wb.getWorksheet('__customers');
      const values = [];
      for (let r = 2; r <= 10; r++) {
         const v = customerSheet.getCell(`A${r}`).value;
         if (v != null) values.push(v);
      }
      expect(values).to.include('New Co Just Added');
   });
});

describe('template-builder _applyDataValidation', () => {
   it('marks the employee dropdown as strict (errorStyle stop) and uses range-based rules', async () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Time');
      _applyDataValidation({ sheet, customerCount: 5, employeeCount: 3, categoryCount: 4 });
      // ExcelJS stores range-based rules in worksheet.dataValidations.model;
      // each key is a sheet range like "B1" or "B6:B1500".
      const rules = sheet.dataValidations.model || {};
      const ranges = Object.keys(rules);
      // The implementation registers four ranges total: B1 (name-block
      // employee), B6:Bn (customers), C6:Cn (categories), D6:Dn (data-block
      // employee). Don't pin the exact range bounds — that's the
      // MAX_DATA_ROWS knob — but assert the ranges and their errorStyle.
      const findRule = prefix => rules[ranges.find(r => r.startsWith(prefix))];
      expect(findRule('B1').errorStyle).to.equal('stop');
      expect(findRule('B6').errorStyle).to.equal('information');
      expect(findRule('C6').errorStyle).to.equal('information');
      expect(findRule('D6').errorStyle).to.equal('stop');
   });
});
