import { test, expect } from "@playwright/test";
import { gotoApp, near, tick, waitForNode, waitProbe, cspViolations } from "./helpers";

// Unity-parity 2D primitive: GameObject ▸ 2D Object ▸ Sprites ▸ Hexagon Flat-Top
// — a hexagon with flat top + bottom edges (a point at the left and right), the
// 90°-rotated counterpart of the existing pointed-top Hexagon. Jouer models it as
// a `hexagonFlat` shape kind: a Phaser GameObjects.Polygon whose six points fill
// the object's w×h box, so it behaves like the other shape primitives (centred
// origin, fill + stroke, resizable, exportable). Specs drive the live editor via
// `window.__mj` and assert the model, the live node geometry and the exported
// code. Under the `desktop` project the last test doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("Insert ▸ Hexagon Flat adds one with sane defaults + a live node", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("hexagonFlat", { x: 200, y: 150 });
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { id, kind: o.kind, name: o.name, width: o.width, height: o.height, fill: o.fill };
  });
  expect(r.kind).toBe("hexagonFlat");
  expect(r.name).toBe("Hexagon Flat");
  expect(r.width).toBe(100);
  expect(r.height).toBe(100);
  expect(r.fill).toBe("#fbbf24");
  // the live Phaser node is built as a centred w×h box
  await waitForNode(page, r.id);
  const p = (await page.evaluate((id) => window.__mj.probe(id), r.id))!;
  near(p.x, 200); near(p.y, 150);
  near(p.width!, 100); near(p.height!, 100);
  expect(p.originX).toBe(0.5); expect(p.originY).toBe(0.5);
  // Polygon#setTo recomputes width/height + the display origin from the points'
  // AABB, so node.width is the faithful reshape indicator and the pivot is centred.
  near(p.displayOriginX!, 50); near(p.displayOriginY!, 50);
});

test("transform edits move, rotate and scale the live flat hexagon node", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagonFlat", { x: 0, y: 0 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateTransform(id, { x: 321, y: 123, angle: 45, scaleX: 2, alpha: 0.5 }), id);
  await tick(page);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  near(p.x, 321); near(p.y, 123); near(p.angle, 45); near(p.scaleX, 2, 0.01); near(p.alpha, 0.5, 0.01);
});

test("resizing width/height reshapes the live flat hexagon's bounding box", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagonFlat", { x: 100, y: 100 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { width: 200, height: 120 }), id);
  await waitProbe(page, id, "width", 200);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  near(p.width!, 200); near(p.height!, 120);
  near(p.displayOriginX!, 100); near(p.displayOriginY!, 60);
});

test("a flat hexagon exports as add.polygon with the box-inscribed flat-top points", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("hexagonFlat", { x: 200, y: 150, patch: { width: 100, height: 80, strokeWidth: 4, stroke: "#101010" } });
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  // hexagonFlatPoints(100, 80) = [25,0, 75,0, 100,40, 75,80, 25,80, 0,40]
  expect(js).toContain("this.add.polygon(200, 150, [25,0,75,0,100,40,75,80,25,80,0,40], 0xfbbf24)");
  expect(js).toContain("setStrokeStyle(4, 0x101010)");
});

test("a flat hexagon survives a .jouer round-trip", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer } = window.__mj;
    const id = cmd.addObject("hexagonFlat", { x: 50, y: 60, patch: { width: 140, height: 90, fill: "#ff0066" } });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = scene.objects.find((x: any) => x.id === id);
    return { kind: o.kind, width: o.width, height: o.height, fill: o.fill };
  });
  expect(r).toEqual({ kind: "hexagonFlat", width: 140, height: 90, fill: "#ff0066" });
});

test("the flat hexagon primitive runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagonFlat", { x: 120, y: 90 }));
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
