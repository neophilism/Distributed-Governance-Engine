# Semantic legal document contract v1

DCE-004 introduces a bounded semantic tree independent of page layout and any editor library. Stable IDs identify the document and blocks. Sections, paragraphs, lists/items, tables/rows/cells, definitions, exhibits and footnotes have explicit child grammars; inline text supports four basic marks and stable-target references. Unknown versions/fields, duplicate IDs, unsafe records, malformed tables, invalid footnotes and structural/size limits fail closed.

Drafts may retain unresolved references with explicit diagnostics; published/adopted/signed content and finalization require valid targets. Direct structural edits require a collaboration draft. Moving a node preserves its ID and references, recalculates labels for the selected numbering profile and increments the revision. Cyclic/invalid moves fail. A public-input edition is a new published snapshot, with no direct editing transition.

Migration from the initial block representation preserves exact text, IDs, document identity and revision, and records the original digest. Unknown/signed legacy formats require their own migration protocol. The migration leaves the original object intact. `legalDocumentDigest` domain-separates v1 semantic data from the initial development revision format. It remains development integrity tooling, not an authenticated signed decision certificate.

`finalizeLegalDocument` is a deterministic domain transition, not an authorized production adoption endpoint. Production must require a valid decision, capability and transactional expected-revision guard around it. Signing is deliberately unavailable through that function. The data validator is not a substitute for tenant authorization, sanitizing an HTML rendering boundary, or the future import parser sandbox.

Validation includes stable reference movement, lifecycle immutability, legacy provenance, exact text, hierarchy/size bounds, malformed trees, unsafe object fields and rectangular table fixtures. Styling/page layout remains outside this semantic tree and cannot silently rewrite the voted language.
