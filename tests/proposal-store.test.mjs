import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  createIdentityStore,
  applyIdentityMigrations,
} from "../server/identity-store.mjs";
import { createDocumentStore } from "../server/document-store.mjs";
import { createProposalStore } from "../server/proposal-store.mjs";
import { createProposalRoutes } from "../server/proposal-http.mjs";
import { createAccountHandler } from "../server/account-http.mjs";
import { createLegalDocument } from "../src/legal-structure.mjs";
let db,
  identity,
  documents,
  proposals,
  owner,
  member,
  outsider,
  tenantId,
  document,
  handler;
const origin = "https://quill.example",
  transaction = (fn) =>
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE dge_identity_runtime");
      return fn(tx);
    });
before(async () => {
  db = await PGlite.create();
  await applyIdentityMigrations((fn) => db.transaction(fn));
});
after(async () => db.close());
const user = async () => ({
  ...(await identity.establishSession({
    issuer: "https://provider.example",
    subject: randomUUID(),
    authenticatedAt: Date.now(),
  })),
  origin,
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE dge_identity.accounts,dge_identity.tenants,dge_identity.login_challenges CASCADE",
  );
  identity = createIdentityStore({
    transaction,
    origin,
    sessionKey: randomBytes(32),
    stateKey: randomBytes(32),
  });
  documents = createDocumentStore({ identity, transaction });
  proposals = createProposalStore({ identity, transaction });
  owner = await user();
  member = await user();
  outsider = await user();
  ({ tenantId } = await identity.createTenant(owner));
  const invite = await identity.invite(
    owner,
    tenantId,
    member.accountId,
    "participant",
  );
  await identity.acceptInvitation(member, tenantId, invite.invitationToken);
  document = structuredClone(
    createLegalDocument({
      id: randomUUID(),
      tenantId,
      title: "Public proposal test",
    }),
  );
  document.content[0].inlines = [
    { kind: "text", text: "The agency shall report annually." },
  ];
  await documents.create(owner, tenantId, {
    document,
    commandId: randomUUID(),
    disclosure: "publish-all-revisions-v1",
  });
  handler = createAccountHandler({
    store: identity,
    origin,
    login: {},
    extensions: [createProposalRoutes({ proposals })],
  });
});
const payload = () => ({
  baseVersion: 1,
  selection: {
    blockId: document.content[0].id,
    start: 24,
    end: 32,
    quote: "annually",
  },
  replacement: "quarterly",
  rationale: "Reports should be current.",
  commandId: randomUUID(),
  disclosure: "publish-proposal-v1",
});
const call = (path, { who = owner, method = "GET", body, headers = {} } = {}) =>
  handler(
    new Request(origin + path, {
      method,
      headers: {
        ...(who
          ? {
              cookie: "__Host-dge_session=" + who.sessionToken,
              origin,
              "x-dge-csrf": who.csrfToken,
            }
          : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { peerAddress: "127.0.0.1" },
  );
test("workspace contributors create immutable exact-version public proposals without altering the source", async () => {
  const input = payload(),
    created = await proposals.create(member, tenantId, document.id, input);
  assert.equal(created.baseVersion, 1);
  assert.equal(created.proposal.selection.quote, "annually");
  assert.equal(created.anchorStatus, "pending");
  assert.deepEqual(
    (await documents.read(owner, tenantId, document.id)).document,
    document,
  );
  assert.deepEqual(
    await proposals.create(member, tenantId, document.id, input),
    created,
  );
  const fresh = createProposalStore({ identity, transaction });
  assert.equal(
    (await fresh.read(document.id, created.proposal.id)).digest,
    created.digest,
  );
  const serialized = JSON.stringify(await proposals.list(document.id));
  assert.ok(!serialized.includes(member.accountId));
  assert.ok(!serialized.includes(input.commandId));
  await transaction(async (tx) => {
    assert.equal(
      (await tx.query("SELECT * FROM dge_proposals.proposals")).rows.length,
      0,
    );
    await assert.rejects(
      tx.query("UPDATE dge_proposals.proposals SET digest=digest"),
      /permission denied/,
    );
  });
});
test("wrong tenant, removed members, viewers, and caller-supplied identity assertions cannot publish", async () => {
  await assert.rejects(
    proposals.create(outsider, tenantId, document.id, payload()),
  );
  await identity.changeMember(owner, tenantId, member.accountId, "viewer");
  await assert.rejects(
    proposals.create(member, tenantId, document.id, payload()),
  );
  await identity.changeMember(owner, tenantId, member.accountId, null);
  await assert.rejects(
    proposals.create(member, tenantId, document.id, payload()),
  );
  const response = await call(
    `/api/workspaces/${tenantId}/documents/${document.id}/proposals`,
    { method: "POST", body: { ...payload(), actorId: owner.accountId } },
  );
  assert.equal(response.status, 400);
});
test("changed retries and quote substitution fail without duplicate history or pending commitments", async () => {
  const input = payload();
  await proposals.create(owner, tenantId, document.id, input);
  await assert.rejects(
    proposals.create(owner, tenantId, document.id, {
      ...input,
      replacement: "monthly",
    }),
    /COMMAND_REUSED/,
  );
  await assert.rejects(
    proposals.create(owner, tenantId, document.id, {
      ...payload(),
      selection: { ...input.selection, quote: "different" },
    }),
    /INVALID_TEXT_SELECTION/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM dge_proposals.anchor_outbox",
      )
    ).rows[0].n,
    1,
  );
});
test("proposals on a public-input edition remain advisory and later source revisions mark earlier proposals stale", async () => {
  const first = await proposals.create(owner, tenantId, document.id, payload());
  const next = {
    ...structuredClone(document),
    revision: 1,
    metadata: { ...document.metadata, title: "Updated title" },
  };
  await documents.save(owner, tenantId, document.id, {
    document: next,
    expectedVersion: 1,
    commandId: randomUUID(),
  });
  assert.equal(
    (await proposals.read(document.id, first.proposal.id)).stale,
    true,
  );
  const frozen = await documents.freezeForInput(owner, tenantId, document.id, {
    expectedVersion: 2,
    commandId: randomUUID(),
  });
  const feedback = await proposals.create(member, tenantId, document.id, {
    ...payload(),
    baseVersion: 3,
  });
  assert.equal(feedback.stale, false);
  assert.equal((await documents.publicRead(document.id)).digest, frozen.digest);
  assert.equal(
    (await documents.publicRead(document.id)).document.mode,
    "public-input",
  );
});
test("bounded public lists, JSON inputs, disclosure and HTTP request protections are enforced", async () => {
  const path = `/api/workspaces/${tenantId}/documents/${document.id}/proposals`;
  assert.equal(
    (
      await call(path, {
        method: "POST",
        body: payload(),
        headers: { origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(path, {
        method: "POST",
        body: { ...payload(), disclosure: "private" },
      })
    ).status,
    400,
  );
  const response = await call(path, {
    who: member,
    method: "POST",
    body: payload(),
  });
  assert.equal(response.status, 201);
  assert.equal(
    (
      await call(`/api/public/documents/${document.id}/proposals`, {
        who: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/public/documents/${document.id}/proposals?limit=101`, {
        who: null,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(`/api/public/documents/${randomUUID()}/proposals`, {
        who: null,
      })
    ).status,
    404,
  );
});
test("proposal and shared storage budgets roll back without accepting the change", async () => {
  const limited = createProposalStore({
    identity,
    transaction,
    maxPerDocument: 1,
  });
  await limited.create(owner, tenantId, document.id, payload());
  await assert.rejects(
    limited.create(member, tenantId, document.id, payload()),
    /PROPOSAL_LIMIT_REACHED/,
  );
  const tiny = createProposalStore({
    identity,
    transaction,
    maxStoredBytes: 1,
  });
  await assert.rejects(
    tiny.create(owner, tenantId, document.id, payload()),
    /STORAGE_LIMIT_REACHED/,
  );
  assert.equal((await proposals.list(document.id)).items.length, 1);
});

test("overly nested proposal input fails as a client error without leaking details", async () => {
  let nested = {};
  for (let i = 0; i < 80; i++) nested = { child: nested };
  const response = await call(
    `/api/workspaces/${tenantId}/documents/${document.id}/proposals`,
    { method: "POST", body: { ...payload(), selection: nested } },
  );
  assert.equal(response.status, 400);
});

test("proposal quota checks lock the shared document before counting concurrent submissions", async () => {
  // Regression guard: a shared (FOR SHARE) lock permits both transactions to
  // count the same prior rows. An exclusive row lock serializes count+insert.
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../server/proposal-store.mjs", import.meta.url), "utf8"
  );
  assert.match(source, /SELECT version FROM dge_documents\.documents WHERE tenant_id=\$1 AND id=\$2 FOR UPDATE/);
  assert.doesNotMatch(source, /SELECT version FROM dge_documents\.documents WHERE tenant_id=\$1 AND id=\$2 FOR SHARE/);
});
