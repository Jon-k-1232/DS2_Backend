const express = require('express');
const healthRouter = express.Router();

// Simple health check for AWS ECS/ALB
healthRouter.get('/check', (req, res) => {
   res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Healthz endpoint for AWS health checks (no auth required)
healthRouter.get('/healthz', (req, res) => {
   res.status(200).json({ status: 'ok' });
});

module.exports = { healthRouter };
