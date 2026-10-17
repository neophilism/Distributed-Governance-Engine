# Repository operating instructions

Read docs/ARCHITECTURE.md, docs/PRODUCT_SPEC.md, docs/SECURITY.md, docs/DEVELOPMENT_PLAN.md and registry/PR_FORMAT.md before work. This repository is one of three; shared engine logic lives only in Distributed-Governance-Engine.

- Canonical plan: registry/prs.json. Preserve IDs, scope, dependencies, exact count, acceptance and historical PR mappings. Never infer completion from an ordinal or local commit.
- Use the same fail-closed current-head GitHub merge preflight as Boardroom; scripts/verify-pr-merge.mjs is vendored from upstream. Require verify and any other configured required checks. No green, complete exact-head evidence means no merge.
- Work autonomously through dependency-ready PRs; fix bugs/conflicts and continue. Preserve user authorization. No paid resource creation without existing spending authority; no unnecessary approvals.
- Under Boardroom-assigned sessions follow its atomic lease/fencing and one-repository-per-session rule. Direct owner-requested development in these three repositories is not a Boardroom scheduled assignment.
- Follow E2EESA at pinned development revision d916938cb6b0e6569edfde88555984ddacb96021; preserve real crypto, privacy, authorization and transaction controls. User explicitly defers human audit/review/certification until fully deployed. Perform AI source review and substantive tests; do not fabricate independent-review or conformance claims.
- Private plaintext stays at authorized endpoints. Public disclosure and public-chain hashes have explicit consent/data inventories. Never log document contents, signatures, credentials, or voting identity evidence.
- Settings cannot disable invariants, alter an active electorate/policy/ballot wording, or bypass public-input immutability. Adopted/signed editions are append-only.
- Update source/specification/credential requirements/progress together. Engine Room and Boardroom registration is unverified until an actual remote acknowledgment is recorded.
- No scheduler or autonomous background-work claim unless explicitly requested and actually verified. No secret values in files, issues, PR bodies or output.

- Read docs/PRODUCT_DIRECTION.md: CivicQuill and CharterQuill are related branded hosted subscription products; custom/white-label deployments are bespoke exceptions.
