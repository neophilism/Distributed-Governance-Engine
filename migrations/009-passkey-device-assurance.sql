-- Passkey proof is local step-up evidence. It never grants an encrypted device by itself.
ALTER TABLE dge_identity.sessions
  ADD COLUMN passkey_verified_at timestamptz,
  ADD COLUMN passkey_credential_id uuid;

CREATE TABLE dge_identity.passkey_credentials (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK(sign_count BETWEEN 0 AND 9007199254740991),
  transports text[] NOT NULL DEFAULT '{}',
  backed_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK(length(credential_id) BETWEEN 1 AND 2048),
  CHECK(length(public_key) BETWEEN 1 AND 16384),
  CHECK(cardinality(transports)<=8)
);
CREATE INDEX passkey_credentials_active_account
  ON dge_identity.passkey_credentials(account_id,created_at)
  WHERE revoked_at IS NULL;

ALTER TABLE dge_identity.sessions
  ADD CONSTRAINT sessions_passkey_credential
  FOREIGN KEY(passkey_credential_id) REFERENCES dge_identity.passkey_credentials(id);

CREATE TABLE dge_identity.passkey_challenges (
  challenge_digest char(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  session_digest char(64) NOT NULL REFERENCES dge_identity.sessions(token_digest),
  purpose text NOT NULL CHECK(purpose IN ('enrollment','authentication')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK(expires_at>created_at)
);
CREATE INDEX passkey_challenges_expiry ON dge_identity.passkey_challenges(expires_at);

CREATE TABLE dge_identity.authorized_devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  passkey_credential_id uuid NOT NULL REFERENCES dge_identity.passkey_credentials(id),
  key_thumbprint char(64) NOT NULL,
  authorized_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE(account_id,key_thumbprint)
);
CREATE INDEX authorized_devices_active_account
  ON dge_identity.authorized_devices(account_id,authorized_at)
  WHERE revoked_at IS NULL;

ALTER TABLE dge_identity.account_security_events
  DROP CONSTRAINT account_security_events_kind_check;
ALTER TABLE dge_identity.account_security_events
  ADD CONSTRAINT account_security_events_kind_check
  CHECK(kind IN ('recovery-codes-issued','recovery-code-redeemed','passkey-enrolled','passkey-authenticated','device-authorized','device-revoked'));

GRANT SELECT,INSERT,UPDATE ON dge_identity.passkey_credentials,dge_identity.passkey_challenges,dge_identity.authorized_devices TO dge_identity_runtime;
GRANT DELETE ON dge_identity.passkey_challenges TO dge_identity_runtime;
