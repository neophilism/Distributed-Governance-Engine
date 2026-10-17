-- Preserve only a bounded assurance classification from the provider-signed OIDC amr claim.
-- This is authentication evidence, not encrypted-device enrollment.
ALTER TABLE dge_identity.sessions
  ADD COLUMN authentication_assurance text NOT NULL DEFAULT 'primary'
  CHECK(authentication_assurance IN ('primary','multifactor','hardware-bound'));
