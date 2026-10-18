-- Persist the exact server policy evidence applied to each new passkey.
-- Existing credentials remain usable but retain NULL evidence rather than invented metadata.
ALTER TABLE dge_identity.passkey_credentials
  ADD COLUMN attestation_policy_id text,
  ADD COLUMN attestation_format text,
  ADD COLUMN aaguid uuid;

UPDATE dge_identity.passkey_credentials
SET attestation_policy_id='legacy-unrecorded-v0',
    attestation_format='unknown',
    aaguid='00000000-0000-0000-0000-000000000000'
WHERE attestation_policy_id IS NULL;

ALTER TABLE dge_identity.passkey_credentials
  ALTER COLUMN attestation_policy_id SET NOT NULL,
  ALTER COLUMN attestation_format SET NOT NULL,
  ALTER COLUMN aaguid SET NOT NULL,
  ADD CONSTRAINT passkey_attestation_evidence_complete CHECK(
    attestation_policy_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$' AND
    attestation_format ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  );
