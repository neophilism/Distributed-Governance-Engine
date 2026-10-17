# Distributed Governance Engine

Reusable legal-document drafting, proposal, deliberation and governance engine.

**Status: foundation under active development; not a deployed application.** Source is being published through tested GitHub pull requests. Live Engine Room/Boardroom registration, production database/authentication, E2EE sessions, payments, signing and blockchain execution require their own implementation and evidence.

- [Architecture, product differences and editor features](docs/ARCHITECTURE.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md) and [canonical PR registry](registry/prs.json)
- [Security and truthful claim boundaries](docs/SECURITY.md)
- [Operations and credential requirements](docs/OPERATIONS.md)
- [Identity and organization access foundation](docs/IDENTITY_FOUNDATION.md)
- [Repository agent instructions](AGENTS.md)

Requires Node 24.19.0 (tested). Install the exact lockfile before running the editor and tests.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run preview
```

The shared React/ProseMirror editor preview serves http://127.0.0.1:4173 and demonstrates the CivicQuill/CharterQuill family, real drafting/formatting, legal sections, tables, outline, working-copy exports and anchored walkthroughs. Changes stay in memory unless you opt into public-sample device recovery. Confidential recovery, authentication, durable server save and governed collaboration remain future work. The earlier conceptual walkthrough remains available through npm run demo.

Actual PR mappings are recorded in registry/prs.json; bootstrap commits alone do not establish product acceptance. Follow the dependency-ready PR specifications to implement the full product. Human review is the final deployed handoff; actual failed technical gates remain blockers.
