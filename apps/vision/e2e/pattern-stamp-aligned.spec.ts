import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// ── Photoshop Pattern Stamp ▸ Aligned ──────────────────────────────
// Adobe: with Aligned on (default) the pattern tiles continuously to the canvas
// across every stroke; with it off, each new stroke re-anchors the pattern so it
// starts fresh at the stroke's start point. Vision only ever tiled to the canvas
// origin. The engine tiling offset is verified in Rust; here we assert the
// store→CanvasView→engine wiring: a real drag with Aligned off shifts the tiling.
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

const DOCW = 160;
const DOCH = 120;

// Fresh doc + an 8×8 two-tone pattern (left 4 cols red, right 4 blue), a paint
// layer, the Pattern Stamp tool with the given Aligned setting; then drag a
// horizontal stroke starting at doc (10,60) — not a multiple of 8, so aligned
// (origin 0) and off (origin 10) tile to different boundaries. Returns the
// composite checksum.
async function dragPatternChk(page: Page, aligned: boolean): Promise<number> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "pa"), { w: DOCW, h: DOCH });
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(0, 0, 8, 8, 0); E.fill_selection(0, 0, 200, 255); // blue tile
    E.select_rect(0, 0, 4, 8, 0); E.fill_selection(200, 0, 0, 255); // left half red
    E.select_rect(0, 0, 8, 8, 0); E.define_pattern();
    E.select_none(); E.composite();
  });
  await page.evaluate((al) => {
    const mv = (window as any).__mv;
    mv.engine.engine.add_layer("paint");
    mv.store.setBrush({ size: 14, hardness: 1, smoothing: 0 });
    mv.store.setTool("patternstamp");
    mv.store.setOptions({ patternAligned: al });
    mv.store.fit();
  }, aligned);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / DOCW;
  const cy = (d: number) => box.y + d * box.h / DOCH;
  await page.mouse.move(cx(10), cy(60));
  await page.mouse.down();
  await page.mouse.move(cx(120), cy(60), { steps: 6 });
  await page.mouse.up();
  return (await composite(page)).chk;
}

test("the Pattern Stamp options bar offers an Aligned toggle that drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("patternstamp"));
  const box = page.getByRole("checkbox", { name: "Aligned" });
  await expect(box).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.patternAligned)).toBe(true);
  await box.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.patternAligned)).toBe(false);
});

test("Aligned off re-anchors the pattern to the stroke, shifting the tiling", async ({ page }) => {
  const aligned = await dragPatternChk(page, true);
  const off = await dragPatternChk(page, false);
  expect(aligned).not.toBe(off); // the same drag tiles differently → wiring reached the engine
});
