-- Credential revocation is an account security event and immediately removes linked device authority.
ALTER TABLE dge_identity.account_security_events
  DROP CONSTRAINT account_security_events_kind_check;
ALTER TABLE dge_identity.account_security_events
  ADD CONSTRAINT account_security_events_kind_check
  CHECK(kind IN ('recovery-codes-issued','recovery-code-redeemed','passkey-enrolled','passkey-authenticated','passkey-revoked','device-authorized','device-revoked'));
