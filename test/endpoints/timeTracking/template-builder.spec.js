const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
   buildTemplate,
   _resetCacheForTest,
   _addLookupSheet,
   _applyDataValidation,
   _replaceVisibleNameList,
   _loadNeutralAsset,
   _readZipTextParts,
   _xmlDecodeText,
   _tokenAppearsIn,
   _assertNoForbiddenTokens,
   _setExampleEmployeeCells,
   ALLOWED_SHEET_NAMES,
   EXAMPLE_PLACEHOLDER_TEXT,
   NEUTRAL_ASSET_PATH,
   NEUTRAL_MANIFEST_PATH,
   COLLAPSE_WINDOW_MS
} = require('../../../src/endpoints/timeTracking/template-builder');
const { buildNeutralTemplateFromBuffer } = require('../../../scripts/timeTracking/build-neutral-template');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'timetrackers', 'clean.xlsx');
const REAL_BASE_FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'timetrackers', 'real-base.xlsx');
const ASTRA_FINDING2_FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'timetrackers', 'astra-finding2-hidden-sheet.xlsx');
const ASTRA_PAIRED_SHEET_TAGS_FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'timetrackers', 'astra-paired-sheet-tags.xlsx');

// Await a promise that should reject; returns the error (or null otherwise).
const caught = async promise => {
   try {
      await promise;
   } catch (e) {
      return e;
   }
   return null;
};

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
      const { buffer, counts } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer });
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
      await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer });
      expect(db._downloads).to.have.lengthOf(1);
      expect(db._downloads[0]).to.deep.include({ account_id: 9001, user_id: 7, customer_count: 3, employee_count: 2, category_count: 2 });
   });

   it('returns the cached buffer within the collapse window', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      const fixedNow = () => 1_000_000;
      const a = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
      const b = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
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
      await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
      moveTime(COLLAPSE_WINDOW_MS + 1);
      await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(db._downloads).to.have.lengthOf(2);
   });

   it('keeps owner and non-owner builds for the same account and user in separate cache entries', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      const fixedNow = () => 1_000_000;
      const owner = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
      const nonOwner = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(nonOwner.buffer.equals(owner.buffer)).to.equal(false);
      expect(db._downloads).to.have.lengthOf(2);
      const again = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(again.buffer).to.equal(nonOwner.buffer);
      expect(db._downloads).to.have.lengthOf(2);
   });

   it('rebuilds for a different user (no cache cross-contamination)', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      const fixedNow = () => 1_000_000;
      await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
      await buildTemplate({ db, accountId: 9001, userId: 8, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });
      expect(db._downloads).to.have.lengthOf(2);
      expect(db._downloads[0].user_id).to.equal(7);
      expect(db._downloads[1].user_id).to.equal(8);
   });

   it('reflects new customers immediately on next download', async () => {
      const baseBuffer = fs.readFileSync(FIXTURE_PATH);
      const db = buildStubDb();
      let t = 0;
      const fixedNow = () => t;

      await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });

      // New customer added between downloads.
      db._customers.push({ customer_id: 999, account_id: 9001, display_name: 'New Co Just Added', is_customer_active: true });
      t += COLLAPSE_WINDOW_MS + 1;

      const next = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer, now: fixedNow });

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
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: baseBuffer });

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

      wb.creator = 'Jim Kimmel';
      wb.company = 'James F. Kimmel & Associates';
      return Buffer.from(await wb.xlsx.writeBuffer());
   };

   it("scrubs a foreign employee's full name, a bare name-token, and a foreign customer's name from sheets the lookup-sheet replacement never touches", async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: await buildForeignBase() });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const instr = wb.getWorksheet('Instructions');
      // buildStubDb's users/customers keep insertion order (its `.orderBy` is
      // a no-op) — 'Eliza Smith' and 'Acme Corp' are each first in their list.
      expect(instr.getCell('D15').value, 'full employee name example (the reported leak)').to.equal('Eliza Smith');
      expect(instr.getCell('F21').value, 'bare last-name token with no collision').to.equal('Eliza Smith');
      expect(instr.getCell('E15').value, 'foreign customer name embedded in prose').to.equal('Billed through Acme Corp this month');
   });

   it("never corrupts the workbook's own Entity/business-line text even when it shares a word with a foreign employee's surname", async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: await buildForeignBase() });

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
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
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
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: await buildForeignBase() });
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
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: await buildForeignBase() });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.creator).to.equal('Acme Testing Co');
      expect(wb.lastModifiedBy).to.equal('Acme Testing Co');
      expect(wb.company).to.equal('Acme Testing Co');
   });

   // SUPERSEDED by the fail-closed allowlist (Astra finding 2, round 9): a
   // cell comment used to be "scrubbed" the same as any other cell string.
   // Comments now live in their own package part (xl/comments*.xml, plus a
   // legacy xl/drawings/vmlDrawing*.vml) that this file never reviewed and
   // has no safe way to rebuild, so it is refused outright — see
   // "template-builder fail-closed allowlist" below for the full suite of
   // disallowed-part coverage.
   it('throws rather than scrubs when the base contains a cell comment (a package part outside the allowlist)', async () => {
      const wb = new ExcelJS.Workbook();
      const time = wb.addWorksheet('Time');
      time.getCell('A1').value = 'see comment';
      time.getCell('A1').note = 'Ask Jim Kimmel before changing this.';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const err = await caught(buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer }));
      expect(err, 'a comment part must refuse the rebuild, never silently scrub it').to.be.an('error');
      expect(err.message).to.match(/disallowed_package_part/);
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
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });

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

// ─────────────────────────────────────────────────────────────────────────
// Astra round 9 findings (2026-09-23): finding 2 (a fail-closed allowlist —
// an unknown sheet, drawing, comment, custom XML, table, pivot cache, or
// external link must refuse the whole rebuild rather than be "sanitized" by
// a successful ExcelJS round trip) and finding 3 (name matching that cannot
// damage the template's own vocabulary or ordinary prose). See the
// file-level comments above _assertAllowedPackage and _neutralizeExactToken
// in template-builder.js for the full design these tests cover.
describe('template-builder fail-closed allowlist + name-boundary fixes (Astra findings 2 & 3, round 9)', () => {
   afterEach(() => _resetCacheForTest());

   it('accepts the real base template unchanged — all 8 of its sheets are on the allowlist, and Categories/Instructions vocabulary survives', async () => {
      const db = buildStubDb();
      const err = await caught(
         (async () => {
            const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: fs.readFileSync(REAL_BASE_FIXTURE_PATH) });
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buffer);
            // Real base's worked examples name the firm's own owner
            // ("Jim Kimmel") — must be replaced by the requesting account.
            expect(wb.getWorksheet('Instructions').getCell('D15').value).to.equal('Eliza Smith');
            expect(wb.getWorksheet('Instructions').getCell('D16').value).to.equal('Eliza Smith');
            // The real base's own static category vocabulary must survive
            // byte-for-byte (this is the exact Astra finding-3 cell).
            expect(wb.getWorksheet('Categories').getCell('A3').value).to.equal('Administrative');
         })()
      );
      expect(err, err && err.message).to.equal(null);
   });

   it('throws when the base has an unknown worksheet', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      wb.addWorksheet('Notes').getCell('A1').value = 'internal scratch sheet';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const err = await caught(buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer }));
      expect(err, 'an unrecognized worksheet must refuse the rebuild').to.be.an('error');
      expect(err.message).to.match(/disallowed_sheet/);
      expect(err.message).to.include('Notes');
   });

   it('throws when the base has a hidden worksheet named after a foreign person (not on the allowlist)', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const hidden = wb.addWorksheet('Jim Kimmel');
      hidden.state = 'veryHidden';
      hidden.getCell('A1').value = 'Jim Kimmel';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const err = await caught(buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer }));
      expect(err, 'a hidden sheet is still a sheet — its name is checked the same as a visible one').to.be.an('error');
      expect(err.message).to.match(/disallowed_sheet/);
      expect(err.message).to.include('Jim Kimmel');
   });

   // Real-world regression: Astra's actual round-9 output for a synthetic
   // base carrying a hidden "Jim Kimmel" sheet, a formula returning that
   // name, a hyperlink, and a stray Employee Names!B1 value — every one of
   // those survived the OLD builder. Feeding that exact file back in as a
   // base must now refuse it outright rather than re-"sanitize" it.
   it("throws when fed Astra's round-9 finding-2 fixture (hidden foreign sheet + formula + hyperlink)", async () => {
      const db = buildStubDb();
      const err = await caught(buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer: fs.readFileSync(ASTRA_FINDING2_FIXTURE_PATH) }));
      expect(err, 'the fixture\'s hidden "Jim Kimmel" sheet must be refused').to.be.an('error');
      expect(err.message).to.match(/disallowed_sheet/);
   });

   it('neutralizes docProps Subject, Keywords and Category — not just Title/Creator/Description', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      wb.subject = 'Jim Kimmel';
      wb.keywords = 'Jim Kimmel, taxes, 2025';
      wb.category = 'Jim Kimmel personal';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      // buildStubDb has no 'accounts' table, so this falls back to the same
      // 'DS2' literal the pre-existing metadata tests above already cover.
      expect(wb2.subject).to.equal('DS2');
      expect(wb2.keywords).to.equal('DS2');
      expect(wb2.category).to.equal('DS2');
   });

   it('drops a cell formula whose literal names a foreign person, keeping only the scrubbed cached value', async () => {
      const wb = new ExcelJS.Workbook();
      const time = wb.addWorksheet('Time');
      time.getCell('A1').value = 'Employee Name';
      time.getCell('L1').value = { formula: '"Jim Kimmel"', result: 'Jim Kimmel' };
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Jim Kimmel';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      const cell = wb2.getWorksheet('Time').getCell('L1');
      expect(cell.type, 'the formula itself must be gone, not just its cached result (Excel recalculates formulas on open)').to.not.equal(ExcelJS.ValueType.Formula);
      expect(cell.value).to.equal('Eliza Smith');
   });

   it('drops a hyperlink whose TARGET names a foreign person, even when its display text does not', async () => {
      const wb = new ExcelJS.Workbook();
      const time = wb.addWorksheet('Time');
      time.getCell('A1').value = 'Employee Name';
      time.getCell('L1').value = { text: 'Contact us', hyperlink: 'https://intranet.example.com/staff?name=Jim Kimmel' };
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Jim Kimmel';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      const cell = wb2.getWorksheet('Time').getCell('L1');
      expect(cell.type, 'the hyperlink must be dropped entirely, not just its display text').to.not.equal(ExcelJS.ValueType.Hyperlink);
      expect(cell.value).to.equal('Contact us');
   });

   it('clears Employee Names!B1 (not just column A) of a stray value', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const namesSheet = wb.addWorksheet('Employee Names');
      namesSheet.getCell('A1').value = 'Foreign Person One';
      namesSheet.getCell('A2').value = 'Foreign Person Two';
      namesSheet.getCell('B1').value = 'Stray leftover value';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      const sheet = wb2.getWorksheet('Employee Names');
      expect(sheet.getCell('B1').value, 'Astra finding 2: a stray value outside column A used to survive').to.equal(null);
      expect(sheet.getCell('A1').value).to.equal('Eliza Smith');
      expect(sheet.getCell('A2').value).to.equal('Bob Jones');
   });

   it('preserves "Administrative" in the Categories sheet even when "Admin" is a foreign employee\'s full display name', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Admin';
      const categories = wb.addWorksheet('Categories');
      categories.getCell('A1').value = 'Accounting';
      categories.getCell('A2').value = 'Administrative';
      categories.getCell('A3').value = 'Billing';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      expect(wb2.getWorksheet('Categories').getCell('A2').value, 'a full employee name that is a PREFIX of real vocabulary must not corrupt it').to.equal('Administrative');
   });

   it("preserves ordinary prose containing common words that also happen to be a foreign employee's first/last name", async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Mark Long';
      const instructions = wb.addWorksheet('Instructions');
      const prose = 'Mark the start date. How long did it take you?';
      instructions.getCell('C9').value = prose;
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      expect(wb2.getWorksheet('Instructions').getCell('C9').value, 'ordinary prose must never be token-replaced').to.equal(prose);
   });

   it('replaces an exact-cell bare name token ("Kimmel") when the whole trimmed cell value is nothing else', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Time').getCell('A1').value = 'Employee Name';
      const employeesSheet = wb.addWorksheet('__employees');
      employeesSheet.state = 'veryHidden';
      employeesSheet.getCell('A1').value = 'Employee';
      employeesSheet.getCell('A2').value = 'Jim Kimmel';
      // No Entity/Categories sheet in this fixture, so "Kimmel" is not
      // protected shared vocabulary here (contrast with the Astra
      // finding-2 describe block above, where it legitimately is).
      const instructions = wb.addWorksheet('Instructions');
      instructions.getCell('F1').value = 'Kimmel';
      const baseTemplateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: true, baseTemplateBuffer });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      expect(wb2.getWorksheet('Instructions').getCell('F1').value).to.equal('Eliza Smith');
   });
});

// ─────────────────────────────────────────────────────────────────────────
// Design decision, round 10 (2026-09-23, Astra findings 1 & 2): non-owner
// downloads are rebuilt from the reviewed, committed neutral-template.xlsx
// asset instead of the owner's uploaded bytes — see the file-level comment
// above buildTemplate / _buildFromNeutralAsset in template-builder.js.
describe('template-builder non-owner build (neutral asset)', () => {
   afterEach(() => _resetCacheForTest());

   it('builds successfully for a non-owner account WITHOUT ever reading baseTemplateBuffer', async () => {
      const db = buildStubDb();
      // Stands in for "whatever the S3 layer would have handed buildTemplate
      // for the owner's shared object" — a Proxy that throws the instant ANY
      // property is touched. If the non-owner path reads so much as
      // `.length` off this, the test fails loudly instead of silently
      // passing on a buffer that happens to not matter.
      const sentinel = new Proxy(Buffer.from('not a real workbook'), {
         get(target, prop) {
            throw new Error(`SENTINEL BUFFER WAS READ: ${String(prop)}`);
         }
      });
      const { buffer, counts } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false, baseTemplateBuffer: sentinel });
      expect(counts).to.deep.equal({ customers: 3, employees: 2, categories: 2 });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect([...new Set(wb.worksheets.map(ws => ws.name))].sort()).to.deep.equal([...ALLOWED_SHEET_NAMES].sort());
   });

   it('also builds successfully when no baseTemplateBuffer is passed at all — it is never required for a non-owner build', async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.getWorksheet('Time')).to.exist;
   });

   it('scopes the hidden lookup sheets and the visible roster to the requesting account, same as the owner path', async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const customerSheet = wb.getWorksheet('__customers');
      expect(customerSheet.state).to.equal('veryHidden');
      expect(customerSheet.getCell('A2').value).to.equal('Acme Corp');
      const empNames = [];
      for (let r = 1; r <= wb.getWorksheet('Employee Names').rowCount; r++) {
         const v = wb.getWorksheet('Employee Names').getCell(`A${r}`).value;
         if (v != null) empNames.push(v);
      }
      expect(empNames).to.have.members(['Eliza Smith', 'Bob Jones']);
   });

   it("fills the Instructions worked-example placeholder with the tenant's first active employee", async () => {
      const db = buildStubDb();
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const instr = wb.getWorksheet('Instructions');
      // buildStubDb's users keep insertion order (.orderBy is a no-op) —
      // 'Eliza Smith' is first.
      expect(instr.getCell('D15').value).to.equal('Eliza Smith');
      expect(instr.getCell('D16').value).to.equal('Eliza Smith');
   });

   // Real-world regression (found running the integration suite against
   // ds2_local, 2026-09-24): the real Instructions sheet has its OWN,
   // unrelated field-label cell (A5) whose value is ALSO the literal string
   // "Employee Name" — the exact placeholder text. Re-finding "which cells
   // hold the placeholder" by content at request time can't tell that label
   // apart from the two former-name cells, and corrupted it. Fixed by having
   // the runtime only ever write to manifest.exampleCellAddresses (recorded
   // once, at build time, by searching for the ORIGINAL name instead).
   it("_setExampleEmployeeCells only touches the recorded addresses, never any OTHER cell that also happens to hold the placeholder text", () => {
      const wb = new ExcelJS.Workbook();
      const instructions = wb.addWorksheet('Instructions');
      instructions.getCell('A5').value = EXAMPLE_PLACEHOLDER_TEXT; // the real sheet's own, unrelated field label
      instructions.getCell('D15').value = EXAMPLE_PLACEHOLDER_TEXT;
      instructions.getCell('D16').value = EXAMPLE_PLACEHOLDER_TEXT;

      _setExampleEmployeeCells(wb, 'Eliza Smith', ['Instructions!D15', 'Instructions!D16']);

      expect(instructions.getCell('A5').value, 'the unrelated field label must survive untouched').to.equal(EXAMPLE_PLACEHOLDER_TEXT);
      expect(instructions.getCell('D15').value).to.equal('Eliza Smith');
      expect(instructions.getCell('D16').value).to.equal('Eliza Smith');
   });

   it('leaves the literal placeholder in place when the tenant has no active employees yet', async () => {
      const db = table => (table === 'users' ? { where: () => ({ orderBy: () => ({ select: () => Promise.resolve([]) }) }) } : buildStubDb()(table));
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.getWorksheet('Instructions').getCell('D15').value).to.equal(EXAMPLE_PLACEHOLDER_TEXT);
   });

   it('stamps docProps to the requesting account name (or DS2) exactly like the owner path', async () => {
      const base = buildStubDb();
      const db = table => (table === 'accounts' ? { where: () => ({ first: () => Promise.resolve({ account_name: 'Acme Testing Co' }) }) } : base(table));
      const { buffer } = await buildTemplate({ db, accountId: 9001, userId: 7, isOwnerAccount: false });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.creator).to.equal('Acme Testing Co');
      expect(wb.company).to.equal('Acme Testing Co');
   });

   it('throws when the neutral asset does not match its manifest sha256 — never serves an unverified asset', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neutral-asset-test-'));
      const assetPath = path.join(tmpDir, 'neutral-template.xlsx');
      const manifestPath = path.join(tmpDir, 'neutral-template.manifest.json');
      fs.writeFileSync(assetPath, Buffer.from('these are not the reviewed bytes'));
      fs.writeFileSync(manifestPath, JSON.stringify({ sha256: '0'.repeat(64) }));
      expect(() => _loadNeutralAsset(assetPath, manifestPath)).to.throw(/neutral_template_asset_hash_mismatch/);
   });

   it('throws when the asset file is missing', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neutral-asset-test-'));
      expect(() => _loadNeutralAsset(path.join(tmpDir, 'missing.xlsx'), path.join(tmpDir, 'missing.json'))).to.throw(/neutral_template_asset_missing/);
   });

   it('a genuine (correctly matched) asset+manifest pair loads without throwing', () => {
      const { buffer, manifest } = _loadNeutralAsset();
      expect(Buffer.isBuffer(buffer)).to.equal(true);
      expect(manifest).to.have.property('sha256');
   });

   it("the committed neutral-template.xlsx contains none of its own manifest's forbidden tokens", async () => {
      const manifest = JSON.parse(fs.readFileSync(NEUTRAL_MANIFEST_PATH, 'utf8'));
      const assetBuffer = fs.readFileSync(NEUTRAL_ASSET_PATH);
      const parts = await _readZipTextParts(assetBuffer);
      const survivors = [];
      for (const [partName, xml] of Object.entries(parts)) {
         const decoded = _xmlDecodeText(xml);
         for (const token of manifest.forbiddenTokens) {
            if (_tokenAppearsIn(decoded, token)) survivors.push(`"${token}" in ${partName}`);
         }
      }
      expect(survivors, survivors.join('\n')).to.deep.equal([]);
   });

   // Real-world regression (found running the integration suite against
   // ds2_local, 2026-09-24): account 9001's own fixture admin user is
   // literally named "Admin Person", and "Admin" (the REAL firm's own admin
   // account name) is one of the neutral asset's forbidden tokens. Every
   // non-owner download for that account 503'd — the requesting tenant's own
   // legitimate roster entry looked identical to a leak. ownValues is what
   // fixes it: _buildFromNeutralAsset passes the tenant's own current
   // customers/employees/categories/label so this check can tell "this
   // tenant's own data, expected to be here" apart from "a real survivor".
   it("excludes a forbidden token from the scan when it matches the requesting tenant's OWN current data (no false-positive 503)", async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Sheet1').getCell('A1').value = 'Admin Person';
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const manifest = { forbiddenTokens: ['Admin'] };

      // Without ownValues, this is indistinguishable from a real leak.
      const withoutOwnValues = await caught(_assertNoForbiddenTokens(buffer, manifest));
      expect(withoutOwnValues, 'sanity check: "Admin" really is in this buffer').to.be.an('error');

      // With ownValues carrying the tenant's own "Admin Person", the same
      // buffer must be accepted.
      const withOwnValues = await caught(_assertNoForbiddenTokens(buffer, manifest, ['Admin Person']));
      expect(withOwnValues, 'a token matching the tenant\'s own current data must not be treated as a leak').to.equal(null);
   });

   it('still throws for a forbidden token that does NOT match anything in the requesting tenant\'s own current data', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Sheet1').getCell('A1').value = 'Totally Unrelated Text About Jim Kimmel';
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const manifest = { forbiddenTokens: ['Jim Kimmel'] };
      const err = await caught(_assertNoForbiddenTokens(buffer, manifest, ['Eliza Smith', 'Acme Corp']));
      expect(err, 'a real survivor unrelated to the tenant\'s own data must still be refused').to.be.an('error');
      expect(err.message).to.match(/forbidden_token_survived/);
   });

   it('the committed neutral-template.xlsx has exactly the eight allowed sheets, with the lookup sheets veryHidden and the three lookup defined names present', async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync(NEUTRAL_ASSET_PATH));
      expect([...new Set(wb.worksheets.map(ws => ws.name))].sort()).to.deep.equal([...ALLOWED_SHEET_NAMES].sort());
      ['__customers', '__employees', '__categories'].forEach(name => {
         expect(wb.getWorksheet(name).state, name).to.equal('veryHidden');
      });
      const zip = await JSZip.loadAsync(fs.readFileSync(NEUTRAL_ASSET_PATH));
      const wbXml = await zip.files['xl/workbook.xml'].async('string');
      ['EntityList', 'Categories', 'Employees'].forEach(name => {
         expect(wbXml, name).to.match(new RegExp(`<definedName\\s+name="${name}"`));
      });
   });
});

// ─────────────────────────────────────────────────────────────────────────
// scripts/timeTracking/build-neutral-template.js — the offline, by-hand
// tool that PRODUCES the neutral-template.xlsx asset the tests above load.
// These exercise its fail-closed paths directly against small in-memory
// fixtures (DB reachability disabled via checkDb:false so these stay fast,
// hermetic unit tests — the best-effort ds2_local account-1 augmentation
// itself is exercised by actually running the script by hand; see
// src/endpoints/timeTracking/assets/README.md).
describe('build-neutral-template.js (scripts/timeTracking)', () => {
   // A minimal, otherwise-valid eight-sheet package with "Jim Kimmel" as a
   // real roster entry (so it's collected as a forbidden token) — `customize`
   // then injects one specific risky representation elsewhere in the
   // workbook, matching one of Astra's round-10 finding-2 vectors.
   const buildEightSheetFixture = customize => {
      const wb = new ExcelJS.Workbook();
      const time = wb.addWorksheet('Time');
      time.getCell('A1').value = 'Employee Name';
      // A throwaway validation so the "Time sheet still has data
      // validations" round-trip check has something to find — these tests
      // aren't exercising _applyDataValidation, just the fail-closed paths.
      time.dataValidations.add('B1', { type: 'list', allowBlank: true, formulae: ['"a,b"'] });
      wb.addWorksheet('Employee Names').getCell('A1').value = 'Jim Kimmel';
      const instructions = wb.addWorksheet('Instructions');
      wb.addWorksheet('Categories').getCell('A1').value = 'Accounting';
      wb.addWorksheet('Entity').getCell('A1').value = 'James F. Kimmel & Associates';
      const emp = wb.addWorksheet('__employees');
      emp.state = 'veryHidden';
      emp.getCell('A1').value = 'Employee';
      emp.getCell('A2').value = 'Jim Kimmel';
      const cust = wb.addWorksheet('__customers');
      cust.state = 'veryHidden';
      cust.getCell('A1').value = 'Customer';
      const cat = wb.addWorksheet('__categories');
      cat.state = 'veryHidden';
      cat.getCell('A1').value = 'Category';
      if (customize) customize({ wb, instructions });
      return wb;
   };

   it('produces an asset that round-trips through ExcelJS with the eight sheets, hidden flags, validations and lookup defined names intact (real base fixture)', async () => {
      const { buffer, manifest } = await buildNeutralTemplateFromBuffer(fs.readFileSync(REAL_BASE_FIXTURE_PATH), { sourceLabel: 'real-base.xlsx', checkDb: false });
      expect(manifest.sheets).to.deep.equal([...ALLOWED_SHEET_NAMES].sort());

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect([...new Set(wb.worksheets.map(ws => ws.name))].sort()).to.deep.equal([...ALLOWED_SHEET_NAMES].sort());
      ['__customers', '__employees', '__categories'].forEach(name => {
         expect(wb.getWorksheet(name).state, name).to.equal('veryHidden');
      });
      const timeValidations = Object.keys((wb.getWorksheet('Time').dataValidations || {}).model || {});
      expect(timeValidations.length, 'Time sheet must still have data validations').to.be.greaterThan(0);
      const zip = await JSZip.loadAsync(buffer);
      const wbXml = await zip.files['xl/workbook.xml'].async('string');
      ['EntityList', 'Categories', 'Employees'].forEach(name => {
         expect(wbXml, name).to.match(new RegExp(`<definedName\\s+name="${name}"`));
      });
      // The two worked-example cells are the placeholder now, not "Jim Kimmel".
      expect(wb.getWorksheet('Instructions').getCell('D15').value).to.equal(EXAMPLE_PLACEHOLDER_TEXT);
      expect(wb.getWorksheet('Instructions').getCell('D16').value).to.equal(EXAMPLE_PLACEHOLDER_TEXT);
      // Categories' own static vocabulary must survive untouched (same
      // Astra finding-3 regression the runtime tests already cover).
      expect(wb.getWorksheet('Categories').getCell('A3').value).to.equal('Administrative');
   });

   it("rejects Astra's round-10 finding-1 fixture — an extra hidden sheet encoded as an equivalent PAIRED <sheet> tag, not a self-closing one", async () => {
      const err = await caught(buildNeutralTemplateFromBuffer(fs.readFileSync(ASTRA_PAIRED_SHEET_TAGS_FIXTURE_PATH), { checkDb: false }));
      expect(err, 'a workbook whose sheet set is not exactly the eight known sheets must be refused, whichever XML tag form it uses').to.be.an('error');
      expect(err.message).to.match(/eight known sheets/);
   });

   it('rejects a workbook containing a disallowed package part (a cell comment)', async () => {
      const wb = new ExcelJS.Workbook();
      const time = wb.addWorksheet('Time');
      time.getCell('A1').value = 'see comment';
      time.getCell('A1').note = 'Ask Jim Kimmel before changing this.';
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const err = await caught(buildNeutralTemplateFromBuffer(buf, { checkDb: false }));
      expect(err, 'a comment part must refuse the build, never be silently dropped').to.be.an('error');
      expect(err.message).to.match(/disallowed package part/);
   });

   it('rejects a workbook whose worksheet set is not exactly the eight known sheets', async () => {
      const wb = buildEightSheetFixture();
      wb.addWorksheet('Notes').getCell('A1').value = 'internal scratch sheet';
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const err = await caught(buildNeutralTemplateFromBuffer(buf, { checkDb: false }));
      expect(err).to.be.an('error');
      expect(err.message).to.match(/eight known sheets/);
   });

   it('rejects a workbook whose formula still names a foreign roster entry once flattened to its cached value', async () => {
      // A LONGER string than the bare name on purpose: an exact-whole-cell
      // match against a foreign employee's full name would already be
      // caught (and fixed) by the Instructions worked-example replacement
      // step above, which would mask what THIS test means to prove — that
      // the FINAL GATE independently catches a survivor that step doesn't
      // reach, e.g. a name embedded in a longer sentence.
      const wb = buildEightSheetFixture(({ instructions }) => {
         instructions.getCell('Z1').value = { formula: '"Contact "&"Jim Kimmel"', result: 'Contact Jim Kimmel' };
      });
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const err = await caught(buildNeutralTemplateFromBuffer(buf, { checkDb: false }));
      expect(err, 'flattening a formula to its plain value does not launder the name it still spells out').to.be.an('error');
      expect(err.message).to.match(/FINAL GATE failed/);
   });

   it('rejects a workbook whose hyperlink display text still names a foreign roster entry once the link itself is dropped', async () => {
      const wb = buildEightSheetFixture(({ instructions }) => {
         instructions.getCell('Z1').value = { text: 'Contact Jim Kimmel', hyperlink: 'mailto:jim.kimmel@example.com' };
      });
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const err = await caught(buildNeutralTemplateFromBuffer(buf, { checkDb: false }));
      expect(err, 'dropping the hyperlink target does not launder a name left in the display text').to.be.an('error');
      expect(err.message).to.match(/FINAL GATE failed/);
   });

   it('rejects a workbook whose rich-text runs spell out a foreign roster entry once flattened to plain text', async () => {
      // Same reasoning as the formula test above: a longer string than the
      // bare name, so this proves the FINAL GATE catches it rather than the
      // (exact-whole-cell-match only) Instructions worked-example step.
      const wb = buildEightSheetFixture(({ instructions }) => {
         instructions.getCell('Z1').value = { richText: [{ text: 'Contact ' }, { text: 'Jim ' }, { text: 'Kimmel', font: { bold: true } }] };
      });
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const err = await caught(buildNeutralTemplateFromBuffer(buf, { checkDb: false }));
      expect(err, 'flattening rich text runs does not launder the name they spell out together').to.be.an('error');
      expect(err.message).to.match(/FINAL GATE failed/);
   });

   // Unlike the three representations above, a defined name and a quoted
   // numFmt literal are not "flattened and re-checked" — step (c)
   // unconditionally removes every custom defined name and strips every
   // quoted numFmt literal, full stop, regardless of what they contain (the
   // design's "reconstruct from a strict schema" option). That is a
   // STRONGER guarantee than a reactive reject: there is no matching-based
   // detection to ever miss. These two tests prove the removal, not a throw.
   it('unconditionally strips a defined name even when its own name spells out a foreign roster entry', async () => {
      const wb = buildEightSheetFixture();
      let buf = Buffer.from(await wb.xlsx.writeBuffer());
      const zip = await JSZip.loadAsync(buf);
      let wbXml = await zip.files['xl/workbook.xml'].async('string');
      const definedName = '<definedName name="Jim_Kimmel">Time!$A$1</definedName>';
      wbXml = wbXml.includes('<definedNames>') ? wbXml.replace('</definedNames>', `${definedName}</definedNames>`) : wbXml.replace('</sheets>', `</sheets><definedNames>${definedName}</definedNames>`);
      zip.file('xl/workbook.xml', wbXml);
      buf = await zip.generateAsync({ type: 'nodebuffer' });

      const { buffer } = await buildNeutralTemplateFromBuffer(buf, { checkDb: false });
      const outZip = await JSZip.loadAsync(buffer);
      const outWbXml = await outZip.files['xl/workbook.xml'].async('string');
      expect(outWbXml, 'the injected defined name must not survive — every custom defined name is removed, not pattern-matched').to.not.include('Jim_Kimmel');
   });

   it('unconditionally resets a numFmt whose quoted literal spells out a foreign roster entry', async () => {
      const wb = buildEightSheetFixture(({ instructions }) => {
         instructions.getCell('Z1').value = 123;
         instructions.getCell('Z1').numFmt = '"Jim Kimmel "0';
      });
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const { buffer } = await buildNeutralTemplateFromBuffer(buf, { checkDb: false });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer);
      expect(wb2.getWorksheet('Instructions').getCell('Z1').numFmt).to.equal('0');
   });

   it('the produced buffer round-trips clean through _finalGate on a workbook with no forbidden content at all', async () => {
      const wb = buildEightSheetFixture();
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const { buffer, manifest, summary } = await buildNeutralTemplateFromBuffer(buf, { sourceLabel: 'inline-fixture', checkDb: false });
      expect(Buffer.isBuffer(buffer)).to.equal(true);
      expect(manifest.forbiddenTokens).to.include('Jim Kimmel');
      expect(summary.exampleCellsReplaced).to.be.an('array');
   });
});

describe('buildTemplate owner flag is required (fail-closed)', () => {
   it('throws a TypeError before any database read or buffer access when isOwnerAccount is omitted or not a boolean', async () => {
      const sentinelDb = new Proxy(() => {}, {
         get() {
            throw new Error('database must not be touched');
         },
         apply() {
            throw new Error('database must not be touched');
         }
      });
      const sentinelBuffer = new Proxy(Buffer.alloc(0), {
         get() {
            throw new Error('base buffer must not be read');
         }
      });
      for (const flag of [undefined, null, 'true', 1, 0]) {
         let err;
         try {
            await buildTemplate({ db: sentinelDb, accountId: 9001, userId: 7, baseTemplateBuffer: sentinelBuffer, isOwnerAccount: flag });
         } catch (e) {
            err = e;
         }
         expect(err, `flag ${String(flag)}`).to.be.instanceOf(TypeError);
         expect(err.message).to.match(/isOwnerAccount/);
      }
   });
});
