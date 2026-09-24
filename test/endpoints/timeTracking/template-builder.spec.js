const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
   buildTemplate,
   _resetCacheForTest,
   _addLookupSheet,
   _applyDataValidation,
   _replaceVisibleNameList,
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
   // The Category dropdown pulls customer_general_work_descriptions (work-type
   // descriptors), NOT customer_job_categories — see _readCatalogs.
   const categories = [
      { general_work_description_id: 90001, account_id: 9001, general_work_description: 'Tax Compliance', is_general_work_description_active: true },
      { general_work_description_id: 90002, account_id: 9001, general_work_description: 'Bookkeeping', is_general_work_description_active: true }
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

   // DEFECT fix regression: the base template also carries a VISIBLE
   // 'Employee Names' sheet (predates __employees; see _replaceVisibleNameList)
   // that buildTemplate used to leave untouched, so a re-stamped (flag-on)
   // template still displayed whichever account's staff the base workbook was
   // last captured from.
   it('also scrubs the visible "Employee Names" sheet to the requesting account\'s own staff', async () => {
      const foreignBase = new ExcelJS.Workbook();
      foreignBase.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const foreignNames = foreignBase.addWorksheet('Employee Names');
      ['Foreign Staff One', 'Foreign Staff Two', 'Foreign Staff Three'].forEach((name, i) => {
         foreignNames.getCell(`A${i + 1}`).value = name;
      });
      const baseBuffer = Buffer.from(await foreignBase.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: baseBuffer });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Employee Names');
      const values = [];
      for (let r = 1; r <= sheet.rowCount; r++) {
         const v = sheet.getCell(`A${r}`).value;
         if (v != null) values.push(v);
      }
      expect(values).to.have.members(['Eliza Smith', 'Bob Jones']);
      expect(values).to.not.include.members(['Foreign Staff One', 'Foreign Staff Two', 'Foreign Staff Three']);
   });
});

describe('template-builder _replaceVisibleNameList', () => {
   it('overwrites an existing visible sheet\'s rows with the given list, clearing leftovers', () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Employee Names');
      ['Foreign Staff One', 'Foreign Staff Two', 'Foreign Staff Three'].forEach((name, i) => {
         sheet.getCell(`A${i + 1}`).value = name;
      });
      _replaceVisibleNameList(wb, 'Employee Names', ['Eliza Smith', 'Bob Jones']);
      expect(sheet.getCell('A1').value).to.equal('Eliza Smith');
      expect(sheet.getCell('A2').value).to.equal('Bob Jones');
      expect(sheet.getCell('A3').value).to.equal(null);
      expect(sheet.state).to.equal('visible');
   });

   it('is a no-op when the sheet does not exist (base template shape may vary)', () => {
      const wb = new ExcelJS.Workbook();
      expect(() => _replaceVisibleNameList(wb, 'Employee Names', ['Eliza Smith'])).to.not.throw();
   });
});

describe('template-builder _applyDataValidation', () => {
   it('marks the employee dropdown as strict (errorStyle stop) and uses range-based rules', async () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Time');
      _applyDataValidation({ sheet, customerCount: 5, employeeCount: 3, categoryCount: 4 });
      // ExcelJS stores range-based rules in worksheet.dataValidations.model;
      // each key is a sheet range like "B1" or "C6:C1500".
      const rules = sheet.dataValidations.model || {};
      const ranges = Object.keys(rules);
      // Current layout (column mapping fixed 2026-05): B1 employee header
      // (strict), C6:Cn categories, D6:Dn customers (both advisory). There is
      // no per-row employee column anymore, so nothing registers on B6.
      // Don't pin exact range bounds — that's the MAX_DATA_ROWS knob.
      const findRule = prefix => rules[ranges.find(r => r.startsWith(prefix))];
      expect(findRule('B1').errorStyle).to.equal('stop');
      expect(ranges.find(r => r.startsWith('B6'))).to.equal(undefined);
      expect(findRule('C6').errorStyle).to.equal('information');
      expect(findRule('D6').errorStyle).to.equal('information');
   });
});

// DEFECT fix (Astra finding 2, 2026-09-23): the fixes above scoped the three
// hidden lookup sheets and the visible 'Employee Names' list, but nothing
// scrubbed the REST of the workbook — an actual account-9001 download still
// carried account-1's employee name in Instructions!D15/D16 (a worked-example
// cell, well outside those four sheets). See template-builder.js's own
// comment block above _collectForeignNames for the full design, and the
// integration-level proof (every worksheet, defined names, comments,
// docProps) in coverage-timetracking-timesheets.integration.spec.js.
describe('template-builder tenant-neutral scrubbing (Astra finding 2)', () => {
   afterEach(() => _resetCacheForTest());

   // A stand-in for "whatever tenant the S3-stored base object currently
   // belongs to" — two employees (one sharing a surname with the workbook's
   // OWN Entity text, one that doesn't), one customer, referenced from
   // several places outside the three hidden lookup sheets.
   const buildForeignBase = async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';

      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Jim Kimmel';
      employeesSheet.getCell('A3').value = 'Marsha Johnson';

      const customersSheet = wb.addWorksheet('__customers');
      customersSheet.state = 'veryHidden';
      customersSheet.getCell('A1').value = 'Customer';
      customersSheet.getCell('A2').value = 'Acme Global LLC';

      // The firm's own Entity/business-line option — shares the word
      // "Kimmel" with employee "Jim Kimmel" above. Must never be touched.
      wb.addWorksheet('Entity').getCell('A1').value = 'James F. Kimmel & Associates';

      const instructions = wb.addWorksheet('Instructions');
      instructions.getCell('D15').value = 'Jim Kimmel'; // the actual Astra finding's shape
      instructions.getCell('B15').value = 'James F. Kimmel & Associates'; // Entity example — must survive
      instructions.getCell('F20').value = 'Kimmel'; // bare token colliding with Entity vocabulary
      instructions.getCell('F21').value = 'Johnson'; // bare token, no collision
      instructions.getCell('E15').value = 'Billed through Acme Global LLC this month';

      // A hidden sheet that is NOT one of the three lookup sheets — proves
      // the scrub covers "every worksheet", not just the well-known ones.
      const misc = wb.addWorksheet('__old_notes');
      misc.state = 'veryHidden';
      misc.getCell('A1').value = 'Contact Jim Kimmel for questions';

      wb.creator = 'Jim Kimmel';
      wb.company = 'James F. Kimmel & Associates';
      return Buffer.from(await wb.xlsx.writeBuffer());
   };

   it("scrubs a foreign employee's full name, a bare name-token, and a foreign customer's name from sheets the lookup-sheet replacement never touches", async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: await buildForeignBase() });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const instr = wb.getWorksheet('Instructions');
      // buildStubDb's users/customers keep insertion order (its `.orderBy` is
      // a no-op) — 'Eliza Smith' and 'Acme Corp' are each first in their list.
      expect(instr.getCell('D15').value, 'full employee name example (the reported leak)').to.equal('Eliza Smith');
      expect(instr.getCell('F21').value, 'bare last-name token with no collision').to.equal('Eliza Smith');
      expect(instr.getCell('E15').value, 'foreign customer name embedded in prose').to.equal('Billed through Acme Corp this month');
      expect(wb.getWorksheet('__old_notes').getCell('A1').value, 'a hidden sheet that is not one of the three lookup sheets is scrubbed too').to.equal('Contact Eliza Smith for questions');
   });

   it("never corrupts the workbook's own Entity/business-line text even when it shares a word with a foreign employee's surname", async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: await buildForeignBase() });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.getWorksheet('Entity').getCell('A1').value, 'the Entity sheet itself').to.equal('James F. Kimmel & Associates');
      expect(wb.getWorksheet('Instructions').getCell('B15').value, 'an Entity example elsewhere').to.equal('James F. Kimmel & Associates');
      expect(wb.getWorksheet('Instructions').getCell('F20').value, 'the bare surname token is protected for the same reason').to.equal('Kimmel');
   });

   it('clears any populated entry rows in the data sheet for the rebuild (headers in rows 1-5 survive)', async () => {
      const baseWb = new ExcelJS.Workbook();
      const time = baseWb.addWorksheet('Time');
      time.getCell('A1').value = 'Employee Name';
      time.getCell('A5').value = 'Date';
      time.getCell('A6').value = new Date('2024-01-01');
      time.getCell('D6').value = 'Some Prior Customer';
      time.getCell('I6').value = 'Some prior note';
      const baseTemplateBuffer = Buffer.from(await baseWb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const time2 = wb.getWorksheet('Time');
      expect(time2.getCell('A1').value, 'header row 1 survives').to.equal('Employee Name');
      expect(time2.getCell('A5').value, 'header row 5 survives').to.equal('Date');
      expect(time2.getCell('A6').value, 'a populated entry row is cleared').to.equal(null);
      expect(time2.getCell('D6').value).to.equal(null);
      expect(time2.getCell('I6').value).to.equal(null);
   });

   it("stamps docProps metadata to a generic label when the db has no account name (fails closed, never leaves a foreign name in place)", async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: await buildForeignBase() });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      // buildStubDb has no 'accounts' table — _readAccountLabel fails closed
      // to null, and _neutralizeMetadata falls back to the literal 'DS2'.
      expect(wb.creator).to.equal('DS2');
      expect(wb.lastModifiedBy).to.equal('DS2');
      expect(wb.title).to.equal('DS2');
      expect(wb.description).to.equal('DS2');
      expect(wb.company).to.equal('DS2');
      expect(wb.manager).to.equal('DS2');
   });

   it("stamps docProps metadata to the requesting account's own name when the db has one", async () => {
      const base = buildStubDb();
      const db = table => (table === 'accounts' ? { where: () => ({ first: () => Promise.resolve({ account_name: 'Acme Testing Co' }) }) } : base(table));
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer: await buildForeignBase() });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.creator).to.equal('Acme Testing Co');
      expect(wb.lastModifiedBy).to.equal('Acme Testing Co');
      expect(wb.company).to.equal('Acme Testing Co');
   });

   it('scrubs a foreign name out of a cell comment (defense in depth — none exist in the real template today)', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Jim Kimmel';
      const notes = wb.addWorksheet('Notes');
      notes.getCell('A1').value = 'see comment';
      notes.getCell('A1').note = 'Ask Jim Kimmel before changing this.';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      expect(wb2.getWorksheet('Notes').getCell('A1').note).to.equal('Ask Eliza Smith before changing this.');
   });

   // Regression: ExcelJS writes a data-validation literal list's quotes back
   // as the XML ENTITY &quot;, not a literal '"' character — a first version
   // of _neutralizeXmlTextParts matched only the literal quote and so never
   // fired on real output (silently doing nothing rather than throwing).
   // Also covers a defined name whose own text contains an XML-special
   // character ("&"), to prove the raw-XML splice re-encodes correctly
   // instead of producing an invalid workbook.
   it('scrubs a foreign name out of a literal (quoted) data-validation list and a defined name — including one containing "&"', async () => {
      const wb = new ExcelJS.Workbook();
      const time = wb.addWorksheet('Time');
      time.getCell('A1').value = 'Employee Name';
      time.getCell('L1').value = 'x';
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Jim Kimmel';
      // A literal quoted list (as opposed to a named-range/cell-ref formula).
      time.dataValidations.add('K1', { type: 'list', allowBlank: true, formulae: ['"Jim Kimmel,Someone Else"'] });
      let baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      // ExcelJS's own definedNames API is unreliable for round-tripping
      // arbitrary names (see _restoreDefinedNames) — splice one in via the
      // same raw-zip approach the builder itself uses, so this test doesn't
      // depend on that separate, known-shaky path.
      const zip = await JSZip.loadAsync(baseTemplateBuffer);
      let wbXml = await zip.files['xl/workbook.xml'].async('string');
      const definedName = '<definedName name="Jim Kimmel Contact &amp; Notes">Time!$L$1</definedName>';
      wbXml = wbXml.includes('<definedNames>') ? wbXml.replace('</definedNames>', `${definedName}</definedNames>`) : wbXml.replace('</sheets>', `</sheets><definedNames>${definedName}</definedNames>`);
      zip.file('xl/workbook.xml', wbXml);
      baseTemplateBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, baseTemplateBuffer });

      const outZip = await JSZip.loadAsync(buffer);
      const sheetXml = await outZip.files['xl/worksheets/sheet1.xml'].async('string');
      expect(sheetXml, 'the literal list no longer names the foreign employee').to.not.include('Kimmel');
      expect(sheetXml, 'the scrubbed list is still validly XML-quoted').to.match(/<formula1>&quot;Eliza Smith,Someone Else&quot;<\/formula1>/);

      const outWbXml = await outZip.files['xl/workbook.xml'].async('string');
      expect(outWbXml, 'the defined name no longer names the foreign employee').to.not.include('Kimmel');
      expect(outWbXml).to.include('<definedName name="Eliza Smith Contact &amp; Notes">');

      // Re-open with ExcelJS to confirm the raw-XML splice produced a valid
      // workbook and the "&" round-trips back to a literal ampersand.
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      const restoredName = wb2.definedNames.model.find(dn => dn.name.includes('Contact'));
      expect(restoredName.name).to.equal('Eliza Smith Contact & Notes');
   });
});
