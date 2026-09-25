-- Optional credit statements: preserve the explicit selection reason alongside
-- the immutable issuer, timestamp, signed payload and original artifact.
-- No business-row backfill. Existing issues retain NULL (not selected here).
ALTER TABLE invoice_issues ADD COLUMN IF NOT EXISTS credit_selection_reason text
   CHECK (credit_selection_reason IS NULL OR
      (length(btrim(credit_selection_reason)) BETWEEN 1 AND 2000));
COMMENT ON COLUMN invoice_issues.credit_selection_reason IS
   'Explicit credit-statement selection at finalize (= sent); immutable issue evidence.';
