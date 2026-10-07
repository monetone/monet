import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Mixer Brush (brush mode 11) ─────────────────────────
// Wet-media paint: the brush carries a paint reservoir and blends it with the
// canvas colours it drags through. Wet = how much canvas colour it picks up
// (the smear rate), Load = how much foreground paint the reservoir starts with,
// Mix = reservoir-vs-canvas per deposit. Tools are armed via the store (so the
// test exercises pushBrush's mode mapping + set_mixer_params) and painted via
// the engine FFI at fixed doc coords for determinism.
// https://helpx.adobe.com/photoshop/using/painting-mixer-brush.html

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

// A red|blue split doc. Arm `tool` + `brush`, then drag a horizontal stroke from
// deep in the red region across the seam into the blue region.
async function strokeAcrossBoundary(page: Page, opts: {
  tool: string; brush: Record<string, number | boolean>;
}) {
  await page.evaluate((o) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 60, "mixer");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 60, 0); E.fill_selection(220, 30, 30, 255);  // A: red (left)
    E.select_rect(40, 0, 40, 60, 0); E.fill_selection(30, 30, 220, 255); // B: blue (right)
    E.select_none();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });                   // black fg
    mv.engine.commit();
    mv.store.setTool(o.tool);
    mv.store.setBrush(o.brush);
    E.stroke_begin();
    for (let x = 5; x <= 75; x += 2) E.stroke_to(x, 30, 1);
    E.stroke_end();
    E.composite();
  }, opts);
}

test("the Mixer Brush blends two canvas colours across a boundary (a midtone appears)", async ({ page }) => {
  await gotoApp(page);
  // Wet pickup (load 0 → reservoir samples the canvas; mix 1 → it deposits what
  // it carries) drags red across the seam into the blue region.
  await strokeAcrossBoundary(page, {
    tool: "mixerbrush",
    brush: { size: 16, hardness: 1, flow: 1, opacity: 1, mixerWet: 0.6, mixerLoad: 0, mixerMix: 1 },
  });
  const [r, , b] = await rgba(page, 43, 30); // just inside the blue region
  // A red/blue midtone: red was carried in (well above the blue field's 30) while
  // the blue canvas colour is retained — the two colours blended.
  expect(r).toBeGreaterThan(70);
  expect(b).toBeGreaterThan(70);
});

test("a plain Brush does NOT blend the canvas colours (it lays the solid foreground)", async ({ page }) => {
  await gotoApp(page);
  await strokeAcrossBoundary(page, {
    tool: "brush",
    brush: { size: 16, hardness: 1, flow: 1, opacity: 1 },
  });
  const [r, g, b] = await rgba(page, 43, 30); // same spot, just inside blue
  // The plain brush paints the (black) foreground — no red carried in, no midtone.
  expect(r).toBeLessThan(40);
  expect(g).toBeLessThan(40);
  expect(b).toBeLessThan(40);
});

test("Undo restores the canvas after a Mixer Brush stroke", async ({ page }) => {
  await gotoApp(page);
  await strokeAcrossBoundary(page, {
    tool: "mixerbrush",
    brush: { size: 16, hardness: 1, flow: 1, opacity: 1, mixerWet: 0.6, mixerLoad: 0, mixerMix: 1 },
  });
  const smeared = await rgba(page, 43, 30);
  expect(smeared[0]).toBeGreaterThan(70); // confirm the stroke landed
  await page.evaluate(() => { (window as any).__mv.store.undo(); (window as any).__mv.engine.engine.composite(); });
  const [r, , b] = await rgba(page, 43, 30);
  // Back to the pristine blue field (red ≈ 30, blue ≈ 220).
  expect(r).toBeLessThan(60);
  expect(b).toBeGreaterThan(180);
});

test("the Mixer Brush is reachable from the Brush flyout group and via Shift+B", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { (window as any).__mv.store.newDocument(40, 40, "g"); });
  // It joined the Brush flyout slot (Brush ▸ Pencil ▸ Color Replacement ▸ Mixer).
  const brush = page.locator('[data-tool-group="grp-brush"]');
  await brush.waitFor();
  await brush.click({ button: "right" });
  await page.locator('[data-flyout-tool="mixerbrush"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("mixerbrush");
  // Shift+B cycles the brush group; from the Mixer Brush it wraps back to Brush.
  await page.keyboard.press("Shift+B");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
});
