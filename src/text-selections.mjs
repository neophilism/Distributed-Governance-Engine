import { validateLegalDocument } from "./legal-structure.mjs";
import { canonicalize, identifier, invariant } from "./integrity-values.mjs";
export const SELECTION_LIMIT = 100000;
const equalMarks = (a, b) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
function block(document, id) {
  identifier(id);
  let found;
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.id === id) found = node;
      if (node.children) visit(node.children);
    }
  };
  visit(document.content);
  invariant(
    found && Array.isArray(found.inlines),
    "Selection needs an inline text block",
  );
  return found;
}
const width = (run) => (run.kind === "text" ? run.text.length : 1);
const boundary = (value, i) =>
  i === 0 ||
  i === value.length ||
  !(
    value.charCodeAt(i) >= 0xdc00 &&
    value.charCodeAt(i) <= 0xdfff &&
    value.charCodeAt(i - 1) >= 0xd800 &&
    value.charCodeAt(i - 1) <= 0xdbff
  );
/** Offsets count UTF-16 units; a reference occupies one position and may not be replaced as text. */
export function validateTextSelection(document, input) {
  const doc = validateLegalDocument(document);
  canonicalize(input);
  invariant(
    input && Object.keys(input).sort().join(",") === "blockId,end,quote,start",
    "Invalid selection fields",
  );
  const { blockId, start, end, quote } = input,
    node = block(doc, blockId),
    size = node.inlines.reduce((n, run) => n + width(run), 0);
  invariant(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= size &&
      end - start <= SELECTION_LIMIT,
    "Invalid selection range",
  );
  invariant(
    typeof quote === "string" && quote.length <= SELECTION_LIMIT,
    "Invalid selection quote",
  );
  let offset = 0,
    actual = "";
  for (const run of node.inlines) {
    const length = width(run),
      overlap = start < offset + length && end > offset;
    if (run.kind !== "text")
      invariant(!overlap, "Selection crosses a reference");
    else {
      for (const edge of [start, end])
        if (edge >= offset && edge <= offset + length)
          invariant(
            boundary(run.text, edge - offset),
            "Selection splits a Unicode character",
          );
      if (overlap)
        actual += run.text.slice(
          Math.max(0, start - offset),
          Math.min(length, end - offset),
        );
    }
    offset += length;
  }
  invariant(actual === quote, "Selection quote mismatch");
  return Object.freeze({ blockId, start, end, quote });
}
export function selectionContext(document, selection) {
  const doc = validateLegalDocument(document),
    valid = validateTextSelection(doc, selection),
    node = block(doc, valid.blockId),
    flat = node.inlines
      .map((run) => (run.kind === "text" ? run.text : "\uFFFC"))
      .join("");
  return {
    prefix: Array.from(flat.slice(0, valid.start)).slice(-32).join(""),
    suffix: Array.from(flat.slice(valid.end)).slice(0, 32).join(""),
  };
}
export function validateReplacement(selection, replacement) {
  invariant(
    typeof replacement === "string" && replacement.length <= SELECTION_LIMIT,
    "Invalid replacement text",
  );
  canonicalize(replacement);
  invariant(replacement !== selection.quote, "Replacement makes no change");
  return replacement;
}
/** Content operation only; authority, decision bindings and atomic adoption belong to the governance service. */
export function replaceSelectedText(document, selection, replacement) {
  const doc = validateLegalDocument(document),
    valid = validateTextSelection(doc, selection);
  validateReplacement(valid, replacement);
  invariant(
    doc.mode === "collaboration" && doc.lifecycle === "draft",
    "Frozen source cannot be edited",
  );
  const next = structuredClone(doc),
    node = block(next, valid.blockId),
    runs = [];
  let offset = 0,
    inserted = false,
    marks;
  for (const run of node.inlines) {
    const length = width(run);
    if (
      run.kind === "text" &&
      valid.start >= offset &&
      valid.start <= offset + length
    ) {
      marks = run.marks;
      if (valid.start < offset + length) break;
    }
    offset += length;
  }
  const insert = () => {
    if (inserted) return;
    inserted = true;
    if (replacement)
      runs.push({
        kind: "text",
        text: replacement,
        ...(marks ? { marks: [...marks] } : {}),
      });
  };
  offset = 0;
  for (const run of node.inlines) {
    const length = width(run);
    if (valid.start <= offset) insert();
    if (run.kind !== "text") runs.push(run);
    else {
      const before = Math.max(0, Math.min(length, valid.start - offset)),
        after = Math.max(0, Math.min(length, valid.end - offset));
      if (before > 0) runs.push({ ...run, text: run.text.slice(0, before) });
      if (valid.start >= offset && valid.start <= offset + length) insert();
      if (after < length) runs.push({ ...run, text: run.text.slice(after) });
    }
    offset += length;
  }
  insert();
  // Merge only new adjacent text fragments with identical marks, leaving references intact.
  node.inlines = runs.reduce((result, run) => {
    const prior = result.at(-1);
    if (
      prior?.kind === "text" &&
      run.kind === "text" &&
      equalMarks(prior.marks, run.marks)
    )
      prior.text += run.text;
    else result.push(run);
    return result;
  }, []);
  next.revision++;
  return validateLegalDocument(next);
}
/** A rebase suggestion is never authorization: even a unique candidate needs confirmation and a new vote. */
export function findSelectionCandidates(
  document,
  selection,
  { limit = 20 } = {},
) {
  const doc = validateLegalDocument(document);
  canonicalize(selection);
  invariant(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
    "Invalid candidate limit",
  );
  let target;
  try {
    target = block(doc, selection.blockId);
  } catch {
    return { status: "target-deleted", candidates: [] };
  }
  if (!selection.quote)
    return { status: "needs-reconfirmation", candidates: [] };
  invariant(
    typeof selection.quote === "string" &&
      selection.quote.length <= SELECTION_LIMIT,
    "Invalid selection quote",
  );
  let offset = 0,
    segment = "",
    segmentStart = 0;
  const candidates = [];
  let truncated = false;
  const scan = () => {
    let from = 0;
    for (;;) {
      const at = segment.indexOf(selection.quote, from);
      if (at < 0) break;
      const candidate = {
        blockId: target.id,
        start: segmentStart + at,
        end: segmentStart + at + selection.quote.length,
        quote: selection.quote,
      };
      try {
        validateTextSelection(doc, candidate);
        if (candidates.length >= limit) {
          truncated = true;
          break;
        }
        candidates.push(candidate);
      } catch {}
      from = at + 1;
    }
  };
  for (const run of target.inlines) {
    if (run.kind === "text") segment += run.text;
    else {
      scan();
      segment = "";
      segmentStart = offset + 1;
    }
    offset += width(run);
    if (truncated) break;
  }
  if (!truncated) scan();
  return {
    status:
      truncated || candidates.length > 1
        ? "ambiguous"
        : candidates.length === 1
          ? "needs-reconfirmation"
          : "quote-not-found",
    candidates,
    truncated,
  };
}
