const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SaxesParser } = require('saxes');

const COLLAPSE_WINDOW_MS = Number(process.env.TEMPLATE_COLLAPSE_WINDOW_MS || 60_000);
const PROTECT_PASSWORD = process.env.TEMPLATE_PROTECT_PASSWORD || 'jka-internal';
const MAX_DATA_ROWS = Number(process.env.TEMPLATE_MAX_DATA_ROWS || 1500);

/**
 * The prod tracker template (and others authored in Excel) often contains
 * dataValidations with `sqref="D1:D1048576"` (entire column = 1,048,576 cells).
 * ExcelJS's load() expands those ranges cell-by-cell into a Map, which
 * pegs CPU at 100% for several minutes per such range — effectively a hang.
 * Pre-process the buffer's sheet XML to cap those ranges at MAX_DATA_ROWS
 * before handing it to ExcelJS. The user-visible result is identical: Excel
 * still applies the validation to every relevant row.
 */
const _shrinkFullColumnSqrefs = async buffer => {
   try {
      const zip = await JSZip.loadAsync(buffer);
      const sheetFiles = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
      let modified = false;
      for (const name of sheetFiles) {
         const xml = await zip.files[name].async('string');
         const replaced = xml.replace(/sqref="([^"]+)"/g, (match, sqref) => {
            const tightened = sqref.replace(/(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?)1048576/g, (_m, start, endCol) => `${start}:${endCol}${MAX_DATA_ROWS}`);
            return `sqref="${tightened}"`;
         });
         if (replaced !== xml) {
            zip.file(name, replaced);
            modified = true;
         }
      }
      if (!modified) return buffer;
      return zip.generateAsync({ type: 'nodebuffer' });
   } catch (e) {
      return buffer;
   }
};

/**
 * Strip baked-in validations on B2 (Start Date), B3 (End Date), and the
 * A-column date column from the prod tracker XLSX. The base template
 * has four overlapping date rules on A and uses operator="greaterThan"
 * with a hardcoded serial 45292 (Jan 1 2024) on B2/B3, with no B3>B2
 * cross-check. We re-author cleaner ones below in _applyDataValidation.
 *
 * Also strips the customer-list validation that was previously applied
 * to column B by template-builder — it conflicted with the base
 * template's Entity dropdown on column B; the correct target is column
 * D (Company Name). We rebuild dropdowns from scratch below.
 */
const RANGES_TO_STRIP = new Set([
   // Bad date validations on B2/B3 — replaced with cell-reference rules below.
   'B2', 'B3',
   // Overlapping A-column date validations — replaced with one A6:A<MAX> rule
   // that enforces the entry date falls inside the tracker window.
   'A5', 'A6', 'A7:A1500', 'A10:A1500',
   `A6:A${MAX_DATA_ROWS}`, `A7:A${MAX_DATA_ROWS}`, `A10:A${MAX_DATA_ROWS}`,
   // Static Category dropdowns (use the workbook's `Categories` named range)
   // — replaced with the dynamic `__categories` lookup that always reflects
   // the live customer_job_categories table.
   'C5', 'C6:C1500', 'C10:C1500', `C6:C${MAX_DATA_ROWS}`, `C10:C${MAX_DATA_ROWS}`
]);

/**
 * ExcelJS silently drops workbook-scope defined names (e.g. `EntityList`,
 * `Categories`, `Employees`) that reference full-column ranges on save.
 * The base template's Entity dropdown validation on B6:B<MAX> references
 * `EntityList` by name — after ExcelJS round-trips the workbook, the name
 * is gone and the dropdown shows up empty in Excel. We restore the names
 * we care about by splicing them back into workbook.xml.
 */
const _restoreDefinedNames = async buffer => {
   try {
      const zip = await JSZip.loadAsync(buffer);
      const wbPath = 'xl/workbook.xml';
      if (!zip.files[wbPath]) return buffer;
      let wb = await zip.files[wbPath].async('string');
      const need = [
         { name: 'EntityList', target: "Entity!$A:$A" },
         { name: 'Categories', target: "Categories!$A:$A" },
         { name: 'Employees', target: "'Employee Names'!$A:$A" }
      ];
      const missing = need.filter(n => !new RegExp(`<definedName\\s+name="${n.name}"`).test(wb));
      if (missing.length === 0) return buffer;
      const block = missing.map(n => `<definedName name="${n.name}">${n.target}</definedName>`).join('');
      if (/<definedNames>/.test(wb)) {
         wb = wb.replace(/<\/definedNames>/, block + '</definedNames>');
      } else {
         // Insert a new <definedNames>...</definedNames> block between
         // </sheets> and <calcPr (or end of workbook).
         const wrapped = `<definedNames>${block}</definedNames>`;
         if (/<\/sheets>/.test(wb)) {
            wb = wb.replace(/<\/sheets>/, '</sheets>' + wrapped);
         } else {
            wb = wb.replace(/<\/workbook>/, wrapped + '</workbook>');
         }
      }
      zip.file(wbPath, wb);
      return zip.generateAsync({ type: 'nodebuffer' });
   } catch (e) {
      console.error('[template-builder] _restoreDefinedNames failed:', e.message);
      return buffer;
   }
};

/**
 * Inject B2 / B3 / A6:A<MAX> date validations directly into the worksheet
 * XML after ExcelJS finishes writing. We can't use ExcelJS's data-validation
 * API for these because it tries to coerce formula strings like
 * `TODAY()-365` and `B2` to numbers (yielding NaN in the generated XML).
 * The XML format is well-known; we just splice the new <dataValidation>
 * elements into the existing <dataValidations> block.
 */
const _injectDateValidations = async buffer => {
   try {
      const zip = await JSZip.loadAsync(buffer);
      const sheetFiles = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
      let modified = false;
      // We only want to inject into the primary data sheet, which is the
      // first sheet that ISN'T one of our hidden lookup sheets. The lookup
      // sheets are veryHidden and have no dataValidations block of interest.
      // Heuristic: the first sheet that already has a dataValidations block
      // we just edited (i.e., contains sqref="B1" with __employees lookup).
      for (const name of sheetFiles) {
         const xml = await zip.files[name].async('string');
         if (!xml.includes('__employees!')) continue;
         const dateTags =
            `<dataValidation type="date" operator="greaterThanOrEqual" allowBlank="0" showInputMessage="1" showErrorMessage="1" errorStyle="stop" promptTitle="MM/DD/YYYY" prompt="Tracker period start. Must be within the last 365 days." errorTitle="Invalid start date" error="Start Date must be a real date within the last year (MM/DD/YYYY)." sqref="B2"><formula1>TODAY()-365</formula1></dataValidation>` +
            `<dataValidation type="date" operator="greaterThanOrEqual" allowBlank="0" showInputMessage="1" showErrorMessage="1" errorStyle="stop" promptTitle="MM/DD/YYYY" prompt="Tracker period end. Must be on or after the Start Date in B2." errorTitle="Invalid end date" error="End Date must be on or after the Start Date in B2 (MM/DD/YYYY)." sqref="B3"><formula1>$B$2</formula1></dataValidation>` +
            `<dataValidation type="date" operator="between" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop" promptTitle="MM/DD/YYYY" prompt="Date of this entry — must fall between the Start (B2) and End (B3) dates." errorTitle="Date outside tracker window" error="Entry date must be between the Start Date (B2) and End Date (B3)." sqref="A6:A${MAX_DATA_ROWS}"><formula1>$B$2</formula1><formula2>$B$3</formula2></dataValidation>`;
         let next = xml;
         if (xml.includes('<dataValidations')) {
            // Splice into the existing block, bumping its count.
            next = next.replace(/<dataValidations\s+count="(\d+)"(\s*[^>]*)>/, (m, c, rest) => {
               const newCount = Number(c) + 3;
               return `<dataValidations count="${newCount}"${rest || ''}>${dateTags}`;
            });
         } else {
            // No existing block — add one just before <pageMargins> (or end of sheet).
            const block = `<dataValidations count="3">${dateTags}</dataValidations>`;
            if (next.includes('<pageMargins')) {
               next = next.replace(/<pageMargins/, block + '<pageMargins');
            } else {
               next = next.replace(/<\/worksheet>/, block + '</worksheet>');
            }
         }
         if (next !== xml) {
            zip.file(name, next);
            modified = true;
         }
      }
      if (!modified) return buffer;
      return zip.generateAsync({ type: 'nodebuffer' });
   } catch (e) {
      console.error('[template-builder] _injectDateValidations failed:', e.message);
      return buffer;
   }
};

const _stripBadValidations = async buffer => {
   try {
      const zip = await JSZip.loadAsync(buffer);
      const sheetFiles = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
      let modified = false;
      const shouldStrip = (whole, sqref) => (RANGES_TO_STRIP.has(sqref.trim()) ? '' : whole);
      // Two non-overlapping regexes:
      //   - selfCloseRe: <dataValidation ... sqref="..." ... />
      //   - contentRe:   <dataValidation ... sqref="..." ...>(formulae)</dataValidation>
      // The content regex uses (?<!\/) before its `>` so it won't accidentally
      // match a self-closing tag's `/>` and then greedily consume downstream
      // tags. Quantifiers are lazy to keep each match tight.
      const selfCloseRe = /<dataValidation\b[^>]*?\bsqref="([^"]+)"[^>]*?\/>/g;
      const contentRe = /<dataValidation\b[^>]*?\bsqref="([^"]+)"[^>]*?(?<!\/)>[\s\S]*?<\/dataValidation>/g;
      for (const name of sheetFiles) {
         const xml = await zip.files[name].async('string');
         const afterSelf = xml.replace(selfCloseRe, shouldStrip);
         const cleaned = afterSelf.replace(contentRe, shouldStrip);
         if (cleaned !== xml) {
            // Fix up the dataValidations count attribute so Excel doesn't warn.
            const newCount = (cleaned.match(/<dataValidation\b/g) || []).length;
            const fixedCount = cleaned.replace(/<dataValidations\s+count="\d+"/, `<dataValidations count="${newCount}"`);
            zip.file(name, fixedCount);
            modified = true;
         }
      }
      if (!modified) return buffer;
      return zip.generateAsync({ type: 'nodebuffer' });
   } catch (e) {
      return buffer;
   }
};

const _cache = new Map();

const _cacheKey = ({ accountId, userId }) => `acct:${accountId}:user:${userId}`;
const _now = () => Date.now();

const _readCatalogs = async (db, accountId) => {
   // The "Category" column on the time tracker historically meant a work-type
   // descriptor like "Email", "Phone Call", "Tax Return Preparation" — those
   // live in customer_general_work_descriptions (~49 active rows in prod),
   // NOT customer_job_categories (4 business lines: Accounting / Insurance /
   // Rental Property / Securities). The original dynamic builder mistakenly
   // pulled the 4-row table, so the dropdown was effectively empty compared
   // to the static list users were used to. This now matches the historical
   // base template content + what the AI ingest actually expects.
   const [customers, employees, categories] = await Promise.all([
      db('customers')
         .where({ account_id: accountId, is_customer_active: true })
         .orderBy('display_name')
         .select('customer_id', 'display_name'),
      db('users')
         .where({ account_id: accountId, is_user_active: true })
         .orderBy('display_name')
         .select('user_id', 'display_name'),
      db('customer_general_work_descriptions')
         .where({ account_id: accountId, is_general_work_description_active: true })
         .orderBy('general_work_description')
         .select('general_work_description_id', 'general_work_description')
   ]);
   return {
      customers: customers.map(c => c.display_name).filter(Boolean),
      employees: employees.map(e => e.display_name).filter(Boolean),
      categories: categories.map(c => c.general_work_description).filter(Boolean)
   };
};

// The base template also carries a VISIBLE 'Employee Names' sheet (no header
// row; the workbook-scope `Employees` defined name points its whole column A
// at it — see _restoreDefinedNames). It predates the __employees hidden
// lookup sheet and is not what the B1 dropdown actually validates against
// once buildTemplate has run (_applyDataValidation points B1 at
// __employees!$A$2:$A$N directly), but it is still rendered to the user and,
// left untouched, keeps showing whichever account the base template was last
// captured from. Overwrite ALL of its existing content — every row AND every
// column, not just column A — with THIS account's own active staff so no
// other tenant's names are visible in the downloaded workbook.
//
// Astra finding 2 (round 9, 2026-09-23): a prior version of this only ever
// touched column A, so a stray value planted in Employee Names!B1 survived a
// rebuild untouched. "Cleared completely" now means the sheet's whole used
// range, including any cell note, not just the one column this sheet is
// supposed to hold.
const _replaceVisibleNameList = (workbook, sheetName, items) => {
   const sheet = workbook.getWorksheet(sheetName);
   if (!sheet) return; // base template shape may vary across versions; nothing to fix
   const rowsToClear = Math.max(sheet.rowCount, items.length);
   const colsToClear = Math.max(sheet.columnCount, 1);
   for (let r = 1; r <= rowsToClear; r += 1) {
      for (let c = 1; c <= colsToClear; c += 1) {
         const cell = sheet.getCell(r, c);
         cell.value = null;
         // Round 10 fix: unconditionally assigning `cell.note = undefined`
         // — even to a cell that never had one — makes ExcelJS's writer
         // fabricate a brand-new EMPTY comment for that cell (an
         // xl/comments*.xml + xl/drawings/vmlDrawing*.vml pair with
         // `<text/>`), on every single build. That silently reintroduced
         // exactly the disallowed-package-part risk the fail-closed
         // allowlist exists to catch (see ALLOWED_PART_RES) — just with
         // empty content this time. Only touch `.note` on a cell that
         // actually already has one.
         if (cell.note != null) cell.note = undefined;
      }
   }
   items.forEach((item, i) => {
      sheet.getCell(i + 1, 1).value = item;
   });
};

const _addLookupSheet = (workbook, sheetName, header, items) => {
   let sheet = workbook.getWorksheet(sheetName);
   if (sheet) workbook.removeWorksheet(sheet.id);
   sheet = workbook.addWorksheet(sheetName);
   sheet.getCell('A1').value = header;
   items.forEach((item, i) => {
      sheet.getCell(`A${i + 2}`).value = item;
   });
   sheet.state = 'veryHidden';
   try {
      sheet.protect(PROTECT_PASSWORD, { selectLockedCells: false });
   } catch (e) {
      // older ExcelJS versions ignore protect — non-fatal.
   }
   return sheet;
};

// ─────────────────────────────────────────────────────────────────────────
// Fail-closed package allowlist (Astra round 9, finding 2, 2026-09-23).
//
// A prior version of this file scrubbed whatever text it could find inside
// the workbook and trusted a successful ExcelJS round trip as proof the
// output was safe to hand another tenant. Astra proved that wrong: a
// rebuilt copy of the real base with a hidden sheet named "Jim Kimmel", a
// formula whose literal returned that name, a hyperlink to
// mailto:jim.kimmel@example.com, and a stray value in Employee Names!B1 all
// survived into the "sanitized" output. None of that lives somewhere a
// per-cell text scrub can safely reach, or even knows to look — a whole
// extra worksheet, a drawing, a comment, custom XML, a table, a pivot
// cache, an external link, or any other package part this file has never
// reviewed must never be silently laundered through. It has to refuse the
// entire rebuild instead of guessing.
//
// ALLOWED_SHEET_NAMES and ALLOWED_PART_RES are drawn directly from the real
// base template as downloaded during this review (Time, Employee Names,
// Instructions, Categories, Entity, __customers, __employees, __categories
// — see test/fixtures/timetrackers/README.md). Both checks run against the
// RAW zip, before ExcelJS ever touches the buffer, so neither can be fooled
// by anything ExcelJS's own loader silently drops or normalizes away on
// load. A thrown error here propagates straight out of buildTemplate — its
// caller (the /template/latest route) already turns any builder failure
// into a 503 for non-owner accounts rather than ever falling back to
// raw/unscrubbed bytes (see timeTracking-router.js).
const ALLOWED_SHEET_NAMES = new Set(['Time', 'Employee Names', 'Instructions', 'Categories', 'Entity', '__customers', '__employees', '__categories']);

const ALLOWED_PART_RES = [
   /^\[Content_Types\]\.xml$/,
   /^_rels\/\.rels$/,
   /^xl\/workbook\.xml$/,
   /^xl\/_rels\/workbook\.xml\.rels$/,
   /^xl\/worksheets\/sheet\d+\.xml$/,
   // The real base has no hyperlinks today, but a worksheet-relationship
   // part for one is still an ordinary, supported package part — a
   // hyperlink naming a foreign person is handled once ExcelJS has loaded
   // it (see _neutralizeCellValue), not refused outright the way a drawing
   // or comment relationship is. This pattern does NOT, by itself, permit a
   // drawing/vmlDrawing/etc. part — those are refused directly below no
   // matter what any worksheet rels file points at.
   /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/,
   /^xl\/theme\/theme\d+\.xml$/,
   /^xl\/styles\.xml$/,
   /^xl\/sharedStrings\.xml$/,
   /^docProps\/core\.xml$/,
   /^docProps\/app\.xml$/
];

// Purely cosmetic (a legible thrown error / log line): matching one of these
// labels a part as a KNOWN bad category. NOT matching ALLOWED_PART_RES above
// is what actually makes any part disallowed, hint or no hint.
const KNOWN_DISALLOWED_PART_HINTS = [
   { test: /^xl\/drawings\//, label: 'a drawing/image part' },
   { test: /^xl\/media\//, label: 'an embedded image' },
   { test: /^xl\/comments\d*\.xml$/, label: 'a comment part' },
   { test: /^customXml\//, label: 'a custom XML part' },
   { test: /^xl\/tables\//, label: 'a table part' },
   { test: /^xl\/pivotCache/, label: 'a pivot cache part' },
   { test: /^xl\/pivotTables\//, label: 'a pivot table part' },
   { test: /^xl\/externalLinks\//, label: 'an external link part' },
   { test: /^xl\/vbaProject\.bin$/, label: 'a macro project' }
];

const _describeDisallowedPart = name => {
   const hint = KNOWN_DISALLOWED_PART_HINTS.find(h => h.test.test(name));
   return hint ? hint.label : 'an unknown package part';
};

// Real XML parsing (via `saxes`, already a transitive exceljs dependency —
// see package-lock.json) for the <sheet> elements inside xl/workbook.xml.
//
// Astra finding 1 (round 10, 2026-09-23): the regex this replaced —
// /<sheet\b[^>]*\bname="([^"]*)"[^>]*\/>/g — only matched the SELF-CLOSING
// tag form (<sheet name="Time" .../>). OOXML permits an equivalent PAIRED
// form (<sheet name="Time" ...></sheet>); a workbook.xml rewritten to use
// paired tags for every <sheet> sailed straight through with its sheet names
// completely unchecked (the reviewer's repro kept a hidden "Jim Kimmel"
// sheet this way — see test/fixtures/timetrackers/astra-paired-sheet-tags.xlsx).
// A real parser handles both forms (and entity-decodes the name) identically,
// because they ARE identical — there is no "form" for an allowlist to miss.
const _parseWorkbookXmlSheetNames = xml => {
   const names = [];
   let parseError = null;
   const parser = new SaxesParser();
   parser.on('error', e => {
      parseError = e;
   });
   parser.on('opentag', node => {
      if (node.name === 'sheet' && typeof node.attributes.name === 'string') {
         names.push(node.attributes.name);
      }
   });
   parser.write(xml).close();
   if (parseError) {
      throw new Error(`template_builder_workbook_xml_unparsable: could not parse xl/workbook.xml (${parseError.message}). Non-owner downloads can only be rebuilt from the reviewed tenant-neutral package shape.`);
   }
   return names;
};

// Finding 1's fix also calls for validating "the loaded/output worksheet set
// as well" — belt-and-suspenders in case the raw-XML parse above and
// ExcelJS's own parser were ever to disagree about what a <sheet> element
// means. Called right after workbook.xlsx.load() in both build paths below.
const _assertAllowedWorksheetSet = workbook => {
   for (const ws of workbook.worksheets) {
      if (!ALLOWED_SHEET_NAMES.has(ws.name)) {
         throw new Error(
            `template_builder_disallowed_sheet: worksheet "${ws.name}" is not one of the template's allowed sheets. Non-owner downloads can only be rebuilt from the reviewed tenant-neutral package shape.`
         );
      }
   }
};

// Throws — never "sanitizes" — the instant the base object contains
// anything outside the reviewed, tenant-neutral package shape: a package
// part this file doesn't recognize, or a worksheet whose name isn't one of
// the template's own. See the file-level comment above for why this has to
// be fail-closed rather than best-effort.
// Just the package-part half of the allowlist — split out so the
// non-owner build path (which trusts the asset's SHAPE via its sha256 rather
// than re-parsing workbook.xml on every request) can still cheaply re-check
// the part list of what it's ABOUT to serve, after the per-tenant steps have
// run. Round 10: this is exactly what would have caught the
// _replaceVisibleNameList empty-comment bug (see the fix there) producing an
// unreviewed xl/comments*.xml + xl/drawings/vmlDrawing*.vml pair on every
// single build — belt-and-suspenders against the NEXT such ExcelJS quirk.
const _assertAllowedParts = async buffer => {
   const zip = await JSZip.loadAsync(buffer);
   const partNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);
   for (const name of partNames) {
      if (!ALLOWED_PART_RES.some(re => re.test(name))) {
         throw new Error(
            `template_builder_disallowed_package_part: found ${_describeDisallowedPart(name)} ("${name}") in the built template. Refusing to serve this download.`
         );
      }
   }
};

const _assertAllowedPackage = async buffer => {
   await _assertAllowedParts(buffer);
   const zip = await JSZip.loadAsync(buffer);

   if (zip.files['xl/workbook.xml']) {
      const wbXml = await zip.files['xl/workbook.xml'].async('string');
      const sheetNames = _parseWorkbookXmlSheetNames(wbXml);
      for (const sheetName of sheetNames) {
         if (!ALLOWED_SHEET_NAMES.has(sheetName)) {
            throw new Error(
               `template_builder_disallowed_sheet: worksheet "${sheetName}" is not one of the template's allowed sheets. Non-owner downloads can only be rebuilt from the reviewed tenant-neutral package shape.`
            );
         }
      }
   }
};

// ─────────────────────────────────────────────────────────────────────────
// Tenant-neutral scrubbing (Astra finding 2, round 9, 2026-09-23).
//
// SCOPE NOTE (round 10, 2026-09-23): everything in this section is now only
// ever exercised by _buildFromOwnerBytes — the owner's OWN rebuild-from-its-
// own-uploaded-bytes path (kept for backward compatibility; see the
// design-decision comment above buildTemplate). Non-owner downloads no
// longer run any of this: they're built from the reviewed, committed,
// hash-verified neutral-template.xlsx asset instead (_buildFromNeutralAsset),
// specifically BECAUSE Astra round 10 proved that "scrub whatever the base
// currently contains" cannot be made to reliably catch every corner (rich
// text, formulas, hyperlinks, numFmts, defined names, theme metadata — see
// findings 1 & 2). The comments below describe what this scrub still does
// for an owner rebuilding ITS OWN bytes for ITSELF, where there is no
// cross-tenant leak to prevent in the first place (worst case, a false
// positive scrubs the owner's own name out of its own download).
//
// The rebuild above already scopes __customers / __employees / __categories
// and the visible 'Employee Names' list to the REQUESTING account (see
// _readCatalogs). That is not the whole workbook: an actual account-9001
// download was found with account-1's employee name still sitting in
// Instructions!D15/D16 — a worked-example cell nobody was scrubbing, because
// it lives outside those four sheets. Rebuilding selected lookup sheets does
// not sanitize the complete workbook; any other sheet, a populated entry row,
// a comment, a header/footer, a literal (quoted) data-validation list, or the
// package's own docProps metadata could just as easily carry a foreign name.
//
// This does not special-case "owner vs non-owner" internally — it always
// treats whatever is currently baked into the base's own __customers /
// __employees / 'Employee Names' sheets as "foreign" and scrubs it, even on
// an owner's own self-rebuild (a harmless near no-op there, since the
// "foreign" names and the requesting account's own names are the same data).
const COMMON_WORD_STOPLIST = new Set([
   'and', 'the', 'for', 'are', 'was', 'not', 'all', 'but', 'you', 'her', 'his', 'its', 'our', 'out', 'day', 'get', 'has', 'him', 'how', 'man', 'new', 'now', 'see',
   'two', 'way', 'who', 'did', 'use', 'say', 'she', 'too', 'let', 'put', 'end', 'why', 'try', 'ask', 'own', 'off', 'yes', 'yet', 'will', 'may', 'hope', 'grace'
]);

const _escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lowercased word tokens — used only for membership checks (protected-word /
// stoplist lookups), never as the literal text we search for.
const _wordsOf = value => String(value).toLowerCase().match(/[a-z0-9]+/g) || [];

// A cell's value flattened to plain text, whatever shape it arrives in.
// Astra finding 2 (round 10, 2026-09-23): _columnAValues used to treat ANY
// object-typed cell value as empty, so a roster/lookup entry recorded as
// rich text (rather than a plain string) was silently skipped during
// foreign-name collection — even though a PLAIN-text copy of that same name
// elsewhere in the workbook (e.g. an Instructions worked example) was not
// skipped, so it survived the scrub untouched. This flattens the same shapes
// _neutralizeCellValue already knows how to REPLACE, so the collection side
// and the replacement side agree on what a cell's text even is.
const _cellPlainText = raw => {
   if (raw == null) return '';
   if (raw instanceof Date) return '';
   if (typeof raw === 'string') return raw.trim();
   if (typeof raw === 'object') {
      if (Array.isArray(raw.richText)) return raw.richText.map(run => (typeof run.text === 'string' ? run.text : '')).join('').trim();
      if (typeof raw.text === 'string') return raw.text.trim(); // hyperlink-shaped { text, hyperlink }
      return '';
   }
   return String(raw).trim();
};

// Every non-empty column-A value on `sheet`, top to bottom, trimmed. Shared by
// the foreign-name and protected-word collectors below. Mirrors the row-count
// loop _replaceVisibleNameList already uses.
const _columnAValues = sheet => {
   if (!sheet) return [];
   const values = [];
   for (let r = 1; r <= sheet.rowCount; r += 1) {
      const s = _cellPlainText(sheet.getCell(`A${r}`).value);
      if (s) values.push(s);
   }
   return values;
};

// Words already used by the workbook's OWN shared/generic dropdown content
// (Entity, Categories) are never treated as scrubbable "foreign name" tokens.
// Concretely: this firm's Entity option "James F. Kimmel & Associates" shares
// a surname with employee "Jim Kimmel" — that's a business-line label everyone
// (every account) should keep seeing, not a personal identifier to launder.
const _collectProtectedWords = workbook => {
   const words = new Set();
   ['Entity', 'Categories'].forEach(name => {
      _columnAValues(workbook.getWorksheet(name)).forEach(v => _wordsOf(v).forEach(w => words.add(w)));
   });
   return words;
};

// Gather every customer/employee identifier already baked into the BASE
// workbook, before _addLookupSheet / _replaceVisibleNameList overwrite them
// with the requesting account's own. Full display names (customers AND
// employees) are matched whole; employees additionally contribute first/last
// tokens (>= 3 chars) so a cell that names only a first OR last name is still
// caught. Customers are never tokenized (their names are highly varied,
// often multi-person households — see _neutralizeText for why tokenizing
// them would be far too broad).
const _collectForeignNames = (workbook, protectedWords) => {
   const customerNames = new Set();
   const employeeNames = new Set();
   const employeeTokens = new Set();

   // Header rows ('Customer' / 'Employee') are always row 1 — see _addLookupSheet.
   _columnAValues(workbook.getWorksheet('__customers'))
      .slice(1)
      .forEach(n => customerNames.add(n));

   const addEmployeeName = name => {
      if (!name) return;
      employeeNames.add(name);
      (name.match(/[A-Za-z0-9]+/g) || []).forEach(token => {
         const lower = token.toLowerCase();
         if (token.length >= 3 && !protectedWords.has(lower) && !COMMON_WORD_STOPLIST.has(lower)) employeeTokens.add(token);
      });
   };
   _columnAValues(workbook.getWorksheet('__employees'))
      .slice(1)
      .forEach(addEmployeeName);
   // The visible legacy sheet has no header row — see _replaceVisibleNameList.
   _columnAValues(workbook.getWorksheet('Employee Names')).forEach(addEmployeeName);

   const byLengthDesc = (a, b) => b.length - a.length;
   return {
      customerNames: [...customerNames].sort(byLengthDesc),
      employeeNames: [...employeeNames].sort(byLengthDesc),
      employeeTokens: [...employeeTokens]
   };
};

// Sentinels stand in for a match until every foreign name/token has had a
// pass, THEN get resolved to the real replacement text. Without this
// intermediate step, replacing a full name first and a token second (or vice
// versa) can have the second pass corrupt what the first pass just wrote —
// e.g. if the chosen replacement employee's own name happens to share a
// token with a still-pending foreign name. Both sentinels use Private-Use-Area
// code points that cannot occur in real spreadsheet text and cannot overlap
// with any name/token regex, so a later pass can never re-match one.
const EMP_SENTINEL = 'TENANT_EMPLOYEE';
const CUS_SENTINEL = 'TENANT_CUSTOMER';

// Replace every occurrence of a foreign customer/employee FULL name in
// `text` with the requesting account's own tenant-neutral stand-in. Full
// names are matched on a word boundary, case-sensitive, longest first (so a
// full name is consumed before any of its own tokens could be) — NOT a bare
// substring. Astra finding 3 (round 9): the single-word employee name
// "Admin" (a full name here, not just a token) corrupted "Administrative"
// into "Admin Personistrative" because the old `.split/.join` had no concept
// of a word boundary. `\b` fixes that — "Admin" immediately followed by
// "istrative" (no boundary between the two) never matches.
const _neutralizeFullNames = (text, plan) => {
   if (typeof text !== 'string' || !text) return text;
   if (!plan.customerNames.length && !plan.employeeNames.length) return text;
   let out = text;
   for (const name of plan.customerNames) {
      if (!name) continue;
      out = out.replace(new RegExp(`\\b${_escapeRegExp(name)}\\b`, 'g'), CUS_SENTINEL);
   }
   for (const name of plan.employeeNames) {
      if (!name) continue;
      out = out.replace(new RegExp(`\\b${_escapeRegExp(name)}\\b`, 'g'), EMP_SENTINEL);
   }
   if (out.includes(EMP_SENTINEL) || out.includes(CUS_SENTINEL)) {
      out = out.split(EMP_SENTINEL).join(plan.employeeReplacement).split(CUS_SENTINEL).join(plan.customerReplacement);
   }
   return out;
};

// Single first/last-name tokens (e.g., "Kimmel", "Mark") are ordinary
// English words and name fragments far too often to ever regex-replace
// *inside* prose. Astra finding 3: with employee "Mark Long", the sentence
// "Mark the start date. How long did it take you?" became "Eliza Smith the
// start date. How Eliza Smith did it take you?" under the old `\btoken\b`
// substitution, which fires anywhere the word appears — including as an
// ordinary English word with no relation to anyone's name. A token is now
// only ever replaced when the ENTIRE (trimmed) string is nothing else: the
// cell/note/run holds just a bare name and nothing more, never a longer
// sentence or label. Case-insensitive, since a bare-name cell is commonly
// retyped in a different case ("KIMMEL", "kimmel").
const _neutralizeExactToken = (text, plan) => {
   if (typeof text !== 'string' || !text) return text;
   if (!plan.employeeTokens.length) return text;
   const trimmed = text.trim();
   if (!trimmed) return text;
   const isToken = plan.employeeTokens.some(token => token.toLowerCase() === trimmed.toLowerCase());
   return isToken ? plan.employeeReplacement : text;
};

// Single entry point every scrubbed string goes through: a full-name pass
// first (may replace a substring within a longer string), then an
// exact-whole-value token pass on whatever that leaves behind (never a
// substring — see _neutralizeExactToken).
const _neutralizeText = (text, plan) => _neutralizeExactToken(_neutralizeFullNames(text, plan), plan);

// Cell values arrive in several shapes (plain string, rich text runs, a
// hyperlink's display text + target, a cell's formula + cached result) —
// scrub whichever string(s) are present and leave numbers/dates/booleans
// untouched.
//
// Hyperlinks and formulas get more than a text scrub. Astra finding 2
// (round 9): a formula's cached RESULT got scrubbed while its LITERAL kept
// the foreign name — Excel recalculates a formula on open, so the cached
// value a prior version relied on is not load-bearing and silently restores
// the foreign name. Likewise a hyperlink's display TEXT got scrubbed while
// its TARGET (a mailto: link) kept the name outright. Neither is patched
// anymore: a formula naming a foreign person has the formula itself dropped
// (replaced with its already-scrubbed cached value, and logged); a
// hyperlink naming a foreign person in its target OR its text is dropped
// entirely, keeping only scrubbed display text as a plain value.
const _neutralizeCellValue = (value, plan) => {
   if (value == null) return value;
   if (typeof value === 'string') return _neutralizeText(value, plan);
   if (typeof value === 'object' && !(value instanceof Date)) {
      if (Array.isArray(value.richText)) {
         return { richText: value.richText.map(run => ({ ...run, text: _neutralizeText(run.text, plan) })) };
      }
      if (typeof value.text === 'string' && 'hyperlink' in value) {
         const scrubbedText = _neutralizeText(value.text, plan);
         const scrubbedTarget = typeof value.hyperlink === 'string' ? _neutralizeText(value.hyperlink, plan) : value.hyperlink;
         if (scrubbedText !== value.text || scrubbedTarget !== value.hyperlink) {
            // Drop the hyperlink outright rather than patch one side of it —
            // a partially-scrubbed hyperlink (fixed text, foreign target) is
            // exactly what survived last time.
            return scrubbedText;
         }
         return value;
      }
      if (typeof value.formula === 'string') {
         const scrubbedFormula = _neutralizeText(value.formula, plan);
         if (scrubbedFormula !== value.formula) {
            console.error('[template-builder] dropped a cell formula that named a foreign person; the cell now holds only its scrubbed cached value.');
            const { result } = value;
            if (typeof result === 'string') return _neutralizeText(result, plan);
            return result == null || typeof result === 'object' ? null : result;
         }
         if (typeof value.result === 'string') {
            return { ...value, result: _neutralizeText(value.result, plan) };
         }
         return value;
      }
   }
   return value;
};

const _neutralizeNote = (note, plan) => {
   if (note == null) return note;
   if (typeof note === 'string') return _neutralizeText(note, plan);
   if (typeof note === 'object' && Array.isArray(note.texts)) {
      return { ...note, texts: note.texts.map(t => ({ ...t, text: _neutralizeText(t.text, plan) })) };
   }
   return note;
};

// The four sheets buildTemplate just (re)populated from the requesting
// account's own catalogs are already correct and authoritative — re-scrubbing
// them here would only risk a false positive (e.g. the requesting account
// happens to share a customer name with the foreign one) for zero benefit.
const AUTHORITATIVE_SHEET_NAMES = new Set(['__customers', '__employees', '__categories', 'Employee Names']);

// Scan every OTHER worksheet (visible and hidden alike — ExcelJS's
// `workbook.worksheets` includes veryHidden sheets same as any other) for a
// foreign name in a cell value or a cell note, and neutralize it.
const _neutralizeWorkbook = (workbook, plan) => {
   workbook.worksheets.forEach(sheet => {
      if (AUTHORITATIVE_SHEET_NAMES.has(sheet.name)) return;
      sheet.eachRow({ includeEmpty: false }, row => {
         row.eachCell({ includeEmpty: false }, cell => {
            cell.value = _neutralizeCellValue(cell.value, plan);
            if (cell.note != null) cell.note = _neutralizeNote(cell.note, plan);
         });
      });
   });
};

// Sheet headers/footers are free text (e.g. "&LPrepared by Jim Kimmel") that
// lives on the worksheet model rather than in any cell — scrub them the same
// way, across every sheet (harmless no-op on the four authoritative ones,
// which never set one).
const _neutralizeHeaderFooters = (workbook, plan) => {
   const sections = ['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter'];
   workbook.worksheets.forEach(sheet => {
      const hf = sheet.headerFooter;
      if (!hf) return;
      sections.forEach(key => {
         if (typeof hf[key] === 'string' && hf[key]) hf[key] = _neutralizeText(hf[key], plan);
      });
   });
};

// A "template" should never carry populated entries. If the stored base
// object ever does (a filled-in tracker mistakenly re-uploaded as a template
// version, for instance), strip them so they can never ride along in someone
// else's rebuild. Headers (rows 1-5), validations and formulas are untouched.
const _clearEntryRows = (sheet, headerRow = 5) => {
   sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      row.eachCell({ includeEmpty: false }, cell => {
         cell.value = null;
      });
   });
};

// docProps identity fields (dc:creator / cp:lastModifiedBy / dc:title /
// dc:subject / dc:description / cp:keywords / cp:category /
// cp:contentStatus / Company / Manager) are plain top-level properties on
// the ExcelJS Workbook once loaded — set directly rather than editing XML.
// Stamped unconditionally (not just "if a foreign name is found") since
// these are exactly the fields Office itself would silently fill in from
// whoever last saved the file in Excel; never trust that they're already
// safe.
//
// Astra finding 2 (round 9): a prior version only ever touched
// creator/lastModifiedBy/title/description/company/manager. subject,
// keywords, category and contentStatus — all plain strings ExcelJS
// round-trips exactly the same way (see node_modules/exceljs's
// xlsx/xform/core/core-xform.js) — were left completely untouched, and the
// real base's own dc:subject held a foreign name.
const _neutralizeMetadata = (workbook, accountLabel) => {
   const label = accountLabel || 'DS2';
   workbook.creator = label;
   workbook.lastModifiedBy = label;
   workbook.title = label;
   workbook.subject = label;
   workbook.description = label;
   workbook.keywords = label;
   workbook.category = label;
   workbook.contentStatus = label;
   workbook.company = label;
   workbook.manager = label;
};

// The requesting account's own display name, for the metadata stamp above.
// Best-effort: a lookup failure (including a caller/test db stub that has no
// 'accounts' table) just falls back to the generic 'DS2' label in
// _neutralizeMetadata — metadata is a defense-in-depth extra, not the
// mechanism the cell/name scrub above relies on.
const _readAccountLabel = async (db, accountId) => {
   try {
      const row = await db('accounts').where({ account_id: accountId }).first();
      const label = row && typeof row.account_name === 'string' ? row.account_name.trim() : '';
      return label || null;
   } catch (e) {
      return null;
   }
};

// Minimal XML entity codec for the raw-string splicing below. Decode order
// matters — &amp; must be LAST or a literal "&lt;" (double-escaped as
// "&amp;lt;") would be corrupted; encode order is the mirror image.
const _xmlDecodeText = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const _xmlEncodeText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _xmlEncodeAttr = s => _xmlEncodeText(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Defensive, XML-level pass for the two corners ExcelJS's object model
// doesn't safely expose for rewriting (see the file-level comments on
// _restoreDefinedNames / _injectDateValidations for why this codebase already
// edits XML parts directly for anything data-validation-shaped): a defined
// name's own NAME (never its target range — that's a structural cell/sheet
// reference, not free text) and a data-validation LIST formula that is a
// literal quoted string ("Item1,Item2") rather than a named-range or
// cell-reference formula. Neither currently occurs in the base template (all
// three dropdowns use named ranges), so this is pure future-proofing: it
// follows the project rule of never editing a zip in place — every touched
// part is fully rebuilt and the buffer is only replaced if something in it
// actually changed. Text content quotes are written back XML-ENCODED
// (&quot;) by ExcelJS's own writer — matching only a literal `"` here (as an
// earlier version of this function did) never fires; both forms are matched
// on read, and the replacement value itself is XML-encoded before being
// spliced back in (a customer/employee name containing "&" or "<" would
// otherwise produce invalid XML).
const _neutralizeXmlTextParts = async (buffer, plan) => {
   const zip = await JSZip.loadAsync(buffer);
   let modified = false;

   if (zip.files['xl/workbook.xml']) {
      const xml = await zip.files['xl/workbook.xml'].async('string');
      const next = xml.replace(/(<definedName\s+name=")([^"]*)(")/g, (whole, open, name, close) => {
         const decoded = _xmlDecodeText(name);
         const scrubbed = _neutralizeText(decoded, plan);
         return scrubbed === decoded ? whole : `${open}${_xmlEncodeAttr(scrubbed)}${close}`;
      });
      if (next !== xml) {
         zip.file('xl/workbook.xml', next);
         modified = true;
      }
   }

   const scrubQuotedFormula = (xml, tag) => {
      const re = new RegExp(`(<${tag}>)(?:&quot;|")([\\s\\S]*?)(?:&quot;|")(<\\/${tag}>)`, 'g');
      return xml.replace(re, (whole, open, text, close) => {
         const decoded = _xmlDecodeText(text);
         const scrubbed = _neutralizeText(decoded, plan);
         return scrubbed === decoded ? whole : `${open}&quot;${_xmlEncodeText(scrubbed)}&quot;${close}`;
      });
   };
   const sheetFiles = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
   for (const name of sheetFiles) {
      const xml = await zip.files[name].async('string');
      let next = scrubQuotedFormula(xml, 'formula1');
      next = scrubQuotedFormula(next, 'formula2');
      if (next !== xml) {
         zip.file(name, next);
         modified = true;
      }
   }

   if (!modified) return buffer;
   return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
};

const _applyDataValidation = ({ sheet, customerCount, employeeCount, categoryCount }) => {
   // Column mapping per the base template header row (row 5):
   //   A=Date, B=Entity, C=Category, D=Company Name (customer),
   //   E=First Name, F=Last Name, G=Duration, H=Time Range
   // The prior code mis-targeted the customer dropdown at column B (Entity)
   // and the employee dropdown at column D (Company Name); both were wrong.
   // Customer now goes on D. There is no per-row "employee" column — the
   // employee is on B1 (single header cell), so the prior D-column
   // employee dropdown is removed.

   // B1: Employee header cell — must be an active DS2 user
   if (employeeCount) {
      sheet.dataValidations.add('B1', {
         type: 'list',
         allowBlank: false,
         formulae: [`__employees!$A$2:$A$${employeeCount + 1}`],
         showErrorMessage: true,
         errorStyle: 'stop',
         errorTitle: 'Unknown employee',
         error: 'Pick your name from the list. Only active DS2 users may submit time.'
      });
   }

   // B2 / B3 / A6:A1500 date validations are injected via post-build XML
   // (see _injectDateValidations). ExcelJS silently converts formula
   // strings like 'TODAY()-365' and 'B2' to NaN when the validation type
   // is 'date', so we bypass its API for those three.

   // C6..end: Category dropdown (existing base template has C5/C10:C1500;
   // we add C6:C1500 to cover the actual entry range used by the parser)
   if (categoryCount) {
      sheet.dataValidations.add(`C6:C${MAX_DATA_ROWS}`, {
         type: 'list',
         allowBlank: true,
         formulae: [`__categories!$A$2:$A$${categoryCount + 1}`],
         showErrorMessage: true,
         errorStyle: 'information',
         errorTitle: 'Unknown category'
      });
   }

   // D6..end: Company Name (customer) dropdown — moved here from the
   // wrong B column. allowBlank because some entries are internal/admin.
   if (customerCount) {
      sheet.dataValidations.add(`D6:D${MAX_DATA_ROWS}`, {
         type: 'list',
         allowBlank: true,
         formulae: [`__customers!$A$2:$A$${customerCount + 1}`],
         showErrorMessage: true,
         errorStyle: 'information',
         errorTitle: 'Unknown customer',
         error: 'This customer is not in our system. The row will be flagged for review.'
      });
   }
};

// ─────────────────────────────────────────────────────────────────────────
// The reviewed, committed, tenant-neutral base asset (design decision,
// 2026-09-23 — Astra round 10 findings 1 & 2). See
// scripts/timeTracking/build-neutral-template.js for how it's produced and
// src/endpoints/timeTracking/assets/README.md for the reviewed-by-hand
// process around it.
const ASSETS_DIR = path.join(__dirname, 'assets');
const NEUTRAL_ASSET_PATH = path.join(ASSETS_DIR, 'neutral-template.xlsx');
const NEUTRAL_MANIFEST_PATH = path.join(ASSETS_DIR, 'neutral-template.manifest.json');

// The literal placeholder text build-neutral-template.js leaves in the
// Instructions sheet's worked-example cell(s) that used to name the real
// firm's own employee (Instructions!D15/D16 on the real base). Deliberately
// a plain, friendly string — an asset reviewer opening the file directly
// should see something sensible there — NOT a machine sentinel.
//
// Because it's friendly and generic, it is NOT safe to re-find by content at
// request time: the real Instructions sheet already has its OWN, unrelated
// "Employee Name" field-LABEL cell (Instructions!A5), which happens to be
// the exact same string. A content search at request time can't tell that
// label apart from the two former-name cells, and would corrupt it too. So
// the addresses get discovered by content only ONCE, at build time (see
// build-neutral-template.js, which searches for the FOREIGN EMPLOYEE'S NAME
// — a value distinctive enough that this ambiguity doesn't apply — and
// records where it found it), and the runtime below just writes to those
// recorded addresses directly. See manifest.exampleCellAddresses.
const EXAMPLE_PLACEHOLDER_TEXT = 'Employee Name';

const _sha256Hex = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

// Loads the committed neutral-template.xlsx asset and verifies its bytes
// against neutral-template.manifest.json's sha256 before returning anything.
// A mismatch — a stale checkout, a hand-edit that skipped
// build-neutral-template.js, a corrupt commit — means we can no longer prove
// the asset is the exact, reviewed package the manifest describes, so this
// throws rather than guessing. The caller (_buildFromNeutralAsset) lets it
// propagate straight out of buildTemplate; the /template/latest route
// already turns any builder failure into a 503 for non-owner accounts.
const _loadNeutralAsset = (assetPath = NEUTRAL_ASSET_PATH, manifestPath = NEUTRAL_MANIFEST_PATH) => {
   let buffer;
   try {
      buffer = fs.readFileSync(assetPath);
   } catch (e) {
      throw new Error(`neutral_template_asset_missing: could not read the committed neutral template asset at ${assetPath} (${e.message}). Run scripts/timeTracking/build-neutral-template.js to generate it.`);
   }
   let manifest;
   try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
   } catch (e) {
      throw new Error(`neutral_template_manifest_missing: could not read/parse the neutral template manifest at ${manifestPath} (${e.message}).`);
   }
   const actual = _sha256Hex(buffer).toLowerCase();
   const expected = typeof manifest.sha256 === 'string' ? manifest.sha256.toLowerCase() : '';
   if (!expected || actual !== expected) {
      throw new Error(
         `neutral_template_asset_hash_mismatch: ${assetPath} (sha256 ${actual}) does not match neutral-template.manifest.json (expected ${expected || '<missing>'}). Refusing to build a non-owner template from an asset that doesn't match its own manifest.`
      );
   }
   return { buffer, manifest };
};

// Writes `label` into every `"SheetName!A1"`-style address in `addresses` —
// the exact cells build-neutral-template.js found (by CONTENT — see the
// comment on EXAMPLE_PLACEHOLDER_TEXT above for why content-matching only
// happens once, at build time) to hold the real firm's own employee name.
// Safe no-op for any address whose sheet doesn't exist or is malformed.
const _setExampleEmployeeCells = (workbook, label, addresses = []) => {
   addresses.forEach(ref => {
      const [sheetName, cellRef] = String(ref).split('!');
      const sheet = sheetName && cellRef ? workbook.getWorksheet(sheetName) : null;
      if (!sheet) return;
      sheet.getCell(cellRef).value = label;
   });
};

// Every text-bearing OOXML part of a package (sheets, sharedStrings,
// workbook.xml, styles.xml, theme, docProps, rels — anything decodable as
// XML), decoded to a string. Shared by build-neutral-template.js's final
// gate and _assertNoForbiddenTokens below, so both sides scan the same set
// of parts the same way.
const _readZipTextParts = async buffer => {
   const zip = await JSZip.loadAsync(buffer);
   const parts = {};
   for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (entry.dir || !/\.(?:xml|rels)$/i.test(name)) continue;
      parts[name] = await entry.async('string');
   }
   return parts;
};

// Cheap, fail-closed insurance for every non-owner build — see the comment
// where this is called in _buildFromNeutralAsset. Word-boundary matching,
// same as _neutralizeFullNames above and for the same reason: a short
// forbidden token (e.g. an employee literally named "Admin") is otherwise a
// false positive against the template's own legitimate vocabulary that
// merely starts with it (e.g. Categories' "Administrative" — this is the
// exact Astra finding-3, round-9 collision, and a naive substring check
// re-introduces it here).
const _tokenAppearsIn = (decodedText, token) => new RegExp(`\\b${_escapeRegExp(token)}\\b`).test(decodedText);

// `ownValues` is every string the CURRENT request's own tenant legitimately
// wrote into this build — its own customers, employees, categories, and
// account label (see the call site in _buildFromNeutralAsset). Those are
// the only four places any per-tenant text lands in the output; everything
// else in the buffer is fixed asset content, already proven token-free by
// build-neutral-template.js's own final gate. A forbidden token that
// happens to match a SUBSTRING of the tenant's own value (e.g. this
// request's account has an employee named "Admin Person", and "Admin" is
// one of the real firm's own forbidden tokens) is therefore not a leak —
// it's this tenant's own legitimate data, and excluding it from the scan
// is what lets that data actually get served. Any OTHER survivor can only
// mean a runtime regression, and is still refused.
const _assertNoForbiddenTokens = async (buffer, manifest, ownValues = []) => {
   const tokens = Array.isArray(manifest.forbiddenTokens) ? manifest.forbiddenTokens.filter(t => typeof t === 'string' && t) : [];
   if (!tokens.length) return;
   const remainingTokens = tokens.filter(token => !ownValues.some(v => typeof v === 'string' && v && _tokenAppearsIn(v, token)));
   if (!remainingTokens.length) return;
   const parts = await _readZipTextParts(buffer);
   for (const [partName, xml] of Object.entries(parts)) {
      const decoded = _xmlDecodeText(xml);
      for (const token of remainingTokens) {
         if (_tokenAppearsIn(decoded, token)) {
            // Deliberately not naming the token itself in the thrown message
            // — no reason to propagate the very identifier we're refusing to
            // ship into logs / a 503 response body.
            throw new Error(`template_builder_forbidden_token_survived: found a forbidden identifier in ${partName} after building from the neutral asset. Refusing to serve this download.`);
         }
      }
   }
};

// The owner's own rebuild-from-its-own-uploaded-bytes path — see the SCOPE
// NOTE above the tenant-neutral-scrubbing section for why this is now only
// ever reached when isOwnerAccount is true (the default; see buildTemplate).
const _buildFromOwnerBytes = async ({ baseTemplateBuffer, customers, employees, categories, accountLabel }) => {
   // Astra finding 2 (round 9): fail closed on the package shape before
   // doing anything else with the base object — see _assertAllowedPackage.
   await _assertAllowedPackage(baseTemplateBuffer);

   const shrunk = await _shrinkFullColumnSqrefs(baseTemplateBuffer);
   const safeBuffer = await _stripBadValidations(shrunk);
   const workbook = new ExcelJS.Workbook();
   await workbook.xlsx.load(safeBuffer);
   // Astra finding 1 (round 10): re-validate the worksheet set ExcelJS itself
   // parsed, not just the raw XML _assertAllowedPackage already checked.
   _assertAllowedWorksheetSet(workbook);

   // Astra finding 2: collect whichever tenant's names are CURRENTLY baked
   // into the base workbook's own lookup/name sheets BEFORE we overwrite them
   // below — the base workbook itself is the only source of truth for this.
   const protectedWords = _collectProtectedWords(workbook);
   const foreign = _collectForeignNames(workbook, protectedWords);

   _addLookupSheet(workbook, '__customers', 'Customer', customers);
   _addLookupSheet(workbook, '__employees', 'Employee', employees);
   _addLookupSheet(workbook, '__categories', 'Category', categories);
   // Visible legacy sheet — see _replaceVisibleNameList for why this also
   // needs the requesting account's own staff list, not just the hidden one.
   _replaceVisibleNameList(workbook, 'Employee Names', employees);

   // The allowlist above (see _assertAllowedPackage) already guarantees the
   // entry sheet, if present at all, is named exactly "Time" — look it up
   // directly rather than the old "first sheet that isn't one of the three
   // hidden lookups" heuristic, which could have mis-picked e.g. 'Employee
   // Names' as the data sheet on a base that omitted "Time".
   const dataSheet = workbook.getWorksheet('Time');
   if (!dataSheet) {
      throw new Error('base_template_has_no_data_sheet');
   }

   // A template should never carry populated entries — belt-and-suspenders
   // ahead of the name-based scrub below (see _clearEntryRows).
   _clearEntryRows(dataSheet);

   // Now scrub every OTHER trace of the base workbook's previous tenant: any
   // worksheet (visible or hidden), any cell value or note, and any
   // header/footer. Runs AFTER the lookup-sheet replacement above so it never
   // touches (or risks a false-positive on) the sheets we just correctly
   // repopulated with the requesting account's own data.
   const neutralPlan = {
      customerNames: foreign.customerNames,
      employeeNames: foreign.employeeNames,
      employeeTokens: foreign.employeeTokens,
      customerReplacement: customers[0] || 'Client Name',
      employeeReplacement: employees[0] || 'Employee Name'
   };
   _neutralizeWorkbook(workbook, neutralPlan);
   _neutralizeHeaderFooters(workbook, neutralPlan);
   _neutralizeMetadata(workbook, accountLabel);

   _applyDataValidation({
      sheet: dataSheet,
      customerCount: customers.length,
      employeeCount: employees.length,
      categoryCount: categories.length
   });

   const rawBuffer = await workbook.xlsx.writeBuffer();
   const withDates = await _injectDateValidations(Buffer.from(rawBuffer));
   const withNames = await _restoreDefinedNames(withDates);
   // Deliberately NOT wrapped in a try/catch-and-return-original-buffer like
   // the cosmetic XML helpers above: unlike those (safe to skip — worst case
   // a dropdown is briefly less convenient), a failure here means we don't
   // know whether the buffer is clean. Let it throw; buildTemplate's caller
   // (the /template/latest route) already turns any builder failure into a
   // 503 for non-owner accounts rather than falling back to raw/unscrubbed
   // bytes — see timeTracking-router.js.
   const buffer = await _neutralizeXmlTextParts(withNames, neutralPlan);

   return { buffer: Buffer.from(buffer), counts: { customers: customers.length, employees: employees.length, categories: categories.length } };
};

// Non-owner accounts — design decision, 2026-09-23 (Astra round 10, findings
// 1 & 2): a runtime scrub of the owner's uploaded bytes, no matter how
// thorough, cannot be proven to catch every representation OOXML supports
// (rich text, formulas, hyperlinks, quoted numFmts, defined names, theme/font
// metadata all survived earlier "fail-closed allowlist + scrub" rounds — see
// the SCOPE NOTE above the tenant-neutral-scrubbing section). So non-owner
// downloads no longer derive their CONTENT from the owner's bytes at all:
// every one is rebuilt from the reviewed, committed, hash-verified
// neutral-template.xlsx asset (see scripts/timeTracking/build-neutral-template.js
// and src/endpoints/timeTracking/assets/README.md for how that asset is
// produced and reviewed), using only the same per-tenant steps the owner
// path also runs. baseTemplateBuffer is never a parameter here — see
// buildTemplate, which never passes one to this function.
const _buildFromNeutralAsset = async ({ customers, employees, categories, accountLabel }) => {
   const { buffer: assetBuffer, manifest } = _loadNeutralAsset();

   const shrunk = await _shrinkFullColumnSqrefs(assetBuffer);
   const safeBuffer = await _stripBadValidations(shrunk);
   const workbook = new ExcelJS.Workbook();
   await workbook.xlsx.load(safeBuffer);
   // Cheap insurance even though the asset is hash-verified above: prove the
   // loaded worksheet set is still exactly the eight allowed sheets.
   _assertAllowedWorksheetSet(workbook);

   _addLookupSheet(workbook, '__customers', 'Customer', customers);
   _addLookupSheet(workbook, '__employees', 'Employee', employees);
   _addLookupSheet(workbook, '__categories', 'Category', categories);
   _replaceVisibleNameList(workbook, 'Employee Names', employees);

   const dataSheet = workbook.getWorksheet('Time');
   if (!dataSheet) {
      throw new Error('base_template_has_no_data_sheet');
   }
   // Belt-and-suspenders — the asset itself should never carry entry rows
   // (the build script clears them), but this costs nothing to re-assert.
   _clearEntryRows(dataSheet);

   // The asset's own Instructions worked-example cells hold the literal
   // placeholder EXAMPLE_PLACEHOLDER_TEXT (see build-neutral-template.js) —
   // swap it for this tenant's own first active employee, or leave it as the
   // placeholder if the tenant has none yet.
   _setExampleEmployeeCells(workbook, employees[0] || EXAMPLE_PLACEHOLDER_TEXT, manifest.exampleCellAddresses);
   _neutralizeMetadata(workbook, accountLabel);

   _applyDataValidation({
      sheet: dataSheet,
      customerCount: customers.length,
      employeeCount: employees.length,
      categoryCount: categories.length
   });

   const rawBuffer = await workbook.xlsx.writeBuffer();
   const withDates = await _injectDateValidations(Buffer.from(rawBuffer));
   const withNames = await _restoreDefinedNames(withDates);
   const buffer = Buffer.from(withNames);

   // Cheap, fail-closed insurance (design decision, 2026-09-23): the asset
   // itself is already proven offline, by build-neutral-template.js's own
   // final gate, to carry none of the original uploaded base's identifiers.
   // Nothing in the per-tenant steps just above should be able to
   // reintroduce one — this proves it on every build instead of assuming a
   // future edit to those steps can't regress it. ownValues excludes this
   // request's OWN legitimate data from the scan (see the comment on
   // _assertNoForbiddenTokens) — otherwise any tenant whose own
   // customer/employee name happens to share a word with the real firm's
   // roster (e.g. an "Admin Person" employee vs. the firm's own "Admin"
   // account) would 503 on every download of its own correct content.
   await _assertNoForbiddenTokens(buffer, manifest, [...customers, ...employees, ...categories, accountLabel]);
   // Same idea, for package SHAPE rather than content: re-check the part
   // list of what's actually about to be served. This is what would have
   // caught the _replaceVisibleNameList empty-comment ExcelJS quirk (see the
   // fix there) fabricating an unreviewed xl/comments*.xml on every build.
   await _assertAllowedParts(buffer);

   return { buffer, counts: { customers: customers.length, employees: employees.length, categories: categories.length } };
};

// ─────────────────────────────────────────────────────────────────────────
// buildTemplate — the only export the router calls.
//
// DESIGN DECISION (2026-09-23, Astra round 10 findings 1 & 2): non-owner
// downloads must never be derived at runtime from the owner's uploaded
// bytes, however thoroughly scrubbed. `isOwnerAccount` is the caller's own
// determination of who is asking (timeTracking-router.js already computes
// this — TEMPLATE_OWNER_ACCOUNT_ID — to decide whether to call buildTemplate
// at all; it now just forwards that same boolean through). It is REQUIRED
// and must be a real boolean: a caller that omits it (or passes anything
// else) gets a TypeError before any database read or buffer access, rather
// than silently defaulting to the owner-bytes path (fail-closed; review
// follow-up to Astra round 10). Owner requests pass `isOwnerAccount: true`,
// every other account passes `false`.
// When it does, baseTemplateBuffer is never read (see _buildFromOwnerBytes
// vs _buildFromNeutralAsset above) — the owner's uploaded object plays no
// part in producing a non-owner's download, full stop.
const buildTemplate = async ({ db, accountId, userId, baseTemplateBuffer, now = _now, isOwnerAccount }) => {
   if (typeof isOwnerAccount !== 'boolean') {
      throw new TypeError('buildTemplate requires isOwnerAccount (boolean): true only for the account that owns the uploaded template.');
   }
   const cacheKey = _cacheKey({ accountId, userId });
   const cached = _cache.get(cacheKey);
   if (cached && now() - cached.builtAt < COLLAPSE_WINDOW_MS) {
      return cached.payload;
   }

   const { customers, employees, categories } = await _readCatalogs(db, accountId);
   const accountLabel = await _readAccountLabel(db, accountId);

   const payload = isOwnerAccount
      ? await _buildFromOwnerBytes({ baseTemplateBuffer, customers, employees, categories, accountLabel })
      : await _buildFromNeutralAsset({ customers, employees, categories, accountLabel });

   try {
      await db('template_downloads').insert({
         account_id: accountId,
         user_id: userId,
         customer_count: customers.length,
         employee_count: employees.length,
         category_count: categories.length
      });
   } catch (e) {
      console.error('[template-builder] audit-row write failed:', e.message);
   }

   _cache.set(cacheKey, { builtAt: now(), payload });
   return payload;
};

const _resetCacheForTest = () => _cache.clear();

module.exports = {
   buildTemplate,
   _resetCacheForTest,
   _readCatalogs,
   _addLookupSheet,
   _replaceVisibleNameList,
   _stripBadValidations,
   _shrinkFullColumnSqrefs,
   _applyDataValidation,
   _assertAllowedPackage,
   _assertAllowedParts,
   _assertAllowedWorksheetSet,
   _parseWorkbookXmlSheetNames,
   _collectProtectedWords,
   _collectForeignNames,
   _neutralizeText,
   _neutralizeFullNames,
   _neutralizeExactToken,
   _neutralizeWorkbook,
   _neutralizeHeaderFooters,
   _neutralizeMetadata,
   _neutralizeXmlTextParts,
   _restoreDefinedNames,
   _clearEntryRows,
   _readAccountLabel,
   _buildFromOwnerBytes,
   _buildFromNeutralAsset,
   _loadNeutralAsset,
   _setExampleEmployeeCells,
   _readZipTextParts,
   _assertNoForbiddenTokens,
   _sha256Hex,
   _xmlDecodeText,
   _escapeRegExp,
   _tokenAppearsIn,
   ALLOWED_SHEET_NAMES,
   ALLOWED_PART_RES,
   _describeDisallowedPart,
   EXAMPLE_PLACEHOLDER_TEXT,
   NEUTRAL_ASSET_PATH,
   NEUTRAL_MANIFEST_PATH,
   COLLAPSE_WINDOW_MS,
   MAX_DATA_ROWS
};
