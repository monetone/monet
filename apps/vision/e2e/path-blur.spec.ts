import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Blur ▸ Path Blur ──────────────────────────────────────
// Adobe: Path Blur "creates motion blurs along paths." Vision adds a new engine
// filter (filter_path_blur): a directional streak `speed` px long at `angle`. Unlike
// Motion Blur (a symmetric smear), Path Blur can TRAIL — with Centered Blur off it
// samples only backward along the path, so a rightward path leaves the trailing edge
// crisp while smearing the leading side (a one-sided motion trail). Taper fades the
// far end of the streak. (Previously the "Path Blur…" menu item aliased the Motion
// Blur dialog; now it drives a real, distinct filter.) pick_color reads 8-bit channels.
//   https://helpx.adobe.com/photoshop/using/blur-gallery.html

const maxR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(([x0, x1, h]) => {
    const E = (window as any).__mv.engine.engine;
    let m = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m = Math.max(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, [x0, x1, h] as const);

const minR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(([x0, x1, h]) => {
    const E = (window as any).__mv.engine.engine;
    let m = 255;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m = Math.min(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, [x0, x1, h] as const);

const meanR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(([x0, x1, h]) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) { s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255; n++; }
    return s / n;
  }, [x0, x1, h] as const);

// Left half black, right half white (vertical boundary at x=w/2).
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "path-blur");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("a centered blur smears the boundary both ways; it is undoable", async ({ page }) => {
  await split(page, 40, 40);
  expect(await maxR(page, 12, 20, 40)).toBe(0); // black side starts pure
  await page.evaluate(() => (window as any).__mv.fil.pathBlur(0, 16, 0, true)); // horizontal, symmetric
  expect(await maxR(page, 12, 20, 40)).toBeGreaterThan(0); // white bled into the black side
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await maxR(page, 12, 20, 40)).toBe(0); // undo restores the crisp edge
});

test("a trailing blur is directional (the Motion Blur distinction)", async ({ page }) => {
  await split(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.pathBlur(0, 16, 0, false)); // trailing: samples only backward
  expect(await maxR(page, 0, 20, 40)).toBe(0);        // the black side samples only further-left black → untouched
  expect(await minR(page, 20, 28, 40)).toBeLessThan(255); // the white side trails the black edge in
});

test("taper fades the far end of the trail", async ({ page }) => {
  await split(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.pathBlur(0, 16, 0, false));
  const lo = await meanR(page, 20, 30, 40);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.pathBlur(0, 16, 0.9, false));
  const hi = await meanR(page, 20, 30, 40);
  expect(hi).toBeGreaterThan(lo); // a stronger taper keeps the white side lighter
});

test("zero speed is an identity", async ({ page }) => {
  await split(page, 40, 40);
  await page.evaluate(() => (window as any).__mv.fil.pathBlur(0, 0.5, 0, true));
  expect(await maxR(page, 0, 20, 40)).toBe(0);
  expect(await minR(page, 20, 40, 40)).toBe(255);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await split(page, 40, 30);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [ang, sp, tp, ct] of [[0, 16, 0, false], [90, 24, 0.5, true], [45, 8, 1, false]] as const) {
    await page.evaluate(([ang, sp, tp, ct]) => (window as any).__mv.fil.pathBlur(ang, sp, tp, ct), [ang, sp, tp, ct] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
    expect(await maxR(page, 0, 40, 30)).toBeLessThanOrEqual(255);
  }
});

test("the Path Blur dialog opens from the Filter menu (its own dialog, not Motion Blur)", async ({ page }) => {
  await split(page, 32, 32);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Path Blur…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Path Blur…")).run());
  await expect(page.getByText("Centered Blur")).toBeVisible(); // unique to the Path Blur dialog
});
