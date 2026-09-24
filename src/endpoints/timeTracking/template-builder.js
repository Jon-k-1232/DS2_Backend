const ExcelJS = require('exceljs');
const JSZip = require('jszip');

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
// captured from. Overwrite its rows with THIS account's own active staff so
// no other tenant's names are visible in the downloaded workbook.
const _replaceVisibleNameList = (workbook, sheetName, items) => {
   const sheet = workbook.getWorksheet(sheetName);
   if (!sheet) return; // base template shape may vary across versions; nothing to fix
   const rowsToClear = Math.max(sheet.rowCount, items.length);
   for (let r = 1; r <= rowsToClear; r += 1) {
      sheet.getCell(`A${r}`).value = items[r - 1] != null ? items[r - 1] : null;
   }
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
// Tenant-neutral scrubbing (Astra finding 2, 2026-09-23).
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
// The fix does not special-case "owner vs non-owner": buildTemplate has no
// reliable way to know who the BASE workbook actually belongs to (the caller
// never tells it — see the router's TEMPLATE_OWNER_ACCOUNT_ID comment), so it
// treats whatever is currently baked into the base's own __customers /
// __employees / 'Employee Names' sheets as "foreign" and always scrubs it,
// even on an owner's own self-rebuild (a harmless near no-op there, since the
// "foreign" names and the requesting account's own names are the same data).
const COMMON_WORD_STOPLIST = new Set([
   'and', 'the', 'for', 'are', 'was', 'not', 'all', 'but', 'you', 'her', 'his', 'its', 'our', 'out', 'day', 'get', 'has', 'him', 'how', 'man', 'new', 'now', 'see',
   'two', 'way', 'who', 'did', 'use', 'say', 'she', 'too', 'let', 'put', 'end', 'why', 'try', 'ask', 'own', 'off', 'yes', 'yet', 'will', 'may', 'hope', 'grace'
]);

const _escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lowercased word tokens — used only for membership checks (protected-word /
// stoplist lookups), never as the literal text we search for.
const _wordsOf = value => String(value).toLowerCase().match(/[a-z0-9]+/g) || [];

// Every non-empty column-A value on `sheet`, top to bottom, trimmed. Shared by
// the foreign-name and protected-word collectors below. Mirrors the row-count
// loop _replaceVisibleNameList already uses.
const _columnAValues = sheet => {
   if (!sheet) return [];
   const values = [];
   for (let r = 1; r <= sheet.rowCount; r += 1) {
      const raw = sheet.getCell(`A${r}`).value;
      const s = typeof raw === 'string' ? raw.trim() : raw != null && typeof raw !== 'object' ? String(raw).trim() : '';
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

// Replace every occurrence of a foreign customer/employee name (or employee
// name-token) in `text` with the requesting account's own tenant-neutral
// stand-in. Full names are matched as literal substrings (longest first, so
// e.g. a full name is consumed before any of its own tokens could be); tokens
// are matched on word boundaries, case-insensitively, so "Kimmel" is replaced
// but "Administrative" (containing employee-name token "Admin") is not.
const _neutralizeText = (text, plan) => {
   if (typeof text !== 'string' || !text) return text;
   if (!plan.customerNames.length && !plan.employeeNames.length && !plan.employeeTokens.length) return text;
   let out = text;
   for (const name of plan.customerNames) {
      if (name && out.includes(name)) out = out.split(name).join(CUS_SENTINEL);
   }
   for (const name of plan.employeeNames) {
      if (name && out.includes(name)) out = out.split(name).join(EMP_SENTINEL);
   }
   for (const token of plan.employeeTokens) {
      out = out.replace(new RegExp(`\\b${_escapeRegExp(token)}\\b`, 'gi'), EMP_SENTINEL);
   }
   if (out.includes(EMP_SENTINEL) || out.includes(CUS_SENTINEL)) {
      out = out.split(EMP_SENTINEL).join(plan.employeeReplacement).split(CUS_SENTINEL).join(plan.customerReplacement);
   }
   return out;
};

// Cell values arrive in several shapes (plain string, rich text runs, a
// hyperlink's display text, a cached formula result) — scrub whichever
// string(s) are actually present and leave everything else (numbers, dates,
// formulas themselves, booleans) untouched.
const _neutralizeCellValue = (value, plan) => {
   if (value == null) return value;
   if (typeof value === 'string') return _neutralizeText(value, plan);
   if (typeof value === 'object' && !(value instanceof Date)) {
      if (Array.isArray(value.richText)) {
         return { richText: value.richText.map(run => ({ ...run, text: _neutralizeText(run.text, plan) })) };
      }
      if (typeof value.result === 'string') {
         return { ...value, result: _neutralizeText(value.result, plan) };
      }
      if (typeof value.text === 'string' && 'hyperlink' in value) {
         return { ...value, text: _neutralizeText(value.text, plan) };
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
// dc:description / Company / Manager) are plain top-level properties on the
// ExcelJS Workbook once loaded — set directly rather than editing XML.
// Stamped unconditionally (not just "if a foreign name is found") since these
// are exactly the fields Office itself would silently fill in from whoever
// last saved the file in Excel; never trust that they're already safe.
const _neutralizeMetadata = (workbook, accountLabel) => {
   const label = accountLabel || 'DS2';
   workbook.creator = label;
   workbook.lastModifiedBy = label;
   workbook.title = label;
   workbook.description = label;
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

const buildTemplate = async ({ db, accountId, userId, baseTemplateBuffer, now = _now }) => {
   const cacheKey = _cacheKey({ accountId, userId });
   const cached = _cache.get(cacheKey);
   if (cached && now() - cached.builtAt < COLLAPSE_WINDOW_MS) {
      return cached.payload;
   }

   const { customers, employees, categories } = await _readCatalogs(db, accountId);
   const accountLabel = await _readAccountLabel(db, accountId);

   const shrunk = await _shrinkFullColumnSqrefs(baseTemplateBuffer);
   const safeBuffer = await _stripBadValidations(shrunk);
   const workbook = new ExcelJS.Workbook();
   await workbook.xlsx.load(safeBuffer);

   // Astra finding 2: collect whichever tenant's names are CURRENTLY baked
   // into the base workbook's own lookup/name sheets BEFORE we overwrite them
   // below — the base workbook itself is the only source of truth for this
   // (see the file-level comment above _collectForeignNames for why we never
   // rely on the caller telling us who owns it).
   const protectedWords = _collectProtectedWords(workbook);
   const foreign = _collectForeignNames(workbook, protectedWords);

   _addLookupSheet(workbook, '__customers', 'Customer', customers);
   _addLookupSheet(workbook, '__employees', 'Employee', employees);
   _addLookupSheet(workbook, '__categories', 'Category', categories);
   // Visible legacy sheet — see _replaceVisibleNameList for why this also
   // needs the requesting account's own staff list, not just the hidden one.
   _replaceVisibleNameList(workbook, 'Employee Names', employees);

   const dataSheet = workbook.worksheets.find(ws => !['__customers', '__employees', '__categories'].includes(ws.name));
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

   const payload = {
      buffer: Buffer.from(buffer),
      counts: { customers: customers.length, employees: employees.length, categories: categories.length }
   };
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
   _applyDataValidation,
   _collectProtectedWords,
   _collectForeignNames,
   _neutralizeText,
   _neutralizeWorkbook,
   _neutralizeHeaderFooters,
   _neutralizeMetadata,
   _neutralizeXmlTextParts,
   _clearEntryRows,
   _readAccountLabel,
   COLLAPSE_WINDOW_MS,
   MAX_DATA_ROWS
};
