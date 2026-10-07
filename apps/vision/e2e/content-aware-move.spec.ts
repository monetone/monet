import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Content-Aware Move tool ─────────────────────────────
// Make a selection, then drag its CONTENTS to a new location: the object appears
// at the drop point AND the source region is content-aware-filled, so the object
// looks relocated in one undo step (engine content_aware_move(dx,dy)). Joins the
// Healing flyout group. This is DISTINCT from Patch, which heals the selection in
// place by sampling an offset region (the object never moves).
// https://helpx.adobe.com/photoshop/using/content-aware-move-tool.html

const DOCW = 60;
const DOCH = 40;

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

// Green field with a red object at doc (5..13, 5..13); the object is selected.
async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "camove");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none();
    E.select_rect(5, 5, 8, 8, 0); // selection active over the object
    E.fill_selection(220, 0, 0, 255);
    mv.engine.commit();
    mv.store.setTool("contentawaremove");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

test("contentAwareMoveBy relocates the object and content-aware-fills the source", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.contentAwareMoveBy(20, 0));
  // The object is now at the drop point (28,8)…
  const dst = await rgba(page, 28, 8);
  expect(dst[0]).toBeGreaterThan(150); // red
  expect(dst[1]).toBeLessThan(80);
  // …and the source (8,8) was content-aware-filled back to the green field.
  const src = await rgba(page, 8, 8);
  expect(src[0]).toBeLessThan(80);
  expect(src[1]).toBeGreaterThan(150); // green
});

test("a real Content-Aware Move drag moves the object; one undo restores it", async ({ page }) => {
  const m = await scene(page);
  // Drag the selection 20px right onto clean green, then release.
  await page.mouse.move(m.cx(9), m.cy(9));
  await page.mouse.down();
  await page.mouse.move(m.cx(19), m.cy(9));
  await page.mouse.move(m.cx(29), m.cy(9));
  await page.mouse.up();
  // The object relocated to the drop point and the source filled.
  let dst = await rgba(page, 28, 8);
  expect(dst[0]).toBeGreaterThan(140);
  expect(dst[1]).toBeLessThan(90);
  let src = await rgba(page, 8, 8);
  expect(src[0]).toBeLessThan(90);
  expect(src[1]).toBeGreaterThan(140);
  // A SINGLE undo restores the original: object back at the source, dest clean.
  await page.evaluate(() => (window as any).__mv.store.undo());
  src = await rgba(page, 8, 8);
  expect(src[0]).toBeGreaterThan(150); // red object back at the source
  expect(src[1]).toBeLessThan(80);
  dst = await rgba(page, 28, 8);
  expect(dst[1]).toBeGreaterThan(150); // destination is clean green again
});

// ── #429: Mode (Move / Extend), Structure, Color, Transform On Drop ─────────

type Scene = Awaited<ReturnType<typeof scene>>;
const labels = (page: Page) =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.history_labels()) as string[]);
const isRed = (p: number[]) => p[0] > 140 && p[1] < 90;
const isGreen = (p: number[]) => p[0] < 90 && p[1] > 140;

/** A real pointer drag between two doc points. */
async function drag(page: Page, m: Scene, from: [number, number], to: [number, number]) {
  await page.mouse.move(m.cx(from[0]), m.cy(from[1]));
  await page.mouse.down();
  await page.mouse.move(m.cx((from[0] + to[0]) / 2), m.cy((from[1] + to[1]) / 2));
  await page.mouse.move(m.cx(to[0]), m.cy(to[1]));
  await page.mouse.up();
}

test("the options bar offers Mode, Structure, Color and Transform On Drop", async ({ page }) => {
  await scene(page);
  await expect(page.getByRole("radio", { name: "Move", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Extend", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("slider", { name: "Structure", exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Color", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Transform On Drop" })).not.toBeChecked();
});

test("Extend copies the object instead of moving it, as one undo step", async ({ page }) => {
  const m = await scene(page);
  await page.getByRole("radio", { name: "Extend", exact: true }).click();
  await page.waitForFunction(() => (window as any).__mv.store.state.camExtend === true);
  const before = await labels(page);

  await drag(page, m, [9, 9], [29, 9]);

  expect(isRed(await rgba(page, 8, 8)), "the source keeps the object").toBe(true);
  expect(isRed(await rgba(page, 28, 8)), "a copy lands at the drop point").toBe(true);
  expect(await labels(page)).toEqual([...before, "Content-Aware Move"]);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(isGreen(await rgba(page, 28, 8))).toBe(true);
  expect(isRed(await rgba(page, 8, 8))).toBe(true);
});

test("Color pulls the dropped object toward its new surroundings", async ({ page }) => {
  const greenAt = async (color: number) => {
    const m = await scene(page);
    await page.evaluate((c) => (window as any).__mv.store.setOptions({ camColor: c }), color);
    await drag(page, m, [9, 9], [29, 9]);
    return (await rgba(page, 28, 8))[1];
  };
  const raw = await greenAt(0);
  const blended = await greenAt(10);
  expect(blended, `Color 10 (${blended}) vs Color 0 (${raw})`).toBeGreaterThan(raw + 40);
});

test("Structure decides how much of the dropped object's texture survives", async ({ page }) => {
  const contrastAt = async (structure: number) => {
    const m = await scene(page);
    await page.evaluate((s) => {
      const mv = (window as any).__mv;
      const E = mv.engine.engine;
      for (let y = 5; y < 13; y++) for (let x = 5; x < 13; x++) {
        const v = (x + y) % 2 ? 156 : 100; // a two-grey checker object
        E.select_rect(x, y, 1, 1, 0); E.fill_selection(v, v, v, 255);
      }
      E.select_rect(5, 5, 8, 8, 0);
      mv.engine.commit();
      mv.store.setOptions({ camStructure: s, camColor: 0 });
    }, structure);
    await drag(page, m, [9, 9], [29, 9]);
    return Math.abs((await rgba(page, 28, 8))[1] - (await rgba(page, 29, 8))[1]);
  };
  const hard = await contrastAt(7);
  const loose = await contrastAt(1);
  expect(hard, `Structure 7 (${hard}) vs Structure 1 (${loose})`).toBeGreaterThan(loose + 20);
});

/** Check Transform On Drop and drag the object 20px right; returns the history before the drag. */
async function openDropFrame(page: Page): Promise<{ m: Scene; before: string[] }> {
  const m = await scene(page);
  const before = await labels(page);
  await page.getByRole("checkbox", { name: "Transform On Drop" }).click();
  await page.waitForFunction(() => (window as any).__mv.store.state.camTransformOnDrop === true);
  await drag(page, m, [9, 9], [29, 9]);
  await expect(page.locator("[data-mv-camdrop-body]")).toBeVisible();
  return { m, before };
}

test("Transform On Drop leaves the drop in a live frame that commits as one undo step", async ({ page }) => {
  const { m, before } = await openDropFrame(page);
  await expect(page.locator("[data-mv-camdrop-handle]")).toHaveCount(8);
  expect(isRed(await rgba(page, 28, 8)), "the frame previews the drop").toBe(true);

  // Pull the bottom-right handle from (33,13) out to (39,19): the 8×8 box grows
  // to 14×14 with its top-left (25,5) pinned.
  const handle = await page.locator('[data-mv-camdrop-handle="4"]').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.cx(36), m.cy(16));
  await page.mouse.move(m.cx(39), m.cy(19));
  await page.mouse.up();
  await page.keyboard.press("Enter");

  await expect(page.locator("[data-mv-camdrop-body]")).toHaveCount(0);
  expect(isRed(await rgba(page, 35, 15)), "only the enlarged object covers (35,15)").toBe(true);
  expect(await labels(page)).toEqual([...before, "Content-Aware Move"]);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.history_transaction_active())).toBe(false);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(isRed(await rgba(page, 8, 8))).toBe(true);
  expect(isGreen(await rgba(page, 28, 8))).toBe(true);
});

test("Esc on the Transform On Drop frame leaves nothing applied", async ({ page }) => {
  const { before } = await openDropFrame(page);

  await page.keyboard.press("Escape");

  await expect(page.locator("[data-mv-camdrop-body]")).toHaveCount(0);
  expect(isRed(await rgba(page, 8, 8))).toBe(true);
  expect(isGreen(await rgba(page, 28, 8))).toBe(true);
  expect(await labels(page)).toEqual(before);
  expect(await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return { redo: E.redo_label(), open: E.history_transaction_active() };
  })).toEqual({ redo: "", open: false });
});

test("a panel click while the frame is open settles the drop first, so neither edit is lost", async ({ page }) => {
  const { before } = await openDropFrame(page);
  const layers = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count() as number);

  await page.locator('button.monet-iconbtn[title="Add layer"]').click();

  await expect(page.locator("[data-mv-camdrop-body]")).toHaveCount(0);
  await page.waitForFunction((n) => (window as any).__mv.engine.engine.layer_count() === n + 1, layers);
  // The committed move, then the panel's own step — neither rolled back.
  expect(await labels(page)).toEqual([...before, "Content-Aware Move", "New Layer"]);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.history_transaction_active())).toBe(false);
});

test("Content-Aware Move is reachable from the Healing flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-healing"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="contentawaremove"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("contentawaremove");
});

test("Shift+J cycles the Healing group onward to Content-Aware Move", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(40, 40, "g"); mv.store.setTool("patch"); });
  await page.keyboard.press("Shift+KeyJ"); // patch → contentawaremove
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("contentawaremove");
});
