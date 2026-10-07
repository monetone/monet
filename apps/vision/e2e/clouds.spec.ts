import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Render ▸ Clouds ─────────────────────────────
// Adobe spec (helpx "Render filters"): Clouds generates a soft cloud pattern
// using random values that vary between the foreground and background colors.
// The app had Lens Flare but no Clouds.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// luminance range across a coarse grid of the active doc.
async function lumRange(page: Page): Promise<{ min: number; max: number }> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    let min = 255, max = 0;
    for (let y = 4; y < 64; y += 8) for (let x = 4; x < 64; x += 8) {
      const l = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      if (l < min) min = l; if (l > max) max = l;
    }
    return { min, max };
  });
}
async function maxGreen(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    let m = 0;
    for (let y = 4; y < 64; y += 8) for (let x = 4; x < 64; x += 8) {
      const g = ((E.pick_color(x, y) >>> 0) >>> 16) & 255;
      if (g > m) m = g;
    }
    return m;
  });
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

async function newDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "clouds");
    mv.engine.commit();
  });
}

// ── Integration: varied texture spanning fg↔bg ─────────────────────
test("clouds fill the layer with non-uniform black↔white texture", async ({ page }) => {
  await newDoc(page); // default black fg / white bg
  await page.evaluate(() => (window as any).__mv.fil.clouds());
  const { min, max } = await lumRange(page);
  expect(max - min).toBeGreaterThan(30); // varies across the image
  expect(min).toBeLessThan(110);          // reaches the dark (fg) end
  expect(max).toBeGreaterThan(145);       // reaches the light (bg) end
});

// ── Integration: blends the foreground and background colours ──────
test("clouds blend the foreground and background colours", async ({ page }) => {
  await newDoc(page);
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.set_foreground(255, 0, 0, 255); // red fg
    E.set_background(0, 0, 255, 255);  // blue bg
  });
  await page.evaluate(() => (window as any).__mv.fil.clouds());
  expect(await maxGreen(page)).toBeLessThan(40); // a red↔blue mix has ~no green
});

// ── Mouse + menu: Filter ▸ Render ▸ Clouds ─────────────────────────
test("the Filter ▸ Render ▸ Clouds menu item renders clouds", async ({ page }) => {
  await newDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Render", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Clouds")).toBe(true);
  await page.waitForTimeout(200);
  const { min, max } = await lumRange(page);
  expect(max - min).toBeGreaterThan(30);
});
