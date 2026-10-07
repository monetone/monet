import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Blur ▸ Average ──────────────────────────────
// Adobe spec (helpx "Blur filters"): Average "Finds the average color of an
// image or selection, and then fills the image or selection with the color to
// create a smooth look." It is a one-click filter — no dialog, no parameters.
//
//   https://helpx.adobe.com/photoshop/using/blur-gallery.html

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

// 40×40: left half white, right half black (mean ≈ 128).
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "avg");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: the whole image becomes its mean colour ───────────
test("average fills the image with its mean colour", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.average());
  for (const [x, y] of [[5, 5], [20, 20], [35, 35]]) {
    const v = await lum(page, x, y);
    expect(v).toBeGreaterThanOrEqual(126);
    expect(v).toBeLessThanOrEqual(129);
  }
});

// ── Mouse + UI: the one-click Filter ▸ Average menu item ───────────
test("the Filter ▸ Average menu item averages the image", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Average")).toBe(true);
  await page.waitForTimeout(150);
  expect(await lum(page, 5, 5)).toBeGreaterThanOrEqual(126);
  expect(await lum(page, 35, 35)).toBeLessThanOrEqual(129);
});
