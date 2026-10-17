-- Run with a migration owner, never the ordinary request credential.
CREATE SCHEMA IF NOT EXISTS dge_identity;
REVOKE ALL ON SCHEMA dge_identity FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dge_identity_runtime') THEN
    CREATE ROLE dge_identity_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dge_identity_runtime' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolcanlogin))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='dge_identity_runtime')) THEN
    RAISE EXCEPTION 'Identity runtime must remain an unprivileged NOLOGIN permission group';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS dge_identity.accounts (
  id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  auth_epoch integer NOT NULL DEFAULT 1 CHECK (auth_epoch>0),
  created_at timestamptz NOT NULL, UNIQUE(issuer,subject),
  CHECK(length(issuer) BETWEEN 1 AND 2048), CHECK(length(subject) BETWEEN 1 AND 255)
);
CREATE TABLE IF NOT EXISTS dge_identity.sessions (
  token_digest char(64) PRIMARY KEY, account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  auth_epoch integer NOT NULL, csrf_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS sessions_account ON dge_identity.sessions(account_id);
CREATE TABLE IF NOT EXISTS dge_identity.tenants (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS dge_identity.memberships (
  tenant_id uuid NOT NULL REFERENCES dge_identity.tenants(id),
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  role text NOT NULL CHECK(role IN ('owner','admin','editor','participant','viewer')),
  active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,account_id)
);
CREATE INDEX IF NOT EXISTS memberships_account ON dge_identity.memberships(account_id,tenant_id);
CREATE TABLE IF NOT EXISTS dge_identity.invitations (
  token_digest char(64) PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES dge_identity.tenants(id),
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  role text NOT NULL CHECK(role IN ('admin','editor','participant','viewer')),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS dge_identity.login_challenges (
  state_digest char(64) PRIMARY KEY, browser_digest char(64) NOT NULL,
  sealed_state text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS dge_identity.events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES dge_identity.tenants(id),
  actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  subject_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  kind text NOT NULL CHECK(kind IN ('tenant-created','invited','joined','role-changed','removed')),
  occurred_at timestamptz NOT NULL
);
ALTER TABLE dge_identity.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dge_identity.events FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dge_identity' AND tablename='tenants' AND policyname='tenant_scope') THEN
    CREATE POLICY tenant_scope ON dge_identity.tenants TO dge_identity_runtime
      USING(id::text=current_setting('dge.tenant_id',true))
      WITH CHECK(id::text=current_setting('dge.tenant_id',true));
  END IF;
  FOR i IN 1..3 LOOP
    DECLARE target text := (ARRAY['memberships','invitations','events'])[i]; BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dge_identity' AND tablename=target AND policyname='tenant_scope') THEN
        EXECUTE format('CREATE POLICY tenant_scope ON dge_identity.%I TO dge_identity_runtime USING(tenant_id::text=current_setting(''dge.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
      END IF;
    END;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA dge_identity TO dge_identity_runtime;
GRANT SELECT,INSERT,UPDATE ON dge_identity.accounts,dge_identity.sessions,dge_identity.tenants,dge_identity.memberships,dge_identity.invitations TO dge_identity_runtime;
GRANT SELECT,INSERT,DELETE ON dge_identity.login_challenges TO dge_identity_runtime;
GRANT SELECT,INSERT ON dge_identity.events TO dge_identity_runtime;
