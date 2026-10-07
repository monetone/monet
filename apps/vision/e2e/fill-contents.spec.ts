import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Fill ──────────────────────────────────────────
// Adobe spec (helpx "Fill selections or layers with color"): Edit ▸ Fill (⇧F5)
// fills the selection (or whole layer) with a Contents choice — Foreground,
// Background, Black, White, 50% Gray — at a chosen blend Mode and Opacity. The
// app only had ⌥⌫/⌘⌫ foreground/background fills; this adds the full dialog.
//
//   https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-selection-layer-color.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

async function openFillDialogCommand(page: Page) {
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Edit ▸ Fill…")),
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Edit ▸ Fill…")).run());
  await expect(page.locator("#mv-fill-contents")).toBeVisible();
}

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "fill"); // white base
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red (for the fg/dialog default)
    mv.store.setTool("marquee");
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

async function marqueeDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 3 });
  await page.mouse.up();
}

// ── Integration: fill_blend mode + opacity through the FFI ─────────
test("fill_blend applies the blend mode and opacity", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const grayDoc = () => { mv.store.newDocument(10, 10, "f"); const E = mv.engine.engine; E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none(); return E; };
    const g = (E: any) => ((E.pick_color(5, 5) >>> 0) >>> 16) & 255;
    const E1 = grayDoc(); E1.fill_blend(128, 128, 128, 255, 3); const mult = g(E1); // Multiply
    const E2 = grayDoc(); E2.fill_blend(128, 128, 128, 255, 7); const scr = g(E2);  // Screen
    return { mult, scr };
  });
  expect(r.mult).toBeLessThan(100);    // Multiply darkened
  expect(r.scr).toBeGreaterThan(160);  // Screen lightened
});

// ── Mouse: fill a marquee with 50% Gray ────────────────────────────
test("filling a marquee selection with 50% Gray paints just the selection", async ({ page }) => {
  const m = await setup(page);
  await marqueeDrag(page, m, 50, 40, 130, 100);
  await page.evaluate(() => (window as any).__mv.store.fillContents("gray", 1, "normal"));
  const inside = await pixel(page, 90, 70);
  expect(inside[0]).toBeGreaterThan(110); expect(inside[0]).toBeLessThan(150); // ≈ 128 grey
  expect((await pixel(page, 10, 10))[0]).toBeGreaterThan(200); // outside the selection: untouched white
});

// ── UI: the Fill dialog ────────────────────────────────────────────
test("the Fill dialog OK fills with the foreground", async ({ page }) => {
  const m = await setup(page); // foreground = red
  await marqueeDrag(page, m, 50, 40, 130, 100);
  expect((await pixel(page, 90, 70))[1]).toBeGreaterThan(200); // white before
  await openFillDialogCommand(page);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const inside = await pixel(page, 90, 70);
  expect(inside[0]).toBeGreaterThan(180); // red filled (default Contents = Foreground)
  expect(inside[1]).toBeLessThan(80);
});

// ── UI: Color… contents (the parity addition) ──────────────────────
test("the Fill dialog Color… contents fills with the picked colour", async ({ page }) => {
  await setup(page); // white doc, no selection → whole-layer fill
  await openFillDialogCommand(page);
  await page.locator("#mv-fill-contents").click();
  await page.locator(".monet-listbox").waitFor();
  const labels = await page.locator(".monet-listbox [role=option]").allTextContents();
  expect(labels).toContain("Color…");
  expect(labels).toContain("Content-Aware");
  await page.locator('.monet-listbox [role=option][data-value="color"]').click();
  await page.locator("#mv-fill-color").fill("#00ff00"); // green, distinct from the red fg
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const px = await pixel(page, 90, 70);
  expect(px[1]).toBeGreaterThan(200); // green channel high
  expect(px[0]).toBeLessThan(80);     // red low
});

// ── UI: Content-Aware contents (the parity addition) ───────────────
test("the Fill dialog Content-Aware contents replaces a selection from surroundings", async ({ page }) => {
  await setup(page); // white doc
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(80, 50, 40, 40, 0); E.fill_selection(255, 0, 0, 255); // a red patch on white, still selected
    (window as any).__mv.engine.commit();
  });
  const before = await pixel(page, 100, 70); // inside the red patch
  expect(before[0]).toBeGreaterThan(180);
  await openFillDialogCommand(page);
  await chooseOption(page.locator("#mv-fill-contents"), "contentAware");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const after = await pixel(page, 100, 70);
  expect(after[1]).toBeGreaterThan(before[1] + 40); // content-aware reconstructed the white surroundings
});
