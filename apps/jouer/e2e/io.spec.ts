import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// .jouer (de)serialisation round-trips the document and re-renders it live.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("round-trip preserves objects, keyframes and transitions", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer } = window.__mj;
    const s1 = store.getProject().scenes[0].id;
    const rect = cmd.addObject("rectangle", { x: 11, y: 22 });
    store.selectOne(rect);
    store.setPlayhead(0);
    const tid = cmd.addTrack(rect, "x");
    store.setPlayhead(1);
    cmd.updateTransform(rect, { x: 99 });
    cmd.keyframeAtPlayhead(tid);
    const s2 = cmd.addScene();
    store.setActiveScene(s1);
    cmd.addTransition(s1, s2, { kind: "slide", trigger: "key", triggerKey: "SPACE" });

    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === s1);
    return {
      schema: back.schema,
      scenes: back.scenes.length,
      objects: scene.objects.length,
      keys: scene.timelines[0].tracks[0].keyframes.length,
      x0: scene.timelines[0].tracks[0].keyframes[0].value,
      x1: scene.timelines[0].tracks[0].keyframes[1].value,
      transitions: back.transitions.length,
      kind: back.transitions[0].kind,
      key: back.transitions[0].triggerKey,
    };
  });
  expect(r.schema).toBe("monet-jouer/v1");
  expect(r.scenes).toBe(2);
  expect(r.objects).toBe(1);
  expect(r.keys).toBe(2);
  expect(r.x0).toBe(11);
  expect(r.x1).toBe(99);
  expect(r.transitions).toBe(1);
  expect(r.kind).toBe("slide");
  expect(r.key).toBe("SPACE");
});

test("opening a parsed project re-renders it on the live canvas", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store, jouer } = window.__mj;
    const rect = cmd.addObject("rectangle", { x: 200, y: 100 });
    store.replaceProject(jouer.projectFromJson(jouer.projectToJson(store.getProject())), { dirty: false });
    return rect;
  });
  await page.waitForFunction((id) => window.__mj.probe(id) !== null, id, { timeout: 8000 });
});

test("a partial / malformed project loads with defaults", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { jouer } = window.__mj;
    const back = jouer.projectFromJson(JSON.stringify({ name: "Bare" }));
    return { name: back.name, scenes: back.scenes.length, width: back.width };
  });
  expect(r.name).toBe("Bare");
  expect(r.scenes).toBeGreaterThanOrEqual(1);
  expect(r.width).toBe(960);
});
