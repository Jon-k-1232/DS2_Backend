/* eslint-disable no-console */
/*
   build-neutral-template.js — OFFLINE, BY-HAND tool. Not run automatically,
   not part of any request path, not scheduled anywhere.

   Usage:
      node scripts/timeTracking/build-neutral-template.js <input.xlsx>

   Run it yourself, by hand, whenever the real firm time-tracker template's
   STRUCTURE changes (a new column, a new validation, a new sheet) and the
   committed asset needs regenerating. It reads a candidate base workbook
   (normally a fresh `GET /template/latest` capture of the real, owner-account
   template) and — if, and only if, it can PROVE the result carries none of
   that workbook's own tenant identity — writes:

      src/endpoints/timeTracking/assets/neutral-template.xlsx
      src/endpoints/timeTracking/assets/neutral-template.manifest.json

   Those two files are meant to be committed. They are the ONLY source of
   bytes for every non-owner /template/latest download from then on — see
   the design-decision comment above buildTemplate in
   src/endpoints/timeTracking/template-builder.js, and
   src/endpoints/timeTracking/assets/README.md for the reviewed-by-hand
   process this script is one step of (a human is expected to look at the
   printed summary AND the input file before trusting the result — this
   script proves the absence of KNOWN risky shapes, it does not replace a
   human looking at the file).

   Why this exists (Astra round 10, 2026-09-23, findings 1 & 2): a runtime
   scrub of whatever the OWNER happens to have uploaded — no matter how
   thorough — cannot be proven to catch every representation OOXML supports
   for carrying a name (rich text runs, a formula that recomputes a name on
   open, a hyperlink target, a data-validation prompt, a quoted literal in a
   number format, a defined name, theme/font metadata). This script performs
   that proof exactly ONCE, offline, against a specific reviewed input, and
   the runtime then just verifies (by sha256) that it's serving the exact
   bytes this script produced — see _loadNeutralAsset /
   _buildFromNeutralAsset in template-builder.js.

   Every step below is FAIL-CLOSED: the moment this script finds something it
   cannot positively prove is tenant-neutral, it throws instead of guessing,
   "sanitizing", or silently dropping the offending part. That is deliberate
   — see the file-level comment block in template-builder.js above
   ALLOWED_SHEET_NAMES for the full rationale (a prior "scrub and hope" design
   is exactly what Astra round 10 broke).

   Steps (see the numbered comments in the code):
     (a) enumerate worksheets TWO independent ways (ExcelJS's parsed model,
         and a real XML parse of the raw workbook.xml) and require them to
         agree, AND to be exactly the eight known sheets;
     (b) allow only the package parts the real template has (reuses
         template-builder.js's own ALLOWED_PART_RES — one allowlist, not two
         that could drift apart);
     (c) flatten/strip every corner Astra round 10 proved can carry a
         foreign identity even inside an "allowed" part — rich text,
         formulas, hyperlinks, cell notes, quoted numFmts, data-validation
         prompts/errors, defined names (all of them — the three lookup
         ranges get restored afterward via template-builder.js's own
         _restoreDefinedNames, the same function the runtime already uses),
         theme name, docProps — then clears the lookup/roster/Time sheets
         entirely and replaces the Instructions worked-example cell(s) that
         name a real employee with a fixed placeholder;
     (d) a FINAL GATE: decodes every text-bearing part of the result and
         fails if any name/token collected from the INPUT's own roster
         sheets (plus, best-effort, ds2_local account 1) still appears
         anywhere;
     (e) writes the asset + manifest and prints a summary.

   `buildNeutralTemplateFromBuffer` below does (a)-(d) and returns the
   produced bytes + manifest without touching disk — that's what
   test/endpoints/timeTracking/template-builder.spec.js calls directly to
   unit-test the script's fail-closed paths against small in-memory
   fixtures. `main()` is the CLI: it adds (e) — reading argv/writing the
   committed files — and only runs when this file is executed directly
   (`require.main === module`), not when required as a module by a test.
*/

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const builder = require('../../src/endpoints/timeTracking/template-builder');

const {
   ALLOWED_SHEET_NAMES,
   ALLOWED_PART_RES,
   EXAMPLE_PLACEHOLDER_TEXT,
   _assertAllowedParts,
   _describeDisallowedPart,
   _collectProtectedWords,
   _collectForeignNames,
   _parseWorkbookXmlSheetNames,
   _shrinkFullColumnSqrefs,
   _addLookupSheet,
   _replaceVisibleNameList,
   _clearEntryRows,
   _neutralizeMetadata,
   _restoreDefinedNames,
   _readZipTextParts,
   _sha256Hex,
   _xmlDecodeText,
   _tokenAppearsIn
} = builder;

const ASSETS_DIR = path.join(__dirname, '..', '..', 'src', 'endpoints', 'timeTracking', 'assets');
const OUT_ASSET_PATH = path.join(ASSETS_DIR, 'neutral-template.xlsx');
const OUT_MANIFEST_PATH = path.join(ASSETS_DIR, 'neutral-template.manifest.json');

class BuildNeutralTemplateError extends Error {}
const fail = message => {
   throw new BuildNeutralTemplateError(message);
};

// Fixed, generic replacement strings for data-validation prompt/error text —
// see the file-level comment's step (c). Deliberately NOT derived from
// whatever text was there: "matching known plain-text names is insufficient"
// (Astra finding 2) applies just as much to a human eyeballing validation
// copy as it does to a regex, so this never tries to decide whether existing
// text is "safe" — it always replaces it.
const NEUTRAL_VALIDATION_TEXT = Object.freeze({
   promptTitle: 'Entry',
   prompt: 'See the Instructions sheet for guidance on this field.',
   errorTitle: 'Invalid entry',
   error: 'See the Instructions sheet for guidance on this field.'
});

const LOOKUP_SHEETS = Object.freeze({ __customers: 'Customer', __employees: 'Employee', __categories: 'Category' });

// ── (a) helpers ─────────────────────────────────────────────────────────

const _sameNameSet = (a, b) => {
   const sa = [...new Set(a)].sort();
   const sb = [...new Set(b)].sort();
   return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
};

// ── (c) helpers ─────────────────────────────────────────────────────────

// Flattens the three object-shaped cell values Astra round 10 proved can
// carry an identity even though the SHEET they live on is allowed: rich
// text, a formula (formula dropped, cached result kept and flattened), and
// a hyperlink (target dropped, display text kept). Anything else
// object-shaped is a value this script has never reviewed — fail closed
// rather than silently pass it through.
const _flattenCellValue = (value, where) => {
   if (value == null || typeof value !== 'object' || value instanceof Date) return value;
   if (Array.isArray(value.richText)) {
      return value.richText.map(run => (typeof run.text === 'string' ? run.text : '')).join('');
   }
   if (typeof value.formula === 'string') {
      const { result } = value;
      if (typeof result === 'string') return result;
      return result == null || typeof result === 'object' ? '' : result;
   }
   if (typeof value.text === 'string' && 'hyperlink' in value) {
      return value.text;
   }
   fail(`unrecognized object-shaped cell value at ${where} (${JSON.stringify(value).slice(0, 120)}) — extend this script deliberately before trusting it with this input.`);
   return value; // unreachable; keeps linters happy about a missing return
};

const _resetQuotedNumFmt = numFmt => {
   if (typeof numFmt !== 'string' || !numFmt.includes('"')) return numFmt;
   const stripped = numFmt.replace(/"[^"]*"/g, '').trim();
   return stripped || 'General';
};

const _neutralizeValidationMessages = sheet => {
   const model = (sheet.dataValidations && sheet.dataValidations.model) || {};
   let touched = 0;
   Object.values(model).forEach(rule => {
      let changedThisRule = false;
      Object.keys(NEUTRAL_VALIDATION_TEXT).forEach(field => {
         if (typeof rule[field] === 'string' && rule[field] && rule[field] !== NEUTRAL_VALIDATION_TEXT[field]) {
            rule[field] = NEUTRAL_VALIDATION_TEXT[field];
            changedThisRule = true;
         }
      });
      if (changedThisRule) touched += 1;
   });
   return touched;
};

// ── (d) final gate ─────────────────────────────────────────────────────
async function _finalGate(buffer, forbiddenTokens) {
   if (!forbiddenTokens.length) return;
   const parts = await _readZipTextParts(buffer);
   for (const [partName, xml] of Object.entries(parts)) {
      const decoded = _xmlDecodeText(xml);
      for (const token of forbiddenTokens) {
         if (_tokenAppearsIn(decoded, token)) {
            // This script runs offline, by hand, and its whole job is to let
            // the operator diagnose exactly this — unlike the runtime's own
            // _assertNoForbiddenTokens (whose failure message can reach a
            // 503 response / shared logs), naming the token here is safe
            // AND necessary to fix the input or this script.
            fail(`(d) FINAL GATE failed: forbidden token "${token}" (from the input's own roster, or ds2_local account 1) still appears in ${partName} of the produced asset. Refusing to write neutral-template.xlsx.`);
         }
      }
   }
}

// ── best-effort ds2_local account-1 augmentation ───────────────────────
async function _collectAccount1TokensBestEffort() {
   let knex;
   try {
      // eslint-disable-next-line global-require
      const { makeDb } = require('../_db');
      knex = makeDb({ envFile: '.env.local', database: 'ds2_local', poolMax: 2 });
      const [customers, users] = await Promise.all([knex('customers').where({ account_id: 1 }).pluck('display_name'), knex('users').where({ account_id: 1 }).pluck('display_name')]);
      return [...customers, ...users]
         .filter(v => typeof v === 'string')
         .map(v => v.trim())
         .filter(v => v.length >= 4);
   } catch (e) {
      console.warn(`[build-neutral-template] account-1 DB reachability check skipped (${e.message}) — forbidden-token list is based solely on the input workbook's own roster sheets.`);
      return [];
   } finally {
      if (knex) {
         try {
            await knex.destroy();
         } catch (e2) {
            // ignore — best-effort cleanup only
         }
      }
   }
}

// ── (a)-(d): the testable core. Takes an in-memory buffer, never touches
// disk (other than the best-effort DB check above, which is a network call,
// not a filesystem one). Returns { buffer, manifest, summary } or throws a
// BuildNeutralTemplateError. `sourceLabel` is cosmetic (manifest.sourceFile
// and a couple of messages only) — pass a real path's basename from main(),
// or anything descriptive from a test.
async function buildNeutralTemplateFromBuffer(inputBuffer, { sourceLabel = '<buffer>', checkDb = true } = {}) {
   const summary = { flattenedCells: 0, droppedNotes: 0, resetNumFmts: 0, neutralizedValidationRules: 0, definedNamesRemoved: [], exampleCellsReplaced: [], dbTokensUsed: false };

   // ---- (a) enumerate worksheets two independent ways, require agreement ----
   const inputZip = await JSZip.loadAsync(inputBuffer);
   const partNames = Object.keys(inputZip.files).filter(n => !inputZip.files[n].dir);

   for (const name of partNames) {
      if (!ALLOWED_PART_RES.some(re => re.test(name))) {
         fail(`(b) disallowed package part: ${_describeDisallowedPart(name)} ("${name}"). The input is not the reviewed, tenant-neutral package shape — this script refuses to guess which parts of it are safe.`);
      }
   }

   if (!inputZip.files['xl/workbook.xml']) fail('input has no xl/workbook.xml');
   const inputWbXml = await inputZip.files['xl/workbook.xml'].async('string');
   const xmlSheetNames = _parseWorkbookXmlSheetNames(inputWbXml);

   const preprocessed = await _shrinkFullColumnSqrefs(inputBuffer);
   const workbook = new ExcelJS.Workbook();
   await workbook.xlsx.load(preprocessed);
   const excelJsSheetNames = workbook.worksheets.map(ws => ws.name);

   if (!_sameNameSet(xmlSheetNames, excelJsSheetNames)) {
      fail(`(a) ExcelJS's parsed sheet set ${JSON.stringify(excelJsSheetNames)} disagrees with a real XML parse of workbook.xml ${JSON.stringify(xmlSheetNames)} — refusing to trust either parser alone.`);
   }
   const expectedSheets = [...ALLOWED_SHEET_NAMES].sort();
   const actualSheets = [...new Set(excelJsSheetNames)].sort();
   if (JSON.stringify(actualSheets) !== JSON.stringify(expectedSheets)) {
      fail(`(a) input worksheet set ${JSON.stringify(actualSheets)} is not EXACTLY the eight known sheets ${JSON.stringify(expectedSheets)}.`);
   }
   summary.sheets = actualSheets;

   // ---- forbidden tokens: collected from the INPUT before anything is cleared ----
   const protectedWords = _collectProtectedWords(workbook);
   const foreign = _collectForeignNames(workbook, protectedWords);
   const inputTokens = [...new Set([...foreign.customerNames, ...foreign.employeeNames, ...foreign.employeeTokens])].filter(Boolean);

   const dbTokens = checkDb ? await _collectAccount1TokensBestEffort() : [];
   summary.dbTokensUsed = dbTokens.length > 0;
   const forbiddenTokens = [...new Set([...inputTokens, ...dbTokens])].filter(Boolean);
   summary.inputTokenCount = inputTokens.length;
   summary.dbTokenCount = dbTokens.length;

   // ---- (c) flatten / strip every cell across every sheet ----
   workbook.worksheets.forEach(sheet => {
      sheet.eachRow({ includeEmpty: false }, row => {
         row.eachCell({ includeEmpty: false }, cell => {
            const where = `${sheet.name}!${cell.address}`;
            const before = cell.value;
            if (before != null && typeof before === 'object' && !(before instanceof Date)) {
               cell.value = _flattenCellValue(before, where);
               summary.flattenedCells += 1;
            }
            if (cell.note != null) {
               cell.note = undefined;
               summary.droppedNotes += 1;
            }
            const beforeFmt = cell.numFmt;
            const afterFmt = _resetQuotedNumFmt(beforeFmt);
            if (afterFmt !== beforeFmt) {
               cell.numFmt = afterFmt;
               summary.resetNumFmts += 1;
            }
         });
      });
      summary.neutralizedValidationRules += _neutralizeValidationMessages(sheet);
   });

   // ---- clear lookup / roster / Time sheets entirely ----
   Object.entries(LOOKUP_SHEETS).forEach(([sheetName, header]) => {
      _addLookupSheet(workbook, sheetName, header, []);
   });
   _replaceVisibleNameList(workbook, 'Employee Names', []);

   const dataSheet = workbook.getWorksheet('Time');
   if (!dataSheet) fail('input has no "Time" sheet');
   // Default headerRow=5, same as the runtime call in _buildFromOwnerBytes /
   // _buildFromNeutralAsset — rows 1-5 are the form's own header/label rows
   // (e.g. A1 "Employee Name", the row-5 column headers), not data.
   _clearEntryRows(dataSheet);

   // ---- replace worked-example cell(s) that name a real employee, found BY CONTENT ----
   // The addresses found here are recorded (manifest.exampleCellAddresses)
   // and are what the RUNTIME uses to fill in each tenant's own name — see
   // the comment on EXAMPLE_PLACEHOLDER_TEXT in template-builder.js for why
   // the runtime can't just re-search for the placeholder text itself: it's
   // a plain, friendly string ("Employee Name") that collides with the real
   // Instructions sheet's OWN, unrelated field-label cell of the same text
   // (Instructions!A5) — content-matching only works here, once, because
   // we're searching for the ORIGINAL FOREIGN NAME, which is distinctive.
   const exampleCellAddresses = [];
   const instructions = workbook.getWorksheet('Instructions');
   if (instructions) {
      instructions.eachRow({ includeEmpty: false }, row => {
         row.eachCell({ includeEmpty: false }, cell => {
            if (typeof cell.value === 'string' && foreign.employeeNames.includes(cell.value)) {
               summary.exampleCellsReplaced.push(`${cell.address} (was a foreign employee's full name)`);
               exampleCellAddresses.push(`Instructions!${cell.address}`);
               cell.value = EXAMPLE_PLACEHOLDER_TEXT;
            }
         });
      });
   }

   // ---- docProps: unconditional neutral stamp (no tenant yet — the asset itself has none) ----
   _neutralizeMetadata(workbook, null);

   // ---- write, then two raw-XML passes: strip ALL defined names, reset theme name(s) ----
   let buffer = Buffer.from(await workbook.xlsx.writeBuffer());

   const zip = await JSZip.loadAsync(buffer);
   if (zip.files['xl/workbook.xml']) {
      let wbXml = await zip.files['xl/workbook.xml'].async('string');
      const definedNamesBlock = wbXml.match(/<definedNames>[\s\S]*?<\/definedNames>/);
      if (definedNamesBlock) {
         const removedNames = [...definedNamesBlock[0].matchAll(/<definedName\s+name="([^"]*)"/g)].map(m => m[1]);
         summary.definedNamesRemoved = removedNames;
         wbXml = wbXml.replace(definedNamesBlock[0], '');
         zip.file('xl/workbook.xml', wbXml);
      }
   }
   const themeParts = Object.keys(zip.files).filter(n => /^xl\/theme\/theme\d+\.xml$/.test(n));
   for (const themePart of themeParts) {
      const themeXml = await zip.files[themePart].async('string');
      const renamed = themeXml.replace(/(<a:theme[^>]*\bname=")[^"]*(")/, '$1DS2 Theme$2');
      if (renamed !== themeXml) zip.file(themePart, renamed);
   }
   buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));

   // The three lookup-range defined names (EntityList / Categories /
   // Employees) are structural, generic references — never tenant-
   // identifying — so the asset ships WITH them already restored, via the
   // exact same function the runtime calls on every build. Calling it again
   // at request time (see _buildFromNeutralAsset) is then a harmless no-op
   // unless ExcelJS's own load+write cycle dropped them again in the
   // meantime (a known quirk _restoreDefinedNames exists to fix either way).
   buffer = Buffer.from(await _restoreDefinedNames(buffer));

   // ---- (d) FINAL GATE ----
   await _finalGate(buffer, forbiddenTokens);

   // ---- round-trip verification ----
   // Package-part shape, one more time, on the FINAL bytes (catches an
   // ExcelJS quirk introduced by any of the writeBuffer() passes above —
   // exactly how the _replaceVisibleNameList empty-comment bug surfaced
   // during this script's own development; see the fix in
   // template-builder.js's _replaceVisibleNameList).
   await _assertAllowedParts(buffer);

   const verify = new ExcelJS.Workbook();
   await verify.xlsx.load(buffer);
   const verifySheets = [...new Set(verify.worksheets.map(ws => ws.name))].sort();
   if (JSON.stringify(verifySheets) !== JSON.stringify(expectedSheets)) {
      fail(`round-trip check: produced asset's sheet set ${JSON.stringify(verifySheets)} is not the expected eight.`);
   }
   ['__customers', '__employees', '__categories'].forEach(name => {
      const ws = verify.getWorksheet(name);
      if (!ws || ws.state !== 'veryHidden') fail(`round-trip check: "${name}" is not veryHidden in the produced asset.`);
   });
   const verifyWbXml = await (await JSZip.loadAsync(buffer)).files['xl/workbook.xml'].async('string');
   ['EntityList', 'Categories', 'Employees'].forEach(name => {
      if (!new RegExp(`<definedName\\s+name="${name}"`).test(verifyWbXml)) {
         fail(`round-trip check: lookup defined name "${name}" is missing from the produced asset.`);
      }
   });
   const verifyTimeValidations = Object.keys((verify.getWorksheet('Time').dataValidations || {}).model || {});
   if (!verifyTimeValidations.length) fail("round-trip check: the produced asset's Time sheet has no data validations left.");

   const manifest = {
      sha256: _sha256Hex(buffer),
      sourceFile: sourceLabel,
      sourceSha256: _sha256Hex(inputBuffer),
      generatedAt: new Date().toISOString(),
      sheets: verifySheets,
      parts: Object.keys((await JSZip.loadAsync(buffer)).files)
         .filter(n => !n.endsWith('/'))
         .sort(),
      forbiddenTokens,
      exampleCellAddresses
   };

   return { buffer, manifest, summary };
}

// ── CLI ─────────────────────────────────────────────────────────────────
async function main() {
   const inputArg = process.argv[2];
   if (!inputArg) {
      fail('usage: node scripts/timeTracking/build-neutral-template.js <input.xlsx>');
   }
   const inputPath = path.resolve(process.cwd(), inputArg);
   const inputBuffer = fs.readFileSync(inputPath);

   const { buffer, manifest, summary } = await buildNeutralTemplateFromBuffer(inputBuffer, { sourceLabel: path.basename(inputPath) });

   fs.mkdirSync(ASSETS_DIR, { recursive: true });
   fs.writeFileSync(OUT_ASSET_PATH, buffer);
   fs.writeFileSync(OUT_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

   console.log('build-neutral-template: wrote');
   console.log(' ', OUT_ASSET_PATH, `(${buffer.length} bytes, sha256 ${manifest.sha256})`);
   console.log(' ', OUT_MANIFEST_PATH);
   console.log('\nSummary:');
   console.log(`  input: ${inputPath} (${inputBuffer.length} bytes, sha256 ${manifest.sourceSha256})`);
   console.log(`  sheets: ${manifest.sheets.join(', ')}`);
   console.log(`  flattened object-shaped cells (rich text / formula / hyperlink): ${summary.flattenedCells}`);
   console.log(`  dropped cell notes: ${summary.droppedNotes}`);
   console.log(`  reset quoted numFmts: ${summary.resetNumFmts}`);
   console.log(`  data-validation rules with prompt/error text neutralized: ${summary.neutralizedValidationRules}`);
   console.log(`  defined names removed (then restored for the 3 canonical lookups only): ${JSON.stringify(summary.definedNamesRemoved)}`);
   console.log(`  Instructions worked-example cells replaced with "${EXAMPLE_PLACEHOLDER_TEXT}": ${JSON.stringify(summary.exampleCellsReplaced)}`);
   console.log(`  forbidden-token list size: ${manifest.forbiddenTokens.length} (from input roster: ${summary.inputTokenCount}; from ds2_local account 1: ${summary.dbTokensUsed ? summary.dbTokenCount : 'DB unreachable, skipped'})`);
   console.log('  FINAL GATE: passed — none of the forbidden tokens appear anywhere in the produced asset.');
}

module.exports = { buildNeutralTemplateFromBuffer, BuildNeutralTemplateError, OUT_ASSET_PATH, OUT_MANIFEST_PATH, ASSETS_DIR };

if (require.main === module) {
   main()
      .then(() => process.exit(0))
      .catch(e => {
         console.error(`\nbuild-neutral-template FAILED: ${e.message}`);
         process.exit(1);
      });
}
