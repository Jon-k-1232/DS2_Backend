const restoreDataTypesRetainersTableOnCreate = data => ({
   parent_retainer_id: Number(data.parentRetainerID) || null,
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   display_name: data.displayName,
   type_of_hold: data.typeOfHold,
   starting_amount: Number(data.unitCost),
   current_amount: Number(data.unitCost),
   form_of_payment: data.formOfPayment,
   payment_reference_number: data.paymentReferenceNumber,
   is_retainer_active: true,
   created_by_user_id: Number(data.loggedByUserID),
   note: data.note || null
});

const restoreDataTypesRetainersTableOnUpdate = data => ({
   retainer_id: Number(data.retainerID),
   parent_retainer_id: Number(data.parentRetainerID) || null,
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   display_name: data.displayName,
   type_of_hold: data.typeOfHold,
   starting_amount: Number(data.unitCost),
   current_amount: Number(data.unitCost),
   form_of_payment: data.formOfPayment,
   payment_reference_number: data.paymentReferenceNumber,
   is_retainer_active: true,
   created_by_user_id: Number(data.loggedByUserID),
   note: data.note || null
});

module.exports = { restoreDataTypesRetainersTableOnCreate, restoreDataTypesRetainersTableOnUpdate };
