# Semantic legal document contract v2

DCE-004 defines a bounded semantic tree independent of page layout and any editor library. Stable IDs identify the document and blocks. Sections, paragraphs, lists/items, tables/rows/cells, definitions, exhibits and footnotes have explicit child grammars. Schema v2 retains the four basic text marks and stable-target references, and adds explicit external link and citation inline atoms.

External links and citations store a visible label, canonical absolute HTTPS target and optional title. HTTP, script/data schemes, URL user information, empty labels, oversized values and unknown fields fail closed. Rendering uses inert text/DOM attributes; pasted active markup still does not become a semantic link. Plain-text export includes the visible label and target so the source is not silently lost.

Schema v1 remains readable without broadening its accepted fields. `migrateLegalDocumentV1` produces detached v2 data, preserves the exact content and revision, and records the v1 domain-separated digest in `schemaMigration`. Existing foundation-block provenance is retained. New documents use v2. Unknown versions fail safely.

Drafts may retain unresolved stable-ID references with explicit diagnostics; published/adopted/signed content and finalization require valid targets. Direct structural edits require a collaboration draft. Moving a node preserves its ID and references, recalculates labels for the selected numbering profile and increments the revision. Cyclic/invalid moves fail. A public-input edition is a new published snapshot, with no direct editing transition.

Migration from the initial block representation preserves exact text, IDs, document identity and revision, and records the original digest. Unknown/signed legacy formats require their own migration protocol. The migration leaves the original object intact. `legalDocumentDigest` domain-separates each semantic schema version from the initial development revision format. It remains development integrity tooling, not an authenticated signed decision certificate.

`finalizeLegalDocument` is a deterministic domain transition, not an authorized production adoption endpoint. Production must require a valid decision, capability and transactional expected-revision guard around it. Signing is deliberately unavailable through that function. The data validator is not a substitute for tenant authorization, sanitizing an HTML rendering boundary, or the future import parser sandbox.
