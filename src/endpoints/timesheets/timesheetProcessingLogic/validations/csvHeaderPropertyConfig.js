/**
 * Configuration for headers and their validation rules
 * - `snakeCase`: The equivalent snake_case key for the header
 * - `type`: The data type for validation ('string', 'date', 'duration', 'int')
 * - `allowEmpty`: Whether the field is allowed to be empty
 */
const HEADER_CONFIG = {
   Date: { snakeCase: 'date', type: 'date', allowEmpty: false },
   Entity: { snakeCase: 'entity', type: 'string', allowEmpty: false },
   Category: { snakeCase: 'category', type: 'string', allowEmpty: false },
   'Employee Name': { snakeCase: 'employee_name', type: 'string', allowEmpty: false },
   'Company Name': { snakeCase: 'company_name', type: 'string', allowEmpty: true },
   'First Name': { snakeCase: 'first_name', type: 'string', allowEmpty: true },
   'Last Name': { snakeCase: 'last_name', type: 'string', allowEmpty: true },
   // Minutes. Parsed by parseDurationMinutes (whole minutes, or explicit
   // '1.5h' / '90m' style units) and must be > 0.
   Duration: { snakeCase: 'duration', type: 'duration', allowEmpty: false },
   Notes: { snakeCase: 'notes', type: 'string', allowEmpty: false },
   'Time Tracker Start Date': { snakeCase: 'time_tracker_start_date', type: 'date', allowEmpty: false },
   'Time Tracker End Date': { snakeCase: 'time_tracker_end_date', type: 'date', allowEmpty: false }
};

const ALLOWED_HEADERS = Object.keys(HEADER_CONFIG);

// Columns every tracker's header row (row 5) must carry. Prod layout:
//   Date · Entity · Category · Company Name · First Name · Last Name · Duration · Time Range · Notes
// ('Time Range' and any other extra column are informational and ignored;
// 'Employee Name' is an optional legacy per-row column — the employee
// normally lives in B1.)
const REQUIRED_HEADERS = Object.freeze(['Date', 'Entity', 'Category', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Notes']);

const normalizeHeaderName = value =>
   String(value == null ? '' : value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

const _canonicalByNormalized = new Map(ALLOWED_HEADERS.map(header => [normalizeHeaderName(header), header]));

/**
 * Map a raw header row onto the canonical HEADER_CONFIG names. Matching is
 * exact apart from case and whitespace ("notes ", "COMPANY  NAME" match;
 * "Duration (min)" or "Note" do not).
 *
 * @param {Array} originalHeaders raw header cells (row 5)
 * @returns {{ columns: Array<{index:number, header:string}>, missing: string[], duplicates: string[] }}
 *   columns   — one entry per recognized column, header = canonical name
 *   missing   — REQUIRED_HEADERS not present
 *   duplicates — canonical headers that appear more than once (ambiguous)
 */
const resolveHeaderColumns = (originalHeaders = []) => {
   const columns = [];
   const seen = new Map();
   const cells = Array.isArray(originalHeaders) ? originalHeaders : [];
   for (let index = 0; index < cells.length; index += 1) {
      const canonical = _canonicalByNormalized.get(normalizeHeaderName(cells[index]));
      if (!canonical) continue;
      seen.set(canonical, (seen.get(canonical) || 0) + 1);
      columns.push({ index, header: canonical });
   }
   const missing = REQUIRED_HEADERS.filter(header => !seen.has(header));
   const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([header]) => header);
   return { columns, missing, duplicates };
};

/**
 * Human-readable problems with the header row, or [] when it is usable.
 * Messages deliberately avoid the phrase "row N" — the time-block validator
 * parses that pattern to blank out bad data rows.
 * @param {Array} originalHeaders
 * @returns {string[]}
 */
const describeHeaderProblems = originalHeaders => {
   const { missing, duplicates } = resolveHeaderColumns(originalHeaders);
   const problems = [];
   const found = (Array.isArray(originalHeaders) ? originalHeaders : [])
      .map(h => String(h == null ? '' : h).trim())
      .filter(Boolean);
   if (missing.length) {
      problems.push(
         `The time entry header (spreadsheet line 5) is missing required column${missing.length === 1 ? '' : 's'}: ${missing
            .map(h => `"${h}"`)
            .join(', ')}. Found: ${found.length ? found.map(h => `"${h}"`).join(', ') : '(none)'}. Header names must match the template exactly (capitalization and spacing are ignored).`
      );
   }
   if (duplicates.length) {
      problems.push(`The time entry header (spreadsheet line 5) repeats column${duplicates.length === 1 ? '' : 's'} ${duplicates.map(h => `"${h}"`).join(', ')}; each column may appear only once.`);
   }
   return problems;
};

module.exports = { HEADER_CONFIG, ALLOWED_HEADERS, REQUIRED_HEADERS, normalizeHeaderName, resolveHeaderColumns, describeHeaderProblems };
