'use strict';
const router = require('express').Router();
const { route } = require('../../utils/ledgerAction');
const s = require('./recurring-billing');
const args = req => ({ accountId: Number(req.user.account_id), actorId: Number(req.user.user_id), body: req.body || {}, query: req.query,
  key: req.get('Idempotency-Key'), planId: req.params.planID, occurrenceId: req.params.occurrenceID });
router.get('/plans', route(req => s.due(req.app.get('db'), args(req))));
router.post('/plans', route(req => s.savePlan(req.app.get('db'), args(req))));
router.get('/plans/:planID', route(req => s.detail(req.app.get('db'), args(req))));
router.patch('/plans/:planID', route(req => s.savePlan(req.app.get('db'), args(req))));
router.get('/due', route(req => s.due(req.app.get('db'), args(req))));
router.post('/prepare', route(req => s.prepare(req.app.get('db'), args(req))));
router.post('/:planID/catch-up', route(req => s.catchUp(req.app.get('db'), args(req))));
router.patch('/occurrences/:occurrenceID', route(req => s.changeOccurrence(req.app.get('db'), args(req))));
router.post('/occurrences/:occurrenceID/skip', route(req => s.changeOccurrence(req.app.get('db'), args(req), true)));
module.exports = router;
