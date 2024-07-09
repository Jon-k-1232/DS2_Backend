// Define the schema for customer_writeOffs
const writeOffSchema = {
   writeoff_id: 'int',
   customer_id: 'int',
   account_id: 'int',
   customer_invoice_id: ['int', 'null'],
   customer_job_id: ['int', 'null'],
   writeoff_date: 'date',
   writeoff_amount: 'decimal',
   transaction_type: 'string',
   writeoff_reason: 'string',
   created_at: 'timestamp',
   created_by_user_id: 'int',
   note: ['text', 'null']
};

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

// Function to clean and validate write-off object
const cleanAndValidateWriteOffObject = writeOffObject => {
   // Remove any extraneous properties not in the schema
   Object.keys(writeOffObject).forEach(key => {
      if (!writeOffSchema.hasOwnProperty(key)) {
         delete writeOffObject[key];
      }
   });

   // Validate each property according to the schema
   const validatedKeys = Object.keys(writeOffSchema).every(key => {
      const schemaTypes = Array.isArray(writeOffSchema[key]) ? writeOffSchema[key] : [writeOffSchema[key]];

      if (!writeOffObject.hasOwnProperty(key) || !schemaTypes.some(type => transactionValidators[type](writeOffObject[key]))) {
         // Log message
         console.log(`${key} failed data type validation. Attempting to correct data type.`);

         // Attempt to correct the type
         const correctedValue = correctType(
            writeOffObject[key],
            schemaTypes.find(type => type !== 'null')
         );

         if (correctedValue !== null && schemaTypes.some(type => transactionValidators[type](correctedValue))) {
            writeOffObject[key] = correctedValue;
            console.log(`${key} data type corrected.`);
            return true;
         }

         throw new Error(`Validation of write-off object failed prior to database insert failed on ${key} on ${writeOffObject.customer_id}`);
      }
      return true;
   });

   if (!validatedKeys) throw new Error(`Validation of write off failed prior to database insert on ${writeOffObject.customer_id}`);

   console.log(`Write Off: ${writeOffObject.writeoff_id} has been validated successfully.`);
   return writeOffObject;
};

module.exports = cleanAndValidateWriteOffObject;
