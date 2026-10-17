import { canonicalize, digest, identifier, invariant } from "./integrity.mjs";
export const POINT_TEXT_LIMIT = 1000;
export function validateEvidence(evidence) {
  canonicalize(evidence);
  invariant(
    Array.isArray(evidence) && evidence.length <= 5,
    "At most five evidence links",
  );
  return evidence.map((item) => {
    invariant(
      item &&
        Object.keys(item).sort().join(",") === "label,url" &&
        typeof item.label === "string" &&
        item.label.trim() &&
        item.label.length <= 200 &&
        typeof item.url === "string" &&
        item.url.length <= 2048,
      "Invalid evidence link",
    );
    const url = new URL(item.url);
    invariant(
      url.protocol === "https:" &&
        url.href.length <= 2048 &&
        !url.username &&
        !url.password &&
        !/[\u0000-\u0020\u007f]/.test(item.url),
      "Evidence needs a credential-free HTTPS URL",
    );
    return Object.freeze({ label: item.label, url: url.href });
  });
}
export function createDiscussionPoint(input) {
  canonicalize(input);
  const {
    id,
    tenantId,
    documentId,
    proposalId,
    parentId = null,
    position,
    relation = null,
    text,
    evidence = [],
  } = input;
  for (const value of [id, tenantId, documentId, proposalId]) identifier(value);
  if (parentId !== null) identifier(parentId);
  invariant(
    ["support", "oppose", "clarify"].includes(position),
    "Invalid point position",
  );
  invariant(
    parentId === null
      ? relation === null
      : ["supports", "challenges", "clarifies"].includes(relation),
    "Invalid parent relation",
  );
  invariant(
    typeof text === "string" &&
      text.trim().length > 0 &&
      text.length <= POINT_TEXT_LIMIT,
    "Use one concise point, at most 1,000 characters",
  );
  canonicalize(text);
  return Object.freeze({
    schemaVersion: 1,
    kind: "discussion-point",
    id,
    tenantId,
    documentId,
    proposalId,
    parentId,
    position,
    relation,
    text,
    evidence: Object.freeze(validateEvidence(evidence)),
  });
}
export function discussionPointDigest(point) {
  canonicalize(point);
  invariant(
    point &&
      Object.keys(point).sort().join(",") ===
        "documentId,evidence,id,kind,parentId,position,proposalId,relation,schemaVersion,tenantId,text",
    "Invalid point fields",
  );
  invariant(
    point.schemaVersion === 1 && point.kind === "discussion-point",
    "Unsupported point schema",
  );
  const checked = createDiscussionPoint(point);
  invariant(
    canonicalize(checked) === canonicalize(point),
    "Evidence links must use their canonical URL",
  );
  return digest("discussion-point-v1", checked);
}
export function pointScore({ up, down }) {
  invariant(
    Number.isSafeInteger(up) &&
      Number.isSafeInteger(down) &&
      up >= 0 &&
      down >= 0 &&
      up + down <= 1000000000,
    "Invalid point counts",
  );
  return up - down;
}
