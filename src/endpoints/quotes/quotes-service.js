const quotesService = {
  getActiveQuotes(db, accountID) {
    return db.select().from('customer_quotes').where('account_id', accountID);
  },

  getLabeledQuotes(db, accountID) {
    return db('customer_quotes as q').select('q.*','c.display_name','c.business_name','t.job_description')
      .leftJoin('customers as c',function(){this.on('q.customer_id','c.customer_id').andOn('q.account_id','c.account_id');})
      .leftJoin('customer_jobs as j',function(){this.on('q.customer_job_id','j.customer_job_id').andOn('q.account_id','j.account_id').andOn('q.customer_id','j.customer_id');})
      .leftJoin('customer_job_types as t',function(){this.on('j.job_type_id','t.job_type_id').andOn('q.account_id','t.account_id');})
      .where('q.account_id',accountID);
  },

  createQuote(db, newQuote) {
    return db
      .insert(newQuote)
      .into('customer_quotes')
      .returning('*')
      .then(rows => rows[0]);
  },

  updateQuote(db, updatedQuote, accountId) {
    return db
      .update(updatedQuote)
      .into('customer_quotes')
      .where('customer_quote_id', '=', updatedQuote.customer_quote_id)
      .andWhere('account_id', accountId)
      .returning('*')
      .then(rows => rows[0]);
  },

  deleteQuote(db, quoteID, accountId) {
    return db
      .delete()
      .from('customer_quotes')
      .where('customer_quote_id', '=', quoteID)
      .andWhere('account_id', accountId)
      .returning('*')
      .then(rows => rows[0]);
  }
};

module.exports = quotesService;
