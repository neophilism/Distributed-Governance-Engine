# Public draft CRDT convergence (partial DCE-008)

This increment pins stable Yjs v13, y-prosemirror v1.3.7 and browser/server WebSocket dependencies in the npm lockfile. It adds createPublicSharedDraft: a bounded **in-memory** Yjs update/merge adapter for collaboration documents that the caller explicitly marks PUBLIC.

- One authorized source seeds the initial ProseMirror legal tree. Other clients must hydrate from that source's update; separately seeding two replicas independently would duplicate initial content.
- Incremental updates use Yjs state vectors; applying duplicate or reordered updates converges. An update is staged in an independent Y.Doc, projected into the legal schema, then committed to the live Y.Doc only after validation. Failed, malformed or oversized updates leave the live document untouched.
- The adapter refuses frozen/public-input/adopted editions and all documents not explicitly classified public. Viewer sessions may receive updates but cannot originate local changes.
- A caller-provided local-update callback is invoked only for accepted local edits. The module does not create a public network endpoint, authenticate users, persist updates, or grant membership.
- The model adapter provides domain snapshots for projection and testing. Yjs binary updates—not exported legal JSON—must remain the synchronization source of truth. Persisting/distributing only JSON loses CRDT concurrency history.

**Not yet complete:** authenticated WSS room admission and per-message revocation checks, durable update/outbox storage, encrypted private envelopes and membership rekeying, ProseMirror live plugin/mount integration, browser multiuser reconnect evidence, CPU/memory bounds under adversarial updates, and production acceptance. This module is intentionally NOT enabled for confidential workspace content or advertised as a deployed realtime editor.

The temporary CI workflow used to generate the reproducible npm lockfile was removed after the package and exact lockfiles were committed. All checks must pass on the final PR head before merging.
