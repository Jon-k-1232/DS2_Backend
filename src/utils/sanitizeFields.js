const xss = require('xss');

/**
 * Sanitizer
 * @param {*} obj
 * @returns object
 */
const sanitizeFields = obj => {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (typeof value === 'string') {
      acc[key] = xss(value);
    } else if (Array.isArray(value)) {
      // check if each item in the array is an object before sanitizing
      acc[key] = value.map(item => (typeof item === 'object' ? sanitizeFields(item) : item));
    } else if (value && typeof value === 'object') {
      acc[key] = sanitizeFields(value);
    } else {
      acc[key] = value;
    }
    return acc;
  }, {});
};

module.exports = { sanitizeFields };
