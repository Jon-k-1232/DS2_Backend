/**
 * Configuration for headers and their validation rules
 * - `snakeCase`: The equivalent snake_case key for the header
 * - `type`: The data type for validation ('string', 'date', 'int')
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
   Duration: { snakeCase: 'duration', type: 'int', allowEmpty: false },
   Notes: { snakeCase: 'notes', type: 'string', allowEmpty: false },
   'Time Tracker Start Date': { snakeCase: 'time_tracker_start_date', type: 'date', allowEmpty: false },
   'Time Tracker End Date': { snakeCase: 'time_tracker_end_date', type: 'date', allowEmpty: false }
};

const ALLOWED_HEADERS = Object.keys(HEADER_CONFIG);

module.exports = { HEADER_CONFIG, ALLOWED_HEADERS };
