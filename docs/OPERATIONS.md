# Operations and credential requirements

Foundation has no authentication, database, network API, encrypted collaboration, production signing, payment, blockchain transaction or deployed service. npm run check is dependency-free and does not need credentials. Core npm run demo binds loopback and serves an in-memory design demonstrator; restarting or reloading loses demo state. Never expose it as the production service.

Production target: shared engine API/realtime/worker on isolated Render services; Neon Postgres with tested TLS and row isolation; S3-compatible encrypted-object storage; optional Key Value for rate limits/fanout (never sole ballot authority). Frontends can be independently deployed. Provision only within authorized costs and verify actual trust/transport boundaries. No resource has been created by this foundation.

Required credentials by future capability: OIDC client and verified mail domain (identity); project-scoped database migration/runtime users; object storage scoped credentials; session protection; mail vendor; payment and webhook test/live keys; anchor RPC and protected signer reference with spend limits; code-host CI and deployment scopes. E2EE content/device keys remain at clients and cannot be injected as server environment secrets.

Registration: public GitHub source repository neophilism/Distributed-Governance-Engine, immutable repository ID 1422876391, was created by the owner and write access verified. The foundation is being published via a real PR. After the canonical registry reaches the default branch, perform authenticated Engine Room/Boardroom source discovery and retain actual synchronization acknowledgments. Repository existence and a tracking issue do not establish live dashboard registration.

PR protocol: use a foundation bootstrap commit, then create dependency-ordered PRs with stable IDs, actual GitHub mappings and required CI. All planned PR specs are reviewable documents; opening every dependency-blocked empty PR is not useful. Use scripts/verify-pr-merge.mjs for exact-head verification and merging only when authenticated and green. Missing/rate-limited/unstarted/skipped checks never count as passed.

Deployment requires readiness/health, isolated resource identity, migration and rollback records, live multiuser browser journeys, real anchor receipts and source-bound security evidence. Archive backups/recovery tests and cost/scale assumptions. Human review is a post-deployment handoff, never a fictional completed audit.
