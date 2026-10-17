import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentSession } from "../editor/document-session.mjs";
import { createLegalDocument } from "../src/legal-structure.mjs";
const initial = createLegalDocument({
  id: "session",
  tenantId: "workspace",
  title: "Bill",
});
const changed = (revision, text) => ({
  ...structuredClone(initial),
  revision,
  content: [{ kind: "paragraph", id: "p1", inlines: [{ kind: "text", text }] }],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("serial save preserves edits made while a request is in flight and sends them against its acknowledged version", async () => {
  const requests = [],
    resolvers = [];
  const session = createDocumentSession({
    snapshot: { document: initial, version: 1 },
    saveRequest: (body) => {
      requests.push(body);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  session.change(changed(1, "First edit"));
  const saving = session.save();
  await tick();
  session.change(changed(2, "Newer local text"));
  assert.equal(session.save(), saving);
  resolvers[0]({ version: 2 });
  await tick();
  assert.equal(requests[1].expectedVersion, 2);
  assert.equal(
    requests[1].document.content[0].inlines[0].text,
    "Newer local text",
  );
  resolvers[1]({ version: 3 });
  await saving;
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().document.revision, 2);
});
test("an uncertain response retries the exact command before sending newer edits", async () => {
  let fail = true;
  const requests = [];
  const session = createDocumentSession({
    snapshot: { document: initial, version: 1 },
    saveRequest: async (body) => {
      requests.push(body);
      if (fail) {
        fail = false;
        throw Error("network lost after commit");
      }
      return { version: body.expectedVersion + 1 };
    },
  });
  session.change(changed(1, "Accepted but response lost"));
  await assert.rejects(session.save());
  session.change(changed(2, "Newer"));
  await session.save();
  assert.equal(requests[0], requests[1]);
  assert.equal(requests[2].expectedVersion, 2);
  assert.equal(session.getState().version, 3);
});
test("a conflicting save preserves local text and stops writing until the user chooses how to recover", async () => {
  let attempts = 0;
  const session = createDocumentSession({
    snapshot: { document: initial, version: 1 },
    saveRequest: async () => {
      attempts++;
      throw Object.assign(Error("VERSION_CONFLICT"), {
        code: "VERSION_CONFLICT",
        status: 409,
      });
    },
  });
  session.change(changed(1, "Keep my local wording"));
  await assert.rejects(session.save());
  await assert.rejects(session.save());
  assert.equal(attempts, 1);
  assert.equal(session.getState().state, "conflict");
  assert.equal(session.getState().dirty, true);
  assert.equal(
    session.getState().document.content[0].inlines[0].text,
    "Keep my local wording",
  );
});
test("disposing a session prevents an in-flight response from updating a different document", async () => {
  let resolve;
  const events = [];
  const session = createDocumentSession({
    snapshot: { document: initial, version: 1 },
    saveRequest: () => new Promise((r) => (resolve = r)),
    onState: (s) => events.push(s),
  });
  session.change(changed(1, "x"));
  const saving = session.save();
  await tick();
  session.dispose();
  const count = events.length;
  resolve({ version: 2 });
  await saving;
  assert.equal(events.length, count);
});
