import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Charcoal ─────────────────────────────────────
// Adobe: Charcoal "redraws an image to create a posterized, smudged effect. Major
// edges are boldly drawn, while midtones are sketched using a diagonal stroke.
// Charcoal is the FOREGROUND colour and the paper is the BACKGROUND colour." Vision
// adds a new engine filter (filter_charcoal): a strong luma edge inks the foreground
// regardless of tone; elsewhere a diagonal stroke ramp shades by darkness. Distinct
// from Chalk & Charcoal (a flat 3-tone map with no edges/strokes). pick_color reads
// back 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const px = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => { const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; }, { x, y });

const meanR = (page: Page, w: number, h: number) =>
  page.evaluate(([w, h]) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return s / (w * h);
  }, [w, h] as const);

// Set fg=red / bg=blue and fill the layer flat at value v.
async function flat(page: Page, w: number, h: number, v: number) {
  await gotoApp(page);
  await page.evaluate(([w, h, v]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "charcoal");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red charcoal
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
  }, [w, h, v] as const);
}

// Left half black, right half white (vertical boundary at x=w/2), fg=red / bg=blue.
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "charcoal-split");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 });
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("a dark field inks the foreground charcoal; it is undoable", async ({ page }) => {
  await flat(page, 40, 40, 20); // near-black
  const before = await meanR(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.charcoal(1, 0, 0.5));
  expect(await meanR(page, 40, 40)).toBeGreaterThan(150); // charcoal red dominates the shadows
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await meanR(page, 40, 40)).toBeCloseTo(before, 0); // undo restores the dark field
});

test("a light field stays mostly the background paper", async ({ page }) => {
  await flat(page, 40, 40, 235); // near-white
  await page.evaluate(() => (window as any).__mv.fil.charcoal(1, 0, 0.5));
  const c = await px(page, 20, 20);
  // The paper (blue) dominates the highlights; mean red stays low.
  expect(await meanR(page, 40, 40)).toBeLessThan(120);
  expect(c.b).toBeGreaterThanOrEqual(c.r);
});

test("major edges are drawn in charcoal even on the light side", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.charcoal(1, 5, 0.5)); // max detail → edges inked
  const edge = await px(page, 16, 8); // first white column at the boundary
  expect(edge.r).toBeGreaterThan(200); // the edge is charcoal red…
  expect(edge.b).toBeLessThan(60);     // …not the blue paper it would otherwise be
});

test("a higher Light/Dark Balance inks more charcoal", async ({ page }) => {
  await flat(page, 40, 40, 128);
  await page.evaluate(() => (window as any).__mv.fil.charcoal(1, 0, 0.2)); // toward light
  const lo = await meanR(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.charcoal(1, 0, 0.8)); // toward dark
  const hi = await meanR(page, 40, 40);
  expect(hi).toBeGreaterThan(lo + 20);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await flat(page, 40, 30, 140);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [th, dt, ba] of [[1, 0, 0.5], [7, 5, 0.8], [3, 2, 0.3]] as const) {
    await page.evaluate(([th, dt, ba]) => (window as any).__mv.fil.charcoal(th, dt, ba), [th, dt, ba] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await meanR(page, 40, 30)).toBeGreaterThanOrEqual(0);
  }
});

test("the Charcoal dialog opens from the Filter menu", async ({ page }) => {
  await flat(page, 32, 32, 128);
  // NB: "Chalk & Charcoal…" also ends with "Charcoal…" — match Charcoal exactly.
  await page.waitForFunction(() => {
    const ok = (l: string) => l.endsWith("Charcoal…") && !l.includes("Chalk");
    return (window as any).__mv.commandPalette?.items?.some((i: any) => ok(i.label));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const ok = (l: string) => l.endsWith("Charcoal…") && !l.includes("Chalk");
    (window as any).__mv.commandPalette.items.find((i: any) => ok(i.label)).run();
  });
  await expect(page.getByText("Charcoal Thickness")).toBeVisible();
});
