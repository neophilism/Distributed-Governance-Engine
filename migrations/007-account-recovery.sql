-- Recovery codes are account credentials, never encrypted-device credentials.
ALTER TABLE dge_identity.sessions
  ADD COLUMN authentication_method text NOT NULL DEFAULT 'oidc'
  CHECK(authentication_method IN ('oidc','recovery'));

CREATE TABLE dge_identity.recovery_codes (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  token_digest char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK(expires_at>created_at)
);
CREATE INDEX recovery_codes_active_account
  ON dge_identity.recovery_codes(account_id,expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE dge_identity.account_security_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  kind text NOT NULL CHECK(kind IN ('recovery-codes-issued','recovery-code-redeemed')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX account_security_events_account_time
  ON dge_identity.account_security_events(account_id,occurred_at DESC);

GRANT SELECT,INSERT,UPDATE ON dge_identity.recovery_codes TO dge_identity_runtime;
GRANT SELECT,INSERT ON dge_identity.account_security_events TO dge_identity_runtime;
