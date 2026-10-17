-- Public content only. Private content requires the separate endpoint-encryption protocol.
CREATE SCHEMA dge_documents;
REVOKE ALL ON SCHEMA dge_documents FROM PUBLIC;
GRANT USAGE ON SCHEMA dge_documents TO dge_identity_runtime;
CREATE TABLE dge_documents.documents (
  tenant_id uuid NOT NULL REFERENCES dge_identity.tenants(id), id uuid NOT NULL UNIQUE,
  visibility text NOT NULL CHECK(visibility='public'),
  disclosure text NOT NULL CHECK(disclosure='publish-all-revisions-v1'),
  created_by uuid NOT NULL REFERENCES dge_identity.accounts(id), created_at timestamptz NOT NULL,
  version integer NOT NULL CHECK(version BETWEEN 1 AND 1000000),
  digest char(64) NOT NULL, current jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id),
  CHECK(current->>'id'=id::text AND current->>'tenantId'=tenant_id::text),
  CHECK(current->>'mode' IN ('collaboration','public-input')),
  CHECK((current->>'mode'='collaboration' AND current->>'lifecycle'='draft') OR
        (current->>'mode'='public-input' AND current->>'lifecycle'='published'))
);
CREATE TABLE dge_documents.versions (
  tenant_id uuid NOT NULL, document_id uuid NOT NULL, version integer NOT NULL,
  document jsonb NOT NULL, digest char(64) NOT NULL, previous_digest char(64),
  event_digest char(64) NOT NULL, command_id uuid NOT NULL, request_digest char(64) NOT NULL,
  actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id), created_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,document_id,version), UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,document_id) REFERENCES dge_documents.documents(tenant_id,id),
  CHECK(version BETWEEN 1 AND 1000000),
  CHECK((version=1 AND previous_digest IS NULL) OR (version>1 AND previous_digest IS NOT NULL))
);
CREATE TABLE dge_documents.usage (
  tenant_id uuid PRIMARY KEY REFERENCES dge_identity.tenants(id),
  stored_bytes bigint NOT NULL CHECK(stored_bytes>=0)
);
CREATE TABLE dge_documents.anchor_outbox (
  tenant_id uuid NOT NULL, document_id uuid NOT NULL, version integer NOT NULL,
  event_digest char(64) NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,document_id,version),
  FOREIGN KEY(tenant_id,document_id,version) REFERENCES dge_documents.versions(tenant_id,document_id,version)
);
-- A feedback edition cannot be rewritten even by an accidental direct runtime UPDATE.
CREATE FUNCTION dge_documents.guard_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.current->>'mode'='public-input' OR OLD.current->>'lifecycle'<>'draft' THEN
    RAISE EXCEPTION 'Frozen document source';
  END IF;
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.created_by<>OLD.created_by OR
     NEW.created_at<>OLD.created_at OR NEW.visibility<>OLD.visibility OR NEW.disclosure<>OLD.disclosure OR
     NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid document transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_source BEFORE UPDATE ON dge_documents.documents FOR EACH ROW EXECUTE FUNCTION dge_documents.guard_source();
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['documents','versions','anchor_outbox','usage'] LOOP
    EXECUTE format('ALTER TABLE dge_documents.%I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE dge_documents.%I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY tenant_read ON dge_documents.%I FOR SELECT TO dge_identity_runtime USING(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
    EXECUTE format('CREATE POLICY tenant_insert ON dge_documents.%I FOR INSERT TO dge_identity_runtime WITH CHECK(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
  END LOOP;
END $$;
CREATE POLICY usage_write ON dge_documents.usage FOR UPDATE TO dge_identity_runtime
  USING(tenant_id::text=current_setting('dge.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON dge_documents.usage TO dge_identity_runtime;
CREATE POLICY document_write ON dge_documents.documents FOR UPDATE TO dge_identity_runtime
  USING(tenant_id::text=current_setting('dge.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
CREATE POLICY public_document ON dge_documents.documents FOR SELECT TO dge_identity_runtime
  USING(id::text=current_setting('dge.public_document_id',true));
CREATE POLICY public_version ON dge_documents.versions FOR SELECT TO dge_identity_runtime
  USING(document_id::text=current_setting('dge.public_document_id',true));
GRANT SELECT,INSERT,UPDATE ON dge_documents.documents TO dge_identity_runtime;
GRANT SELECT,INSERT ON dge_documents.versions,dge_documents.anchor_outbox TO dge_identity_runtime;
CREATE INDEX document_directory ON dge_documents.documents(tenant_id,id);
