import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer-core";
import { accountFixture } from "./support/account-fixture.mjs";
import { createLegalDocument } from "../src/legal-structure.mjs";
const binary = process.env.DGE_BROWSER_EXECUTABLE;
if (!binary) throw Error("DGE_BROWSER_EXECUTABLE required");
async function click(page, label) {
  await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === label && !b.disabled,
      ),
    {},
    label,
  );
  const handle = await page.evaluateHandle(
    (label) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      ),
    label,
  );
  await handle.asElement().click();
  await handle.dispose();
}
async function login(context, origin, subject) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport({ width: 1440, height: 1050 });
  await page.goto(origin + "/account");
  await page.click('a[href="/auth/start"]');
  await page.waitForSelector('input[name="subject"]');
  await page.type('input[name="subject"]', subject);
  await click(page, "Continue fixture login");
  await page.waitForSelector(".account-id");
  return page;
}
async function api(page, path, method = "GET", body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((value) => value.startsWith("__Host-dge_csrf="))
        ?.split("=")[1];
      const response = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(method !== "GET" ? { "x-dge-csrf": csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
}
async function open(page, url) {
  await page.goto(url);
  await click(page, "Suggested changes");
  await page.waitForSelector(".proposal-list button");
  await page.click(".proposal-list button");
  await page.waitForSelector(".discussion");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".discussion button")].some(
      (b) => b.textContent === "Add a supporting point" && !b.disabled,
    ),
  );
}
async function publishPoint(page, button, text) {
  await click(page, button);
  await page.waitForSelector(".point-form");
  await page.type(".point-form textarea", text);
  await page.click('.point-form input[type="checkbox"]');
  await click(page, "Publish point");
  await page.waitForFunction(() => !document.querySelector(".point-form"));
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".discussion-status")
        ?.textContent.includes("Loading"),
  );
}
async function vote(page, group, label, score) {
  const selector = ".point-group-" + group + " .point-card";
  await page.waitForFunction(
    ({ selector, label }) =>
      [...document.querySelectorAll(selector + " button")].some(
        (b) => b.getAttribute("aria-label") === label && !b.disabled,
      ),
    {},
    { selector, label },
  );
  await page.click(selector + ' button[aria-label="' + label + '"]');
  await page.waitForFunction(
    ({ selector, score }) =>
      document.querySelector(selector + " .point-score")?.textContent ===
      "Net " + score,
    {},
    { selector, score },
  );
}
test(
  "Chrome supports structured pro/con points, typed counterclaims and independent up/down/withdraw argument votes",
  { timeout: 90000 },
  async () => {
    const fixture = await accountFixture();
    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: binary,
        headless: true,
        acceptInsecureCerts: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      const ownerContext = await browser.createBrowserContext(),
        voterContext = await browser.createBrowserContext();
      const owner = await login(ownerContext, fixture.origin, "owner"),
        voter = await login(voterContext, fixture.origin, "voter");
      const voterId = await voter.$eval(".account-id", (el) => el.textContent);
      const room = await api(owner, "/api/workspaces", "POST", {});
      assert.equal(room.status, 201);
      const tenantId = room.body.tenantId;
      const invitation = await api(
        owner,
        `/api/workspaces/${tenantId}/invitations`,
        "POST",
        { accountId: voterId, role: "participant" },
      );
      assert.equal(invitation.status, 201);
      assert.equal(
        (
          await api(voter, `/api/workspaces/${tenantId}/join`, "POST", {
            invitationToken: invitation.body.invitationToken,
          })
        ).status,
        200,
      );
      const document = structuredClone(
        createLegalDocument({
          id: randomUUID(),
          tenantId,
          title: "Public Reporting Bill",
        }),
      );
      document.content[0].inlines = [
        { kind: "text", text: "Report annually." },
      ];
      const root = `/api/workspaces/${tenantId}/documents`;
      assert.equal(
        (
          await api(owner, root, "POST", {
            document,
            commandId: randomUUID(),
            disclosure: "publish-all-revisions-v1",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await api(owner, root + "/" + document.id + "/freeze-input", "POST", {
            commandId: randomUUID(),
            expectedVersion: 1,
          })
        ).status,
        200,
      );
      const proposal = await api(
        owner,
        root + "/" + document.id + "/proposals",
        "POST",
        {
          baseVersion: 2,
          selection: {
            blockId: document.content[0].id,
            start: 7,
            end: 15,
            quote: "annually",
          },
          replacement: "quarterly",
          rationale: "Improve timely oversight.",
          commandId: randomUUID(),
          disclosure: "publish-proposal-v1",
        },
      );
      assert.equal(proposal.status, 201);
      const url = fixture.origin + "/?document=" + document.id;
      await open(owner, url);
      await publishPoint(
        owner,
        "Add a supporting point",
        "Quarterly updates let residents identify missed deadlines sooner.",
      );
      await owner.waitForSelector(".point-group-support .point-card");
      await owner.waitForFunction(
        () =>
          document.querySelector(
            '.point-group-support .point-card button[aria-label="Upvote this point"]',
          )?.disabled === true,
      );
      await open(voter, url);
      await vote(voter, "support", "Upvote this point", 1);
      await vote(voter, "support", "Downvote this point", -1);
      await click(voter, "Withdraw point vote");
      await voter.waitForFunction(
        () =>
          document.querySelector(".point-group-support .point-score")
            ?.textContent === "Net 0",
      );
      await publishPoint(
        voter,
        "Add an opposing point",
        "More reporting can divert scarce staff from carrying out the program.",
      );
      await click(owner, "Refresh points");
      await owner.waitForSelector(".point-group-oppose .point-card");
      await vote(owner, "oppose", "Upvote this point", 1);
      const reply = await voter.evaluateHandle(() =>
        document.querySelector(
          ".point-group-support .point-card .point-actions button:last-child",
        ),
      );
      await reply.asElement().click();
      await reply.dispose();
      await voter.waitForSelector(".point-form");
      await voter.type(
        ".point-form textarea",
        "Existing annual audits may already identify the important delays.",
      );
      await voter.click('.point-form input[type="checkbox"]');
      await click(voter, "Publish point");
      await voter.waitForFunction(() => !document.querySelector(".point-form"));
      await voter.click(
        ".point-group-support .point-card .point-actions button:first-child",
      );
      await voter.waitForFunction(() =>
        document
          .querySelector(".point-thread")
          ?.textContent.includes("Existing annual audits"),
      );
      assert.ok(
        (await voter.$eval(".point-thread", (el) => el.textContent)).includes(
          "challenges its parent point",
        ),
      );
      await mkdir("artifacts", { recursive: true });
      await voter.screenshot({
        path: "artifacts/discussion-desktop.png",
        fullPage: true,
      });
      await voter.setViewport({ width: 390, height: 844 });
      await voter.screenshot({
        path: "artifacts/discussion-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await voter.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const publicContext = await browser.createBrowserContext(),
        reader = await publicContext.newPage();
      await reader.goto(url);
      await click(reader, "Suggested changes");
      await reader.waitForSelector(".proposal-list button");
      await reader.click(".proposal-list button");
      await reader.waitForFunction(
        () =>
          document.querySelector(".point-group-oppose .point-score")
            ?.textContent === "Net 1",
      );
      assert.equal(
        await reader.$eval(
          '.point-group-oppose button[aria-label="Upvote this point"]',
          (button) => button.disabled,
        ),
        true,
      );
      assert.equal(
        await reader.$eval(".ProseMirror", (el) => el.textContent),
        "Report annually.",
      );
    } finally {
      await browser?.close();
      await fixture.close();
    }
  },
);
