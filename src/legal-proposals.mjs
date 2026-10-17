import {
  digest,
  canonicalize,
  identifier,
  invariant,
  validDigest,
} from "./integrity.mjs";
import { validateLegalDocument, legalDocumentDigest } from "./legal-schema.mjs";
import {
  validateTextSelection,
  validateReplacement,
  selectionContext,
  replaceSelectedText,
} from "./text-selections.mjs";
export function createTextProposal(
  document,
  { id, selection, replacement, rationale },
) {
  const doc = validateLegalDocument(document),
    valid = validateTextSelection(doc, selection);
  identifier(id);
  validateReplacement(valid, replacement);
  invariant(
    typeof rationale === "string" &&
      rationale.trim().length >= 1 &&
      rationale.length <= 4000,
    "A concise rationale is required",
  );
  canonicalize(rationale);
  return Object.freeze({
    schemaVersion: 1,
    kind: "text-replacement",
    id,
    documentId: doc.id,
    tenantId: doc.tenantId,
    baseDigest: legalDocumentDigest(doc),
    baseRevision: doc.revision,
    selection: valid,
    context: Object.freeze(selectionContext(doc, valid)),
    replacement,
    rationale,
  });
}
export function textProposalDigest(proposal) {
  canonicalize(proposal);
  invariant(
    proposal &&
      Object.keys(proposal).sort().join(",") ===
        "baseDigest,baseRevision,context,documentId,id,kind,rationale,replacement,schemaVersion,selection,tenantId",
    "Invalid proposal fields",
  );
  invariant(
    proposal.schemaVersion === 1 && proposal.kind === "text-replacement",
    "Unsupported proposal schema",
  );
  for (const key of ["id", "documentId", "tenantId"]) identifier(proposal[key]);
  validDigest(proposal.baseDigest);
  invariant(
    Number.isSafeInteger(proposal.baseRevision) && proposal.baseRevision >= 0,
    "Invalid proposal base revision",
  );
  invariant(
    proposal.selection &&
      Object.keys(proposal.selection).sort().join(",") ===
        "blockId,end,quote,start",
    "Invalid proposal selection",
  );
  identifier(proposal.selection.blockId);
  invariant(
    Number.isSafeInteger(proposal.selection.start) &&
      Number.isSafeInteger(proposal.selection.end) &&
      proposal.selection.start >= 0 &&
      proposal.selection.end >= proposal.selection.start,
    "Invalid proposal range",
  );
  invariant(
    typeof proposal.selection.quote === "string" &&
      proposal.selection.quote.length <= 100000 &&
      proposal.selection.end - proposal.selection.start ===
        proposal.selection.quote.length,
    "Invalid proposal quote",
  );
  validateReplacement(proposal.selection, proposal.replacement);
  invariant(
    proposal.context &&
      Object.keys(proposal.context).sort().join(",") === "prefix,suffix" &&
      ["prefix", "suffix"].every(
        (key) =>
          typeof proposal.context[key] === "string" &&
          Array.from(proposal.context[key]).length <= 32,
      ),
    "Invalid proposal context",
  );
  invariant(
    typeof proposal.rationale === "string" &&
      proposal.rationale.trim().length > 0 &&
      proposal.rationale.length <= 4000,
    "Invalid proposal rationale",
  );
  return digest("legal-text-proposal-v1", proposal);
}
/** Pure exact-base transformation, not a decision certificate or an adoption API. */
export function applyTextProposal(document, proposal) {
  const doc = validateLegalDocument(document);
  textProposalDigest(proposal);
  invariant(
    proposal.documentId === doc.id && proposal.tenantId === doc.tenantId,
    "Proposal context mismatch",
  );
  invariant(
    proposal.baseDigest === legalDocumentDigest(doc) &&
      proposal.baseRevision === doc.revision,
    "Stale proposal requires reconfirmation and a new vote",
  );
  const context = selectionContext(doc, proposal.selection);
  invariant(
    context.prefix === proposal.context.prefix &&
      context.suffix === proposal.context.suffix,
    "Proposal context changed",
  );
  return replaceSelectedText(doc, proposal.selection, proposal.replacement);
}
