const { incrementAnInvoiceOrQuote } = require('../../sharedInvoiceFunctions');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const config = require('../../../../../config');
const { getObject } = require('../../../../utils/s3');
const { normalizeInvoiceFileLocation, sanitizeAccountName } = require('../../../../utils/invoicePath');

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
   const accountRoot = sanitizeAccountName(accountBillingInformation?.account_name || '');
   const fallbackS3Key = accountRoot ? `${accountRoot}/app/assets/logo.png` : null;

   if (typeof rawLogoValue === 'string' && rawLogoValue.trim().length > 0) {
      try {
         const normalizedKey = normalizeInvoiceFileLocation({
            rawLocation: rawLogoValue,
            accountName: accountBillingInformation?.account_name || '',
            bucketName: config.S3_BUCKET_NAME
         });

         let logoBuffer = await safeFetchS3LogoBuffer(normalizedKey);

         if (!logoBuffer && fallbackS3Key && fallbackS3Key !== normalizedKey) {
            logoBuffer = await safeFetchS3LogoBuffer(fallbackS3Key);
         }

         if (logoBuffer) {
            return logoBuffer;
         }
      } catch (error) {
         console.warn(`Falling back to legacy logo path ${rawLogoValue}: ${error.message}`);
      }

      const legacyPath = rawLogoValue.startsWith('/') ? rawLogoValue : `/${rawLogoValue}`;
      if (fs.existsSync(legacyPath)) {
         const legacyBuffer = fs.readFileSync(legacyPath);
         if (isSupportedImageBuffer(legacyBuffer)) {
            return legacyBuffer;
         }
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

const addInvoiceDetails = async (calculatedInvoices, invoiceQueryData, invoicesToCreateMap, accountBillingInformation, globalInvoiceNote) => {
   const companyLogo = await loadCompanyLogo(accountBillingInformation);

   return calculatedInvoices.map((invoiceCalculation, i) => {
      const { customer_id, invoiceNote } = invoicesToCreateMap[invoiceCalculation.customer_id];
      const { lastInvoiceNumber, customerInformation } = invoiceQueryData;
      const startingInvoiceNumber = lastInvoiceNumber?.invoice_number || 'INV-2024-00000';

      const customerContactInformation = customerInformation[customer_id];
      const invoiceNumber = incrementAnInvoiceOrQuote(startingInvoiceNumber, i);
      const dueDate = dayjs().add(16, 'day').format('MM/DD/YYYY');

      return { invoiceNumber, dueDate, globalInvoiceNote, invoiceNote, accountBillingInformation, customerContactInformation, companyLogo, ...invoiceCalculation };
   });
};

module.exports = { addInvoiceDetails };
