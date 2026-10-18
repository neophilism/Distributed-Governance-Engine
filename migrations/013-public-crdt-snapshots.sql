-- Append-only Yjs v13 snapshots for explicitly PUBLIC collaboration drafts.
-- Every record is committed in the same transaction as the corresponding
-- canonical public document version. No private document fallback is allowed.
CREATE TABLE dge_documents.crdt_states (
 tenant_id uuid NOT NULL,
 document_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000000),
 format text NOT NULL CHECK(format='yjs-v13-public-v1'),
 state bytea NOT NULL CHECK(octet_length(state) BETWEEN 1 AND 3000000),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,document_id,version),
 FOREIGN KEY(tenant_id,document_id,version)
  REFERENCES dge_documents.versions(tenant_id,document_id,version)
);
ALTER TABLE dge_documents.crdt_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE dge_documents.crdt_states FORCE ROW LEVEL SECURITY;
CREATE POLICY crdt_tenant_read ON dge_documents.crdt_states
 FOR SELECT TO dge_identity_runtime
 USING(tenant_id::text=current_setting('dge.tenant_id',true));
CREATE POLICY crdt_tenant_append ON dge_documents.crdt_states
 FOR INSERT TO dge_identity_runtime
 WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
GRANT SELECT,INSERT ON dge_documents.crdt_states TO dge_identity_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON dge_documents.crdt_states FROM dge_identity_runtime;
