import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop eraser group ▸ Magic Eraser ──────────────────────────
// Adobe: the Magic Eraser erases all pixels similar to the clicked one to
// transparency in one step (Tolerance / Contiguous / Sample All Layers / Opacity)
// and, unlike the Magic Wand, leaves NO selection. Vision adds it via an engine
// magic_eraser that floods into a temp selection then erases the active layer.
// The pixel maths is covered by a Rust test; this covers the options, that the op
// reaches the canvas, and a real mouse click.
//   https://helpx.adobe.com/photoshop/using/erasing.html

const DOCW = 160;
const DOCH = 120;

const alphaAt = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) & 255, { x, y });

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "me");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(230, 20, 20, 255); // whole doc red
    E.select_none();
    E.composite();
    mv.engine.commit();
    mv.store.setTool("magiceraser");
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

// ── UI: the options bar + store defaults ───────────────────────────
test("the Magic Eraser tool exposes Tolerance / Contiguous / Sample All Layers / Opacity", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("magiceraser"));
  await expect(page.getByText("Tolerance", { exact: true })).toBeVisible();
  const contig = page.getByRole("checkbox", { name: "Contiguous" });
  const sampleAll = page.getByRole("checkbox", { name: "Sample All Layers" });
  await expect(contig).toBeVisible();
  await expect(sampleAll).toBeVisible();
  const opts = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { tol: s.magicEraserTolerance, contig: s.magicEraserContiguous, all: s.magicEraserSampleAll, op: s.magicEraserOpacity };
  });
  expect(opts).toEqual({ tol: 0.18, contig: true, all: false, op: 1 });
  // the Contiguous checkbox drives the store
  await contig.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.magicEraserContiguous)).toBe(false);
});

// ── Integration: magic_eraser through the engine FFI ───────────────
test("magic_eraser erases the similar region and leaves no selection", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "me");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 10, 20, 0);
    E.fill_selection(255, 0, 0, 255); // left half red
    E.select_rect(10, 0, 10, 20, 0);
    E.fill_selection(0, 0, 255, 255); // right half blue
    E.select_none();
    E.composite();
    E.magic_eraser(2, 10, 0.1, true, false, 1.0); // click the red half
    E.composite();
    const a = (x: number, y: number) => (E.pick_color(x, y) >>> 0) & 255;
    return { red: a(2, 10), blue: a(15, 10), hasSel: E.has_selection() };
  });
  expect(r.red).toBe(0); // red region erased to transparent
  expect(r.blue).toBeGreaterThan(250); // blue region untouched (opaque)
  expect(r.hasSel).toBe(false); // no marquee left
});

// ── Mouse: a real Magic Eraser click erases ────────────────────────
test("a real Magic Eraser click erases where clicked", async ({ page }) => {
  const m = await setup(page);
  expect(await alphaAt(page, 80, 60)).toBeGreaterThan(250); // opaque red before
  await page.mouse.click(m.cx(80), m.cy(60));
  expect(await alphaAt(page, 80, 60)).toBe(0); // erased to transparent
});
