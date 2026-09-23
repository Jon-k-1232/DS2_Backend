const express = require('express');
const healthRouter = express.Router();
const healthService = require('./health-service');

// Health check for AWS ECS/ALB that actually verifies DB connectivity (unlike
// the bare /healthz below, which must stay cheap since it's polled far more
// frequently). healthService.dbStatus previously existed but was never called
// from anywhere — this endpoint always reported "ok" regardless of DB state.
healthRouter.get('/check', async (req, res) => {
   const db = req.app.get('db');
   try {
      await healthService.dbStatus(db);
      res.status(200).json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
   } catch (error) {
      console.error('Health check DB probe failed:', error.message);
      res.status(503).json({ status: 'error', db: 'error', message: error.message, timestamp: new Date().toISOString() });
   }
});

// Healthz endpoint for AWS health checks (no auth required)
// Mounted at /healthz in app.js, so this responds to /healthz
healthRouter.get('/', (req, res) => {
   res.status(200).json({ status: 'ok' });
});

module.exports = { healthRouter };
