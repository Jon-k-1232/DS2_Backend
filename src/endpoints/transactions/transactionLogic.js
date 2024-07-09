const fetchUserTime = (activeUsers, transactions, unitType) => {
   const unit = unitType === 'Time' ? 'time' : 'count';

   const usersLookup = activeUsers.reduce((acc, user) => ({ ...acc, [user.user_id]: { user, [unit]: 0, customers: [] } }), {});

   const usersWithTime = transactions.reduce((acc, transaction) => {
      const { display_name, job_description, quantity, logged_for_user_id, transaction_type, ...transactionDetails } = transaction;
      const userKey = logged_for_user_id;

      if (transaction_type !== unitType) return acc;

      if (!acc[userKey]) acc[userKey] = usersLookup[logged_for_user_id];

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
