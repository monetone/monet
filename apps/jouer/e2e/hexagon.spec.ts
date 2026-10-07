import { test, expect } from "@playwright/test";
import { gotoApp, near, tick, waitForNode, waitProbe, cspViolations } from "./helpers";

// Unity-parity 2D primitive: GameObject ▸ 2D Object ▸ Sprites ▸ Hexagon. Jouer
// models it as a `hexagon` shape kind: a Phaser GameObjects.Polygon whose six
// point-top vertices (apex top/bottom, vertical left/right edges) fill the w×h
// box, so it behaves like the rectangle/ellipse/triangle primitives — centred
// origin, fill + stroke, resizable, exportable, round-tripped through .jouer.
// Phaser sizes a Polygon from its points' AABB, so probe.width/height and the
// display origin track the box (no separate geom bookkeeping). Specs drive the
// live editor through `window.__mj`; under the `desktop` project (shipped bundle
// + Tauri CSP) the last test doubles as the feature's CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("Insert ▸ Hexagon adds a hexagon with sane defaults + a live node", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("hexagon", { x: 200, y: 150 });
    const o = query.findObject(query.activeScene(store.getProject()), id);
    return { id, kind: o.kind, name: o.name, width: o.width, height: o.height, fill: o.fill };
  });
  expect(r.kind).toBe("hexagon");
  expect(r.name).toBe("Hexagon");
  expect(r.width).toBe(100);
  expect(r.height).toBe(100);
  expect(r.fill).toBe("#fbbf24");
  // the live Polygon is sized from its points' AABB and centred under the origin
  await waitForNode(page, r.id);
  const p = (await page.evaluate((id) => window.__mj.probe(id), r.id))!;
  near(p.x, 200); near(p.y, 150);
  near(p.width!, 100); near(p.height!, 100);
  expect(p.originX).toBe(0.5); expect(p.originY).toBe(0.5);
  near(p.displayOriginX!, 50); near(p.displayOriginY!, 50);
  expect(p.strokeWidth).toBe(0); // default hexagon is unstroked
});

test("transform edits move, rotate and scale the live hexagon node", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagon", { x: 0, y: 0 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateTransform(id, { x: 321, y: 123, angle: 45, scaleX: 2, alpha: 0.5 }), id);
  await tick(page);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  near(p.x, 321); near(p.y, 123); near(p.angle, 45); near(p.scaleX, 2, 0.01); near(p.alpha, 0.5, 0.01);
});

test("resizing width/height reshapes the live hexagon's bounding box + pivot", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagon", { x: 100, y: 100 }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { width: 200, height: 120 }), id);
  await waitProbe(page, id, "width", 200);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  // Polygon#setTo recomputes the size + display origin from the new points' AABB,
  // so both track the resized box (a broken points formula would diverge here).
  near(p.width!, 200); near(p.height!, 120);
  near(p.displayOriginX!, 100); near(p.displayOriginY!, 60);
});

test("a hexagon exports as add.polygon with the point-top points", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("hexagon", { x: 200, y: 150, patch: { width: 100, height: 80, strokeWidth: 4, stroke: "#101010" } });
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  // hexagonPoints(100, 80) = [50,0, 100,20, 100,60, 50,80, 0,60, 0,20]
  expect(js).toContain("this.add.polygon(200, 150, [50,0,100,20,100,60,50,80,0,60,0,20], 0xfbbf24)");
  expect(js).toContain("setStrokeStyle(4, 0x101010)");
});

test("a hexagon survives a .jouer round-trip", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("hexagon", { x: 50, y: 60, patch: { width: 140, height: 90, fill: "#ff0066" } });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = scene.objects.find((x: any) => x.id === id);
    return { kind: o.kind, width: o.width, height: o.height, fill: o.fill };
  });
  expect(r).toEqual({ kind: "hexagon", width: 140, height: 90, fill: "#ff0066" });
});

test("a stroked hexagon carries its stroke width on the live node", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagon", { x: 100, y: 100, patch: { strokeWidth: 4, stroke: "#101010" } }));
  await waitForNode(page, id);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.strokeWidth).toBe(4); // runtime applied setStrokeStyle to the live Polygon
});

test("the hexagon primitive runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("hexagon", { x: 120, y: 90 }));
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
