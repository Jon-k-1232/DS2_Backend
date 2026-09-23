const fetchUserTime = (activeUsers, transactions, unitType) => {
   const unit = unitType === 'Time' ? 'time' : 'count';
   const normalizedUnitType = String(unitType || '').toLowerCase();

   const usersLookup = activeUsers.reduce((acc, user) => ({ ...acc, [user.user_id]: { user, [unit]: 0, customers: [] } }), {});

   const usersWithTime = transactions.reduce((acc, transaction) => {
      const { display_name, job_description, quantity, logged_for_user_id, transaction_type, ...transactionDetails } = transaction;
      const userKey = logged_for_user_id;

      // Case-insensitive: transaction_type is persisted as 'Time'/'Charge' via
      // normalizeTransactionType, but legacy rows may have inconsistent casing.
      if (String(transaction_type || '').toLowerCase() !== normalizedUnitType) return acc;

      // logged_for_user_id may belong to a user who is no longer active (and
      // therefore absent from `activeUsers`/`usersLookup`) — e.g. someone who
      // logged time before being deactivated. There's nothing to attribute
      // this transaction to in an active-users view, so skip it rather than
      // crash on the undefined lookup entry. Checking the lookup BEFORE
      // assigning matters: `acc[userKey] = undefined` would still create an
      // enumerable key, so a plain `!acc[userKey]` guard after the fact
      // wouldn't stop Object.values() below from yielding an undefined entry.
      if (!acc[userKey]) {
         const lookupEntry = usersLookup[logged_for_user_id];
         if (!lookupEntry) return acc;
         acc[userKey] = lookupEntry;
      }

      let customer = acc[userKey].customers.find(item => item.customer === display_name);

      if (!customer) {
         customer = { customer: display_name, [unit]: 0, jobs: [] };
         acc[userKey].customers.push(customer);
      }

      customer[unit] = Number((Number(customer[unit]) + Number(quantity)).toFixed(2));
      let job = customer.jobs.find(item => item.job === job_description);

      if (!job) {
         job = { job: job_description, [unit]: 0, transactions: [] };
         customer.jobs.push(job);
      }

      job[unit] = Number((Number(job[unit]) + Number(quantity)).toFixed(2));
      job.transactions.push({
         quantity: Number(quantity),
         logged_for_user_id,
         transaction_type,
         ...transactionDetails
      });

      acc[userKey][unit] = Number((Number(acc[userKey][unit]) + Number(quantity)).toFixed(2));
      return acc;
   }, {});

   return Object.values({ ...usersLookup, ...usersWithTime });
};

module.exports = { fetchUserTime };
