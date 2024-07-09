// Define your schema
const invoiceSchema = {
   parent_invoice_id: ['int', 'null'],
   account_id: 'int',
   customer_id: 'int',
   customer_info_id: 'int',
   invoice_number: 'string',
   invoice_date: 'date',
   due_date: 'date',
   beginning_balance: 'decimal',
   total_payments: 'decimal',
   total_charges: 'decimal',
   total_write_offs: 'decimal',
   total_retainers: 'decimal',
   total_amount_due: 'decimal',
   remaining_balance_on_invoice: 'int',
   is_invoice_paid_in_full: 'boolean',
   fully_paid_date: ['date', 'null'],
   created_by_user_id: 'int',
   start_date: 'date',
   end_date: 'date',
   invoice_file_location: ['string', 'null'],
   notes: ['string', 'null']
};

// Updated validators to include 'null'
const invoiceValidators = {
   int: n => Number.isInteger(n),
   string: str => typeof str === 'string',
   date: d => !isNaN(new Date(d).getTime()),
   decimal: n => typeof n === 'number',
   boolean: b => typeof b === 'boolean',
   timestamp: ts => !isNaN(new Date(ts).getTime()),
   null: n => n === null
};

const correctType = (value, expectedType) => {
   switch (expectedType) {
      case 'int':
         return Number.isNaN(parseInt(value)) ? null : parseInt(value);
      case 'string':
         return value.toString();
      default:
         return null;
   }
};

// Updated cleanAndValidateInvoiceObject function
const cleanAndValidateInvoiceObject = invoiceObject => {
   // Remove any extraneous properties not in the schema
   Object.keys(invoiceObject).forEach(key => {
      if (!invoiceSchema.hasOwnProperty(key)) {
         delete invoiceObject[key];
      }
   });

   // Validate each property according to the schema
   const validatedKeys = Object.keys(invoiceSchema).every(key => {
      const schemaTypes = Array.isArray(invoiceSchema[key]) ? invoiceSchema[key] : [invoiceSchema[key]];

      if (!invoiceObject.hasOwnProperty(key) || !schemaTypes.some(type => invoiceValidators[type](invoiceObject[key]))) {
         // Log message
         console.log(`${key} failed data type validation. Attempting to correct data type.`);

         // Attempt to correct the type
         const correctedValue = correctType(
            invoiceObject[key],
            schemaTypes.find(type => type !== 'null')
         );

         if (correctedValue !== null && schemaTypes.some(type => invoiceValidators[type](correctedValue))) {
            invoiceObject[key] = correctedValue;
            console.log(`${key} data type corrected.`);
            return true;
         }

         throw new Error(`Validation of invoice object failed prior to database insert failed on ${key} on ${invoiceObject.customer_id}`);
      }
      return true;
   });

   if (!validatedKeys) throw new Error(`Validation of invoice failed prior to database insert on ${invoiceObject.customer_id}`);

   console.log(`New invoice for: ${invoiceObject.customer_id} has been validated successfully.`);
   return invoiceObject;
};

module.exports = cleanAndValidateInvoiceObject;
