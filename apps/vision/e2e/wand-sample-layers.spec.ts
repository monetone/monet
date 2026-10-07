import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Magic Wand "Sample All Layers" ───────────────────────
// Adobe spec (helpx / photoshopessentials): by DEFAULT the Magic Wand evaluates
// only the active layer; the "Sample All Layers" checkbox (unchecked by default)
// makes it sample the merged visible image instead. The app always sampled the
// composite — wrong default + missing option; this fixes both.
//
//   https://www.photoshopessentials.com/basics/selections/magic-wand-tool/

const DOCW = 200;
const DOCH = 140;

const bounds = (page: Page) => page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);

// A doc whose ACTIVE (top) layer is uniform but whose MERGED image is varied:
// bottom red|blue halves, top a uniform 50%-opacity grey. So the active layer
// floods the whole canvas, but the merged image only floods one half.
async function setupMultiLayer(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "wsl");
    const E = mv.engine.engine; // AFTER newDocument
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(220, 40, 40, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(40, 60, 220, 255);
    E.select_none();
    const top = E.add_layer("top");
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    E.set_layer_opacity(top, 0.5);
    mv.engine.commit();
    mv.store.setTool("wand");
    mv.store.setOptions({ wandTolerance: 0.1, wandContiguous: true, antiAlias: false });
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
test("magic_wand samples the active layer or the merged image per the flag", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "w");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 10, 20, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(10, 0, 10, 20, 0); E.fill_selection(0, 0, 255, 255);
    E.select_none();
    const top = E.add_layer("top");
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    E.set_layer_opacity(top, 0.5);
    E.set_selection_antialias(false);
    E.magic_wand(5, 10, 0.1, true, 0, false); // active layer (uniform) → whole
    const current = Array.from(E.selection_bounds());
    E.select_none();
    E.magic_wand(5, 10, 0.1, true, 0, true); // merged → left half only
    const all = Array.from(E.selection_bounds());
    return { current, all };
  });
  expect(r.current).toEqual([0, 0, 20, 20]); // active layer is uniform → floods all
  expect(r.all).toEqual([0, 0, 10, 20]);     // merged is reddish|bluish → left half
});

// ── Mouse: a real wand click honours Sample All Layers ─────────────
test("wand click samples the active layer (off) vs the merged image (on)", async ({ page }) => {
  const m = await setupMultiLayer(page);

  // default OFF → the active (uniform) layer floods the whole canvas
  await page.evaluate(() => (window as any).__mv.store.setOptions({ wandSampleAllLayers: false }));
  await page.mouse.click(m.cx(50), m.cy(70));
  expect((await bounds(page))[2]).toBeGreaterThan(180); // ~full width

  // ON → the merged image floods only the left (reddish) half
  await page.evaluate(() => { const mv = (window as any).__mv; mv.engine.engine.select_none(); mv.store.setOptions({ wandSampleAllLayers: true }); });
  await page.mouse.click(m.cx(50), m.cy(70));
  expect((await bounds(page))[2]).toBeLessThan(130); // ~half width
});

// ── UI: the Sample All Layers checkbox ─────────────────────────────
test("the wand offers Sample All Layers (off by default; bucket has none)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("wand"));
  const cb = page.getByRole("checkbox", { name: "Sample All Layers" });
  await expect(cb).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.wandSampleAllLayers)).toBe(false); // PS default
  await cb.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.wandSampleAllLayers)).toBe(true);

  await page.evaluate(() => (window as any).__mv.store.setTool("bucket"));
  await expect(page.getByRole("checkbox", { name: "Sample All Layers" })).toHaveCount(0);
});
