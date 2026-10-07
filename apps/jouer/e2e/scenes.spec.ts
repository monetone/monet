import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Scene lifecycle: add / duplicate / delete / rename, active-scene switching,
// scene properties, and multiple timelines per scene.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("add scene makes it active and unique-keyed", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addScene();
    const p = store.getProject();
    return { count: p.scenes.length, active: p.activeSceneId, id, keys: p.scenes.map((s: any) => s.key) };
  });
  expect(r.count).toBe(2);
  expect(r.active).toBe(r.id);
  expect(new Set(r.keys).size).toBe(r.keys.length); // keys unique
});

test("duplicate scene deep-copies with fresh ids", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const src = store.getProject().scenes[0];
    const rect = cmd.addObject("rectangle", { x: 42, y: 42 });
    const copyId = cmd.duplicateScene(src.id);
    const p = store.getProject();
    const copy = p.scenes.find((s: any) => s.id === copyId);
    return {
      count: p.scenes.length,
      copyObjs: copy.objects.length,
      idCollision: copy.objects.some((o: any) => o.id === rect),
      sameX: copy.objects[0].transform.x,
    };
  });
  expect(r.count).toBe(2);
  expect(r.copyObjs).toBe(1);
  expect(r.idCollision).toBe(false); // ids regenerated
  expect(r.sameX).toBe(42);          // geometry preserved
});

test("cannot delete the last scene; can delete others", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const only = store.getProject().scenes[0].id;
    cmd.deleteScene(only);
    const afterLast = store.getProject().scenes.length;
    const s2 = cmd.addScene();
    cmd.deleteScene(s2);
    const afterDelete = store.getProject().scenes.length;
    return { afterLast, afterDelete };
  });
  expect(r.afterLast).toBe(1); // refused to delete the only scene
  expect(r.afterDelete).toBe(1);
});

test("rename scene updates the slug key uniquely", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const s = store.getProject().scenes[0];
    cmd.renameScene(s.id, "Level 1: Start!");
    const after = store.getProject().scenes[0];
    return { name: after.name, key: after.key };
  });
  expect(r.name).toBe("Level 1: Start!");
  expect(r.key).toBe("Level_1_Start");
});

test("scene properties update", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const s = store.getProject().scenes[0];
    cmd.updateScene(s.id, { width: 1280, height: 720, backgroundColor: "#112233", gravityY: 800 });
    const after = store.getProject().scenes[0];
    return { w: after.width, h: after.height, bg: after.backgroundColor, g: after.gravityY };
  });
  expect(r).toEqual({ w: 1280, h: 720, bg: "#112233", g: 800 });
});

test("multiple timelines per scene + active switching", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addTimeline();
    const scene = store.getProject().scenes[0];
    store.setActiveTimeline(id);
    return { count: scene.timelines.length, active: store.getProject().scenes[0].activeTimelineId, id };
  });
  expect(r.count).toBe(2);
  expect(r.active).toBe(r.id);
});

test("switching active scene swaps the live canvas content", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const s1 = store.getProject().scenes[0].id;
    const r1 = cmd.addObject("rectangle", { x: 10, y: 10 });
    const s2 = cmd.addScene();
    const r2 = cmd.addObject("ellipse", { x: 20, y: 20 });
    return { s1, s2, r1, r2 };
  });
  // On scene 2, scene-1's object isn't in the live scene; scene-2's is.
  await page.waitForFunction((ids) => window.__mj.probe(ids.r2) !== null && window.__mj.probe(ids.r1) === null, ids, { timeout: 8000 });
  await page.evaluate((ids) => window.__mj.store.setActiveScene(ids.s1), ids);
  await page.waitForFunction((ids) => window.__mj.probe(ids.r1) !== null && window.__mj.probe(ids.r2) === null, ids, { timeout: 8000 });
});
