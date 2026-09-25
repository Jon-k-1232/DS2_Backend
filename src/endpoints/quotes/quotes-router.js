const { committedResponse } = require('../../utils/committedResponse');
const { requireCustomerJob } = require('../../utils/relatedAccount');
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
      quoteTableFields.created_by_user_id = Number(req.user.user_id);

      await requireCustomerJob(db, quoteTableFields);

      // Post new quotes
      await quotesService.createQuote(db, quoteTableFields);

      // Get all quotes
      return committedResponse(res, 'Successfully created new quote.', async () => {
         const quotesData = await quotesService.getActiveQuotes(db, quoteTableFields.account_id);

         // Create grid for Mui Grid
         const grid = createGrid(quotesData);

         const quote = {
            quotesData,
            grid
         };

         return {
            quote,
            message: 'Successfully created new quote.',
            status: 200
         };
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

      await requireCustomerJob(db, quoteTableFields);

      // Update quote
      const updatedQuoteRow = await quotesService.updateQuote(db, quoteTableFields, quoteTableFields.account_id);
      if (!updatedQuoteRow) {
         return res.status(404).send({ message: 'Quote not found.', status: 404 });
      }

      // Get all quote
      return committedResponse(res, 'Successfully updated quote.', async () => {
         const quotesData = await quotesService.getActiveQuotes(db, quoteTableFields.account_id);

         // Create grid for Mui Grid
         const grid = createGrid(quotesData);

         const quote = {
            quotesData,
            grid
         };

         return {
            quote,
            message: 'Successfully updated quote.',
            status: 200
         };
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
      const deletedQuoteRow = await quotesService.deleteQuote(db, quoteID, accountID);
      if (!deletedQuoteRow) {
         return res.status(404).send({ message: 'Quote not found.', status: 404 });
      }

      // Get all quotes
      return committedResponse(res, 'Successfully deleted quote.', async () => {
         const quotesData = await quotesService.getActiveQuotes(db, accountID);

         // Create grid for Mui Grid
         const grid = createGrid(quotesData);

         const quote = {
            quotesData,
            grid
         };

         return {
            quote,
            message: 'Successfully deleted quote.',
            status: 200
         };
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
