# Decision: implement identity without provisioning hosted resources

Owner direction, October 17, 2026: develop efficiently within limited resources.

Use an existing standards-based identity provider, opaque sessions in the planned Postgres database, and explicit organization membership authority in the engine. Reuse openid-client and Node cryptographic implementations. Keep identity server code separate from browser/editor exports. Start with one API and one database; no Redis, session microservice or hosted identity subscription is required by this implementation.

Use embedded Postgres for inexpensive local checks and a disposable PostgreSQL service in CI for multiple-connection locking tests. No cloud resources are provisioned for either. Split services or add caches only when measured capacity requires it.

The identity service is trusted for identity and routing metadata. Login does not authorize an E2EE device. Metadata encryption keys, provider credentials, migration credentials and request credentials have separate purposes. No application content key or unrelated project's database/credential is reused. Production request protection, retention, provider configuration and endpoint-encrypted device trust remain explicit work.
