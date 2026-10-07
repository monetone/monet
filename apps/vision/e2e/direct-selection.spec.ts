import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Direct Selection tool (A): drag a path's individual anchor points to
// reshape it. Vision wires it through engine vector_nearest_anchor / vector_move_anchor.
test("Direct Selection grabs and drags a path anchor", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "ds");
    const E = mv.engine.engine;
    const scene = JSON.stringify({
      layers: [{ items: [{ type: "path", id: "p1", geometry: { anchors: [{ point: { x: 20, y: 20 } }, { point: { x: 60, y: 60 } }] } }] }],
    });
    const lid = E.add_vector_layer(scene, "Path");
    mv.engine.afterDocChange(); // adopt the new active vector layer into the store
    mv.store.setTool("directselect");
    const hit = mv.store.directSelectAt(20, 20, 6);
    const sel = mv.store.state.selectedAnchor;
    mv.store.dragSelectedAnchor(80, 85);
    mv.store.endAnchorDrag();
    return {
      hit,
      sel,
      cleared: mv.store.state.selectedAnchor,
      at80: E.vector_nearest_anchor(lid, 80, 85, 3),
      at20: E.vector_nearest_anchor(lid, 20, 20, 3),
      tool: mv.store.state.tool,
    };
  });
  expect(r.tool).toBe("directselect");
  expect(r.hit).toBe(true);
  expect(r.sel).toEqual({ item: "p1", index: 0 });
  expect(r.cleared).toBe(null); // released on pointer-up
  expect(r.at80).toBe(JSON.stringify({ item: "p1", index: 0 })); // anchor moved here
  expect(r.at20).toBe(""); // and away from its old spot
});

// Photoshop Path Selection tool (V): drag a whole path to move it.
test("Path Selection drags a whole path", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "ps");
    const E = mv.engine.engine;
    const scene = JSON.stringify({
      layers: [{ items: [{ type: "path", id: "p1", geometry: { anchors: [{ point: { x: 20, y: 20 } }, { point: { x: 40, y: 40 } }] } }] }],
    });
    const lid = E.add_vector_layer(scene, "Path");
    mv.engine.afterDocChange();
    mv.store.setTool("pathselect");
    const hit = mv.store.pathSelectAt(30, 30, 6); // a point on the segment
    mv.store.dragSelectedPath(45, 40); // drag by (+15, +10)
    mv.store.endPathDrag();
    return {
      hit,
      selected: mv.store.state.selectedPaths, // kept after release for Align / Distribute / Arrange (#456)
      a0: E.vector_nearest_anchor(lid, 35, 30, 2), // 20+15, 20+10
      a1: E.vector_nearest_anchor(lid, 55, 50, 2), // 40+15, 40+10
      tool: mv.store.state.tool,
    };
  });
  expect(r.tool).toBe("pathselect");
  expect(r.hit).toBe(true);
  expect(r.selected).toEqual(["p1"]);
  expect(r.a0).toBe(JSON.stringify({ item: "p1", index: 0 }));
  expect(r.a1).toBe(JSON.stringify({ item: "p1", index: 1 }));
});

test("Path Selection toolbar edits only selected components in one undo step", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(160, 100, "components");
    mv.engine.e.add_vector_layer(JSON.stringify({ layers: [{ items: [
      { type: "rect", id: "a", width: 10, height: 10 },
      { type: "rect", id: "b", transform: { a: 1, b: 0, c: 0, d: 1, e: 30, f: 20 }, width: 20, height: 40 },
      { type: "rect", id: "c", transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 5 }, width: 10, height: 10 },
    ] }] }), "Shape");
    mv.engine.afterDocChange();
    mv.store.setTool("pathselect");
    mv.store.pathSelectAt(0, 0);
    mv.store.endPathDrag();
    mv.store.pathSelectAt(30, 20, 6, true);
    mv.store.endPathDrag();
  });
  const read = () => page.evaluate(() => {
    const mv = (window as any).__mv, e = mv.engine.e, id = mv.store.state.activeLayerId;
    return { depth: e.undo_depth(), selected: mv.store.state.selectedPaths,
      bounds: ["a", "b", "c"].map((item) => Array.from(e.vector_item_bounds(id, item))),
      order: JSON.parse(e.vector_scene_json(id)).layers[0].items.map((item: any) => item.id) };
  });
  const before = await read();
  expect(before.selected).toEqual(["a", "b"]);
  await page.locator("#mv-align-left").click();
  expect(await read()).toMatchObject({ depth: before.depth + 1, bounds: [[0, 0, 10, 10], [0, 20, 20, 40], [100, 5, 10, 10]] });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect((await read()).bounds).toEqual(before.bounds);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.pathSelectAt(100, 5, 6, true);
    mv.store.endPathDrag();
  });
  const distribute = await read();
  await page.locator("#mv-dist-hcenter").click();
  expect(await read()).toMatchObject({ depth: distribute.depth + 1, bounds: [[0, 0, 10, 10], [45, 20, 20, 40], [100, 5, 10, 10]] });
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.pathSelectAt(150, 90); // clear before selecting just a
    mv.store.pathSelectAt(0, 0);
    mv.store.endPathDrag();
  });
  const arrange = await read();
  await page.locator("#mv-arrange-front").click();
  expect(await read()).toMatchObject({ depth: arrange.depth + 1, order: ["b", "c", "a"], bounds: arrange.bounds });
  await page.locator("#mv-arrange-back").click();
  expect(await read()).toMatchObject({ depth: arrange.depth + 2, order: ["a", "b", "c"], bounds: arrange.bounds });
});
