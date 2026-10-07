import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoApp } from "./helpers";

const fontBytes = Array.from(readFileSync(new URL("../../../packages/engine/src/vector/testdata/curve_font.ttf", import.meta.url)));

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

/** Click through the live menu bar; intermediate entries are submenus. */
async function menu(page: Page, top: string, ...path: string[]) {
  await page.getByRole("menuitem", { name: top, exact: true }).click();
  for (const [i, name] of path.entries()) {
    const item = page.getByRole("menuitem", { name, exact: true });
    if (i < path.length - 1) await item.hover();
    else await item.click();
  }
}

/** Document → screen through an overlay SVG, which spans the document box at
 *  the current zoom. */
async function docToScreen(page: Page, selector: string) {
  const box = await page.evaluate((sel) => {
    const e = (window as any).__mv.engine.e;
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return { left: r.left, top: r.top, sx: r.width / e.width(), sy: r.height / e.height() };
  }, selector);
  return (x: number, y: number) => ({ x: box.left + x * box.sx, y: box.top + y * box.sy });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

const undoDepth = (page: Page) => page.evaluate(() => (window as any).__mv.engine.e.undo_depth() as number);

const rgb = (page: Page, x: number, y: number) => page.evaluate(({ x, y }) => {
  const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
  return { r: (c >>> 24) & 255, g: (c >>> 16) & 255, b: (c >>> 8) & 255 };
}, { x, y });

const workAnchor = (page: Page, i: number) =>
  page.evaluate((i) => ((window as any).__mv.store.state.penAnchors as number[]).slice(i * 6, i * 6 + 6), i);

/** Centre of the one highlighted anchor square, in document space. */
const litAnchor = (page: Page) => page.locator('[data-mv-anchor="on"]').evaluate((r) => ({
  x: +r.getAttribute("x")! + +r.getAttribute("width")! / 2,
  y: +r.getAttribute("y")! + +r.getAttribute("height")! / 2,
}));

/** A mouse drag lands within a document pixel at any zoom fitLayer picks. */
const expectNear = (actual: number, expected: number, message?: string) =>
  expect(Math.abs(actual - expected), message).toBeLessThan(1);

test("Type menu creates real glyph work paths and shape SVG through WASM", async ({ page }) => {
  await gotoApp(page);
  const initial = await page.evaluate((bytes) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(180, 140, "Glyph outlines");
    const e = mv.engine.e;
    // The engine's authored TrueType fixture has a quadratic bowl, so this
    // cannot pass by tracing the browser's fallback-font raster.
    e.registerVectorFont("OutlineFixture", Uint8Array.from(bytes), 0);
    const spec = mv.text.defaultSpec("", { ax: 12, ay: 16, font: "OutlineFixture, sans-serif",
      runs: [{ text: "C", size: 32, color: [210, 20, 30, 255] }, { text: "C", size: 48, color: [20, 30, 210, 255] }],
      warp: { style: "arc", bend: 0.4, h: 0, v: 0, orient: "h" } });
    const id = mv.text.create(spec);
    return { id, undo: e.undo_depth() };
  }, fontBytes);

  await menu(page, "Type", "Create Work Path");
  const path = await page.evaluate((id) => {
    const mv = (window as any).__mv;
    const e = mv.engine.e;
    const s = mv.store.state;
    return { svg: e.export_layer_svg(id), kind: e.layer_kind(id), undo: e.undo_depth(), error: e.last_edit_error(),
      contours: s.penContours as number[],
      handles: (s.penAnchors as number[]).filter((v, i) => i % 6 >= 2 && Math.abs(v) > 0.01).length };
  }, initial.id);
  expect(path.error).toBe("");
  expect(path.kind).toBe(2);
  expect(path.undo).toBe(initial.undo + 1);
  expect(path.svg).toMatch(/\bC[-\d]/);
  expect(path.contours, "one closed loop per glyph").toHaveLength(2);
  expect(path.handles, "anchors carry the font's Bezier handles").toBeGreaterThan(0);

  // The work path is the user's, not engine-internal data: the Paths panel row,
  // its enabled path ops, and a curved canvas outline drawn loop by loop.
  await page.locator('[data-tab-id="paths"]').click();
  const workRow = page.locator('[data-mv-path-row="work"]');
  await expect(workRow).toBeVisible();
  const pathsPanel = workRow.locator("xpath=../..");
  for (const name of ["Make Selection", "Fill Path", "Stroke Path", "Save"]) {
    await expect(pathsPanel.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  const outline = page.locator('svg[data-mv-workpath][data-mv-workpath-contours="2"]');
  await expect(outline).toBeVisible();
  await expect(outline.locator("path").first()).toHaveAttribute("d", / C /);

  // Zoom to the glyphs, so Direct Selection's 8 px tolerance is small next to
  // the warped outline's anchor spacing.
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("directselect");
    mv.store.fitLayer();
  });
  await page.waitForFunction(() => {
    const mv = (window as any).__mv;
    const r = document.querySelector("svg[data-mv-workpath]")?.getBoundingClientRect();
    return !!r && Math.abs(r.width - mv.engine.e.width() * mv.store.state.zoom) < 1;
  });

  // Fill Path and Stroke Path cover the glyphs but never the bridges that join
  // their loops in the fill polygon, each in one undo step.
  const layer = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const e = mv.engine.e;
    mv.store.addLayer();
    e.select_all(); e.fill_selection(255, 255, 255, 255); e.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 }); // green
    mv.store.setBrush({ size: 3, hardness: 1 });
    return { id: mv.store.state.activeLayerId as number, undo: e.undo_depth() as number };
  });
  expect(layer.id).not.toBe(initial.id);
  const probe = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const a = mv.store.state.penAnchors as number[];
    const lens = mv.store.state.penContours as number[];
    // Each loop on its own, 16 cubic steps a segment: the outline the path ops
    // must match, with no bridges.
    const edges: number[][] = [];
    let o = 0;
    for (const n of lens) {
      const pts: number[][] = [];
      for (let i = 0; i < n; i++) {
        const p = o + i * 6, q = o + ((i + 1) % n) * 6;
        const x0 = a[p], y0 = a[p + 1], x3 = a[q], y3 = a[q + 1];
        const x1 = x0 + a[p + 4], y1 = y0 + a[p + 5], x2 = x3 + a[q + 2], y2 = y3 + a[q + 3];
        for (let k = 0; k < 16; k++) {
          const t = k / 16, u = 1 - t;
          pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
        }
      }
      pts.forEach((pt, i) => edges.push([...pt, ...pts[(i + 1) % pts.length]]));
      o += n * 6;
    }
    const inside = (x: number, y: number) => edges.reduce((c, [x0, y0, x1, y1]) =>
      ((y0 > y) !== (y1 > y) && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0 ? !c : c), false);
    const clearance = (x: number, y: number) => Math.min(...edges.map(([x0, y0, x1, y1]) => {
      const dx = x1 - x0, dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
    }));
    let glyph = { x: 0, y: 0, clear: 0 };
    for (let y = 0; y < mv.engine.e.height(); y++) {
      for (let x = 0; x < mv.engine.e.width(); x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const clear = clearance(x + 0.5, y + 0.5);
        if (clear > glyph.clear) glyph = { x, y, clear };
      }
    }
    // The fill polygon's bridge runs from loop 0's first point to loop 1's.
    const bx = a[0], by = a[1], ex = a[lens[0] * 6], ey = a[lens[0] * 6 + 1];
    let gap = { x: 0, y: 0, clear: 0 };
    for (let t = 0.02; t < 1; t += 0.02) {
      const x = Math.floor(bx + t * (ex - bx)), y = Math.floor(by + t * (ey - by));
      if (inside(x + 0.5, y + 0.5)) continue;
      const clear = clearance(x + 0.5, y + 0.5);
      if (clear > gap.clear) gap = { x, y, clear };
    }
    return { glyph, gap, edge: { x: Math.floor(a[0]), y: Math.floor(a[1]) } };
  });
  expect(probe.glyph.clear, "a pixel well inside a glyph").toBeGreaterThan(1.5);
  expect(probe.gap.clear, "a bridge pixel clear of every glyph and the brush").toBeGreaterThan(3);
  await page.getByRole("button", { name: "Fill Path", exact: true }).click();
  const filled = await rgb(page, probe.glyph.x, probe.glyph.y);
  expect(filled.g).toBeGreaterThan(filled.r + 100);
  expect(await rgb(page, probe.gap.x, probe.gap.y), "the bridge is not filled").toEqual({ r: 255, g: 255, b: 255 });
  expect(await undoDepth(page)).toBe(layer.undo + 1);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.getByRole("button", { name: "Stroke Path", exact: true }).click();
  const edge = await rgb(page, probe.edge.x, probe.edge.y);
  expect(edge.g, "the loop outline is stroked").toBeGreaterThan(edge.r);
  expect(await rgb(page, probe.gap.x, probe.gap.y), "the bridge is not stroked").toEqual({ r: 255, g: 255, b: 255 });
  expect(await undoDepth(page)).toBe(layer.undo + 1);
  // Map to the screen only now: the new pixel layer swapped the type layer's
  // two-row options bar for a shorter one, which moved the canvas up.
  const toScreen = await docToScreen(page, "svg[data-mv-workpath]");

  // Direct Selection edits the work path. Take an anchor with handles on the
  // SECOND loop, clear of every handle end (grabbed first) and other anchor.
  const target = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const a = s.penAnchors as number[];
    const n = a.length / 6;
    const ends: number[][] = [];
    for (let j = 0; j < n; j++) {
      for (const k of [2, 4]) if (a[j * 6 + k] || a[j * 6 + k + 1]) ends.push([a[j * 6] + a[j * 6 + k], a[j * 6 + 1] + a[j * 6 + k + 1]]);
    }
    let best: { index: number; clear: number } | null = null;
    for (let i = s.penContours[0]; i < n; i++) {
      if (!a[i * 6 + 2] && !a[i * 6 + 3] && !a[i * 6 + 4] && !a[i * 6 + 5]) continue;
      const x = a[i * 6], y = a[i * 6 + 1];
      let clear = Infinity;
      for (const [hx, hy] of ends) clear = Math.min(clear, Math.hypot(hx - x, hy - y));
      for (let j = 0; j < n; j++) if (j !== i) clear = Math.min(clear, Math.hypot(a[j * 6] - x, a[j * 6 + 1] - y));
      if (!best || clear > best.clear) best = { index: i, clear };
    }
    return best && { ...best, tol: 8 / s.zoom, anchor: a.slice(best.index * 6, best.index * 6 + 6) };
  });
  expect(target, "an anchor with handles on the second loop").not.toBeNull();
  expect(target!.clear).toBeGreaterThan(target!.tol * 1.25);
  const [ax, ay] = target!.anchor;
  await page.mouse.click(toScreen(ax, ay).x, toScreen(ax, ay).y);
  await expect(page.locator('[data-mv-anchor="on"]'), "only the clicked second-loop anchor is selected").toHaveCount(1);
  // The highlight sits on THAT anchor. Keyed by the index within its loop, it
  // would light a different anchor of the second loop (or none).
  const lit = await litAnchor(page);
  expect(lit.x).toBeCloseTo(ax, 3);
  expect(lit.y).toBeCloseTo(ay, 3);
  await expect(page.locator("svg[data-mv-vector-paths] circle"), "its direction handles show").not.toHaveCount(0);
  await drag(page, toScreen(ax, ay), toScreen(ax + 8, ay + 6));
  const moved = await workAnchor(page, target!.index);
  expectNear(moved[0], ax + 8);
  expectNear(moved[1], ay + 6);
  expect(moved.slice(2), "relative handles ride along").toEqual(target!.anchor.slice(2));
  const grip = await page.evaluate((i) => {
    const a = (window as any).__mv.store.state.penAnchors as number[];
    let best: { k: number; x: number; y: number; clear: number } | null = null;
    for (const k of [4, 2]) {
      if (!a[i * 6 + k] && !a[i * 6 + k + 1]) continue;
      const x = a[i * 6] + a[i * 6 + k], y = a[i * 6 + 1] + a[i * 6 + k + 1];
      let clear = Infinity;
      for (let j = 0; j < a.length / 6; j++) {
        for (const m of [2, 4]) {
          if ((j === i && m === k) || (!a[j * 6 + m] && !a[j * 6 + m + 1])) continue;
          clear = Math.min(clear, Math.hypot(a[j * 6] + a[j * 6 + m] - x, a[j * 6 + 1] + a[j * 6 + m + 1] - y));
        }
      }
      if (!best || clear > best.clear) best = { k, x, y, clear };
    }
    return best;
  }, target!.index);
  expect(grip!.clear, "no other handle end sits on the grabbed one").toBeGreaterThan(0.5);
  await drag(page, toScreen(grip!.x, grip!.y), toScreen(grip!.x + 5, grip!.y - 4));
  const pulled = await workAnchor(page, target!.index);
  expect(pulled.slice(0, 2), "pulling a handle leaves the anchor").toEqual(moved.slice(0, 2));
  expectNear(pulled[grip!.k], moved[grip!.k] + 5);
  expectNear(pulled[grip!.k + 1], moved[grip!.k + 1] - 4);

  // Save keeps the loops; loading the saved path brings them back.
  await pathsPanel.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.savedPaths[0]?.contours)).toHaveLength(2);
  await workRow.locator('[title="Delete the work path"]').click();
  await expect(workRow).toHaveCount(0);
  await page.locator('[data-mv-path-row="0"]').click();
  await expect(workRow).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.penContours)).toHaveLength(2);

  // Vector Mask ▸ Current Path keeps every loop a curved subpath of its own.
  await menu(page, "Layer", "Vector Mask", "Current Path");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  const mask = await page.evaluate((id) => {
    const e = (window as any).__mv.engine.e;
    return { has: e.has_vector_mask(id), svg: e.export_layer_svg(id) as string };
  }, layer.id);
  expect(mask.has).toBe(true);
  const d = /\sd="([^"]*)"/.exec(mask.svg)?.[1] ?? "";
  expect(d.match(/M/g), "one subpath per glyph loop").toHaveLength(2);
  expect(d).toMatch(/C[-\d]/);
  expect(d, "no bridge segments").not.toContain("L");

  await page.evaluate((id) => (window as any).__mv.store.selectLayer(id), initial.id);
  const beforeShape = await undoDepth(page);
  await menu(page, "Type", "Convert to Shape");
  const shape = await page.evaluate((id) => {
    const e = (window as any).__mv.engine.e;
    const scene = JSON.parse(e.vector_scene_json(id));
    const anchors = scene.layers.flatMap((l: any) => l.items.flatMap((item: any) => (item.subpaths ?? []).flatMap((g: any) => g.anchors)));
    return { svg: e.export_layer_svg(id), kind: e.layer_kind(id), undo: e.undo_depth(),
      curved: anchors.some((a: any) => Math.abs(a.handleOut?.x ?? 0) > 0.01 && Math.abs(a.handleOut?.y ?? 0) > 0.01),
      error: e.last_edit_error() };
  }, initial.id);
  expect(shape.error).toBe("");
  expect(shape.kind).toBe(3);
  expect(shape.undo).toBe(beforeShape + 1);
  expect(shape.curved).toBe(true);
  expect(shape.svg).toMatch(/\bC[-\d]/);
  expect(shape.svg).toContain("rgb(210,20,30)");
  expect(shape.svg).toContain("rgb(20,30,210)");

  // The shape is editable with the vector tools. Each glyph is its own item, so
  // take the anchor clear of every other anchor and handle end across all of
  // them, addressed by its flat index within its item like the engine does.
  await expect(page.locator("svg[data-mv-vector-paths]")).toBeVisible();
  const shapeTarget = await page.evaluate((id) => {
    const mv = (window as any).__mv;
    const e = mv.engine.e;
    const all = JSON.parse(e.vector_scene_json(id)).layers.flatMap((l: any) => l.items)
      .flatMap((it: any) => (it.subpaths ?? []).flatMap((g: any) => g.anchors)
        .map((a: any, index: number) => ({ item: it.id as string, index, x: a.point.x as number, y: a.point.y as number, a })));
    const ends = all.flatMap(({ a }: any) => [a.handleIn, a.handleOut].filter((h: any) => h && (h.x || h.y))
      .map((h: any) => [a.point.x + h.x, a.point.y + h.y]));
    let best: { item: string; index: number; x: number; y: number; clear: number } | null = null;
    for (const t of all) {
      let clear = Infinity;
      for (const [x, y] of ends) clear = Math.min(clear, Math.hypot(x - t.x, y - t.y));
      for (const u of all) if (u !== t) clear = Math.min(clear, Math.hypot(u.x - t.x, u.y - t.y));
      if (!best || clear > best.clear) best = { item: t.item, index: t.index, x: t.x, y: t.y, clear };
    }
    return { ...best!, tol: 8 / mv.store.state.zoom, undo: e.undo_depth() as number,
      hit: e.vector_nearest_anchor(id, best!.x, best!.y, 0.5) as string };
  }, initial.id);
  const address = JSON.stringify({ item: shapeTarget.item, index: shapeTarget.index });
  expect(shapeTarget.hit, "the engine addresses it by its flat index").toBe(address);
  expect(shapeTarget.clear).toBeGreaterThan(shapeTarget.tol * 1.25);
  const shapeScreen = await docToScreen(page, "svg[data-mv-vector-paths]");
  await drag(page, shapeScreen(shapeTarget.x, shapeTarget.y), shapeScreen(shapeTarget.x + 8, shapeTarget.y + 6));
  await expect(page.locator('[data-mv-anchor="on"]'), "only the dragged glyph anchor is selected").toHaveCount(1);
  const shapeLit = await litAnchor(page);
  expectNear(shapeLit.x, shapeTarget.x + 8, "the highlight follows the dragged anchor");
  expectNear(shapeLit.y, shapeTarget.y + 6, "the highlight follows the dragged anchor");
  const shapeDrag = await page.evaluate(({ id, x, y }) => {
    const e = (window as any).__mv.engine.e;
    return { hit: e.vector_nearest_anchor(id, x, y, 1) as string, undo: e.undo_depth() as number };
  }, { id: initial.id, x: shapeTarget.x + 8, y: shapeTarget.y + 6 });
  expect(shapeDrag.hit).toBe(address);
  expect(shapeDrag.undo).toBe(shapeTarget.undo + 1);

  // Layer ▸ Copy SVG puts the shape's curves on the clipboard.
  await menu(page, "Layer", "Copy SVG");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\bC[-\d]/);
});

test("Type outline commands report what they need and change nothing without it", async ({ page }) => {
  await gotoApp(page);
  const pixelUndo = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "No outlines");
    return mv.engine.e.undo_depth() as number;
  });
  await menu(page, "Type", "Create Work Path");
  await expect(page.getByText("Create Work Path needs a type layer. Select a type layer first.")).toBeVisible();
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { undo: mv.engine.e.undo_depth(), pen: mv.store.state.penPath.length };
  })).toEqual({ undo: pixelUndo, pen: 0 });

  // No vector font is registered in this page, so the type has no outline data.
  const type = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.text.create(mv.text.defaultSpec("", { ax: 12, ay: 16, font: "NoOutlineFixture",
      runs: [{ text: "C", size: 32, color: [0, 0, 0, 255] }] }));
    return { id, undo: mv.engine.e.undo_depth() as number };
  });
  await menu(page, "Type", "Convert to Shape");
  await expect(page.getByText(/Convert to Shape needs outline data for this layer's font/)).toBeVisible();
  expect(await page.evaluate((id) => {
    const e = (window as any).__mv.engine.e;
    return { kind: e.layer_kind(id), undo: e.undo_depth() };
  }, type.id)).toEqual({ kind: 2, undo: type.undo });
});
