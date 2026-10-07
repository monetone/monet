import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Trace Contour ─────────────────────
// Adobe spec (helpx "Filter effects reference" / Stylize): "Finds the
// transitions of major brightness areas and thinly outlines them for each
// color channel, for an effect similar to the lines in a contour map."
// Controlled by Level (0–255) and Edge (Lower/Upper) — so it outlines ONE
// brightness, not every edge (the distinction from Find Edges). The app had
// Find Edges / Glowing Edges but no Trace Contour.
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

// 40×40, three vertical bands: 50 | 130 | 200, boundaries at x=13 and x=26.
async function threeBands(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "trace");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 13, 40, 0); E.fill_selection(50, 50, 50, 255);
    E.select_rect(13, 0, 13, 40, 0); E.fill_selection(130, 130, 130, 255);
    E.select_rect(26, 0, 14, 40, 0); E.fill_selection(200, 200, 200, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: outlines only the level that is crossed ───────────
// Level 90 crosses the 50→130 step (x=13) but not the 130→200 step (x=26):
// so just one of the two edges gets a contour — unlike Find Edges.
test("trace contour outlines only the edge that crosses the chosen level", async ({ page }) => {
  await threeBands(page);
  await page.evaluate(() => (window as any).__mv.fil.traceContour(90, true));
  expect(await lum(page, 13, 20)).toBe(0);   // 50→130 crosses 90 → black contour
  expect(await lum(page, 26, 20)).toBe(255); // 130→200 stays above 90 → no line
  expect(await lum(page, 6, 20)).toBe(255);  // flat interior → white
});

// ── Mouse + UI: the Trace Contour… dialog Level field ──────────────
test("the Filter ▸ Trace Contour… dialog Level field outlines that level", async ({ page }) => {
  await threeBands(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Trace Contour…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Level" }).fill("90");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await lum(page, 13, 20)).toBe(0);   // the crossed edge (default Edge = Upper)
  expect(await lum(page, 26, 20)).toBe(255); // the un-crossed edge stays white
});
