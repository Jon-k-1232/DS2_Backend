const sanitizeAccountName = accountName =>
   (accountName || '')
      .toString()
      .replace(/[^a-zA-Z0-9]/g, '_');

module.exports = {
   sanitizeAccountName
};
