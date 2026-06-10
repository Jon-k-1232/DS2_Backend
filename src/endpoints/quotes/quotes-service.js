const quotesService = {
  getActiveQuotes(db, accountID) {
    return db.select().from('customer_quotes').where('account_id', accountID);
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
