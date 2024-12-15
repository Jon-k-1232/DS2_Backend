const dayjs = require('dayjs');
const { convertExcelDate } = require('../utils');

/**
 * Validate the name block (Rows 1–3)
 * @param {Array[]} rows - Rows from the upper section of the timesheet
 * @param {Object} employeeLookup - A mapping of employee names to their records
 * @returns {Object} - Validated metadata including employee name, start date, end date, and email
 * @throws {Error} - If validation fails
 */
const validateNameBlock = (rows, employeeLookup) => {
   const employeeName = rows[0]?.[1]; // B1
   const startDate = convertExcelDate(rows[1]?.[1]); // B2
   const endDate = convertExcelDate(rows[2]?.[1]); // B3

   // Validate Employee Name
   if (!employeeName || employeeName.trim() === '') {
      throw new Error('Employee Name (B1) is required.');
   }

   const matchingEmployee = employeeLookup[employeeName];
   if (!matchingEmployee) {
      throw new Error(`Employee Name (B1) "${employeeName}" is not valid or not found.`);
   }

   // Validate Start Date
   if (!startDate || !dayjs(startDate).isValid()) {
      throw new Error('Time Tracker Start Date (B2) is invalid or missing.');
   }

   // Validate End Date
   if (!endDate || !dayjs(endDate).isValid()) {
      throw new Error('Time Tracker End Date (B3) is invalid or missing.');
   }

   // Ensure Start Date is before End Date
   if (!dayjs(startDate).isBefore(dayjs(endDate))) {
      throw new Error('Time Tracker Start Date (B2) must be before Time Tracker End Date (B3).');
   }

   // Include employee email
   const employeeEmail = matchingEmployee.email;
   if (!employeeEmail || employeeEmail.trim() === '') {
      throw new Error(`Employee Email is missing or invalid for "${employeeName}".`);
   }

   // Return validated metadata
   return {
      employeeName,
      userId: matchingEmployee.user_id,
      email: employeeEmail,
      startDate: dayjs(startDate).format('MM-DD-YYYY'),
      endDate: dayjs(endDate).format('MM-DD-YYYY')
   };
};

module.exports = validateNameBlock;
