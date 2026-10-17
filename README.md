# Distributed Governance Engine

Reusable legal-document drafting, proposal, deliberation and governance engine.

**Status: engine under active development; not a deployed application.** Source is being published through tested GitHub pull requests. Live Engine Room/Boardroom registration, production deployment/authentication acceptance, private encryption, payments, signing and blockchain execution require their own implementation and evidence.

- [Architecture, product differences and editor features](docs/ARCHITECTURE.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md) and [canonical PR registry](registry/prs.json)
- [Security and truthful claim boundaries](docs/SECURITY.md)
- [Operations and credential requirements](docs/OPERATIONS.md)
- [Identity and organization access](docs/IDENTITY_FOUNDATION.md), [account HTTP/UI](docs/ACCOUNT_HTTP.md)
- [Saved public documents and failure recovery](docs/PUBLIC_DOCUMENTS.md)
- [Exact text proposals](docs/TEXT_PROPOSALS.md) and [structured discussion/rating](docs/STRUCTURED_DISCUSSION.md)
- [Repository agent instructions](AGENTS.md)

Requires Node 24.19.0 (tested). Install the exact lockfile before running the editor and tests.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run preview
```

The shared React/ProseMirror editor preview serves http://127.0.0.1:4173 and demonstrates the CivicQuill/CharterQuill family, real drafting/formatting, legal sections, tables, outline, working-copy exports and anchored walkthroughs. Changes stay in memory unless you opt into public-sample device recovery. The account-enabled HTTPS service additionally implements OIDC, workspace membership, explicit public publication, durable public save/reopen/history and fixed public-input sources. It requires configured provider/database/TLS secrets; see operations. Exact-version replacement suggestions and rationales have a saved slide-out interface. Structured pro/con points, typed replies and independent argument ratings are connected. Private encryption, decision voting/adoption and production acceptance remain unfinished. The earlier conceptual walkthrough remains available through npm run demo.

Actual PR mappings are recorded in registry/prs.json; bootstrap commits alone do not establish product acceptance. Follow the dependency-ready PR specifications to implement the full product. Human review is the final deployed handoff; actual failed technical gates remain blockers.
