-- Provider restoration requires a restricted recovery session plus a fresh enrolled-passkey proof.
ALTER TABLE dge_identity.account_security_events
  DROP CONSTRAINT account_security_events_kind_check;
ALTER TABLE dge_identity.account_security_events
  ADD CONSTRAINT account_security_events_kind_check
  CHECK(kind IN (
    'recovery-codes-issued',
    'recovery-code-redeemed',
    'passkey-enrolled',
    'passkey-authenticated',
    'device-authorized',
    'device-revoked',
    'provider-identity-restored'
  ));
