# Document Collaboration Engine

Reusable legal-document drafting, proposal, deliberation and governance engine.

**Status: foundation under active development; not a deployed application.** Source is being published through tested GitHub pull requests. Live Engine Room/Boardroom registration, production database/authentication, E2EE sessions, payments, signing and blockchain execution require their own implementation and evidence.

- [Architecture, product differences and editor features](docs/ARCHITECTURE.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md) and [canonical PR registry](registry/prs.json)
- [Security and truthful claim boundaries](docs/SECURITY.md)
- [Operations and credential requirements](docs/OPERATIONS.md)
- [Repository agent instructions](AGENTS.md)

Requires Node 24.19.0 (tested). No application dependencies or install step are needed for the foundation.

```sh
npm run check
npm run demo
```

The demo serves http://127.0.0.1:4173 and demonstrates clause selection, a proposal/discussion drawer and anchored callout balloons. It has in-memory sample data, loses changes on reload and performs no real voting or legal signing. It is not the planned rich editor.

Actual PR mappings are recorded in registry/prs.json; bootstrap commits alone do not establish product acceptance. Follow the dependency-ready PR specifications to implement the full product. Human review is the final deployed handoff; actual failed technical gates remain blockers.
