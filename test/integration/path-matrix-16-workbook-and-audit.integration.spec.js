'use strict';
const { PathScenario, expect, ok } = require('./_path-matrix');
const builder = require('../../src/endpoints/timeTracking/template-builder');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

describe('Path matrix: workbook fallbacks and immutable PDF integrity', function () {
   this.timeout(180000);
   let s, base;
   const catalogs = { customers: ['Scenario Client'], employees: ['Scenario Employee'], categories: ['Scenario Work'], accountLabel: 'Scenario Firm' };
   before(async () => { s = await new PathScenario().boot(); const book = new ExcelJS.Workbook(); book.addWorksheet('Time').getCell('A1').value = 'Employee Name'; base = Buffer.from(await book.xlsx.writeBuffer()); });
   after(() => s?.close());
   for (const helper of ['_shrinkFullColumnSqrefs', '_stripBadValidations', '_restoreDefinedNames']) it(`${helper} | archive read failure preserves input bytes and writes nothing`, async () => {
      const before = await s.allState();
      const result = await s.fail(JSZip, 'loadAsync', () => builder[helper](base));
      expect(result.equals(base)).eq(true); expect(await s.allState()).deep.eq(before);
   });
   it('owner template | failed date-validation injection still returns a readable tenant workbook', async () => {
      const before = await s.allState(), original = JSZip.loadAsync; let failed = 0;
      const result = await s.stub(JSZip, 'loadAsync', function (...args) { if (new Error().stack.includes('at _injectDateValidations')) { failed++; throw Error('path-matrix date injection'); } return original.apply(this, args); }, () => builder._buildFromOwnerBytes({ baseTemplateBuffer: base, ...catalogs }));
      expect(failed).eq(1); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(result.buffer);
      expect(wb.getWorksheet('__customers').getCell('A2').value).eq('Scenario Client');
      expect(await s.allState()).deep.eq(before);
   });
   it('lookup worksheet | protection failure retains hidden own-tenant lookup values without database writes', async () => {
      const before = await s.allState(), workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Probe');
      const result = await s.stub(Object.getPrototypeOf(sheet), 'protect', () => { throw Error('path-matrix unsupported protection'); }, () => builder._addLookupSheet(workbook, '__customers', 'Customer', ['Scenario Client']));
      expect(result.state).eq('veryHidden'); expect(result.getCell('A2').value).eq('Scenario Client'); expect(await s.allState()).deep.eq(before);
   });
   it('owner template | allowed package without Time refuses rather than selecting a lookup sheet', async () => {
      const before = await s.allState(), book = new ExcelJS.Workbook(); book.addWorksheet('Employee Names').getCell('A1').value = 'Scenario Employee';
      let error; try { await builder._buildFromOwnerBytes({ baseTemplateBuffer: Buffer.from(await book.xlsx.writeBuffer()), ...catalogs }); } catch (e) { error = e; }
      expect(error?.message).eq('base_template_has_no_data_sheet'); expect(await s.allState()).deep.eq(before);
   });
   it('workbook XML | malformed sheet metadata refuses the package without writes', async () => { const before = await s.allState(); expect(() => builder._parseWorkbookXmlSheetNames('<workbook><sheets></workbook>')).to.throw(/template_builder_workbook_xml_unparsable/); expect(await s.allState()).deep.eq(before); });
   it('parsed worksheet set | unreviewed sheet refuses even after an upstream package check', async () => {
      const before = await s.allState(), book = new ExcelJS.Workbook(); book.addWorksheet('Foreign Customers');
      expect(() => builder._assertAllowedWorksheetSet(book)).to.throw(/template_builder_disallowed_sheet/);
      expect(await s.allState()).deep.eq(before);
   });
   it('POST audit print | missing embedded digest refuses 500 and publishes no record or financial write', async () => {
      const c = await s.customer('PM rejected PDF digest'), original = PDFDocument.prototype.text; let removed = 0;
      await s.stub(PDFDocument.prototype, 'text', function (text, ...args) { if (String(text).startsWith('AUDIT-SHA256/')) { removed++; return this; } return original.call(this, text, ...args); }, () => s.refused(() => s.post(`/auditRecord/customer/${c.id}/1/1/records`, { recordType: 'client' }), 500, 500, /Unable to complete the audit record request/));
      expect(removed).eq(1);
   });
   it('stubbed inference | failed S3 audit store preserves result and writes no database rows', async () => {
      const before = await s.allState(), file = require.resolve('../../src/ai_integrations/bedrock'), cached = require.cache[file], bucket = process.env.LLM_LOG_BUCKET;
      process.env.LLM_LOG_BUCKET = 'ds2-clean'; delete require.cache[file];
      const bedrock = require(file); let failed = 0;
      bedrock._setClientsForTest({ bedrockClient: { send: async () => ({ body: Buffer.from(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] })) }) }, s3Client: { send: async () => { failed++; throw Error('path-matrix S3 audit store'); } } });
      try { expect((await bedrock.invokeBedrockClaude({ modelId: 'local-stub', messages: [], feature: 'path-matrix', accountId: 1 })).json).deep.eq({ ok: true }); }
      finally { require.cache[file] = cached; if (bucket === undefined) delete process.env.LLM_LOG_BUCKET; else process.env.LLM_LOG_BUCKET = bucket; }
      expect(failed).eq(1); expect(await s.allState()).deep.eq(before);
   });
});
