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

const _cache = new Map();

const _cacheKey = ({ accountId, userId }) => `acct:${accountId}:user:${userId}`;
const _now = () => Date.now();

const _readCatalogs = async (db, accountId) => {
   const [customers, employees, categories] = await Promise.all([
      db('customers')
         .where({ account_id: accountId, is_customer_active: true })
         .orderBy('display_name')
         .select('customer_id', 'display_name'),
      db('users')
         .where({ account_id: accountId, is_user_active: true })
         .orderBy('display_name')
         .select('user_id', 'display_name'),
      db('customer_job_categories')
         .where({ account_id: accountId, is_job_category_active: true })
         .orderBy('customer_job_category')
         .select('customer_job_category_id', 'customer_job_category')
   ]);
   return {
      customers: customers.map(c => c.display_name).filter(Boolean),
      employees: employees.map(e => e.display_name).filter(Boolean),
      categories: categories.map(c => c.customer_job_category).filter(Boolean)
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
   // Use ExcelJS's range-based dataValidations API. Setting one rule per
   // range is O(1) per range; the previous per-cell loop with MAX_DATA_ROWS=1500
   // and 3 columns hot-spun the worker (~99% CPU for several minutes per
   // request) and never returned. Range syntax keeps the workbook produced
   // identical from Excel's perspective while being instant to generate.
   if (customerCount) {
      sheet.dataValidations.add(`B6:B${MAX_DATA_ROWS}`, {
         type: 'list',
         allowBlank: true,
         formulae: [`__customers!$A$2:$A$${customerCount + 1}`],
         showErrorMessage: true,
         errorStyle: 'information',
         errorTitle: 'Unknown customer',
         error: 'This customer is not in our system. The row will be flagged for review.'
      });
   }
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
   if (employeeCount) {
      sheet.dataValidations.add(`D6:D${MAX_DATA_ROWS}`, {
         type: 'list',
         allowBlank: false,
         formulae: [`__employees!$A$2:$A$${employeeCount + 1}`],
         showErrorMessage: true,
         errorStyle: 'stop',
         errorTitle: 'Unknown employee',
         error: 'Employee Name must match an active DS2 user. Pick from the list.'
      });
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
};

const buildTemplate = async ({ db, accountId, userId, baseTemplateBuffer, now = _now }) => {
   const cacheKey = _cacheKey({ accountId, userId });
   const cached = _cache.get(cacheKey);
   if (cached && now() - cached.builtAt < COLLAPSE_WINDOW_MS) {
      return cached.payload;
   }

   const { customers, employees, categories } = await _readCatalogs(db, accountId);

   const safeBuffer = await _shrinkFullColumnSqrefs(baseTemplateBuffer);
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

   const buffer = await workbook.xlsx.writeBuffer();
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
   _applyDataValidation,
   COLLAPSE_WINDOW_MS,
   MAX_DATA_ROWS
};
