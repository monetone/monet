import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Paint Bucket "All Layers" ────────────────────────────
// Adobe spec (helpx "Fill areas with Paint Bucket"): with All Layers unchecked
// (default) the bucket's fill region is computed from the ACTIVE layer; checked,
// it's computed from the merged visible image (the fill is still painted onto the
// active layer). The app's bucket only ever sampled the active layer.
//
//   https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

// Active (top) layer uniform grey @ 50% over red|blue halves → merged is
// reddish-left/bluish-right. Foreground = red (the bucket fill colour).
async function setupMultiLayer(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "bal");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(220, 40, 40, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(40, 60, 220, 255);
    E.select_none();
    const top = E.add_layer("top");
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    E.set_layer_opacity(top, 0.5);
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red fill
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

// ── Integration: the all_layers flag through the engine FFI ────────
test("bucket_fill computes its region from the active layer or the merged image", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const build = () => {
      mv.store.newDocument(20, 20, "b");
      const E = mv.engine.engine;
      E.select_rect(0, 0, 10, 20, 0); E.fill_selection(255, 0, 0, 255);
      E.select_rect(10, 0, 10, 20, 0); E.fill_selection(0, 0, 255, 255);
      E.select_none();
      const top = E.add_layer("top");
      E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
      E.set_layer_opacity(top, 0.5);
      return E;
    };
    const E1 = build(); E1.bucket_fill(5, 10, 0, 255, 0, 255, 0.1, true, false, 0, 1); E1.composite();
    const off = ((E1.pick_color(15, 10) >>> 0) >>> 16) & 255; // green channel, right side
    const E2 = build(); E2.bucket_fill(5, 10, 0, 255, 0, 255, 0.1, true, true, 0, 1); E2.composite();
    const on = ((E2.pick_color(15, 10) >>> 0) >>> 16) & 255;
    return { off, on };
  });
  // top is at 50% opacity, so filled-green reads ~128 vs untouched-grey-over-blue ~64.
  expect(r.off).toBeGreaterThan(100); // active layer uniform → whole filled → right is greenish
  expect(r.on).toBeLessThan(95);      // merged reddish|bluish → only the left filled → right untouched
});

// ── Mouse: a real bucket click honours All Layers ──────────────────
test("bucket click fills the whole uniform active layer (off) vs only the merged region (on)", async ({ page }) => {
  // OFF: the active layer is uniform grey → the whole canvas fills with red
  const m1 = await setupMultiLayer(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ fillSampleAllLayers: false }));
  await page.mouse.click(m1.cx(50), m1.cy(70));
  expect((await pixel(page, 150, 70))[0]).toBeGreaterThan(100); // right side is reddish too (filled @50%)

  // ON: the merged image floods only the reddish-left half → right stays bluish
  const m2 = await setupMultiLayer(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ fillSampleAllLayers: true }));
  await page.mouse.click(m2.cx(50), m2.cy(70));
  const right = await pixel(page, 150, 70);
  expect(right[0]).toBeLessThan(95);         // not red — untouched
  expect(right[2]).toBeGreaterThan(right[0]); // still bluish
});

// ── UI: the bucket's All Layers checkbox ───────────────────────────
test("the bucket offers an All Layers checkbox (off by default)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("bucket"));
  const cb = page.getByRole("checkbox", { name: "All Layers", exact: true });
  await expect(cb).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillSampleAllLayers)).toBe(false);
  await cb.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.fillSampleAllLayers)).toBe(true);
});
