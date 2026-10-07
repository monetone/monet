import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Spot Healing Brush (heal group) ────────────────────────────────
// Adobe: the Spot Healing Brush removes a blemish by content-aware sampling of the
// SURROUNDINGS of the painted spot — no source point (that's the Healing Brush).
// Vision implements it as TS orchestration: the painted footprint becomes a
// temporary selection, spot_heal_selection() heals it through the options bar's
// Type + Sample All Layers, and the user's selection is restored.
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

const DOCW = 40;
const DOCH = 40;

// A green layer with a small red blemish at its centre; fits the view and returns
// a doc→client coordinate mapping for real mouse interaction.
async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "spotheal");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(0, 200, 0, 255); // uniform green field
    E.select_rect(18, 18, 4, 4, 0);
    E.fill_selection(220, 0, 0, 255); // a red blemish in the middle
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("spothealing");
    mv.store.setBrush({ size: 16 }); // a 16px disc covers the blemish
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const pick = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => {
    const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 };
  }, { x, y });

test("a canvas click heals the blemish from its surroundings", async ({ page }) => {
  const m = await setup(page);
  const before = await pick(page, 20, 20);
  expect(before.r).toBeGreaterThan(before.g); // the blemish starts red
  // Click the blemish with the Spot Healing tool (heal runs on pointer-up).
  await page.mouse.move(m.cx(20), m.cy(20));
  await page.mouse.down();
  await page.mouse.up();
  const after = await pick(page, 20, 20);
  expect(after.g).toBeGreaterThan(after.r); // healed to the surrounding green
});

test("healing preserves an active, unrelated selection", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.select_rect(0, 0, 6, 6, 0); // an unrelated selection
    mv.engine.commit();
  });
  // Heal the blemish via the store action (over the centre).
  await page.evaluate(() => (window as any).__mv.store.spotHeal([20, 20], 8));
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
  expect(await page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds() as Int32Array)))
    .toEqual([0, 0, 6, 6]); // the snapshot/restore kept the user's selection
  // and the blemish was still healed
  const after = await pick(page, 20, 20);
  expect(after.g).toBeGreaterThan(after.r);
});

test("the Spot Healing tool offers its Type picker and Sample All Layers (#431)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("spothealing"));
  await expect(page.getByRole("radio", { name: "Content-Aware" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Create Texture" }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.spotHealType)).toBe(2);
  await page.getByRole("checkbox", { name: "Sample All Layers" }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.spotHealSampleAll)).toBe(true);
});

test("Remove tool falls back to the classic heal when MI-GAN is absent", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "remove-fallback");
    const E = mv.engine.engine; // bind AFTER newDocument — it swaps the wasm engine
    E.select_all(); E.fill_selection(40, 200, 40, 255); E.select_none();
    // a red blemish the stroke should remove
    E.select_rect(14, 14, 4, 4, 0); E.fill_selection(220, 30, 30, 255); E.select_none();
    mv.engine.commit();
    const before = E.pick_color(16, 16) >>> 0;
    await mv.removeStroke([16, 16], 6); // dev server has no MI-GAN → classic heal path
    const after = E.pick_color(16, 16) >>> 0;
    return { before, after };
  });
  expect(r.before).not.toBe(r.after); // the blemish was healed from surroundings
});
