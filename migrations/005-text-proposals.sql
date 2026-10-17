CREATE SCHEMA dge_proposals;
REVOKE ALL ON SCHEMA dge_proposals FROM PUBLIC;
GRANT USAGE ON SCHEMA dge_proposals TO dge_identity_runtime;
CREATE TABLE dge_proposals.proposals (
  tenant_id uuid NOT NULL, document_id uuid NOT NULL, id uuid NOT NULL UNIQUE,
  base_version integer NOT NULL, proposal jsonb NOT NULL, digest char(64) NOT NULL,
  actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id), created_at timestamptz NOT NULL,
  command_id uuid NOT NULL, request_digest char(64) NOT NULL,
  PRIMARY KEY(tenant_id,document_id,id), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,document_id,base_version) REFERENCES dge_documents.versions(tenant_id,document_id,version)
);
CREATE TABLE dge_proposals.anchor_outbox (
  tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL,
  event_digest char(64) NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,document_id,proposal_id),
  FOREIGN KEY(tenant_id,document_id,proposal_id) REFERENCES dge_proposals.proposals(tenant_id,document_id,id)
);
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['proposals','anchor_outbox'] LOOP
    EXECUTE format('ALTER TABLE dge_proposals.%I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE dge_proposals.%I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY tenant_scope ON dge_proposals.%I TO dge_identity_runtime USING(tenant_id::text=current_setting(''dge.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
  END LOOP;
END $$;
CREATE POLICY public_proposals ON dge_proposals.proposals FOR SELECT TO dge_identity_runtime
  USING(document_id::text=current_setting('dge.public_document_id',true));
GRANT SELECT,INSERT ON dge_proposals.proposals,dge_proposals.anchor_outbox TO dge_identity_runtime;
CREATE INDEX proposals_directory ON dge_proposals.proposals(tenant_id,document_id,id);
CREATE INDEX proposals_author ON dge_proposals.proposals(tenant_id,document_id,actor_id);
