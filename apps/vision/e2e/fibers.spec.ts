import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Render ▸ Fibers ─────────────────────────────
// Adobe spec (helpx "Render filters"): Fibers "creates the look of woven fibers
// using the foreground and background colors." Variance controls how the colors
// vary; Strength controls each fiber's appearance. So every pixel is a blend of
// the two colors and the fibers run vertically.
//
//   https://helpx.adobe.com/photoshop/using/render-filters.html

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
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

// a fresh doc with foreground red and background blue.
async function redBlueDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "fibers");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });    // red fg
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 });  // blue bg
    mv.engine.commit();
  });
}

// returns {gMax, rLo, rHi} over the doc.
async function stats(page: Page): Promise<{ gMax: number; rLo: number; rHi: number }> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    let gMax = 0, rLo = 255, rHi = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const c = E.pick_color(x, y) >>> 0;
      const r = (c >>> 24) & 255, g = (c >>> 16) & 255;
      if (g > gMax) gMax = g;
      if (r < rLo) rLo = r;
      if (r > rHi) rHi = r;
    }
    return { gMax, rLo, rHi };
  });
}

// ── Integration: woven from fg/bg, with variation ──────────────────
test("fibers weaves the foreground and background colours", async ({ page }) => {
  await redBlueDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.fibers(50, 4));
  const s = await stats(page);
  expect(s.gMax).toBe(0);        // red↔blue blend → no green anywhere
  expect(s.rHi - s.rLo).toBeGreaterThan(40); // the fibers vary
});

// ── Mouse + UI: the Filter ▸ Render ▸ Fibers… dialog ───────────────
test("the Filter ▸ Render ▸ Fibers… dialog OK weaves the fibers", async ({ page }) => {
  await redBlueDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Render", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Fibers…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const s = await stats(page);
  expect(s.gMax).toBe(0);
  expect(s.rHi - s.rLo).toBeGreaterThan(20);
});
