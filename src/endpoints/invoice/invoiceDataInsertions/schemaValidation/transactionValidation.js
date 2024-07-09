// Define your schema
const transactionSchema = {
   transaction_id: 'int',
   account_id: 'int',
   customer_id: 'int',
   customer_job_id: 'int',
   retainer_id: ['int', 'null'],
   customer_invoice_id: ['int', 'null'],
   logged_for_user_id: 'int',
   general_work_description_id: 'int',
   detailed_work_description: 'text',
   transaction_date: 'date',
   transaction_type: 'string',
   quantity: 'int',
   unit_cost: 'int',
   total_transaction: 'int',
   is_transaction_billable: 'boolean',
   is_excess_to_subscription: 'boolean',
   created_at: 'timestamp',
   created_by_user_id: 'int',
   note: ['text', 'null']
};

// Define your validators
const transactionValidators = {
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
         return value.toString();
      default:
         return null;
   }
};

/**
 * clean, validate and attempt self correction of transaction object prior to database insert
 * @param {*} transactionObject
 * @returns
 */
const cleanAndValidateTransactionObject = transactionObject => {
   // First, remove any extraneous properties not in the schema, clean the object
   Object.keys(transactionObject).forEach(key => {
      if (!transactionSchema.hasOwnProperty(key)) {
         delete transactionObject[key];
      }
   });

   // Next, validate each property according to the schema
   const validatedKeys = Object.keys(transactionSchema).every(key => {
      const schemaTypes = Array.isArray(transactionSchema[key]) ? transactionSchema[key] : [transactionSchema[key]];

      if (!transactionObject.hasOwnProperty(key) || !schemaTypes.some(type => transactionValidators[type](transactionObject[key]))) {
         // Log message
         console.log(`${key} failed data type validation. Attempting to correct data type.`);

         // Attempt to correct the type
         const correctedValue = correctType(
            transactionObject[key],
            schemaTypes.find(type => type !== 'null')
         );

         if (correctedValue !== null && schemaTypes.some(type => transactionValidators[type](correctedValue))) {
            transactionObject[key] = correctedValue;
            console.log(`${key} data type corrected.`);
            return true;
         }

         throw new Error(`Validation of transaction object failed prior to database insert failed on ${key} on ${transactionObject.customer_id}`);
      }
      return true;
   });
   if (!validatedKeys) throw new Error(`Validation of transaction failed prior to database insert on ${invoiceObject.customer_id}`);

   console.log(`Transaction: ${transactionObject.transaction_id} has been validated successfully.`);
   return transactionObject;
};

module.exports = cleanAndValidateTransactionObject;
