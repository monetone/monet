import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Halftone Pattern ─────────────────────────────
// Adobe: Halftone Pattern "simulates the effect of a halftone screen while
// maintaining the continuous range of tones" — it renders a periodic screen
// (Circle / Dot / Line) in the foreground colour on the background-colour paper,
// the ink coverage following the tones (dark areas ink more). Vision adds an
// engine filter (filter_halftone_pattern). pick_color reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

// Max / min R over an explicit list of points.
const rRange = (page: Page, pts: [number, number][]) =>
  page.evaluate((pts) => {
    const E = (window as any).__mv.engine.engine;
    const rs = pts.map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return { max: Math.max(...rs), min: Math.min(...rs) };
  }, pts);

const grid = (x0: number, x1: number, y0: number, y1: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) out.push([x, y]);
  return out;
};

async function inkColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
  });
}

test("Halftone Pattern inks the dark half toward the foreground, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "halftone");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255); // dark half
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255); // light half
    E.select_none();
    mv.engine.commit();
    mv.fil.halftonePattern(4, 0.5, 1);
  });
  const left = await rRange(page, grid(2, 18, 2, 38));
  const right = await rRange(page, grid(22, 38, 2, 38));
  expect(left.max).toBeGreaterThan(200); // the dark half inked the foreground red
  expect(right.max).toBeLessThan(60); // the light half stayed the background paper (blue)
  await page.evaluate(() => (window as any).__mv.store.undo());
  const back = await rRange(page, [[5, 20], [35, 20]]);
  expect(back.min).toBe(0); // undo → the black half is black again
  expect(back.max).toBe(255); // undo → the white half is white again
});

test("Halftone Pattern renders the screen on a midtone (both colours present)", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "halftone-mid");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.halftonePattern(4, 0.5, 1);
  });
  const { max, min } = await rRange(page, grid(0, 40, 0, 40));
  expect(max).toBeGreaterThan(200); // some pixels inked red
  expect(min).toBeLessThan(60); // some pixels stayed blue paper
});

test("the Halftone Pattern dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "halftone-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Halftone Pattern…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Halftone Pattern…")).run());
  await expect(page.getByText("Pattern Type")).toBeVisible();
});
