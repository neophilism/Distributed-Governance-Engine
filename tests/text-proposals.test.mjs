import test from "node:test";
import assert from "node:assert/strict";
import {
  createLegalDocument,
  publicInputEdition,
  legalPlainText,
} from "../src/legal-structure.mjs";
import {
  validateTextSelection,
  replaceSelectedText,
  findSelectionCandidates,
} from "../src/text-selections.mjs";
import {
  createTextProposal,
  textProposalDigest,
  applyTextProposal,
} from "../src/legal-proposals.mjs";
const source = () => ({
  ...structuredClone(
    createLegalDocument({ id: "legal", tenantId: "workspace", title: "Bill" }),
  ),
  content: [
    {
      kind: "paragraph",
      id: "p1",
      inlines: [
        { kind: "text", text: "The agency ", marks: ["bold"] },
        { kind: "text", text: "shall report annually." },
      ],
    },
  ],
});
const range = { blockId: "p1", start: 24, end: 32, quote: "annually" };
test("a proposal binds exact legal text, marks, metadata, base and rationale and produces a stable replacement preview", () => {
  const doc = source(),
    proposal = createTextProposal(doc, {
      id: "p-1",
      selection: range,
      replacement: "quarterly",
      rationale: "Keep reports current.",
    });
  const result = applyTextProposal(doc, proposal);
  assert.equal(legalPlainText(result), "The agency shall report quarterly.");
  assert.equal(result.content[0].id, "p1");
  assert.deepEqual(result.content[0].inlines[0].marks, ["bold"]);
  assert.equal(doc.revision, 0);
  assert.equal(result.revision, 1);
  assert.notEqual(
    textProposalDigest({ ...proposal, rationale: "Different reason" }),
    textProposalDigest(proposal),
  );
  const elsewhere = structuredClone(doc);
  elsewhere.metadata.title = "A changed title";
  awaitReject(() => applyTextProposal(elsewhere, proposal), /Stale proposal/);
});
const awaitReject = (fn, pattern) => assert.throws(fn, pattern);
test("UTF-16 positions reject half of a supplementary character and permit exact emoji and combining text", () => {
  const doc = source();
  doc.content[0].inlines = [{ kind: "text", text: "A😀e\u0301Z" }];
  assert.throws(() =>
    validateTextSelection(doc, {
      blockId: "p1",
      start: 1,
      end: 2,
      quote: "\ud83d",
    }),
  );
  assert.throws(() =>
    validateTextSelection(doc, {
      blockId: "p1",
      start: 2,
      end: 3,
      quote: "\ude00",
    }),
  );
  const next = replaceSelectedText(
    doc,
    { blockId: "p1", start: 1, end: 3, quote: "😀" },
    "🌍",
  );
  assert.equal(legalPlainText(next), "A🌍e\u0301Z");
});
test("selections span text marks but cannot consume reference atoms or mistake their label for editable text", () => {
  const doc = source();
  doc.content[0].inlines = [
    { kind: "text", text: "alpha", marks: ["italic"] },
    { kind: "text", text: "beta" },
    { kind: "reference", targetId: "p1", label: "self" },
    { kind: "text", text: "gamma" },
  ];
  assert.equal(
    legalPlainText(
      replaceSelectedText(
        doc,
        { blockId: "p1", start: 3, end: 7, quote: "habe" },
        "X",
      ),
    ),
    "alpXtaselfgamma",
  );
  assert.throws(
    () =>
      validateTextSelection(doc, {
        blockId: "p1",
        start: 8,
        end: 10,
        quote: "a\uFFFC",
      }),
    /crosses a reference/,
  );
  const result = replaceSelectedText(
    doc,
    { blockId: "p1", start: 10, end: 15, quote: "gamma" },
    "delta",
  );
  assert.equal(
    result.content[0].inlines.find((run) => run.kind === "reference").targetId,
    "p1",
  );
});
test("insertions and deletions preserve unrelated nodes, references and the exact source edition", () => {
  const doc = source();
  assert.equal(
    legalPlainText(
      replaceSelectedText(
        doc,
        { blockId: "p1", start: 0, end: 0, quote: "" },
        "Now ",
      ),
    ),
    "Now The agency shall report annually.",
  );
  assert.equal(
    legalPlainText(replaceSelectedText(doc, range, "")),
    "The agency shall report .",
  );
  assert.throws(
    () => replaceSelectedText(publicInputEdition(doc), range, "monthly"),
    /Frozen source/,
  );
});
test("stale anchors never auto-adopt, and repeated quotes require explicit disambiguation", () => {
  const doc = source(),
    proposal = createTextProposal(doc, {
      id: "p-2",
      selection: range,
      replacement: "quarterly",
      rationale: "A reason",
    }),
    changed = replaceSelectedText(
      doc,
      { blockId: "p1", start: 0, end: 0, quote: "" },
      "Notice: ",
    );
  assert.throws(() => applyTextProposal(changed, proposal), /Stale proposal/);
  assert.equal(
    findSelectionCandidates(changed, range).status,
    "needs-reconfirmation",
  );
  const repeated = source();
  repeated.content[0].inlines = [
    { kind: "text", text: "annually annually annually" },
  ];
  const result = findSelectionCandidates(repeated, range, { limit: 2 });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.truncated, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(
    findSelectionCandidates(
      { ...doc, content: [{ kind: "paragraph", id: "other", inlines: [] }] },
      range,
    ).status,
    "target-deleted",
  );
});
test("forged context, quote and document identifiers fail rather than applying to nearby language", () => {
  const doc = source(),
    proposal = createTextProposal(doc, {
      id: "p-3",
      selection: range,
      replacement: "monthly",
      rationale: "A reason",
    });
  for (const forged of [
    { ...proposal, tenantId: "other" },
    { ...proposal, selection: { ...range, quote: "wrong" } },
    { ...proposal, context: { ...proposal.context, prefix: "fake" } },
  ])
    assert.throws(() => applyTextProposal(doc, forged));
  assert.throws(() => replaceSelectedText(doc, range, range.quote));
  assert.throws(() => validateTextSelection(doc, { ...range, extra: true }));
});
