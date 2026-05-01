const express = require('express');
const aiIntegrationRouter = express.Router();

// Phase 1 cutover: the OpenAI integration endpoints are gone. The pipeline
// now runs on AWS Bedrock (see src/ai_integrations/bedrock/ and
// src/endpoints/timesheets/auto-ingest-orchestrator.js) and is gated by
// TIME_TRACKER_AI_FEATURE_FLAG. Any client still calling these routes
// receives 410 Gone with a pointer to the new surfaces.
const _gone = (_req, res) =>
   res.status(410).json({
      message: 'The /ai-integration endpoints have been removed. The time-tracker AI pipeline now runs on AWS Bedrock and is managed by feature flag rather than per-account API key. Use /billing-review and /notifications for the reviewer surface, and /time-tracking/template/latest for the dynamic template.',
      deprecated: true,
      replacedBy: ['/billing-review', '/notifications', '/time-tracking/template/latest']
   });

aiIntegrationRouter.all('*', _gone);

module.exports = aiIntegrationRouter;
