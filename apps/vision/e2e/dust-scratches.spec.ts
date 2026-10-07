import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Noise ▸ Dust & Scratches ────────────────────
// Adobe spec (helpx "Apply specific filters"): same technology as the Median
// filter plus a Threshold — a pixel is replaced by the neighbourhood median
// only where it differs by MORE than the threshold (≤ threshold is ignored).
// So specks are removed while detail within the threshold is preserved. The
// app only had a plain Median filter.
//
//   https://helpx.adobe.com/photoshop/using/applying-specific-filters.html

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

// grey-100 field with a single white speck at (20,20).
async function speckDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "dust");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(100, 100, 100, 255);
    E.select_rect(20, 20, 1, 1, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: removes a speck above the threshold ───────────────
test("dust & scratches removes a speck that exceeds the threshold", async ({ page }) => {
  await speckDoc(page);
  expect(await lum(page, 20, 20)).toBe(255); // speck before
  await page.evaluate(() => (window as any).__mv.fil.dustScratches(2, 50));
  expect(await lum(page, 20, 20)).toBeLessThan(110); // replaced by the median ≈100
});

// ── Integration: a high threshold preserves the speck ──────────────
test("a high threshold ignores the speck", async ({ page }) => {
  await speckDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.dustScratches(2, 200));
  expect(await lum(page, 20, 20)).toBeGreaterThan(247); // |255−100|=155 < 200 → kept
});

// ── Mouse + UI: the Dust & Scratches… dialog (defaults) ────────────
test("the Filter ▸ Dust & Scratches… dialog OK cleans the speck", async ({ page }) => {
  await speckDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Dust & Scratches…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Threshold", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  expect(await lum(page, 20, 20)).toBeLessThan(110); // default radius 2 / threshold 30 removes it
});
