import { test, expect } from "@playwright/test";
import { gotoApp, near, tick, waitForNode, waitProbe, cspViolations } from "./helpers";

// Unity-parity 2D primitive: GameObject ▸ 2D Object ▸ Sprites ▸ Triangle — a
// white isosceles triangle. Jouer models it as a `triangle` shape kind: a
// Phaser GameObjects.Triangle whose three points (apex top-centre, base corners)
// give a w×h bounding box, so it behaves like the rectangle/ellipse primitives
// (centred origin, fill + stroke, resizable, exportable). Specs drive the live
// editor through `window.__mj` and assert the model, the live node geometry and
// the exported code. Under the `desktop` project (shipped bundle + Tauri CSP)
// the last test doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("Insert ▸ Triangle adds a triangle with sane defaults + a live node", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("triangle", { x: 200, y: 150 });
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { id, kind: o.kind, name: o.name, width: o.width, height: o.height, fill: o.fill };
  });
  expect(r.kind).toBe("triangle");
  expect(r.name).toBe("Triangle");
  expect(r.width).toBe(100);
  expect(r.height).toBe(100);
  expect(r.fill).toBe("#f472b6");
  // the live Phaser node is built as a centred w×h box
  await waitForNode(page, r.id);
  const p = (await page.evaluate((id) => window.__mj.probe(id), r.id))!;
  near(p.x, 200); near(p.y, 150);
  near(p.width!, 100); near(p.height!, 100);
  expect(p.originX).toBe(0.5); expect(p.originY).toBe(0.5);
  // the isosceles triangle's actual path spans the full w×h box, pivoted centre
  near(p.geomWidth!, 100); near(p.geomHeight!, 100);
  near(p.displayOriginX!, 50); near(p.displayOriginY!, 50);
});

test("transform edits move, rotate and scale the live triangle node", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("triangle", { x: 0, y: 0 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateTransform(id, { x: 321, y: 123, angle: 45, scaleX: 2, alpha: 0.5 }), id);
  await tick(page);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  near(p.x, 321); near(p.y, 123); near(p.angle, 45); near(p.scaleX, 2, 0.01); near(p.alpha, 0.5, 0.01);
});

test("resizing width/height reshapes the live triangle's bounding box", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("triangle", { x: 100, y: 100 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { width: 200, height: 120 }), id);
  // the reconcile re-applies the node in place (no kind change → no rebuild)
  await waitProbe(page, id, "width", 200);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  near(p.width!, 200); near(p.height!, 120);
  // The two load-bearing, Triangle-specific reconcile steps (Rectangle#setSize
  // does these itself; the base Shape#setSize Triangle inherits does not):
  //  • setTo(...) reshapes the geometry/path → the geom extent must track the box
  near(p.geomWidth!, 200); near(p.geomHeight!, 120);
  //  • updateDisplayOrigin() recomputes the pixel pivot → stays centred on resize
  near(p.displayOriginX!, 100); near(p.displayOriginY!, 60);
});

test("a triangle exports as add.triangle with isosceles points", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("triangle", { x: 200, y: 150, patch: { width: 100, height: 80, strokeWidth: 4, stroke: "#101010" } });
    void id;
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  // apex top-centre (w/2,0), base corners (0,h)/(w,h) → bounding box 100×80
  expect(js).toContain("this.add.triangle(200, 150, 0, 80, 50, 0, 100, 80, 0xf472b6)");
  expect(js).toContain("setStrokeStyle(4, 0x101010)");
});

test("a triangle survives a .jouer round-trip", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("triangle", { x: 50, y: 60, patch: { width: 140, height: 90, fill: "#ff0066" } });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = scene.objects.find((x: any) => x.id === id);
    return { kind: o.kind, width: o.width, height: o.height, fill: o.fill };
  });
  expect(r).toEqual({ kind: "triangle", width: 140, height: 90, fill: "#ff0066" });
});

test("the triangle primitive runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("triangle", { x: 120, y: 90 }));
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
