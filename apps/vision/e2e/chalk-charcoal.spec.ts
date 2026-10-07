import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Chalk & Charcoal ─────────────────────────────
// Adobe: Chalk & Charcoal reduces the image to THREE tones — shadows are redrawn as
// charcoal in the foreground colour, highlights as chalk in the background colour, and
// the midtones flatten to a solid 50% gray. Vision's engine filter (filter_chalk_charcoal)
// maps per-pixel luma L: L<charcoalArea → fg, L>1−chalkArea → bg, else a neutral gray —
// the flattened mid-zone is the distinction from Stamp's hard 2-tone threshold.
// pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).
//   https://helpx.adobe.com/photoshop-elements/using/sketch-filters.html

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });
const rgb = async (page: Page, x: number, y: number) =>
  [await chan(page, x, y, 24), await chan(page, x, y, 16), await chan(page, x, y, 8)] as const;

async function setInkColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red — charcoal (shadows)
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue — chalk (highlights)
  });
}

test("Chalk & Charcoal maps a black/mid/white triband to charcoal / gray / chalk, and undoes", async ({ page }) => {
  await gotoApp(page);
  await setInkColours(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(48, 16, "cc-triband");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255); // black → shadows
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(128, 128, 128, 255); // mid → midtones
    E.select_rect(32, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); // white → highlights
    E.select_none();
    mv.engine.commit();
    mv.fil.chalkCharcoal(0.3, 0.3, 1); // areas 0.3, full stroke pressure
  });
  const [sr, sg, sb] = await rgb(page, 8, 8); // shadow band → foreground charcoal (red)
  expect(sr).toBeGreaterThan(200); expect(sg).toBeLessThan(60); expect(sb).toBeLessThan(60);
  const [mr, mg, mb] = await rgb(page, 24, 8); // mid band → a solid neutral gray
  expect(Math.abs(mr - 128)).toBeLessThan(20); expect(Math.abs(mg - 128)).toBeLessThan(20); expect(Math.abs(mb - 128)).toBeLessThan(20);
  const [hr, hg, hb] = await rgb(page, 40, 8); // highlight band → background chalk (blue)
  expect(hb).toBeGreaterThan(200); expect(hr).toBeLessThan(60); expect(hg).toBeLessThan(60);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await rgb(page, 8, 8)).toEqual([0, 0, 0]); // undo → bands restored
  expect(await rgb(page, 40, 8)).toEqual([255, 255, 255]);
});

test("a colored midtone flattens to a neutral gray — the 3rd tone Stamp's 2-tone can't make", async ({ page }) => {
  await gotoApp(page);
  await setInkColours(page);
  const [r, g, b] = await (async () => {
    await page.evaluate(() => {
      const mv = (window as any).__mv;
      mv.store.newDocument(24, 24, "cc-mid");
      const E = mv.engine.engine;
      E.select_all(); E.fill_selection(200, 60, 60, 255); E.select_none(); // a reddish midtone (luma ≈ 0.40)
      mv.engine.commit();
      mv.fil.chalkCharcoal(0.3, 0.3, 1);
    });
    return rgb(page, 12, 12);
  })();
  // a colored midtone collapses to a neutral 50% gray — not the input colour, not fg(red), not bg(blue)
  expect(Math.abs(r - 128)).toBeLessThan(20);
  expect(Math.abs(g - 128)).toBeLessThan(20);
  expect(Math.abs(b - 128)).toBeLessThan(20);
});

test("the Chalk & Charcoal dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "cc-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Chalk & Charcoal…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Chalk & Charcoal…")).run());
  await expect(page.getByText("Charcoal Area")).toBeVisible();
});
