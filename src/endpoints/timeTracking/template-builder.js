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

   const shrunk = await _shrinkFullColumnSqrefs(baseTemplateBuffer);
   const safeBuffer = await _stripBadValidations(shrunk);
   const workbook = new ExcelJS.Workbook();
   await workbook.xlsx.load(safeBuffer);

   _addLookupSheet(workbook, '__customers', 'Customer', customers);
   _addLookupSheet(workbook, '__employees', 'Employee', employees);
   _addLookupSheet(workbook, '__categories', 'Category', categories);

   const dataSheet = workbook.worksheets.find(ws => !['__customers', '__employees', '__categories'].includes(ws.name));
   if (!dataSheet) {
      throw new Error('base_template_has_no_data_sheet');
   }

   _applyDataValidation({
      sheet: dataSheet,
      customerCount: customers.length,
      employeeCount: employees.length,
      categoryCount: categories.length
   });

   const rawBuffer = await workbook.xlsx.writeBuffer();
   const withDates = await _injectDateValidations(Buffer.from(rawBuffer));
   const buffer = await _restoreDefinedNames(withDates);
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
   _stripBadValidations,
   _applyDataValidation,
   COLLAPSE_WINDOW_MS,
   MAX_DATA_ROWS
};
