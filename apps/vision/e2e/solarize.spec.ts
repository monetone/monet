import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Solarize ──────────────────────────
// Adobe spec (community / helpx): Solarize blends a positive and a negative
// image — it inverts every channel value above 50% (a tent curve min(v,255−v)
// peaking at mid-grey). Values below mid are unchanged; white maps to black.
// The app had no Solarize.
//
//   https://community.adobe.com/t5/photoshop-ecosystem-discussions/solarize-filter/td-p/11723552

const DOCW = 180;
const DOCH = 120;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const near = (v: number, t: number) => Math.abs(v - t) <= 4;

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

// three vertical strips of grey 60 / 200 / 255.
async function threeStrips(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "sol");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w / 3, h, 0); E.fill_selection(60, 60, 60, 255);
    E.select_rect(w / 3, 0, w / 3, h, 0); E.fill_selection(200, 200, 200, 255);
    E.select_rect((2 * w) / 3, 0, w / 3, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}

// ── Integration: tent curve min(v, 255−v) ──────────────────────────
test("solarize keeps darks, inverts brights, maps white to black", async ({ page }) => {
  await threeStrips(page);
  await page.evaluate(() => (window as any).__mv.fil.solarize());
  expect(near((await pixel(page, 30, 60))[0], 60)).toBe(true);   // 60 below mid → unchanged
  expect(near((await pixel(page, 90, 60))[0], 55)).toBe(true);   // 200 → 55 (255−200)
  expect((await pixel(page, 150, 60))[0]).toBeLessThan(5);       // 255 → 0
});

// ── Integration: each channel solarized independently ──────────────
test("solarize works per channel", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "solc");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(200, 80, 255, 255); E.select_none(); // R above mid, G below
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
  await page.evaluate(() => (window as any).__mv.fil.solarize());
  const p = await pixel(page, 90, 60);
  expect(near(p[0], 55)).toBe(true);  // R 200 → 55
  expect(near(p[1], 80)).toBe(true);  // G 80 → 80 (below mid)
  expect(p[2]).toBeLessThan(5);       // B 255 → 0
});

// ── Mouse + menu: Filter ▸ Solarize ────────────────────────────────
test("the Filter ▸ Solarize menu item solarizes the image", async ({ page }) => {
  await threeStrips(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Solarize")).toBe(true);
  await page.waitForTimeout(150);
  expect(near((await pixel(page, 90, 60))[0], 55)).toBe(true); // bright strip inverted
  expect((await pixel(page, 150, 60))[0]).toBeLessThan(5);     // white → black
});
