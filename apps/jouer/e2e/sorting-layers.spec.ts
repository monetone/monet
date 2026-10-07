import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity 2D Sorting Layers + Order in Layer. Render order is (sorting
// layer, then order-in-layer). Specs drive the live editor through `window.__mj`
// and read the live Phaser node's depth (probe.depth) to assert the actual draw
// order, plus the model + the exported code. Under the `desktop` project
// (shipped bundle + Tauri CSP) this doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a later sorting layer renders in front, regardless of order-in-layer", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addSortingLayer("Foreground"); // project layers: [Default, Foreground]
    const back = cmd.addObject("rectangle", { x: 100, y: 100 }); // stays on Default
    const front = cmd.addObject("rectangle", { x: 120, y: 120 });
    cmd.updateObject(back, { depth: 9999 }); // huge order-in-layer on the back object
    cmd.setSortingLayer(front, "Foreground"); // but Foreground beats it
    return { back, front };
  });
  await waitForNode(page, r.back);
  await waitForNode(page, r.front);
  await page.waitForFunction((ids) => {
    const a = window.__mj.probe(ids.back);
    const b = window.__mj.probe(ids.front);
    return !!a && !!b && b.depth > a.depth && b.depth >= 1_000_000;
  }, r, { timeout: 8000 });
});

test("order-in-layer breaks ties within the same layer", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const lo = cmd.addObject("rectangle");
    const hi = cmd.addObject("rectangle");
    cmd.updateObject(lo, { depth: 1 });
    cmd.updateObject(hi, { depth: 5 });
    return { lo, hi };
  });
  await waitForNode(page, r.lo);
  await waitForNode(page, r.hi);
  await page.waitForFunction((ids) => {
    const a = window.__mj.probe(ids.lo);
    const b = window.__mj.probe(ids.hi);
    return !!a && !!b && a.depth === 1 && b.depth === 5; // Default layer ⇒ depth == order
  }, r, { timeout: 8000 });
});

test("removing a sorting layer reassigns its objects back to Default", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.addSortingLayer("FX");
    const id = cmd.addObject("rectangle");
    cmd.setSortingLayer(id, "FX");
    cmd.removeSortingLayer("FX");
    const proj = store.getProject();
    return { layers: proj.sortingLayers, layer: query.findObject(query.activeScene(proj), id).sortingLayer };
  });
  expect(r.layers).not.toContain("FX");
  expect(r.layer).toBe("Default");
});

test("the Default layer cannot be removed", async ({ page }) => {
  const layers = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.removeSortingLayer("Default");
    return store.getProject().sortingLayers;
  });
  expect(layers).toContain("Default");
});

test("moveSortingLayer reorders the render stack", async ({ page }) => {
  const layers = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addSortingLayer("A"); // [Default, A]
    cmd.addSortingLayer("B"); // [Default, A, B]
    cmd.moveSortingLayer("B", -1); // toward back → [Default, B, A]
    return store.getProject().sortingLayers;
  });
  expect(layers).toEqual(["Default", "B", "A"]);
});

test("export emits the effective depth (sorting layer folded with order-in-layer)", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addSortingLayer("Foreground"); // index 1
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { depth: 3 });
    cmd.setSortingLayer(id, "Foreground");
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  expect(js).toContain("setDepth(1000003)"); // 1 × 1_000_000 + order 3
});

test("sorting layers run under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd } = window.__mj;
    cmd.addSortingLayer("Foreground");
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.setSortingLayer(id, "Foreground");
    return id;
  });
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
