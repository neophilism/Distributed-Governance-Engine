-- Confidential content: authenticated ciphertext only, never plaintext or server-held keys.
-- Identity and membership metadata remain visible to the access-control service.
CREATE SCHEMA dge_private;
REVOKE ALL ON SCHEMA dge_private FROM PUBLIC;
GRANT USAGE ON SCHEMA dge_private TO dge_identity_runtime;

CREATE TABLE dge_private.documents (
 tenant_id uuid NOT NULL REFERENCES dge_identity.tenants(id),
 id uuid NOT NULL UNIQUE,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000000),
 key_epoch integer NOT NULL CHECK(key_epoch BETWEEN 0 AND 1000000),
 current_digest char(64) NOT NULL CHECK(current_digest ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES dge_identity.accounts(id),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE dge_private.versions (
 tenant_id uuid NOT NULL, document_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000000),
 key_epoch integer NOT NULL CHECK(key_epoch BETWEEN 0 AND 1000000),
 cipher text NOT NULL CHECK(cipher='AES-256-GCM'),
 nonce bytea NOT NULL CHECK(octet_length(nonce)=12),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext) BETWEEN 17 AND 3000016),
 digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 previous_digest char(64),
 command_id uuid NOT NULL, request_digest char(64) NOT NULL,
 actor_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,document_id,version),
 UNIQUE(tenant_id,command_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES dge_private.documents(tenant_id,id),
 CHECK((version=1 AND previous_digest IS NULL) OR (version>1 AND previous_digest IS NOT NULL))
);
CREATE TABLE dge_private.usage (
 tenant_id uuid PRIMARY KEY REFERENCES dge_identity.tenants(id),
 stored_bytes bigint NOT NULL CHECK(stored_bytes>=0)
);
CREATE FUNCTION dge_private.guard_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR
    NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR
    NEW.version<>OLD.version+1 OR NEW.key_epoch<OLD.key_epoch THEN
  RAISE EXCEPTION 'Invalid encrypted document transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_pointer BEFORE UPDATE ON dge_private.documents
 FOR EACH ROW EXECUTE FUNCTION dge_private.guard_pointer();

DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['documents','versions','usage'] LOOP
  EXECUTE format('ALTER TABLE dge_private.%I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE dge_private.%I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('CREATE POLICY private_tenant_select ON dge_private.%I FOR SELECT TO dge_identity_runtime USING(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
  EXECUTE format('CREATE POLICY private_tenant_insert ON dge_private.%I FOR INSERT TO dge_identity_runtime WITH CHECK(tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
 END LOOP;
END $$;
CREATE POLICY private_pointer_update ON dge_private.documents FOR UPDATE TO dge_identity_runtime
 USING(tenant_id::text=current_setting('dge.tenant_id',true))
 WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
CREATE POLICY private_usage_update ON dge_private.usage FOR UPDATE TO dge_identity_runtime
 USING(tenant_id::text=current_setting('dge.tenant_id',true))
 WITH CHECK(tenant_id::text=current_setting('dge.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON dge_private.documents,dge_private.usage TO dge_identity_runtime;
GRANT SELECT,INSERT ON dge_private.versions TO dge_identity_runtime;
CREATE INDEX private_document_directory ON dge_private.documents(tenant_id,id);
