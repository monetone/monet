import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Noise ▸ Despeckle ───────────────────────────
// Adobe spec (helpx "Noise filters" / Despeckle): "Detects the edges in an
// image (areas where significant color changes occur) and blurs all of the
// selection except those edges. This blurring removes noise while preserving
// detail." It is a one-click filter — no dialog, no parameters.
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

// grey-100 field with one speck of value `v` at the centre (20,20).
async function speckDoc(page: Page, v: number) {
  await gotoApp(page);
  await page.evaluate((v) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "dspk");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(100, 100, 100, 255);
    E.select_rect(20, 20, 1, 1, 0); E.fill_selection(v, v, v, 255);
    E.select_none();
    mv.engine.commit();
  }, v);
}

// ── Integration: noise is smoothed, detail is preserved ────────────
test("despeckle smooths a faint speck but keeps a strong one crisp", async ({ page }) => {
  await speckDoc(page, 130); // Δ30 — noise
  await page.evaluate(() => (window as any).__mv.fil.despeckle());
  const faint = await lum(page, 20, 20);
  expect(faint).toBeLessThan(115);     // averaged toward the field…
  expect(faint).toBeGreaterThanOrEqual(100);

  await speckDoc(page, 255); // Δ155 — detail/edge
  await page.evaluate(() => (window as any).__mv.fil.despeckle());
  expect(await lum(page, 20, 20)).toBe(255); // preserved exactly
});

// ── Mouse + UI: the one-click Filter ▸ Despeckle menu item ─────────
test("the Filter ▸ Despeckle menu item smooths the faint speck", async ({ page }) => {
  await speckDoc(page, 130);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Despeckle")).toBe(true);
  await page.waitForTimeout(150);
  expect(await lum(page, 20, 20)).toBeLessThan(115);
});
