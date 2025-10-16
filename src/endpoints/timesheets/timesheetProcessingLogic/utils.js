const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const BASE_EXCEL_DATE = dayjs('1899-12-31');

const convertExcelSerialToDate = serial => {
   if (typeof serial !== 'number' || !Number.isFinite(serial)) {
      return null;
   }

   const wholeDays = Math.trunc(serial);
   const fractionalDay = serial - wholeDays;

   // Excel incorrectly treats 1900 as a leap year; adjust serials past Feb 28, 1900
   const adjustedDays = wholeDays > 59 ? wholeDays - 1 : wholeDays;

   const datePortion = BASE_EXCEL_DATE.add(adjustedDays, 'day');

   const millisecondsInDay = 24 * 60 * 60 * 1000;
   const timePortionMs = Math.round(fractionalDay * millisecondsInDay);

   return datePortion.add(timePortionMs, 'millisecond').toDate();
};

/**
 * Convert a variety of Excel-exported date values into JavaScript Date objects.
 * Handles Excel serial numbers, JS Date instances, and common string formats.
 *
 * @param {*} value - The cell value to convert.
 * @returns {Date|null} Normalized Date object or null when conversion fails.
 */
const convertExcelDate = value => {
   if (value === null || value === undefined) {
      return null;
   }

   if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
   }

   if (typeof value === 'number' && Number.isFinite(value)) {
      return convertExcelSerialToDate(value);
   }

   if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
         return null;
      }

      const numericCandidate = Number(trimmed);
      if (!Number.isNaN(numericCandidate)) {
         const serialDate = convertExcelSerialToDate(numericCandidate);
         if (serialDate) {
            return serialDate;
         }
      }

      const strictFormats = ['M/D/YYYY', 'M/D/YY', 'YYYY-MM-DD', 'MM-DD-YYYY', 'MM/DD/YYYY'];
      for (const format of strictFormats) {
         const parsedStrict = dayjs(trimmed, format, true);
         if (parsedStrict.isValid()) {
            return parsedStrict.toDate();
         }
      }

      const looseParsed = dayjs(trimmed);
      if (looseParsed.isValid()) {
         return looseParsed.toDate();
      }
   }

   return null;
};

module.exports = {
   convertExcelDate
};
