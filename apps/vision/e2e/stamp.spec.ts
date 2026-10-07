import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Stamp ────────────────────────────────────────
// Adobe: Stamp "simplifies the image so that it seems made with a rubber or wood
// stamp." A 2-tone Sketch filter — the smoothed luminance is hard-thresholded into
// the foreground (dark) and background (light) colours. Light/Dark Balance is the
// threshold. Vision adds an engine filter (filter_stamp). pick_color is 0xRRGGBBAA.
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

async function inkColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red — the dark/ink tone
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue — the light/paper tone
  });
}
const ch = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => {
    const E = (window as any).__mv.engine.engine;
    return ((E.pick_color(x, y) >>> 0) >>> shift) & 255;
  }, { x, y, shift });

test("Stamp thresholds dark→foreground and light→background, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "stamp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.stamp(0.5, 0.1);
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    const B = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 8) & 255;
    return { lr: R(10, 20), lb: B(10, 20), rr: R(30, 20), rb: B(30, 20) };
  });
  expect(out.lr).toBeGreaterThan(200); expect(out.lb).toBeLessThan(60); // black half → foreground red
  expect(out.rb).toBeGreaterThan(200); expect(out.rr).toBeLessThan(60); // white half → background blue
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await ch(page, 10, 20, 24)).toBe(0); // black half restored
  expect(await ch(page, 30, 20, 24)).toBe(255); // white half restored
});

test("Stamp's Light/Dark Balance shifts the threshold through mid-gray", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  const lo = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "stamp-lo");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.stamp(0.2, 0); // low balance → gray reads light → background blue
    return ((E.pick_color(12, 12) >>> 0) >>> 8) & 255; // B
  });
  const hi = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "stamp-hi");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.stamp(0.8, 0); // high balance → gray reads dark → foreground red
    return ((E.pick_color(12, 12) >>> 0) >>> 24) & 255; // R
  });
  expect(lo).toBeGreaterThan(200); // low balance → the gray is background blue
  expect(hi).toBeGreaterThan(200); // high balance → the gray is foreground red
});

test("the Stamp dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "stamp-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Stamp…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Stamp…")).run());
  await expect(page.getByText("Light/Dark Balance")).toBeVisible();
});
