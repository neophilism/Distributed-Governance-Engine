-- Keep legacy records, but force a fresh login before they can authorize requests.
ALTER TABLE dge_identity.sessions ADD COLUMN authenticated_at timestamptz;
ALTER TABLE dge_identity.sessions ADD CONSTRAINT authenticated_session_time
  CHECK (authenticated_at IS NOT NULL
    AND authenticated_at <= created_at + interval '30 seconds'
    AND authenticated_at >= created_at - interval '5 minutes') NOT VALID;
-- NOT VALID preserves historical rows. Postgres still enforces this on new/updated rows.
