-- Preserve legacy PDF bytes and audit hashes. New records archive their source
-- snapshot alongside the PDF; both objects are unique, conditional creations.
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS record_type text NOT NULL DEFAULT 'full_evidence';
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS evidence_storage_key text;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS evidence_sha256 text;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS evidence_byte_length integer;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='audit_records'::regclass AND conname='audit_record_type_valid') THEN
  ALTER TABLE audit_records ADD CONSTRAINT audit_record_type_valid CHECK(record_type IN ('client','full_evidence'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='audit_records'::regclass AND conname='audit_record_evidence_valid') THEN
  ALTER TABLE audit_records ADD CONSTRAINT audit_record_evidence_valid CHECK(
   (evidence_storage_key IS NULL AND evidence_sha256 IS NULL AND evidence_byte_length IS NULL) OR
   (evidence_storage_key IS NOT NULL AND evidence_sha256 IS NOT NULL AND evidence_byte_length IS NOT NULL AND
    evidence_sha256 ~ '^[a-f0-9]{64}$' AND evidence_byte_length>0));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS audit_record_evidence_key ON audit_records(evidence_storage_key) WHERE evidence_storage_key IS NOT NULL;
