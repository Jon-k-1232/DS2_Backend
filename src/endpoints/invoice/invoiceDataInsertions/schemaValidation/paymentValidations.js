// Define schema for payments
const paymentSchema = {
   payment_id: 'int',
   customer_id: 'int',
   account_id: 'int',
   customer_job_id: ['int', 'null'],
   retainer_id: ['int', 'null'],
   customer_invoice_id: ['int', 'null'],
   payment_date: 'date',
   payment_amount: 'decimal',
   form_of_payment: 'string',
   payment_reference_number: 'string',
   is_transaction_billable: 'boolean',
   created_at: 'timestamp',
   created_by_user_id: 'int',
   note: ['text', 'null']
};

// Define validators for payments
const paymentValidators = {
   int: n => Number.isInteger(n),
   string: str => typeof str === 'string',
   text: str => typeof str === 'string',
   date: d => !isNaN(new Date(d).getTime()),
   decimal: n => typeof n === 'number',
   boolean: b => typeof b === 'boolean',
   timestamp: ts => !isNaN(new Date(ts).getTime()),
   null: val => val === null
};

// Function to clean and validate each object
const correctType = (value, expectedType) => {
   switch (expectedType) {
      case 'int':
         return Number.isNaN(parseInt(value)) ? null : parseInt(value);
      case 'string':
      case 'text':
         return value.toString();
      case 'decimal':
         return Number.isNaN(parseFloat(value)) ? null : parseFloat(value);
      default:
         return null;
   }
};

const cleanAndValidatePaymentObject = paymentObject => {
   // Remove any extraneous properties not in the schema
   Object.keys(paymentObject).forEach(key => {
      if (!paymentSchema.hasOwnProperty(key)) {
         delete paymentObject[key];
      }
   });

   // Validate each property according to the schema
   const validatedKeys = Object.keys(paymentSchema).every(key => {
      const schemaTypes = Array.isArray(paymentSchema[key]) ? paymentSchema[key] : [paymentSchema[key]];

      if (!paymentObject.hasOwnProperty(key) || !schemaTypes.some(type => paymentValidators[type](paymentObject[key]))) {
         console.log(`${key} failed data type validation. Attempting to correct data type.`);

         const correctedValue = correctType(
            paymentObject[key],
            schemaTypes.find(type => type !== 'null')
         );

         if (correctedValue !== null && schemaTypes.some(type => paymentValidators[type](correctedValue))) {
            paymentObject[key] = correctedValue;
            console.log(`${key} data type corrected.`);
            return true;
         }

         throw new Error(`Validation of payment object failed prior to database insert failed on ${key} on ${paymentObject.customer_id}`);
      }

      return true;
   });

   if (!validatedKeys) throw new Error(`Validation of payment failed prior to database insert on ${paymentObject.customer_id}`);

   console.log(`Payment: ${paymentObject.payment_id} has been validated successfully.`);
   return paymentObject;
};

module.exports = cleanAndValidatePaymentObject;
