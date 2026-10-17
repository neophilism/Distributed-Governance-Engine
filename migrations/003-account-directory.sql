-- Permit a signed-in account to list only its own workspace routing entries.
-- Keep all membership writes strictly tenant-scoped.
DROP POLICY tenant_scope ON dge_identity.memberships;
CREATE POLICY membership_read ON dge_identity.memberships FOR SELECT TO dge_identity_runtime
  USING(tenant_id::text=current_setting('dge.tenant_id',true)
    OR account_id::text=current_setting('dge.account_id',true));
CREATE POLICY membership_insert ON dge_identity.memberships FOR INSERT TO dge_identity_runtime
  WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
CREATE POLICY membership_update ON dge_identity.memberships FOR UPDATE TO dge_identity_runtime
  USING(tenant_id::text=current_setting('dge.tenant_id',true))
  WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
GRANT SELECT ON dge_identity.migrations TO dge_identity_runtime;
ALTER TABLE dge_identity.invitations ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE dge_identity.invitations ADD COLUMN created_by uuid REFERENCES dge_identity.accounts(id);
ALTER TABLE dge_identity.events DROP CONSTRAINT events_kind_check;
ALTER TABLE dge_identity.events ADD CONSTRAINT events_kind_check CHECK(kind IN ('tenant-created','invited','joined','role-changed','removed','invitation-revoked'));
CREATE INDEX sessions_active_account_created ON dge_identity.sessions(account_id,created_at DESC) WHERE revoked_at IS NULL;
