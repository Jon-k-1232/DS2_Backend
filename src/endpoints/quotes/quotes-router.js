const express = require('express');
const { enforceAccountId } = require('../auth/account-scope');
const quotesRouter = express.Router();
quotesRouter.param('accountID', enforceAccountId);
const quotesService = require('./quotes-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { restoreDataTypesQuotesTableOnCreate, restoreDataTypesQuotesTableOnUpdate } = require('./quotesObjects');
const { createGrid } = require('../../utils/gridFunctions');

// Create a new quote
quotesRouter.route('/createQuote').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedNewQuote = sanitizeFields(req.body.quote);

      // Create new object with sanitized fields
      const quoteTableFields = restoreDataTypesQuotesTableOnCreate(sanitizedNewQuote);
      // No :accountID in the path — scope to the authenticated user's account.
      quoteTableFields.account_id = req.user.account_id;

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
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the quote.',
         status: 500
      });
   }
});

// Get all active quotes
quotesRouter.route('/getActiveQuotes/:accountID/:quoteID').get(async (req, res) => {
   const db = req.app.get('db');
   try {
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
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while retrieving quotes.',
         status: 500
      });
   }
});

// Update a quote
quotesRouter.route('/updateQuote').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedQuote = sanitizeFields(req.body.quote);

      // Create new object with sanitized fields
      const quoteTableFields = restoreDataTypesQuotesTableOnUpdate(sanitizedUpdatedQuote);
      // No :accountID in the path — scope to the authenticated user's account.
      quoteTableFields.account_id = req.user.account_id;

      // Update quote
      await quotesService.updateQuote(db, quoteTableFields, quoteTableFields.account_id);

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
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the quote.',
         status: 500
      });
   }
});

// Delete a quote
quotesRouter.route('/deleteQuote/:accountID/:quoteID').delete(async (req, res) => {
   const db = req.app.get('db');
   try {
      const { accountID, quoteID } = req.params;

      // Delete quote
      await quotesService.deleteQuote(db, quoteID, accountID);

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
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while deleting the quote.',
         status: 500
      });
   }
});

module.exports = quotesRouter;
