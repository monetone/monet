import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Adjustments ▸ Equalize ───────────────────────
// Adobe spec (helpx): Equalize redistributes brightness so the histogram is
// flat — the darkest value maps to black, the lightest to white, and the
// intermediate values spread evenly throughout the range. The engine already
// had `adjust_equalize` (luminance-CDF, colour-preserving) wired to the menu;
// this spec is the missing end-to-end coverage.
//
//   https://helpx.adobe.com/photoshop/using/making-quick-tonal-adjustments.html

const DOCW = 180;
const DOCH = 120;

async function gray(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });
}

async function openMenu(page: Page, top: string) {
  await page.getByText(top, { exact: true }).first().click();
  await page.waitForTimeout(150);
}
async function clickMenuItem(page: Page, label: string) {
  const ok = await page.evaluate(async (label) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const labelOf = (e: Element) => (((e.querySelector(".monet-menu-label") || {}) as HTMLElement).textContent || "").trim();
    const findLeaf = () => [...document.querySelectorAll(".monet-menu-item")]
      .find((e) => e.getAttribute("aria-haspopup") !== "menu" && labelOf(e) === label) as HTMLElement | undefined;
    const openSub = (e: Element) => {
      e.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      e.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    };
    const seen = new Set<Element>();
    const visit = async (): Promise<boolean> => {
      const hit = findLeaf();
      if (hit) { hit.click(); return true; }
      for (const s of [...document.querySelectorAll('.monet-menu-item[aria-haspopup="menu"]')]) {
        if (seen.has(s)) continue;
        seen.add(s);
        openSub(s);
        await sleep(45);
        if (await visit()) return true;
      }
      return false;
    };
    return await visit();
  }, label);
  await page.waitForTimeout(120);
  return ok;
}

// three equal vertical strips of grey 50 / 100 / 150.
async function threeStrips(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "eq");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w / 3, h, 0); E.fill_selection(50, 50, 50, 255);
    E.select_rect(w / 3, 0, w / 3, h, 0); E.fill_selection(100, 100, 100, 255);
    E.select_rect((2 * w) / 3, 0, w / 3, h, 0); E.fill_selection(150, 150, 150, 255);
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}

// ── Integration: three levels spread to black / mid / white ────────
test("equalize spreads three grey levels across the full range", async ({ page }) => {
  await threeStrips(page);
  expect(await gray(page, 30, 60)).toBeGreaterThan(40); // 50 before
  await page.evaluate(() => (window as any).__mv.adj.equalize());
  expect(await gray(page, 30, 60)).toBeLessThan(8);     // darkest → black
  const mid = await gray(page, 90, 60);
  expect(mid).toBeGreaterThan(110); expect(mid).toBeLessThan(145); // middle → ~128
  expect(await gray(page, 150, 60)).toBeGreaterThan(247); // lightest → white
});

// ── Mouse + menu: Adjustments ▸ Equalize ───────────────────────────
test("the Adjustments ▸ Equalize menu item equalizes the image", async ({ page }) => {
  await threeStrips(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Equalize")).toBe(true);
  await page.waitForTimeout(150);
  expect(await gray(page, 30, 60)).toBeLessThan(8);
  expect(await gray(page, 150, 60)).toBeGreaterThan(247);
});

// ── Idempotence-ish: an already full-range image stays full-range ──
test("equalize keeps an already black/white image at the extremes", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "eq2");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
  await page.evaluate(() => (window as any).__mv.adj.equalize());
  expect(await gray(page, 40, 60)).toBeLessThan(8);      // black stays black
  expect(await gray(page, 140, 60)).toBeGreaterThan(247); // white stays white
});
