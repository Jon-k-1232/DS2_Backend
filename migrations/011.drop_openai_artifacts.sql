-- Phase 1 cutover: drop OpenAI integration tables.
-- The Bedrock pipeline (src/ai_integrations/bedrock/, ai_call_log table)
-- replaces both fully. The training-example feedback loop continues to use
-- ai_category_training_examples (kept).

DROP TABLE IF EXISTS ai_request_logs;
DROP TABLE IF EXISTS ai_integrations;
