# Foundation AI source review

This is author-performed source review and local testing, not independent human review, deployed security testing or certification.

Scope: deterministic voting/reference adoption, development canonical JSON and Merkle inclusion, legal label generation, loopback-only static walkthrough, application profiles and upstream plan/security-status compatibility.

Findings corrected before the initial commit:

- Ballots originally bound only human-readable snapshot IDs. Added exact policy and electorate digests so changing their contents under reused IDs rejects old ballots.
- Added vote timestamps with open/close and future-time rejection, and prohibited ballot-supplied voting weight.
- Rejected sparse/decorated arrays, symbol keys and accessor elements in the development canonicalizer rather than permit ambiguous serialization or getter execution.
- Bound Merkle batch roots to leaf count to distinguish an odd duplicated leaf from an extra actual record; malformed side/count/proof tests reject altered claims.
- Kept proposal base, tenant/document identity, exact quote and Unicode boundaries checked on application; stale/repeated application fails.
- Restricted the demonstration server to a loopback binding, static route allowlist and GET/HEAD, with no filesystem path derivation from requests and no mutation endpoints.
- Preserved keyboard focus when point controls reorder the demonstration list. Actual screen-reader/browser QA remains pending.
- Kept public-input immutable and argument votes separate from decision authority; share units use exact integers and reject excess precision.
- Future federation is explicitly after the first terrestrial release and does not block that release.

Residual limits: no authenticated authority, database transaction/ballot store, open-public admission protocol, rich semantic editor, live encryption/device recovery, signed receipts, real e-signing/payment/chain provider, production operations, browser visual/accessibility audit, independent cross-language canonicalization or production capacity testing. Pure evaluation functions assume callers authenticate and serialize/persist immutable snapshots. They are not API authorization or a complete verifiable election protocol. Runtime cryptographic libraries are Node's standard SHA-256 only; no custom encryption primitive is supplied.

The full deployment threat model and release gates remain in docs/SECURITY.md and the canonical PR specifications. Failed or unimplemented guarantees cannot be relabeled as complete to satisfy a dashboard. Human review stays deferred per the owner's instruction.
