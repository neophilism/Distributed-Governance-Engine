# Identity and organization access — partial DCE-002

This server library adds OpenID Connect (OIDC) login, database-backed sessions, organization roles and invitations. OIDC is the standard protocol for authentication through an existing identity provider. No cloud resource, provider account, mail service or paid subscription is created. HTTP routes, a shared account/workspace UI and a direct-TLS application server are now implemented. They have not been deployed with a real provider. See ACCOUNT_HTTP.md for setup and route boundaries.

## Storage and rollout

Use one API service and the planned Postgres database. `pgTransactions(pool)` keeps each transaction on one connection. `applyIdentityMigrations(adminTransaction)` applies ordered migrations 001–003, records their checksums and refuses edited history. The migration credential must remain separate from request credentials. Preserve applied files after merge; later schema changes need new migrations. Roll back by disabling new routes while preserving identity/audit rows; no destructive down migration is supplied.

An administrator grants the `dge_identity_runtime` permission group to a dedicated service login. Never connect ordinary requests as the schema owner or a Neon/Postgres administrator. The group cannot log in or bypass row security. Organization tables use transaction-local row policies, with active membership/role checks in the service. These policies protect against query mistakes; they do not make the authorized identity service untrusted.

## Login and sessions

Configure `discoverIdentityProvider` from server configuration only. Issuer and callback require HTTPS. The real openid-client library validates issuer, audience, signature, state, nonce, code binding and fresh authentication time. PKCE binds a returned authorization code to the flow that requested it. Login state is browser-cookie-bound, encrypted under a separate metadata key, expires after ten minutes and is consumed once. A failed exchange requires restarting login. Provider tokens are neither persisted nor returned by this adapter.

Account identity is the exact issuer/subject pair; email never links accounts. `establishSession` is a **trusted server adapter boundary**: call it only after successful provider verification. Never expose it as a route accepting caller-supplied identity claims.

The adapter must pass `authenticatedAt` in milliseconds from the verified OIDC `auth_time` claim. The five-minute privileged-action window uses this actual authentication time, not app-session creation time. Creation rejects missing, stale or excessively future authentication times. A backward server-clock jump also denies a session whose issuance is now in the future. Trusted server/provider clocks remain an operational assumption.

Migration 002 leaves historical sessions/accounts intact but old sessions without proven authentication time cannot authorize requests; those users must log in again. The new constraint is enforced for new/updated rows without pretending historical rows contain that evidence. Deploy with identity routes disabled until migrations and the updated service are ready; do not mix older session-issuing code with the new schema. No document, ballot or signed record is rewritten.

Session tokens contain 32 random bytes; only keyed SHA-256 digests are stored. Cookies are host-only, Secure, HttpOnly and SameSite=Lax. Sessions last eight hours by default, configurable from one minute to one day. Logout revokes a stored session. Logout-all changes the account authentication version, invalidating all earlier sessions on their next request. Suspended accounts fail stored-session checks. Login/recovery never authorizes a content-encryption device.

Writes require the session-bound CSRF token and an exact configured Origin. CSRF protection rejects writes triggered by another website using a signed-in browser. Membership administration requires login within five minutes. HTTP integration extracts these values from request headers/cookies, never JSON identity/role assertions. Never construct trusted origins/callbacks from untrusted forwarding headers. Routes now enforce bounded inputs, per-process request budgets, no-store responses and generic errors. Shared fleet-wide abuse controls and production retention remain unfinished.

## Membership

Owners administer roles. Admins can manage lower roles but cannot grant owner/admin status or modify owners/admins. Other roles cannot administer membership. Invitations bind an existing account ID, organization and role; expire after 24 hours; and can be accepted once by that account. Owners/admins can list pending invitations without their secret tokens and cancel them; cancellation and acceptance serialize on the same workspace lock. Account discovery/email delivery are later adapters. An invitation cannot change an active member's role. Removal denies subsequent organization requests and cancels older pending invitations. Rejoining requires a new explicit invitation.

Membership writes lock the organization row, protecting the last owner against simultaneous removals. Reads hold a shared lock during authorization and the operation. Member lists use bounded pages. Audit events contain IDs, action kind and time, not profiles or document text; runtime credentials cannot edit/delete them. Membership changes must not alter a frozen voting electorate; that later module is separate.

## Keys, data and limitations

The identity service sees issuer/subject, internal IDs, membership, roles and authentication timing. This increment does not hide that metadata from the service/database administrator. Assess live transport, disk/backup encryption and operator access separately. No document plaintext, signature ink, device authorization secret, recovery key or application content key is accepted.

Supply independent random 32-byte SESSION_KEY and OIDC_STATE_KEY Buffers through server secret configuration, never source or command arguments. The latter encrypts short-lived login state using Node AES-256-GCM; it is not an application E2EE key. State-key rotation restarts pending logins; session-key rotation invalidates outstanding tokens. `pruneExpiredLogins` removes at most 500 expired challenges per call; connect it to ordinary bounded worker maintenance without renting a scheduler. Production session/account retention policy remains to implement.

This contribution remains partial. Passkey assurance, recovery, encrypted-device trust, fleet-wide abuse controls/retention, production TLS evidence and deployed acceptance are pending. The HTTP/account UI has synthetic-provider browser evidence, not real-provider production acceptance. Human review is deferred under the owner policy. No complete E2EESA conformance or compromised-service authorization protection is claimed.

## Checks

`npm run check` uses an embedded PostgreSQL database (PGlite) plus the real OIDC validation library with a synthetic provider. It checks row permissions, cross-organization access, invitation replay, removal, session expiry/revocation, CSRF, migration rollback/history and altered/forged login data. It contacts no real provider.

`npm run test:postgres` requires a disposable loopback database ending in `_test`. CI supplies PostgreSQL 17 and a non-admin request login. It tests real multiple-connection invitation and owner-removal races; embedded single-connection tests are not evidence for those races. This command fails if its database is unavailable. The ordinary check/build need no local Postgres server.

Primary references: [OIDC example](https://github.com/panva/openid-client/blob/main/examples/oidc.ts), [Postgres row policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [PGlite transactions](https://pglite.dev/docs/api).

The browser fixture uses the actual HTTPS application, OIDC adapter, session store and UI with synthetic identities and an isolated test provider. `npm run test:browser` requires an explicitly installed Chrome executable in DGE_BROWSER_EXECUTABLE; it fails rather than silently skipping. CI pins Chrome Headless Shell 155.0.8059.84. Test-only local certificate acceptance and disabled browser sandbox never configure the production server.
