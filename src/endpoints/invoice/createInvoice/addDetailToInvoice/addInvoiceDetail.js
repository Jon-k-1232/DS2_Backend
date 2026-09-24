const { incrementAnInvoiceOrQuote } = require('../../sharedInvoiceFunctions');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const { getObject } = require('../../../../utils/s3');
const { sanitizeAccountName } = require('../../../../utils/invoicePath');
const { resolveOwnLogoPrefixes, isAuthorizedDownloadKey } = require('../../../../utils/downloadAuthorization');

const isSupportedImageBuffer = buffer => {
   if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
   // PNG signature
   if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
   ) {
      return true;
   }
   // JPEG signature
   if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return true;
   }
   return false;
};

const fetchS3LogoBuffer = async key => {
   if (!key) return null;
   const { body } = await getObject(key);
   return isSupportedImageBuffer(body) ? body : null;
};

const safeFetchS3LogoBuffer = async key => {
   if (!key) return null;
   try {
      return await fetchS3LogoBuffer(key);
   } catch (error) {
      console.warn(`Unable to load logo from S3 key ${key}: ${error.message}`);
      return null;
   }
};

const loadCompanyLogo = async accountBillingInformation => {
   const rawLogoValue = accountBillingInformation?.account_company_logo;
   const noImagePath = path.join(__dirname, '../../../../images/noImage.png');
   const accountName = accountBillingInformation?.account_name || '';
   const accountRoot = sanitizeAccountName(accountName);
   const fallbackS3Key = accountRoot ? `${accountRoot}/app/assets/logo.png` : null;

   const candidateLogoKey = typeof rawLogoValue === 'string' ? rawLogoValue.trim() : '';

   // review/full-audit-2026-09 finding 2: account_company_logo is a free-text
   // field that used to be fetched here with no check that the key actually
   // belonged to this account — PUT /account/updateAccount now validates new
   // values, but this guards values already on record from before that
   // validation existed. A foreign/malformed key is never fetched: skip
   // straight to this account's own fallback key (and, after that, the
   // generic "no image") — never another account's object, and never a 500.
   const allowedLogoPrefixes = resolveOwnLogoPrefixes({ accountName });
   const logoKey = candidateLogoKey && isAuthorizedDownloadKey(candidateLogoKey, allowedLogoPrefixes) ? candidateLogoKey : '';
   if (candidateLogoKey && !logoKey) {
      console.warn(`Ignoring account_company_logo "${candidateLogoKey}" for invoice generation — not under this account's own logo prefix.`);
   }

   if (logoKey) {
      try {
         let logoBuffer = await safeFetchS3LogoBuffer(logoKey);

         if (!logoBuffer && fallbackS3Key && fallbackS3Key !== logoKey) {
            logoBuffer = await safeFetchS3LogoBuffer(fallbackS3Key);
         }

         if (logoBuffer) {
            return logoBuffer;
         }
      } catch (error) {
         console.warn(`Unable to load logo using key ${logoKey}: ${error.message}`);
      }
   }

   if (isSupportedImageBuffer(rawLogoValue)) {
      return rawLogoValue;
   }

   if (fallbackS3Key) {
      const fallbackBuffer = await safeFetchS3LogoBuffer(fallbackS3Key);
      if (fallbackBuffer) {
         return fallbackBuffer;
      }
   }

   return fs.readFileSync(noImagePath);
};

const addInvoiceDetails = async (calculatedInvoices, invoiceQueryData, invoicesToCreateMap, accountBillingInformation, globalInvoiceNote, billingDate) => {
   const companyLogo = await loadCompanyLogo(accountBillingInformation);
   // One firm-local billing date for the whole batch (numbering year, invoice
   // date, due date) — never re-read the clock per customer.
   const statementDate = billingDate ? dayjs(billingDate) : dayjs();
   const billingYear = invoiceQueryData.billingYear || statementDate.year();

   return calculatedInvoices.map((invoiceCalculation, i) => {
      const { customer_id, invoiceNote } = invoicesToCreateMap[invoiceCalculation.customer_id];
      const { lastInvoiceNumber, customerInformation } = invoiceQueryData;
      // No conforming statement yet for this year → the sequence restarts at 00001.
      const startingInvoiceNumber = lastInvoiceNumber?.invoice_number || `INV-${billingYear}-00000`;

      const customerContactInformation = customerInformation[customer_id];
      if (!customerContactInformation) {
         throw new Error(`Customer ${customer_id} has no active mailing address on file; add one before invoicing.`);
      }
      const invoiceNumber = incrementAnInvoiceOrQuote(startingInvoiceNumber, i, billingYear);
      const dueDate = statementDate.add(16, 'day').format('MM/DD/YYYY');

      return { invoiceNumber, dueDate, billingDate: statementDate.format('YYYY-MM-DD'), globalInvoiceNote, invoiceNote, accountBillingInformation, customerContactInformation, companyLogo, ...invoiceCalculation };
   });
};

// loadCompanyLogo is exported alongside the main entry point so its
// authorization behaviour (review/full-audit-2026-09 finding 2 — a foreign
// or malformed account_company_logo key must never be fetched, and must
// never surface as a 500) can be unit/integration-tested directly, without
// having to drive an entire invoice finalize just to reach it.
module.exports = { addInvoiceDetails, loadCompanyLogo };
