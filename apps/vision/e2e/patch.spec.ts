import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Patch tool ──────────────────────────────────────────
// Make a selection, then drag it over a clean area; the selected region is healed
// with the dragged-to texture (engine patch_selection(dx,dy)). Joins the Healing
// flyout group. https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

const DOCW = 60;
const DOCH = 40;

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

// Green field with a red blemish at doc (5..13, 5..13); the blemish is selected.
async function blemish(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "patch");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none();
    E.select_rect(5, 5, 8, 8, 0); // selection active over the blemish
    E.fill_selection(220, 0, 0, 255);
    mv.engine.commit();
    mv.store.setTool("patch");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

test("patchSelectionBy heals the selection from the offset source", async ({ page }) => {
  await blemish(page);
  await page.evaluate(() => (window as any).__mv.store.patchSelectionBy(20, 0));
  const [r, g] = await rgba(page, 8, 8);
  expect(r).toBeLessThan(60);     // red blemish gone
  expect(g).toBeGreaterThan(150); // healed to the green source
});

test("a real Patch drag heals the selection from where it is dragged", async ({ page }) => {
  const m = await blemish(page);
  // Drag the selection 20px right (onto clean green), then release.
  await page.mouse.move(m.cx(9), m.cy(9));
  await page.mouse.down();
  await page.mouse.move(m.cx(19), m.cy(9));
  await page.mouse.move(m.cx(29), m.cy(9));
  await page.mouse.up();
  const [r, g] = await rgba(page, 8, 8);
  expect(r).toBeLessThan(80);
  expect(g).toBeGreaterThan(140);
});

test("Patch is reachable from the Healing flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-healing"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="patch"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("patch");
});
