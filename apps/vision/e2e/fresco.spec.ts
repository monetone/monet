import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Fresco ─────────────────────────────────────
// Adobe: Fresco "paints an image in a coarse style using short, rounded, and hastily
// applied dabs." Vision adds an engine filter (filter_fresco) that dabs the image
// toward local averages (Brush Size), keeps detail at edges (Brush Detail), then
// deepens the tone with a gamma darkening (the fresco signature) plus plaster tooth
// (Texture). pick_color reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const red = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), [x, y] as const);

const meanRed = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return s / (w * h);
  }, [w, h] as const);

async function flat(page: Page, w: number, h: number, v: number) {
  await gotoApp(page);
  await page.evaluate(([w, h, v]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "fresco");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
  }, [w, h, v] as const);
}

// Left half black, right half white (vertical boundary at x=w/2).
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "fresco-split");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("deepens a midtone field, and is undoable", async ({ page }) => {
  await flat(page, 48, 48, 128);
  const before = await meanRed(page, 48, 48);
  expect(before).toBeCloseTo(128, 0);
  await page.evaluate(() => (window as any).__mv.fil.fresco(0, 10, 0));
  expect(await meanRed(page, 48, 48)).toBeLessThan(before - 10); // fresco gamma darkens midtones
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await meanRed(page, 48, 48)).toBeCloseTo(before, 0); // undo restores
});

test("higher Brush Detail keeps the edge sharper", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.fresco(8, 0, 0)); // no detail → coarsen
  const lo = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.fresco(8, 10, 0)); // high detail → keep edge
  const hi = await red(page, 15, 16);
  expect(hi).toBeLessThan(lo); // more detail keeps the dark edge darker
});

test("a larger Brush Size coarsens more", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.fresco(2, 0, 0));
  const small = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.fresco(10, 0, 0));
  const large = await red(page, 15, 16);
  expect(large).toBeGreaterThan(small);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 160);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [bs, bd, tx] of [[0, 10, 0], [10, 0, 3], [5, 5, 1]] as const) {
    await page.evaluate(([bs, bd, tx]) => (window as any).__mv.fil.fresco(bs, bd, tx), [bs, bd, tx] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanRed(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Fresco dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 160);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Fresco…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Fresco…")).run());
  await expect(page.getByText("Brush Detail")).toBeVisible();
});
