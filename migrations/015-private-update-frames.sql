-- DCE-008: encrypted Yjs update ledger, no server plaintext or group key.
-- Storage is deliberately disabled until a verified device/MLS authority is installed.
CREATE TABLE dge_private.update_frames (
 tenant_id uuid NOT NULL,
 document_id uuid NOT NULL,
 position bigint NOT NULL CHECK (position BETWEEN 1 AND 1000000),
 epoch integer NOT NULL CHECK (epoch BETWEEN 0 AND 1000000),
 sender_device_id uuid NOT NULL,
 sender_sequence bigint NOT NULL CHECK (sender_sequence BETWEEN 1 AND 4294967295),
 nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
 ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 17 AND 32784),
 digest char(64) NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
 created_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,document_id,position),
 UNIQUE (tenant_id,document_id,epoch,sender_device_id,sender_sequence),
 FOREIGN KEY (tenant_id,document_id) REFERENCES dge_private.documents(tenant_id,id)
);
CREATE INDEX update_frames_tenant_epoch_read ON
 dge_private.update_frames (tenant_id,document_id,epoch,position);
ALTER TABLE dge_private.update_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE dge_private.update_frames FORCE ROW LEVEL SECURITY;
CREATE POLICY private_frame_select ON dge_private.update_frames
 FOR SELECT TO dge_identity_runtime
 USING (tenant_id::text=current_setting('dge.tenant_id',true));
CREATE POLICY private_frame_insert ON dge_private.update_frames
 FOR INSERT TO dge_identity_runtime
 WITH CHECK (tenant_id::text=current_setting('dge.tenant_id',true));
GRANT SELECT,INSERT ON dge_private.update_frames TO dge_identity_runtime;
-- Deliberately no UPDATE/DELETE grants: prior ciphertext & replay history immutable.
