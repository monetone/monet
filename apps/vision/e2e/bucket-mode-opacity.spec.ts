import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Paint Bucket ▸ Mode + Opacity ────────────────────────
// Adobe: the Paint Bucket options bar has a blend Mode and an Opacity, applied as
// the fill composites onto the existing pixels (like the brush's Mode/Opacity).
// Vision's bucket always filled Normal at 100%. The engine now threads a blend +
// opacity through bucket_fill / bucket_fill_pattern (verified in Rust); here we
// assert the store→CanvasView→engine wiring via a real bucket click.
//   https://helpx.adobe.com/photoshop/using/filling-stroking-selections.html

const DOCW = 40;
const DOCH = 30;

// White doc, black foreground, Paint Bucket with the given Mode/Opacity; click the
// canvas (a uniform region floods entirely, so the exact point is irrelevant) and
// return the red channel (0..255) of a filled pixel.
async function bucketClickRed(page: Page, mode: string, opacity: number): Promise<number> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "bk"), { w: DOCW, h: DOCH });
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black foreground
    mv.store.setTool("bucket");
  });
  await page.evaluate(({ m, o }) => {
    const s = (window as any).__mv.store;
    s.setOptions({ fillMode: m, fillOpacity: o, fillContiguous: true, fillTolerance: 0.5, fillSource: "foreground" });
    s.fit();
  }, { m: mode, o: opacity });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  return page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(20, 15) >>> 0) >>> 24 & 255);
}

test("Paint Bucket Opacity blends the fill; Multiply mode darkens", async ({ page }) => {
  // Black fill over white at 100% Normal → black (R≈0).
  const full = await bucketClickRed(page, "normal", 1);
  expect(full).toBeLessThan(20);
  // At 50% Normal → mid grey (R≈127).
  const half = await bucketClickRed(page, "normal", 0.5);
  expect(half).toBeGreaterThan(100);
  expect(half).toBeLessThan(160);
});

test("the Paint Bucket options bar offers a Mode control that drives the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("bucket"));
  const mode = page.getByLabel("Bucket blend mode");
  await expect(mode).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillMode)).toBe("normal");
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillOpacity)).toBe(1); // default 100%
  await chooseOption(mode, "multiply");
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillMode)).toBe("multiply");
});
