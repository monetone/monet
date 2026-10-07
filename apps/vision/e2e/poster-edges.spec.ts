import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Artistic ▸ Poster Edges ─────────────────────
// Adobe spec (helpx "Filter effects reference" / Artistic): "Reduces the number
// of colors in an image according to the posterization option you set, finds the
// edges of the image, and draws black lines on them." Controlled by Edge
// Thickness, Edge Intensity and Posterization.
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

// 40×40: black left half, white right half (a sharp edge at x=20).
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "poster");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: dark edge line at the boundary, flats unchanged ───
test("poster edges draws a dark line at the boundary and leaves the flats", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.posterEdges(4, 1, 4));
  expect(await lum(page, 5, 20)).toBe(0);    // flat black stays black
  expect(await lum(page, 35, 20)).toBe(255); // flat white stays white
  expect(await lum(page, 20, 20)).toBeLessThan(120); // the boundary is darkened
});

// ── Mouse + UI: the Filter ▸ Poster Edges… dialog ──────────────────
test("the Filter ▸ Poster Edges… dialog OK draws the edge line", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Poster Edges…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "OK", exact: true }).click(); // defaults
  await page.waitForTimeout(150);
  expect(await lum(page, 20, 20)).toBeLessThan(120);
  expect(await lum(page, 5, 20)).toBe(0);
});
