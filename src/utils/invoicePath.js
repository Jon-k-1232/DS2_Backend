const sanitizeAccountName = accountName =>
   (accountName || '')
      .toString()
      .replace(/[^a-zA-Z0-9]/g, '_');

const stripBucketPrefix = (key, bucketName) => {
   if (!key || !bucketName) return key;
   const prefix = `${bucketName}/`;
   return key.startsWith(prefix) ? key.slice(prefix.length) : key;
};

const ensureAccountRoot = (key, sanitizedAccountName) => {
   if (!sanitizedAccountName) return key;
   if (!key) return sanitizedAccountName;

   const lowered = key.toLowerCase();
   const loweredRoot = sanitizedAccountName.toLowerCase();

   return lowered.startsWith(loweredRoot)
      ? key
      : `${sanitizedAccountName}/${key}`.replace(/\/{2,}/g, '/');
};

const normalizeInvoiceFileLocation = ({ rawLocation, accountName, bucketName }) => {
   if (typeof rawLocation !== 'string' || rawLocation.trim().length === 0) {
      return null;
   }

   const sanitizedAccountName = sanitizeAccountName(accountName);

   let working = rawLocation.trim();

   try {
      working = decodeURIComponent(working);
   } catch (error) {
      // ignore decode errors, continue with original string
   }

   if (/^https?:\/\//i.test(working)) {
      try {
         const url = new URL(working);
         working = url.pathname || '';
      } catch (error) {
         // ignore invalid URLs
      }
   }

   if (working.startsWith('s3://')) {
      const withoutScheme = working.slice(5);
      const slashIndex = withoutScheme.indexOf('/');
      working = slashIndex !== -1 ? withoutScheme.slice(slashIndex + 1) : '';
   }

   working = working.replace(/\\/g, '/').replace(/^\/+/ , '');

   const legacyPath = /(^|\/)DS2_Files(\/|$)/i.test(working);

   working = stripBucketPrefix(working, bucketName);

   if (legacyPath || working.toLowerCase().startsWith('ds2_files/')) {
      working = working.replace(/^ds2_files\//i, '');
      working = stripBucketPrefix(working, bucketName);
      working = working
         .replace(/(^|\/)program_files\//i, '$1invoicing/')
         .replace(/(^|\/)monthly_files\//i, '$1invoicing/');
   }

   working = working.replace(/^\/+/ , '').replace(/\/+/g, '/');

   const normalized = ensureAccountRoot(working, sanitizedAccountName);

   return normalized ? normalized.replace(/^\/+/ , '') : null;
};

module.exports = {
   sanitizeAccountName,
   normalizeInvoiceFileLocation
};
