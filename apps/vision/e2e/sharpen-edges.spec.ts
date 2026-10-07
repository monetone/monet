import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Sharpen ▸ Sharpen Edges ─────────────────────
// Adobe spec (helpx "Sharpen filters"): sharpens only the areas where major
// changes in colour occur (the edges), leaving smooth areas untouched —
// unlike Sharpen / Sharpen More, which sharpen the whole image. The app had
// Sharpen and Unsharp Mask but no Sharpen Edges.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

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

// 40×40 with `lo` left half, `hi` right half (one vertical edge at x=20).
async function splitDoc(page: Page, lo: number, hi: number) {
  await gotoApp(page);
  await page.evaluate(({ lo, hi }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "she");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(lo, lo, lo, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(hi, hi, hi, 255);
    E.select_none();
    mv.engine.commit();
  }, { lo, hi });
}

// ── Integration: a strong edge sharpens, flat interior untouched ───
test("sharpen edges overshoots a strong edge and leaves flat areas alone", async ({ page }) => {
  await splitDoc(page, 60, 200);
  await page.evaluate(() => (window as any).__mv.fil.sharpenEdges());
  expect(await lum(page, 20, 20)).toBeGreaterThan(230); // bright side up
  expect(await lum(page, 19, 20)).toBeLessThan(30);      // dark side down
  expect(await lum(page, 5, 20)).toBe(60);               // flat interior untouched
});

// ── Integration: a low-contrast edge is barely sharpened (gating) ──
test("a low-contrast edge is only mildly sharpened", async ({ page }) => {
  await splitDoc(page, 120, 140);
  await page.evaluate(() => (window as any).__mv.fil.sharpenEdges());
  const v = await lum(page, 20, 20);
  expect(v).toBeGreaterThan(140); expect(v).toBeLessThan(170); // not blown out like a strong edge
});

// ── Mouse + menu: Filter ▸ Sharpen Edges ───────────────────────────
test("the Filter ▸ Sharpen Edges menu item sharpens the edge", async ({ page }) => {
  await splitDoc(page, 60, 200);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Sharpen Edges")).toBe(true);
  await page.waitForTimeout(120);
  expect(await lum(page, 20, 20)).toBeGreaterThan(230);
  expect(await lum(page, 5, 20)).toBe(60); // flat untouched
});
