import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Camera Raw / Histogram-panel Vectorscope ───────────────────────
// ACR 18.4 added a hue/saturation Vectorscope (right-click the Histogram →
// Show Vectorscope). Vision computes the n×n density grid in the SHARED render
// engine (packages/engine Engine.vectorscope — also used by monet-artisan) and
// draws it in src/state/vectorscope.ts. These tests exercise the real
// wasm↔JS binding, the right-click toggle, and the actual canvas paint.

/** Fresh 100×100 solid-red doc with the Histogram tab surfaced. */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "vscope");
    const E = mv.engine.engine; // after newDocument: the new doc's active engine
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="histogram"]').click();
}

test("engine.vectorscope returns a hue/sat grid with red in the upper half", async ({ page }) => {
  await scene(page);
  const res = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const n = 64;
    const g = Array.from(mv.engine.vectorscope(n) as Float32Array);
    let maxi = 0;
    for (let i = 1; i < g.length; i++) if (g[i] > g[maxi]) maxi = i;
    return { len: g.length, n, maxi, max: g[maxi], inRange: g.every((v: number) => v >= 0 && v <= 1) };
  });
  expect(res.len).toBe(res.n * res.n); // shared engine returns an n×n Float32Array
  expect(res.inRange).toBe(true);
  expect(res.max).toBeCloseTo(1, 5); // log-normalized peak
  expect(Math.floor(res.maxi / res.n)).toBeLessThan(res.n / 2); // red plots above centre
});

test("right-click the Histogram toggles the Vectorscope on and off", async ({ page }) => {
  await scene(page);
  await expect(page.locator("[data-mv-vectorscope-canvas]")).toHaveCount(0);
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show Vectorscope").click();
  await expect(page.locator("[data-mv-vectorscope-canvas]")).toBeVisible();
  await expect(page.locator("#mv-hist-channel")).toHaveCount(0); // channel row hidden in scope mode
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show Histogram").click();
  await expect(page.locator("[data-mv-vectorscope-canvas]")).toHaveCount(0);
  await expect(page.locator("#mv-hist-channel")).toBeVisible();
});

test("the Vectorscope canvas paints scope content for a coloured document", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ histScope: "vectorscope" }));
  const painted = await page.locator("[data-mv-vectorscope-canvas]").evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) {
      // pixels that aren't the near-black scope background (graticule + red cluster)
      if (data[i + 3] > 0 && (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30)) colored++;
    }
    return colored;
  });
  expect(painted).toBeGreaterThan(50);
});

// ── Luma waveform (same Histogram-panel right-click cycle) ──────────
test("engine.waveform returns a cols×rows luma grid with a bright column at the top", async ({ page }) => {
  await scene(page); // solid-red doc: Rec.709 luma ≈ 0.2126 → lower third
  const res = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const cols = 32, rows = 32;
    const g = Array.from(mv.engine.waveform(cols, rows) as Float32Array);
    let maxi = 0;
    for (let i = 1; i < g.length; i++) if (g[i] > g[maxi]) maxi = i;
    return { len: g.length, cols, rows, maxRow: Math.floor(maxi / cols), max: g[maxi], inRange: g.every((v: number) => v >= 0 && v <= 1) };
  });
  expect(res.len).toBe(res.cols * res.rows);
  expect(res.inRange).toBe(true);
  expect(res.max).toBeCloseTo(1, 5); // log-normalized peak
  // luma 0.21 → below the vertical midpoint (rows/2) since white is at the top
  expect(res.maxRow).toBeGreaterThan(res.rows / 2);
});

test("right-click the Histogram cycles through Waveform and back", async ({ page }) => {
  await scene(page);
  await expect(page.locator("[data-mv-waveform-canvas]")).toHaveCount(0);
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show Waveform", { exact: true }).click();
  await expect(page.locator("[data-mv-waveform-canvas]")).toBeVisible();
  await expect(page.locator("#mv-hist-channel")).toHaveCount(0); // channel row hidden in scope mode
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show Histogram").click();
  await expect(page.locator("[data-mv-waveform-canvas]")).toHaveCount(0);
  await expect(page.locator("#mv-hist-channel")).toBeVisible();
});

test("engine.waveformRgb returns three per-channel grids; red lights the top", async ({ page }) => {
  await scene(page); // solid-red doc
  const res = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const cols = 16, rows = 16, plane = cols * rows;
    const g = Array.from(mv.engine.waveformRgb(cols, rows) as Float32Array);
    const topMax = (c: number) => Math.max(...Array.from({ length: cols }, (_, x) => g[c * plane + x]));
    return { len: g.length, expected: plane * 3, rTop: topMax(0), gTop: topMax(1), inRange: g.every((v: number) => v >= 0 && v <= 1) };
  });
  expect(res.len).toBe(res.expected); // R, G, B grids stacked
  expect(res.inRange).toBe(true);
  expect(res.rTop).toBeGreaterThan(0); // red channel = 255 → top row lit
  expect(res.gTop).toBe(0); // green channel = 0 → nothing at the top
});

test("right-click the Histogram switches to the RGB Waveform", async ({ page }) => {
  await scene(page);
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show RGB Waveform").click();
  await expect(page.locator("[data-mv-waveform-canvas]")).toBeVisible();
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show Histogram").click();
  await expect(page.locator("[data-mv-waveform-canvas]")).toHaveCount(0);
});

// ── RGB Parade ─────────────────────────────────────────────────────
// Same three per-channel grids as the RGB Waveform, but side by side in
// thirds (R | G | B) instead of overlaid — the broadcast parade layout.
test("right-click the Histogram switches to the RGB Parade", async ({ page }) => {
  await scene(page);
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show RGB Parade").click();
  await expect(page.locator("[data-mv-waveform-canvas]")).toHaveAttribute("data-mv-waveform-mode", "waveform-parade");
  await page.locator("[data-mv-hist-graph]").click({ button: "right" });
  await page.getByText("Show Histogram").click();
  await expect(page.locator("[data-mv-waveform-canvas]")).toHaveCount(0);
});

test("the Parade puts each channel in its own third instead of overlaying them", async ({ page }) => {
  await scene(page); // solid red: R=255 (trace at the top), G=B=0 (trace at the bottom)
  await page.evaluate(() => (window as any).__mv.store.setOptions({ histScope: "waveform-parade" }));
  const res = await page.locator("[data-mv-waveform-canvas]").evaluate((el: HTMLCanvasElement) => {
    const { data } = el.getContext("2d")!.getImageData(0, 0, el.width, el.height);
    const third = (x: number) => Math.min(2, Math.floor((x * 3) / el.width));
    // count bright trace pixels per third, split into the top and bottom bands
    const top = [0, 0, 0];
    const bottom = [0, 0, 0];
    for (let y = 0; y < el.height; y++) {
      const band = y < el.height * 0.1 ? top : y > el.height * 0.9 ? bottom : null;
      if (!band) continue;
      for (let x = 0; x < el.width; x++) {
        const i = (y * el.width + x) * 4;
        // well above the graticule (0.12 alpha) and its labels (0.45 alpha)
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 200) band[third(x)]++;
      }
    }
    return { top, bottom };
  });
  expect(res.top[0]).toBeGreaterThan(0); // R=255 lights the LEFT panel's top
  expect(res.top[1]).toBe(0); // ...and nothing else up there — not overlaid
  expect(res.top[2]).toBe(0);
  expect(res.bottom[1]).toBeGreaterThan(0); // G=0 lights the MIDDLE panel's floor
  expect(res.bottom[2]).toBeGreaterThan(0); // B=0 the RIGHT panel's floor
});
