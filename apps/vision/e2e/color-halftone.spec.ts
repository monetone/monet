import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Pixelate ▸ Color Halftone ───────────────────
// Adobe spec (helpx "Filter effects reference" / Pixelate): "Simulates the
// effect of using an enlarged halftone screen on each channel. For each channel
// the filter divides the image into rectangles and replaces each rectangle with
// a circle. The circle size is proportional to the brightness of the rectangle."
// Controlled by Max Radius and a screen angle per channel.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// mean luminance over the document (coverage of the dot screen).
async function meanLum(page: Page, w: number, h: number): Promise<number> {
  return await page.evaluate(({ w, h }) => {
    const E = (window as any).__mv.engine.engine;
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return s / (w * h);
  }, { w, h });
}
async function lum(page: Page, x: number, y: number): Promise<number> {
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

// a 48×48 flat field of grey value `v`.
async function flatDoc(page: Page, v: number) {
  await gotoApp(page);
  await page.evaluate((v) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(48, 48, "halftone");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 48, 48, 0); E.fill_selection(v, v, v, 255);
    E.select_none();
    mv.engine.commit();
  }, v);
}

// ── Integration: coverage tracks brightness ────────────────────────
test("color halftone inks more of a bright field than a dark one", async ({ page }) => {
  await flatDoc(page, 0);
  await page.evaluate(() => (window as any).__mv.fil.colorHalftone(8, 108, 162, 90));
  expect(await meanLum(page, 48, 48)).toBe(0); // black inks nothing

  await flatDoc(page, 160);
  await page.evaluate(() => (window as any).__mv.fil.colorHalftone(8, 108, 162, 90));
  const mid = await meanLum(page, 48, 48);
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(250); // a real dot pattern, not solid

  await flatDoc(page, 255);
  await page.evaluate(() => (window as any).__mv.fil.colorHalftone(8, 108, 162, 90));
  const white = await meanLum(page, 48, 48);
  expect(white).toBeGreaterThan(mid); // brighter field → more ink
  expect(white).toBeGreaterThan(250); // full value fully inks
});

// ── Mouse + UI: the Color Halftone… dialog Max Radius field ────────
test("the Filter ▸ Color Halftone… dialog applies a dot screen", async ({ page }) => {
  await flatDoc(page, 160);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Color Halftone…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Max Radius" }).fill("8");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const mean = await meanLum(page, 48, 48);
  expect(mean).toBeGreaterThan(0);
  expect(mean).toBeLessThan(250); // a screened (partly inked) grey, not solid
});
