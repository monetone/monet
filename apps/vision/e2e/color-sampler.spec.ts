import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Color Sampler tool ───────────────────────────────────
// Adobe spec (Julieanne Kost / Adobe Help): the Color Sampler places up to 10
// persistent sample points (#1..#10) on the image and shows their colour values
// LIVE in the Info panel — its purpose is to monitor colour as you edit. Click
// adds a point, Alt-click removes the nearest, and a point can be dragged to a
// new spot. Sample Size / Sample source are shared with the Eyedropper.
//   https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html

const DOCW = 200;
const DOCH = 140;

/** A solid-colour document with the Color Sampler tool active, plus a doc→client
 *  coordinate mapper for real mouse interactions. */
async function scene(page: Page, r = 230, g = 30, b = 30): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, r, g, b }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "cs");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w, h, 0); E.fill_selection(r, g, b, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("colorsampler");
    mv.store.fit();
  }, { w: DOCW, h: DOCH, r, g, b });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const samplers = (page: Page): Promise<{ x: number; y: number }[]> =>
  page.evaluate(() => (window as any).__mv.store.state.colorSamplers);

// ── Tool registration ──────────────────────────────────────────────
test("the Color Sampler tool is selectable via the Analyze menu action", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.evaluate(() => (window as any).__mv.store.setTool("colorsampler"));
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("colorsampler");
});

// ── Mouse: clicking adds numbered markers ───────────────────────────
test("clicking the canvas drops sample points and renders numbered markers", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(30), m.cy(30));
  await page.mouse.click(m.cx(100), m.cy(70));
  await page.mouse.click(m.cx(160), m.cy(110));
  expect(await samplers(page)).toHaveLength(3);
  // the overlay reports its marker count via the data hook
  await expect(page.locator("[data-mv-samplers]")).toHaveAttribute("data-mv-samplers", "3");
});

// ── Mouse: Alt-click ON a point removes it; empty Alt-click is a no-op ──
test("Alt-clicking on a point removes it; Alt-clicking empty canvas does nothing", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(40), m.cy(40));
  await page.mouse.click(m.cx(160), m.cy(110));
  expect(await samplers(page)).toHaveLength(2);
  // Alt-click directly on the first point removes only it.
  await page.keyboard.down("Alt");
  await page.mouse.click(m.cx(40), m.cy(40));
  await page.keyboard.up("Alt");
  let after = await samplers(page);
  expect(after).toHaveLength(1);
  expect(after[0].x).toBeGreaterThan(120); // the far point survived
  // Photoshop parity: an Alt-click far from any point must NOT delete one.
  await page.keyboard.down("Alt");
  await page.mouse.click(m.cx(10), m.cy(10));
  await page.keyboard.up("Alt");
  after = await samplers(page);
  expect(after).toHaveLength(1);
});

// ── Cap: at most 10 sample points (Photoshop's limit) ───────────────
test("never exceeds 10 sample points", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    for (let i = 0; i < 15; i++) mv.store.addColorSampler(10 + i * 5, 10 + i * 4);
  });
  expect(await samplers(page)).toHaveLength(10);
});

// ── Options bar: Clear removes every point ──────────────────────────
test("the options-bar Clear button removes all sample points", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(40), m.cy(40));
  await page.mouse.click(m.cx(120), m.cy(90));
  expect(await samplers(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Clear" }).click();
  expect(await samplers(page)).toHaveLength(0);
});

// ── Drag: a point can be moved to a new position ────────────────────
test("dragging a sample point moves it", async ({ page }) => {
  const m = await scene(page);
  await page.evaluate(() => (window as any).__mv.store.addColorSampler(50, 50));
  await page.mouse.move(m.cx(50), m.cy(50));
  await page.mouse.down();
  await page.mouse.move(m.cx(120), m.cy(95), { steps: 6 });
  await page.mouse.up();
  const s = await samplers(page);
  expect(s).toHaveLength(1); // moved, not added
  expect(Math.abs(s[0].x - 120)).toBeLessThan(4);
  expect(Math.abs(s[0].y - 95)).toBeLessThan(4);
});

// ── View ▸ Show ▸ Color Samplers toggles the markers ────────────────
test("toggling Show ▸ Color Samplers hides and re-shows the markers", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(60), m.cy(60));
  await expect(page.locator("[data-mv-samplers]")).toHaveCount(1);
  await page.evaluate(() => (window as any).__mv.store.toggleShowSamplers());
  await expect(page.locator("[data-mv-samplers]")).toHaveCount(0); // overlay hidden
  await page.evaluate(() => (window as any).__mv.store.toggleShowSamplers());
  await expect(page.locator("[data-mv-samplers]")).toHaveCount(1); // shown again
});

// ── Bounds: positions are clamped to the canvas (Photoshop) ─────────
test("sample positions are clamped to the canvas", async ({ page }) => {
  await scene(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.addColorSampler(-50, -50);         // past the top-left corner
    mv.store.addColorSampler(w + 999, h + 999); // past the bottom-right corner
    mv.store.moveColorSampler(0, -10, h + 10);  // drag a point off two edges
  }, { w: DOCW, h: DOCH });
  const s = await samplers(page);
  expect(s[0]).toEqual({ x: 0, y: DOCH - 1 });
  expect(s[1]).toEqual({ x: DOCW - 1, y: DOCH - 1 });
});

// ── Info panel: live readouts that track edits ──────────────────────
test("the Info panel shows sample readouts that update live as the image changes", async ({ page }) => {
  await scene(page, 230, 30, 30); // start red
  await page.evaluate(() => (window as any).__mv.store.addColorSampler(100, 70));
  await page.locator('[data-tab-id="info"]').click(); // surface the Info panel
  const row = page.locator('[data-mv-sampler="1"]');
  await expect(row).toContainText("230, 30, 30");
  // repaint the layer green and commit — the readout must follow the pixel
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 200, 0, 255); E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
  await expect(row).toContainText("0, 200, 0");
});
