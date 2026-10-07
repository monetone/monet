import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Paint Bucket ▸ Fill: Pattern ─────────────────────────
// Adobe spec (helpx "Fill areas with the Paint Bucket"): the Paint Bucket options
// bar has a Fill dropdown (Foreground / Pattern); with Pattern selected the tool
// floods the matched region with the defined pattern (tiled, canvas-aligned)
// instead of a solid colour. The app's bucket only ever filled a solid colour.
//   https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html

const DOCW = 120;
const DOCH = 80;

async function px(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[1] < 60 && p[2] < 60;
const isBlue = (p: number[]) => p[2] > 180 && p[0] < 60;
const isYellow = (p: number[]) => p[0] > 180 && p[1] > 180 && p[2] < 60;

// Define a 2×2 red/green/blue/yellow pattern, then flood the doc white so the
// bucket has a single uniform region to fill. Returns a doc→client mapping.
async function patternDoc(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "bp");
    const E = mv.engine.engine;
    const dot = (x: number, y: number, r: number, g: number, b: number) => { E.select_rect(x, y, 1, 1, 0); E.fill_selection(r, g, b, 255); };
    dot(0, 0, 220, 0, 0); dot(1, 0, 0, 220, 0); dot(0, 1, 0, 0, 220); dot(1, 1, 220, 220, 0);
    E.select_rect(0, 0, 2, 2, 0);
    mv.engine.commit();
    mv.store.definePattern();
    mv.store.deselect();
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); // uniform white region
    mv.engine.commit();
    mv.store.setTool("bucket");
    mv.store.setOptions({ fillTolerance: 0.1, fillContiguous: true });
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

test("bucket_fill_pattern floods the region with the tiled pattern (engine)", async ({ page }) => {
  await patternDoc(page);
  await page.evaluate(() => (window as any).__mv.engine.engine.bucket_fill_pattern(40, 30, 0.1, false, false, 0, 1));
  expect(isRed(await px(page, 0, 0))).toBe(true);
  expect(isYellow(await px(page, 1, 1))).toBe(true);
  expect(isRed(await px(page, 2, 0))).toBe(true);   // tile repeats every 2px
  expect(isBlue(await px(page, 4, 5))).toBe(true);  // tile (0,1) = blue
});

test("a real bucket click with Fill = Pattern tiles the pattern", async ({ page }) => {
  const m = await patternDoc(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ fillSource: "pattern" }));
  await page.mouse.click(m.cx(40), m.cy(30));
  expect(isRed(await px(page, 0, 0))).toBe(true);
  expect(isYellow(await px(page, 1, 1))).toBe(true);
});

test("Fill = Foreground still fills a solid colour (routing)", async ({ page }) => {
  const m = await patternDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red
    mv.store.setOptions({ fillSource: "foreground" });
  });
  await page.mouse.click(m.cx(40), m.cy(30));
  // Solid red everywhere — no yellow/blue tiles.
  expect(isRed(await px(page, 0, 0))).toBe(true);
  expect(isRed(await px(page, 1, 1))).toBe(true);
});

test("the bucket options bar offers a Fill source dropdown (Foreground default)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("bucket"));
  const sel = page.locator("#mv-bucket-source");
  await expect(sel).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillSource)).toBe("foreground");
  await chooseOption(sel, "pattern");
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillSource)).toBe("pattern");
});
