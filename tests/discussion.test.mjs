import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  createIdentityStore,
  applyIdentityMigrations,
} from "../server/identity-store.mjs";
import { createDocumentStore } from "../server/document-store.mjs";
import { createProposalStore } from "../server/proposal-store.mjs";
import { createDiscussionStore } from "../server/discussion-store.mjs";
import { createDiscussionRoutes } from "../server/discussion-http.mjs";
import { createAccountHandler } from "../server/account-http.mjs";
import { createLegalDocument } from "../src/legal-structure.mjs";
import {
  createDiscussionPoint,
  discussionPointDigest,
  validateEvidence,
} from "../src/discussion.mjs";
let db,
  identity,
  discussion,
  owner,
  voter,
  outsider,
  tenantId,
  documentId,
  proposalId,
  handler,
  documentStore;
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
  owner = await user();
  voter = await user();
  outsider = await user();
  ({ tenantId } = await identity.createTenant(owner));
  const invite = await identity.invite(
    owner,
    tenantId,
    voter.accountId,
    "participant",
  );
  await identity.acceptInvitation(voter, tenantId, invite.invitationToken);
  const doc = structuredClone(
    createLegalDocument({
      id: randomUUID(),
      tenantId,
      title: "Discussion test",
    }),
  );
  doc.content[0].inlines = [{ kind: "text", text: "Report annually." }];
  documentId = doc.id;
  documentStore = createDocumentStore({ identity, transaction });
  await documentStore.create(owner, tenantId, {
    document: doc,
    commandId: randomUUID(),
    disclosure: "publish-all-revisions-v1",
  });
  const proposal = await createProposalStore({ identity, transaction }).create(
    owner,
    tenantId,
    documentId,
    {
      baseVersion: 1,
      selection: {
        blockId: doc.content[0].id,
        start: 7,
        end: 15,
        quote: "annually",
      },
      replacement: "quarterly",
      rationale: "Keep reports current.",
      commandId: randomUUID(),
      disclosure: "publish-proposal-v1",
    },
  );
  proposalId = proposal.proposal.id;
  discussion = createDiscussionStore({ identity, transaction });
  handler = createAccountHandler({
    store: identity,
    origin,
    login: {},
    extensions: [createDiscussionRoutes({ discussion })],
  });
});
const pointInput = (position = "support", extra = {}) => ({
  position,
  text: "More frequent reporting helps the public assess progress.",
  commandId: randomUUID(),
  disclosure: "publish-point-v1",
  ...extra,
});
const point = (who = owner, input = pointInput()) =>
  discussion.create(who, tenantId, documentId, proposalId, input);
const vote = (who, id, value, expectedVoteVersion, commandId = randomUUID()) =>
  discussion.vote(who, tenantId, documentId, proposalId, id, {
    value,
    expectedVoteVersion,
    commandId,
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
test("point content is concise, typed and digest-bound; evidence is safe HTTPS text rather than fetched markup", () => {
  const p = createDiscussionPoint({
    id: "p1",
    tenantId: "tenant",
    documentId: "doc",
    proposalId: "proposal",
    position: "support",
    text: "One concise thesis.",
    evidence: [{ label: "Research", url: "https://example.org/study" }],
  });
  assert.match(discussionPointDigest(p), /^[a-f0-9]{64}$/);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "http://example.org",
    "https://user:secret@example.org/",
    "https://example.org/\nsecret",
  ])
    assert.throws(() => validateEvidence([{ label: "Unsafe", url }]));
  assert.throws(() => createDiscussionPoint({ ...p, text: "x".repeat(1001) }));
  assert.throws(() =>
    createDiscussionPoint({ ...p, parentId: "parent", relation: null }),
  );
});
test("public pro/con points and typed counterclaims persist without changing source or exposing author identity", async () => {
  const input = pointInput(),
    parent = await point(owner, input);
  assert.deepEqual(await point(owner, input), parent);
  const reply = await point(
    voter,
    pointInput("oppose", {
      parentId: parent.point.id,
      relation: "challenges",
      text: "Quarterly reports could divert staff from urgent work.",
    }),
  );
  assert.equal(reply.depth, 1);
  assert.equal(
    (await discussion.list(documentId, proposalId, { position: "support" }))
      .items[0].point.id,
    parent.point.id,
  );
  assert.equal(
    (
      await discussion.list(documentId, proposalId, {
        parentId: parent.point.id,
      })
    ).items[0].point.id,
    reply.point.id,
  );
  const publicText = JSON.stringify(
    await discussion.list(documentId, proposalId),
  );
  assert.ok(!publicText.includes(owner.accountId));
  assert.ok(!publicText.includes(input.commandId));
  assert.equal((await documentStore.publicRead(documentId)).version, 1);
  await assert.rejects(
    point(
      voter,
      pointInput("oppose", { parentId: randomUUID(), relation: "challenges" }),
    ),
    /PARENT_POINT_NOT_FOUND/,
  );
});
test("up, down and withdrawal maintain exact counts, reject self-votes and preserve an immutable private vote history", async () => {
  const created = await point();
  await assert.rejects(
    vote(owner, created.point.id, 1, 0),
    /SELF_POINT_VOTE_FORBIDDEN/,
  );
  const commandId = randomUUID(),
    up = await vote(voter, created.point.id, 1, 0, commandId);
  assert.deepEqual(await vote(voter, created.point.id, 1, 0, commandId), up);
  assert.equal(up.net, 1);
  await assert.rejects(
    vote(voter, created.point.id, -1, 0),
    /POINT_VOTE_CONFLICT/,
  );
  const down = await vote(voter, created.point.id, -1, 1);
  assert.equal(down.up, 0);
  assert.equal(down.down, 1);
  const withdrawn = await vote(voter, created.point.id, 0, 2);
  assert.equal(withdrawn.net, 0);
  const mine = await discussion.mine(voter, tenantId, documentId, proposalId, {
    pointIds: [created.point.id],
  });
  assert.equal(mine.items[0].voteVersion, 3);
  assert.equal(mine.canContribute, true);
  await transaction(async (tx) => {
    await tx.query("SELECT set_config('dge.public_document_id',$1,true)", [
      documentId,
    ]);
    assert.equal(
      (await tx.query("SELECT * FROM dge_discussion.votes")).rows.length,
      0,
    );
    assert.equal(
      (await tx.query("SELECT * FROM dge_discussion.vote_events")).rows.length,
      0,
    );
    await assert.rejects(
      tx.query("DELETE FROM dge_discussion.vote_events"),
      /permission denied/,
    );
  });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM dge_discussion.vote_events",
      )
    ).rows[0].n,
    3,
  );
});
test("ranking pages have stable ties and reject cursors after point or score changes", async () => {
  const a = await point(),
    b = await point(
      owner,
      pointInput("support", { text: "This also improves oversight." }),
    );
  let page = await discussion.list(documentId, proposalId, {
    position: "support",
    limit: 1,
  });
  assert.ok(page.nextCursor);
  const second = await discussion.list(documentId, proposalId, {
    position: "support",
    limit: 1,
    after: page.nextCursor,
  });
  assert.notEqual(page.items[0].point.id, second.items[0].point.id);
  await vote(voter, b.point.id, 1, 0);
  await assert.rejects(
    discussion.list(documentId, proposalId, {
      position: "support",
      limit: 1,
      after: page.nextCursor,
    }),
    /POINT_RANKING_CHANGED/,
  );
  page = await discussion.list(documentId, proposalId, { position: "support" });
  assert.equal(page.items[0].point.id, b.point.id);
  assert.equal(page.items[0].net, 1);
  await assert.rejects(
    discussion.list(documentId, proposalId, { after: "broken" }),
    /INVALID_POINT_CURSOR/,
  );
  assert.equal(
    (await discussion.list(documentId, proposalId, { sort: "new" })).items
      .length,
    2,
  );
  assert.ok(a.point.id);
});
test("membership removal and viewer roles deny further contributions but retain already-cast point history", async () => {
  const created = await point();
  await assert.rejects(point(outsider));
  await vote(voter, created.point.id, 1, 0);
  await identity.changeMember(owner, tenantId, voter.accountId, "viewer");
  await assert.rejects(vote(voter, created.point.id, 0, 1));
  assert.equal(
    (
      await discussion.mine(voter, tenantId, documentId, proposalId, {
        pointIds: [created.point.id],
      })
    ).canContribute,
    false,
  );
  await identity.changeMember(owner, tenantId, voter.accountId, null);
  await assert.rejects(point(voter));
  assert.equal((await discussion.list(documentId, proposalId)).items[0].up, 1);
});
test("point, storage, depth and vote-change budgets fail atomically, retaining one final withdrawal", async () => {
  const limited = createDiscussionStore({
    identity,
    transaction,
    maxPoints: 1,
    maxVoteChanges: 1,
  });
  const created = await limited.create(
    owner,
    tenantId,
    documentId,
    proposalId,
    pointInput(),
  );
  await assert.rejects(
    limited.create(voter, tenantId, documentId, proposalId, pointInput()),
    /POINT_LIMIT_REACHED/,
  );
  await limited.vote(
    voter,
    tenantId,
    documentId,
    proposalId,
    created.point.id,
    { value: 1, expectedVoteVersion: 0, commandId: randomUUID() },
  );
  await assert.rejects(
    limited.vote(voter, tenantId, documentId, proposalId, created.point.id, {
      value: -1,
      expectedVoteVersion: 1,
      commandId: randomUUID(),
    }),
    /VOTE_CHANGE_LIMIT_REACHED/,
  );
  await limited.vote(
    voter,
    tenantId,
    documentId,
    proposalId,
    created.point.id,
    { value: 0, expectedVoteVersion: 1, commandId: randomUUID() },
  );
  const tiny = createDiscussionStore({
    identity,
    transaction,
    maxStoredBytes: 1,
  });
  await assert.rejects(
    tiny.create(voter, tenantId, documentId, proposalId, pointInput()),
    /STORAGE_LIMIT_REACHED/,
  );
  assert.equal((await discussion.list(documentId, proposalId)).items.length, 1);
  let parent = created;
  for (let depth = 1; depth <= 8; depth++)
    parent = await point(
      owner,
      pointInput("clarify", {
        parentId: parent.point.id,
        relation: "clarifies",
      }),
    );
  await assert.rejects(
    point(
      owner,
      pointInput("clarify", {
        parentId: parent.point.id,
        relation: "clarifies",
      }),
    ),
    /POINT_DEPTH_LIMIT/,
  );
});
test("public HTTP reads and protected mutations have exact field/query boundaries and expose no voter identities", async () => {
  const base = `/api/workspaces/${tenantId}/documents/${documentId}/proposals/${proposalId}`,
    publicBase = `/api/public/documents/${documentId}/proposals/${proposalId}/points`;
  assert.equal(
    (
      await call(base + "/points", {
        method: "POST",
        body: pointInput(),
        headers: { origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(base + "/points", {
        method: "POST",
        body: { ...pointInput(), actorId: owner.accountId },
      })
    ).status,
    400,
  );
  const created = await call(base + "/points", {
    method: "POST",
    body: pointInput(),
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).point.id;
  assert.equal(
    (
      await call(base + "/point-votes/" + id, {
        who: voter,
        method: "PUT",
        body: { value: 1, expectedVoteVersion: 0, commandId: randomUUID() },
      })
    ).status,
    200,
  );
  const response = await call(publicBase, { who: null });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(voter.accountId));
  assert.equal(
    (await call(publicBase + "?limit=101", { who: null })).status,
    400,
  );
  const mine = await call(base + "/my-point-votes?points=" + id, {
    who: voter,
  });
  assert.equal((await mine.json()).items[0].value, 1);
});

test("newest-point pagination continues across score changes but still detects newly inserted points", async () => {
  const first = await point(),
    second = await point(
      owner,
      pointInput("oppose", { text: "A different point." }),
    );
  const page = await discussion.list(documentId, proposalId, {
    sort: "new",
    limit: 1,
  });
  await vote(voter, first.point.id, 1, 0);
  assert.equal(
    (
      await discussion.list(documentId, proposalId, {
        sort: "new",
        limit: 1,
        after: page.nextCursor,
      })
    ).items.length,
    1,
  );
  await point(owner, pointInput("clarify", { text: "A new clarification." }));
  await assert.rejects(
    discussion.list(documentId, proposalId, {
      sort: "new",
      limit: 1,
      after: page.nextCursor,
    }),
    /POINT_RANKING_CHANGED/,
  );
  assert.ok(second.point.id);
});
test("transport rejects null characters that PostgreSQL JSON cannot store while retaining literal escape text", async () => {
  const path = `/api/workspaces/${tenantId}/documents/${documentId}/proposals/${proposalId}/points`;
  assert.equal(
    (
      await call(path, {
        method: "POST",
        body: pointInput("support", { text: "A null: \0" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(path, {
        method: "POST",
        body: pointInput("support", {
          text: String.raw`A literal escape: \u0000`,
        }),
      })
    ).status,
    201,
  );
});
