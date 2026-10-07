import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop focus + tonal brushes ───────────────────────────────
// Sponge (saturate/desaturate), Blur, Sharpen, and Background Eraser. Each is a
// brush-engine mode in Vision (8/9/10/7) wired through the Brush stroke path.
// Tools are armed via the store (exercising pushBrush's mode mapping + the engine
// option setters) and painted via the engine FFI at fixed doc coords for
// determinism. https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

// Fill the whole doc with one colour, arm `tool` + `brush`, paint a stroke through
// the given doc points, then composite. Returns nothing — read pixels after.
async function paint(page: Page, opts: {
  w: number; h: number; fill?: [number, number, number];
  bands?: Array<[number, number, number, number, number]>; // x,w,r,g,b for vertical bands
  tool: string; brush: Record<string, number | boolean>;
  points: Array<[number, number]>;
}) {
  await page.evaluate((o) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(o.w, o.h, "focus");
    const E = mv.engine.engine;
    if (o.fill) { E.select_all(); E.fill_selection(o.fill[0], o.fill[1], o.fill[2], 255); E.select_none(); }
    for (const [x, w, r, g, b] of o.bands ?? []) { E.select_rect(x, 0, w, o.h, 0); E.fill_selection(r, g, b, 255); }
    E.select_none();
    mv.engine.commit();
    // Arm the tool + brush via the store so pushBrush pushes the mode + the engine
    // option setters (set_sponge_options / set_blur_options / …) to wasm.
    mv.store.setTool(o.tool);
    mv.store.setBrush(o.brush);
    E.stroke_begin();
    for (const [px, py] of o.points) E.stroke_to(px, py, 1);
    E.stroke_end();
    E.composite();
  }, opts);
}

test("Sponge (Desaturate) washes the colour toward grey", async ({ page }) => {
  await gotoApp(page);
  await paint(page, {
    w: 80, h: 60, fill: [200, 40, 40], tool: "sponge",
    brush: { size: 40, hardness: 1, flow: 1, opacity: 1, spongeMode: 1, spongeRate: 1, spongeVibrance: false },
    points: [[40, 30]],
  });
  const [r, g, b] = await rgba(page, 40, 30);
  expect(Math.abs(r - g)).toBeLessThan(30); // R≈G≈B → neutral
  expect(Math.abs(r - b)).toBeLessThan(30);
  expect(b).toBeGreaterThan(120); // the muted channels (blue was 40) rose toward grey
});

test("Sponge (Saturate) intensifies a muted colour", async ({ page }) => {
  await gotoApp(page);
  await paint(page, {
    w: 80, h: 60, fill: [150, 120, 120], tool: "sponge",
    brush: { size: 40, hardness: 1, flow: 1, opacity: 1, spongeMode: 0, spongeRate: 1, spongeVibrance: false },
    points: [[40, 30]],
  });
  const [r, , b] = await rgba(page, 40, 30);
  expect(r - b).toBeGreaterThan(30); // the red/blue gap widens (more saturated) vs the input's 30
});

test("Sponge Vibrance protects an already-colourful pixel from oversaturating", async ({ page }) => {
  // Saturate the same mid-saturated red twice: Vibrance OFF drives it hard toward
  // full saturation (blue clips low), while Vibrance ON (Photoshop's default)
  // moderates the boost so the colourful pixel is protected from clipping.
  const sat = { w: 80, h: 60, fill: [200, 80, 80] as [number, number, number], tool: "sponge", points: [[40, 30]] as Array<[number, number]> };
  await gotoApp(page);
  await paint(page, { ...sat, brush: { size: 40, hardness: 1, flow: 1, opacity: 1, spongeMode: 0, spongeRate: 1, spongeVibrance: false } });
  const off = await rgba(page, 40, 30);
  await gotoApp(page);
  await paint(page, { ...sat, brush: { size: 40, hardness: 1, flow: 1, opacity: 1, spongeMode: 0, spongeRate: 1, spongeVibrance: true } });
  const on = await rgba(page, 40, 30);
  expect(off[2]).toBeLessThan(on[2] - 10); // OFF pushes blue much lower (more saturated)
  expect(on[0] - on[2]).toBeGreaterThan(0); // ON still saturates (red stays above blue)
});

test("the Sponge options bar exposes Vibrance, on by default, driving the store", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("sponge"));
  const cb = page.getByRole("checkbox", { name: "Vibrance" });
  await expect(cb).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.spongeVibrance)).toBe(true);
  await cb.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.spongeVibrance)).toBe(false);
});

test("Blur pulls a hard seam toward the local mean", async ({ page }) => {
  await gotoApp(page);
  await paint(page, {
    w: 80, h: 60, bands: [[0, 40, 0, 0, 0], [40, 40, 255, 255, 255]], tool: "blur",
    brush: { size: 24, hardness: 1, flow: 1, opacity: 1, blurRate: 1 },
    points: [[40, 30]],
  });
  const [r] = await rgba(page, 37, 30); // dark side, just inside the seam
  expect(r).toBeGreaterThan(30); // lifted off pure black toward grey
});

test("Sharpen increases contrast across a seam", async ({ page }) => {
  await gotoApp(page);
  await paint(page, {
    w: 80, h: 60, bands: [[0, 40, 110, 110, 110], [40, 40, 150, 150, 150]], tool: "sharpen",
    brush: { size: 30, hardness: 1, flow: 1, opacity: 1, sharpenRate: 1, sharpenProtect: false },
    points: [[40, 30]],
  });
  const light = (await rgba(page, 45, 30))[0]; // lighter side pushed lighter
  const dark = (await rgba(page, 35, 30))[0];  // darker side pushed darker
  expect(light).toBeGreaterThan(152);
  expect(dark).toBeLessThan(108);
});

test("Background Eraser erases the sampled colour only, keeping the rest", async ({ page }) => {
  await gotoApp(page);
  await paint(page, {
    w: 80, h: 60, bands: [[0, 40, 220, 30, 30], [40, 40, 30, 200, 30]], tool: "backgrounderaser",
    brush: { size: 80, hardness: 1, flow: 1, opacity: 1, bgEraserTolerance: 0.25, bgEraserProtectFg: false },
    points: [[5, 30], [75, 30]], // first dab samples the red background
  });
  const redA = (await rgba(page, 12, 30))[3];
  const greenA = (await rgba(page, 68, 30))[3];
  expect(redA).toBeLessThan(12);     // matching (red) erased to transparency
  expect(greenA).toBeGreaterThan(240); // non-matching (green) kept opaque
});

test("the new tools are reachable from their toolbar flyout groups", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { (window as any).__mv.store.newDocument(40, 40, "g"); });
  // The PS R-group (Blur/Sharpen/Smudge) is a new flyout slot.
  const focus = page.locator('[data-tool-group="grp-focus"]');
  await focus.waitFor();
  await focus.click({ button: "right" });
  await page.locator('[data-flyout-tool="sharpen"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("sharpen");
  // Sponge joined the Dodge group; Background Eraser joined the Eraser group.
  await page.locator('[data-tool-group="grp-dodge"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="sponge"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("sponge");
});
