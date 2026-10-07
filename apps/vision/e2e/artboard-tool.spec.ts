import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gotoApp } from "./helpers";

// ── Photoshop Artboard tool (⇧V) ───────────────────────────────────
// Adobe: the Artboard tool drags new artboards (bounded, white-backed canvases),
// selects them, moves them (carrying their layers), resizes them, and deletes
// them. In Monet Vision an artboard is a kind=6 container whose [x,y,w,h]
// adj_params (len 4 → white bg + clip) the compositor renders; the tool drives
// engine new_artboard_rect / set_artboard_bounds / delete_artboard, with the pure
// geometry in src/state/artboardTool.ts (unit-tested).
//   https://helpx.adobe.com/photoshop/using/artboards.html

const DOC = 200; // square document → uniform doc→client mapper

// The doc→client mapper from the live canvas geometry. Re-read it right before a
// pointer-precise drag — the options bar reflows as artboards are added/selected,
// which can shift the canvas, so a mapper captured earlier may be stale.
async function mapper(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOC, cy: (d: number) => box.y + d * box.h / DOC };
}

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate((n) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(n, n, "artboard");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 0, 0, 255); E.select_none(); // black base
    mv.engine.commit();
    mv.store.setTool("artboard");
    mv.store.fit();
  }, DOC);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  return mapper(page);
}

const drag = async (page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, ax: number, ay: number, bx: number, by: number) => {
  await page.mouse.move(m.cx(ax), m.cy(ay));
  await page.mouse.down();
  await page.mouse.move(m.cx(bx), m.cy(by), { steps: 8 });
  await page.mouse.up();
};

const artboardCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.engine.engine.artboard_count());
const artboards = (page: Page): Promise<{ id: number; x: number; y: number; w: number; h: number; name: string }[]> =>
  page.evaluate(() => (window as any).__mv.store.state.artboards);
const selectionState = (page: Page) => page.evaluate(() => {
  const state = (window as any).__mv.store.state;
  return { artboard: state.selectedArtboard, active: state.activeLayerId, selected: [...state.selectedLayerIds] };
});
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}
const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240 && p[3] > 200;
const isBlack = (p: number[]) => p[0] < 30 && p[1] < 30 && p[2] < 30 && p[3] > 200;

// ── a drag on empty canvas creates a white-backed artboard ──
test("an Artboard-tool drag creates a new artboard (count increases)", async ({ page }) => {
  const m = await scene(page);
  expect(await artboardCount(page)).toBe(0);
  await drag(page, m, 40, 40, 140, 120); // 100×80 artboard at (40,40)
  expect(await artboardCount(page)).toBe(1);
  const a = (await artboards(page))[0];
  expect(Math.abs(a.x - 40)).toBeLessThan(3);
  expect(Math.abs(a.y - 40)).toBeLessThan(3);
  expect(Math.abs(a.w - 100)).toBeLessThan(3);
  expect(Math.abs(a.h - 80)).toBeLessThan(3);
  // white artboard background inside the bounds; black base outside it
  expect(isWhite(await pixel(page, a.x + a.w / 2, a.y + a.h / 2))).toBe(true);
  expect(isBlack(await pixel(page, 4, 4))).toBe(true);
  // the new artboard is the sole selection in both models
  expect(await selectionState(page)).toEqual({ artboard: a.id, active: a.id, selected: [a.id] });
});

// ── a tiny drag (a click) creates nothing ──
test("an Artboard-tool click (no drag) creates nothing", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(60), m.cy(60));
  expect(await artboardCount(page)).toBe(0);
});

// ── moving an artboard's body relocates it and its child layers ──
test("dragging an artboard body moves it (with its layers), and undo restores it", async ({ page }) => {
  await scene(page);
  // an artboard wrapping a red block, created at the model level
  const id = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    mv.store.addLayer();
    E.select_rect(60, 60, 20, 20, 0); E.fill_selection(220, 30, 30, 255); E.select_none();
    mv.engine.commit();
    const ab = E.new_artboard(40, 40, 100, 80, "Artboard 1"); // wraps the red block
    mv.engine.commit();
    mv.store.setSelectedArtboard(ab);
    return ab;
  });
  const before = (await artboards(page)).find((a) => a.id === id)!;
  expect(before.x).toBe(40);
  // red shows at the block centre inside the artboard
  const redAt = async (x: number, y: number) => {
    const p = await pixel(page, x, y);
    return p[0] > 150 && p[1] < 110 && p[2] < 110;
  };
  expect(await redAt(70, 70)).toBe(true);

  // grab the artboard body (well inside) and drag +40,+20 (re-measure first)
  const m2 = await mapper(page);
  await drag(page, m2, 70, 70, 110, 90);
  const after = (await artboards(page)).find((a) => a.id === id)!;
  expect(Math.abs(after.x - 80)).toBeLessThan(5);
  expect(Math.abs(after.y - 60)).toBeLessThan(5);
  expect(after.w).toBe(before.w); // size unchanged → a move, not a resize
  expect(after.h).toBe(before.h);
  // the child red block moved with the artboard (now near 110,90)
  expect(await redAt(110, 90)).toBe(true);

  // undo restores the artboard's position
  await page.evaluate(() => (window as any).__mv.store.undo());
  const restored = (await artboards(page)).find((a) => a.id === id)!;
  expect(restored.x).toBe(40);
  expect(restored.y).toBe(40);
});

// ── resizing an artboard via its bottom-right handle changes its size only ──
test("dragging an artboard handle resizes it", async ({ page }) => {
  await scene(page);
  const id = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const ab = mv.engine.engine.new_artboard_rect(40, 40, 80, 60, "Artboard 1");
    mv.engine.commit();
    mv.store.setSelectedArtboard(ab);
    return ab;
  });
  expect(await page.evaluate(() => (window as any).__mv.store.state.selectedArtboard)).toBe(id);
  // BR handle sits at (120,100); drag it to (160,130). Re-measure first: selecting
  // the artboard may have reflowed the options bar (and shifted the canvas).
  const m2 = await mapper(page);
  await drag(page, m2, 120, 100, 160, 130);
  const a = (await artboards(page)).find((x) => x.id === id)!;
  expect(a.x).toBe(40); // origin unchanged
  expect(a.y).toBe(40);
  expect(Math.abs(a.w - 120)).toBeLessThan(5); // 40..160
  expect(Math.abs(a.h - 90)).toBeLessThan(5);  // 40..130
});

// ── Delete removes the selected artboard; undo brings it back ──
test("Delete removes the selected artboard and undo restores it", async ({ page }) => {
  const m = await scene(page);
  await drag(page, m, 40, 40, 140, 120);
  expect(await artboardCount(page)).toBe(1);
  await page.keyboard.press("Delete");
  expect(await artboardCount(page)).toBe(0);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await artboardCount(page)).toBe(1);
});

// ── clicking empty canvas deselects the active artboard ──
test("clicking empty canvas deselects the active artboard", async ({ page }) => {
  const m = await scene(page);
  await drag(page, m, 30, 30, 90, 90); // create + auto-select
  expect(await page.evaluate(() => (window as any).__mv.store.state.selectedArtboard)).toBeGreaterThan(0);
  await page.mouse.click(m.cx(170), m.cy(170)); // outside any artboard
  expect(await page.evaluate(() => (window as any).__mv.store.state.selectedArtboard)).toBe(0);
});

test("artboard and Layers selections stay synchronized", async ({ page }) => {
  const m = await scene(page);
  await drag(page, m, 40, 40, 140, 120);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const artboard = mv.store.state.artboards[0].id;
    const other = mv.store.state.layers.find((layer: any) => layer.id !== artboard).id;
    mv.store.selectLayer(other);
    return { artboard, other };
  });
  expect(await selectionState(page)).toEqual({ artboard: 0, active: ids.other, selected: [ids.other] });

  await page.evaluate((artboard) => (window as any).__mv.store.toggleLayerInSelection(artboard), ids.artboard);
  expect(await selectionState(page)).toEqual({ artboard: ids.artboard, active: ids.artboard, selected: [ids.other, ids.artboard] });
  await page.evaluate((artboard) => (window as any).__mv.store.toggleLayerInSelection(artboard), ids.artboard);
  expect(await selectionState(page)).toEqual({ artboard: 0, active: ids.other, selected: [ids.other] });

  const m2 = await mapper(page);
  await page.mouse.click(m2.cx(90), m2.cy(80));
  expect(await selectionState(page)).toEqual({ artboard: ids.artboard, active: ids.artboard, selected: [ids.artboard] });

  const pending = page.waitForEvent("download");
  await page.evaluate(() => (window as any).__mv.commandPalette.items
    .find((item: any) => item.label === "Layer ▸ Quick Export as PNG").run());
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const artboard = (await artboards(page)).find((item) => item.id === ids.artboard)!;
  expect(download.suggestedFilename()).toBe("Artboard_1.png");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([artboard.w, artboard.h]);
});

// ── the options bar exposes size presets + orientation and renders the overlay ──
test("the Artboard options bar switches orientation and the overlay draws handles", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-artboard-preset")).toBeVisible();
  await expect(page.getByText("Landscape", { exact: true })).toBeVisible();
  await page.getByText("Portrait", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.artboardOrientation)).toBe("portrait");

  // "Add Artboard" makes a preset-sized artboard
  await page.locator("#mv-artboard-add").click();
  expect(await artboardCount(page)).toBe(1);

  // a selected artboard renders its rect + 8 resize handles in the overlay
  const id = (await artboards(page))[0].id;
  await page.evaluate((i) => (window as any).__mv.store.setSelectedArtboard(i), id);
  await expect(page.locator(`[data-mv-artboard-rect="${id}"]`)).toHaveCount(1);
  await expect(page.locator("[data-mv-artboard-handle]")).toHaveCount(8);

  // selecting one shows its dimensions + a Delete button in the options bar
  await expect(page.locator("[data-mv-artboard-dims]")).toBeVisible();
  await page.locator("#mv-artboard-delete").click();
  expect(await artboardCount(page)).toBe(0);
});

// ── Shift+V toggles the Move/Artboard pair without disturbing plain V ──
test("Shift+V toggles Move and Artboard", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(200, 200, "tog"); mv.store.setTool("move"); });
  const tool = () => page.evaluate(() => (window as any).__mv.store.state.tool as string);
  await page.keyboard.press("Shift+V");
  expect(await tool()).toBe("artboard");
  await page.keyboard.press("Shift+V");
  expect(await tool()).toBe("move");
  await page.keyboard.press("v"); // plain V still selects Move
  expect(await tool()).toBe("move");
});
