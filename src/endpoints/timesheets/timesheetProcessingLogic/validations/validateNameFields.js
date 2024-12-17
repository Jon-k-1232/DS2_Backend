/**
 * Validate dependencies between Company Name, First Name, and Last Name
 * @param {object} entry - The current entry being validated
 * @param {number} rowIndex - The row index for error reporting
 * @throws {Error} - If validation fails
 */
const validateNameFields = (entry, rowIndex) => {
   const firstName = entry.first_name?.trim() || '';
   const lastName = entry.last_name?.trim() || '';
   const companyName = entry.company_name?.trim() || '';

   // If Company Name is empty, validate First Name and Last Name
   if (!companyName && (!firstName || !lastName)) {
      throw new Error(`Missing required 'First Name' and 'Last Name' when 'Company Name' is empty at row ${rowIndex}`);
   }
};

module.exports = { validateNameFields };
