import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Copy Component / Paste Component Values for the physics body:
// copy one object's Rigidbody2D/Collider2D (Jouer's PhysicsBody) and paste those
// values onto other existing objects. Each target gets an independent clone;
// containers (no body) and locked objects are skipped. Specs drive the live
// editor through `window.__mj` + inspector DOM. Under the `desktop` project this
// doubles as the feature's CSP smoke.

const BODY = {
  bodyType: "dynamic", shape: "circle", mass: 7, drag: 1.5, angularVelocity: 30, angularDrag: 0.2,
  freezeRotation: true, velocityX: 50, velocityY: -20, gravityY: 200, bounceX: 0.5, bounceY: 0.5,
  collideWorldBounds: true, immovable: false, allowGravity: true,
};

const bodyOf = (page: Page, id: string) =>
  page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).body, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("paste applies the copied body values to the target", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 100, y: 100, patch: { body } });
    const b = cmd.addObject("rectangle", { x: 300, y: 100 }); // no body yet
    store.selectOne(a);
    cmd.copyBody();
    store.selectOne(b);
    cmd.pasteBody();
    return b;
  }, BODY);
  expect(await bodyOf(page, id)).toEqual(BODY);
});

test("paste applies to every selected object", async ({ page }) => {
  const ids = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle");
    const c = cmd.addObject("rectangle");
    store.selectOne(a);
    cmd.copyBody();
    store.select([b, c]);
    cmd.pasteBody();
    return { b, c };
  }, BODY);
  expect(await bodyOf(page, ids.b)).toEqual(BODY);
  expect(await bodyOf(page, ids.c)).toEqual(BODY);
});

test("each paste target gets an independent clone (no shared reference)", async ({ page }) => {
  const independent = await page.evaluate((body) => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle");
    const c = cmd.addObject("rectangle");
    store.selectOne(a); cmd.copyBody();
    store.select([b, c]); cmd.pasteBody();
    const scene = query.activeScene(store.getProject());
    return query.findObject(scene, b).body !== query.findObject(scene, c).body;
  }, BODY);
  expect(independent).toBe(true);
});

test("paste leaves locked objects untouched", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle");
    cmd.setLocked(b, true);
    store.selectOne(a); cmd.copyBody();
    store.selectOne(b); cmd.pasteBody();
    return b;
  }, BODY);
  expect(await bodyOf(page, id)).toBeNull();
});

test("paste skips containers (no physics body)", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const g = cmd.addObject("container");
    store.selectOne(a); cmd.copyBody();
    store.selectOne(g); cmd.pasteBody();
    return g;
  }, BODY);
  expect(await bodyOf(page, id)).toBeNull();
});

test("a single paste over a mixed selection applies only to the valid targets", async ({ page }) => {
  const ids = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const src = cmd.addObject("rectangle", { patch: { body } });
    const valid = cmd.addObject("ellipse");
    const locked = cmd.addObject("rectangle");
    cmd.setLocked(locked, true);
    const container = cmd.addObject("container");
    store.selectOne(src); cmd.copyBody();
    store.select([valid, locked, container]);
    cmd.pasteBody();
    return { valid, locked, container };
  }, BODY);
  expect(await bodyOf(page, ids.valid)).toEqual(BODY); // applied
  expect(await bodyOf(page, ids.locked)).toBeNull();    // skipped: locked
  expect(await bodyOf(page, ids.container)).toBeNull(); // skipped: container
});

test("paste overwrites a target's existing body", async ({ page }) => {
  const id = await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle", { patch: { body: { ...body, mass: 999, gravityY: 0, shape: "box" } } });
    store.selectOne(a); cmd.copyBody();
    store.selectOne(b); cmd.pasteBody();
    return b;
  }, BODY);
  expect(await bodyOf(page, id)).toEqual(BODY); // B's old body replaced by A's
});

test("paste with nothing selected, or an empty clipboard, is a no-op", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    store.selectOne(a);
    const canPasteBefore = cmd.canPasteBody();
    cmd.pasteBody(); // empty clipboard
    return { canPasteBefore, body: window.__mj.query.findObject(window.__mj.query.activeScene(store.getProject()), a).body };
  });
  expect(r.canPasteBefore).toBe(false);
  expect(r.body).toBeNull();
});

test("paste is a single undo step", async ({ page }) => {
  const r = await page.evaluate((body) => {
    const { cmd, store, query } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle");
    store.selectOne(a); cmd.copyBody();
    store.selectOne(b); cmd.pasteBody();
    const after = query.findObject(query.activeScene(store.getProject()), b).body;
    cmd.undo();
    const restored = query.findObject(query.activeScene(store.getProject()), b).body;
    return { after, restored };
  }, BODY);
  expect(r.after).toEqual(BODY);
  expect(r.restored).toBeNull(); // one undo removes the pasted body
});

test("the inspector Copy/Paste body buttons work", async ({ page }) => {
  const ids = await page.evaluate((body) => {
    const { cmd } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle", { patch: { body: { ...body, mass: 1 } } }); // own body → section open
    return { a, b };
  }, BODY);
  // select A and copy its body via the inspector button
  await page.evaluate((id) => window.__mj.store.selectOne(id), ids.a);
  await page.getByTestId("copy-body").click();
  // select B and paste
  await page.evaluate((id) => window.__mj.store.selectOne(id), ids.b);
  await page.getByTestId("paste-body").click();
  expect(await bodyOf(page, ids.b)).toEqual(BODY);
});

test("copy/paste body runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate((body) => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { patch: { body } });
    const b = cmd.addObject("rectangle");
    store.selectOne(a); cmd.copyBody();
    store.selectOne(b); cmd.pasteBody();
  }, BODY);
  expect(await cspViolations(page)).toEqual([]);
});
