import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Dodge & Burn tool options ────────────────────────────
// Adobe spec (helpx + breathingcolor): the Dodge/Burn options bar exposes a
// tonal **Range** (Shadows = values 0–85, Midtones = 85–170, Highlights =
// 170–255 — a stroke only affects the chosen band), an **Exposure** strength,
// and **Protect Tones** (preserve hue/saturation, prevent clipping). The engine
// used to apply a flat lighten/darken ignoring all three. These tests pin the
// fixed behaviour through the engine, real pointer strokes, and the UI.
//
//   https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html
//   https://www.breathingcolor.com/blogs/news/photoshop-dodge-and-burn

const DOCW = 200;
const DOCH = 140;

// Decode the engine's packed-RGBA pick_color into [r,g,b] (0..255).
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

// Drive a dodge/burn dab straight through the engine (no UI), returning the
// centre pixel — the integration-level mirror of the Rust unit tests, proving
// set_dodge_options is exposed across the wasm boundary and the stroke pipeline.
async function engineStroke(page: Page, fill: number[], mode: number, range: number, exposure: number, protect: boolean): Promise<number[]> {
  return await page.evaluate(({ fill, mode, range, exposure, protect }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "db");
    const E = mv.engine.engine; // AFTER newDocument — it replaces the engine instance
    E.select_all(); E.fill_selection(fill[0], fill[1], fill[2], 255); E.select_none();
    E.set_brush(20, 1, 1, 1, 0.1, 255, 255, 255, 255, false);
    E.set_brush_mode(mode);
    E.set_dodge_options(range, exposure, protect);
    E.stroke_begin(); E.stroke_to(20, 20, 1); E.stroke_end();
    E.composite();
    const c = E.pick_color(20, 20) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { fill, mode, range, exposure, protect });
}

// Fresh flat-filled doc with `tool` armed; returns the doc→client map built from
// the live doc-canvas rect (see selection-modes.spec for the why).
async function setup(page: Page, fill: number[], tool: "dodge" | "burn"): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, fill, tool }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "db");
    const E = mv.engine.engine; // AFTER newDocument — it replaces the engine instance
    E.select_all(); E.fill_selection(fill[0], fill[1], fill[2], 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool(tool);
    mv.store.fit();
  }, { w: DOCW, h: DOCH, fill, tool });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

// A real left-to-right pointer stroke at doc-row `y`.
async function strokeMouse(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, x1: number, y: number) {
  await page.mouse.move(m.cx(x0), m.cy(y));
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(m.cx(x0 + (x1 - x0) * i / steps), m.cy(y), { steps: 1 });
  await page.mouse.up();
}

// ── Integration: range + protect tones through the engine FFI ──────
test.describe("dodge/burn engine options", () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test("Range=Shadows brightens dark pixels far more than light ones", async ({ page }) => {
    const darkBefore = 51, lightBefore = 204;
    const dark = await engineStroke(page, [darkBefore, darkBefore, darkBefore], 2, 0, 0.8, false);
    const light = await engineStroke(page, [lightBefore, lightBefore, lightBefore], 2, 0, 0.8, false);
    const dDark = dark[0] - darkBefore;
    const dLight = light[0] - lightBefore;
    expect(dDark).toBeGreaterThan(0);
    expect(dDark).toBeGreaterThan(dLight * 5); // shadows band targets the dark pixel
  });

  test("Range=Highlights brightens light pixels far more than dark ones", async ({ page }) => {
    const dark = await engineStroke(page, [26, 26, 26], 2, 2, 0.8, false);
    const light = await engineStroke(page, [230, 230, 230], 2, 2, 0.8, false);
    expect(light[0] - 230).toBeGreaterThan((dark[0] - 26) * 5);
  });

  test("Protect Tones preserves saturation; legacy desaturates", async ({ page }) => {
    const fill = [200, 60, 60];
    const sat = (c: number[]) => (c[0] - Math.min(c[1], c[2])) / Math.max(c[0], 1);
    const orig = sat(fill);
    const prot = sat(await engineStroke(page, fill, 2, 1, 0.8, true));
    const legacy = sat(await engineStroke(page, fill, 2, 1, 0.8, false));
    expect(Math.abs(prot - orig)).toBeLessThan(0.05); // hue/sat kept
    expect(legacy).toBeLessThan(orig - 0.1);          // toward-white desaturates
  });

  test("burn darkens and Exposure scales the strength", async ({ page }) => {
    const before = 128;
    const burnt = (await engineStroke(page, [before, before, before], 3, 1, 0.6, false))[0];
    expect(burnt).toBeLessThan(before);
    const dWeak = (await engineStroke(page, [before, before, before], 2, 1, 0.25, false))[0] - before;
    const dStrong = (await engineStroke(page, [before, before, before], 2, 1, 0.75, false))[0] - before;
    expect(dStrong).toBeGreaterThan(dWeak * 1.5);
  });
});

// ── Mouse: real dodge/burn pointer strokes ─────────────────────────
test.describe("dodge/burn strokes (mouse)", () => {
  test("a real dodge stroke brightens the pixels under the cursor", async ({ page }) => {
    const m = await setup(page, [128, 128, 128], "dodge");
    await page.evaluate(() => (window as any).__mv.store.setBrush({ dodgeExposure: 0.9, dodgeRange: 1 }));
    const before = (await pixel(page, 100, 70))[0];
    await strokeMouse(page, m, 40, 160, 70);
    const after = (await pixel(page, 100, 70))[0];
    expect(after).toBeGreaterThan(before + 5);
  });

  test("a real burn stroke darkens the pixels under the cursor", async ({ page }) => {
    const m = await setup(page, [128, 128, 128], "burn");
    await page.evaluate(() => (window as any).__mv.store.setBrush({ dodgeExposure: 0.9, dodgeRange: 1 }));
    const before = (await pixel(page, 100, 70))[0];
    await strokeMouse(page, m, 40, 160, 70);
    const after = (await pixel(page, 100, 70))[0];
    expect(after).toBeLessThan(before - 5);
  });

  test("Range gates the stroke: Shadows brightens a dark fill, Highlights barely touches it", async ({ page }) => {
    // Shadows range on a dark fill → big lift.
    const m1 = await setup(page, [56, 56, 56], "dodge");
    await page.evaluate(() => (window as any).__mv.store.setBrush({ dodgeExposure: 0.9, dodgeRange: 0 }));
    await strokeMouse(page, m1, 40, 160, 70);
    const shadows = (await pixel(page, 100, 70))[0];

    // Highlights range on the same dark fill → almost nothing.
    const m2 = await setup(page, [56, 56, 56], "dodge");
    await page.evaluate(() => (window as any).__mv.store.setBrush({ dodgeExposure: 0.9, dodgeRange: 2 }));
    await strokeMouse(page, m2, 40, 160, 70);
    const highlights = (await pixel(page, 100, 70))[0];

    expect(shadows).toBeGreaterThan(highlights + 30);
  });
});

// ── UI: the Dodge/Burn options bar ─────────────────────────────────
test.describe("dodge/burn options bar", () => {
  test("dodge tool shows Range / Exposure / Protect Tones and the controls drive the store", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => (window as any).__mv.store.setTool("dodge"));
    for (const name of ["Shadows", "Midtones", "Highlights"]) {
      await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("checkbox", { name: "Protect Tones" })).toBeVisible();

    await page.getByRole("radio", { name: "Shadows", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__mv.store.state.brush.dodgeRange)).toBe(0);
    await page.getByRole("radio", { name: "Highlights", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__mv.store.state.brush.dodgeRange)).toBe(2);

    const wasProtected = await page.evaluate(() => (window as any).__mv.store.state.brush.protectTones);
    await page.getByRole("checkbox", { name: "Protect Tones" }).click();
    expect(await page.evaluate(() => (window as any).__mv.store.state.brush.protectTones)).toBe(!wasProtected);
  });
});
