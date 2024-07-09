const express = require('express');
const quotesRouter = express.Router();
const quotesService = require('./quotes-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const { restoreDataTypesQuotesTableOnCreate, restoreDataTypesQuotesTableOnUpdate } = require('./quotesObjects');
const { createGrid } = require('../../helperFunctions/helperFunctions');

// Create a new quote
quotesRouter.route('/createQuote').post(jsonParser, async (req, res) => {
  const db = req.app.get('db');
  const sanitizedNewQuote = sanitizeFields(req.body.quote);

  // Create new object with sanitized fields
  const quoteTableFields = restoreDataTypesQuotesTableOnCreate(sanitizedNewQuote);

  // Post new quotes
  await quotesService.createQuote(db, quoteTableFields);

  // Get all quotes
  const quotesData = await quotesService.getActiveQuotes(db, quoteTableFields.account_id);

  // Create grid for Mui Grid
  const grid = createGrid(quotesData);

  const quote = {
    quotesData,
    grid
  };

  res.send({
    quote,
    message: 'Successfully created new quote.',
    status: 200
  });
});

// Get all active quotes
quotesRouter.route('/getActiveQuotes/:accountID/:quoteID').get(async (req, res) => {
  const db = req.app.get('db');
  const { accountID } = req.params;

  const activeQuotes = await quotesService.getActiveQuotes(db, accountID);

  // Create Mui Grid
  const grid = createGrid(activeQuotes);

  // Return Object
  const activeQuoteData = {
    activeQuotes,
    grid
  };

  res.send({
    activeQuoteData,
    message: 'Successfully retrieved all active quotes.',
    status: 200
  });
});

// Update a quote
quotesRouter.route('/updateQuote').put(jsonParser, async (req, res) => {
  const db = req.app.get('db');
  const sanitizedUpdatedQuote = sanitizeFields(req.body.quote);

  // Create new object with sanitized fields
  const quoteTableFields = restoreDataTypesQuotesTableOnUpdate(sanitizedUpdatedQuote);

  // Update quote
  await quotesService.updateQuote(db, quoteTableFields);

  // Get all quote
  const quotesData = await quotesService.getActiveQuotes(db, quoteTableFields.account_id);

  // Create grid for Mui Grid
  const grid = createGrid(quotesData);

  const quote = {
    quotesData,
    grid
  };

  res.send({
    quote,
    message: 'Successfully updated quote.',
    status: 200
  });
});

// Delete a quote
quotesRouter.route('/deleteQuote/:accountID/:quoteID').delete(async (req, res) => {
  const db = req.app.get('db');
  const { accountID, quoteID } = req.params;

  // Delete quote
  await quotesService.deleteQuote(db, quoteID);

  // Get all quotes
  const quotesData = await quotesService.getActiveQuotes(db, accountID);

  // Create grid for Mui Grid
  const grid = createGrid(quotesData);

  const quote = {
    quotesData,
    grid
  };

  res.send({
    quote,
    message: 'Successfully deleted quote.',
    status: 200
  });
});

module.exports = quotesRouter;
