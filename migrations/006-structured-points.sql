CREATE SCHEMA dge_discussion;
REVOKE ALL ON SCHEMA dge_discussion FROM PUBLIC;
GRANT USAGE ON SCHEMA dge_discussion TO dge_identity_runtime;
CREATE TABLE dge_discussion.points (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL, id uuid NOT NULL UNIQUE,
 parent_id uuid, depth integer NOT NULL CHECK(depth BETWEEN 0 AND 8), position text NOT NULL CHECK(position IN ('support','oppose','clarify')),
 data jsonb NOT NULL, digest char(64) NOT NULL, actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id), created_at timestamptz NOT NULL,
 command_id uuid NOT NULL, request_digest char(64) NOT NULL,
 PRIMARY KEY(tenant_id,document_id,proposal_id,id), UNIQUE(tenant_id,command_id), CHECK(parent_id IS NULL OR parent_id<>id),
 FOREIGN KEY(tenant_id,document_id,proposal_id) REFERENCES dge_proposals.proposals(tenant_id,document_id,id),
 FOREIGN KEY(tenant_id,document_id,proposal_id,parent_id) REFERENCES dge_discussion.points(tenant_id,document_id,proposal_id,id)
);
CREATE TABLE dge_discussion.scores (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL, point_id uuid NOT NULL,
 up_count integer NOT NULL CHECK(up_count>=0), down_count integer NOT NULL CHECK(down_count>=0), net integer GENERATED ALWAYS AS (up_count-down_count) STORED,
 PRIMARY KEY(tenant_id,document_id,proposal_id,point_id),
 FOREIGN KEY(tenant_id,document_id,proposal_id,point_id) REFERENCES dge_discussion.points(tenant_id,document_id,proposal_id,id)
);
CREATE TABLE dge_discussion.activity (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL, epoch bigint NOT NULL CHECK(epoch>0), content_epoch bigint NOT NULL CHECK(content_epoch>0),
 PRIMARY KEY(tenant_id,document_id,proposal_id), FOREIGN KEY(tenant_id,document_id,proposal_id) REFERENCES dge_proposals.proposals(tenant_id,document_id,id)
);
CREATE TABLE dge_discussion.votes (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL, point_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id), value integer NOT NULL CHECK(value IN (-1,0,1)), version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(tenant_id,document_id,proposal_id,point_id,actor_id),
 FOREIGN KEY(tenant_id,document_id,proposal_id,point_id) REFERENCES dge_discussion.points(tenant_id,document_id,proposal_id,id)
);
CREATE TABLE dge_discussion.vote_events (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL, point_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id), command_id uuid NOT NULL, request_digest char(64) NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,actor_id,command_id),
 FOREIGN KEY(tenant_id,document_id,proposal_id,point_id) REFERENCES dge_discussion.points(tenant_id,document_id,proposal_id,id)
);
CREATE TABLE dge_discussion.anchor_outbox (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL, proposal_id uuid NOT NULL, event_id uuid NOT NULL,
 event_digest char(64) NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,event_id),
 FOREIGN KEY(tenant_id,document_id,proposal_id) REFERENCES dge_proposals.proposals(tenant_id,document_id,id)
);
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['points','scores','activity','votes','vote_events','anchor_outbox'] LOOP
  EXECUTE format('ALTER TABLE dge_discussion.%I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE dge_discussion.%I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('CREATE POLICY tenant_scope ON dge_discussion.%I TO dge_identity_runtime USING(tenant_id::text=current_setting(''dge.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
 END LOOP;
 FOREACH target IN ARRAY ARRAY['points','scores','activity'] LOOP
  EXECUTE format('CREATE POLICY public_read ON dge_discussion.%I FOR SELECT TO dge_identity_runtime USING(document_id::text=current_setting(''dge.public_document_id'',true))',target);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON dge_discussion.points,dge_discussion.vote_events,dge_discussion.anchor_outbox TO dge_identity_runtime;
GRANT SELECT,INSERT,UPDATE ON dge_discussion.scores,dge_discussion.activity,dge_discussion.votes TO dge_identity_runtime;
CREATE INDEX point_directory ON dge_discussion.points(tenant_id,document_id,proposal_id,parent_id,position,id);
CREATE INDEX point_authors ON dge_discussion.points(tenant_id,document_id,proposal_id,actor_id);
