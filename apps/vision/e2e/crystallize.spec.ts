import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Pixelate ▸ Crystallize ──────────────────────
// Adobe spec (helpx "Filter effects reference" / Pixelate): "Clumps pixels into
// a solid color in a polygon shape." (a Voronoi mosaic). Controlled by Cell
// Size. So a smooth gradient flattens into constant-coloured cells, and a
// two-colour split stays only those two colours (no blends).
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

async function lum(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });
}
// count horizontally-adjacent equal-valued pairs across the doc.
async function equalRuns(page: Page, w: number, h: number): Promise<number> {
  return await page.evaluate(({ w, h }) => {
    const E = (window as any).__mv.engine.engine;
    const L = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) if (L(x, y) === L(x + 1, y)) n++;
    return n;
  }, { w, h });
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

// 48×48 horizontal gradient: every column a distinct grey.
async function gradientDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(48, 48, "cryst");
    const E = mv.engine.engine; // capture AFTER newDocument
    for (let x = 0; x < 48; x++) { const v = (x * 5) & 255; E.select_rect(x, 0, 1, 48, 0); E.fill_selection(v, v, v, 255); }
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: a gradient flattens into constant runs ────────────
test("crystallize flattens a gradient into solid-coloured cells", async ({ page }) => {
  await gradientDoc(page);
  expect(await equalRuns(page, 48, 48)).toBe(0); // gradient: no equal neighbours
  await page.evaluate(() => (window as any).__mv.fil.crystallize(8));
  expect(await equalRuns(page, 48, 48)).toBeGreaterThan(1000); // cells create long runs
});

// ── Mouse + UI: the Crystallize… dialog Cell Size field ────────────
test("the Filter ▸ Crystallize… dialog Cell Size field crystallizes", async ({ page }) => {
  await gradientDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Crystallize…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Cell Size" }).fill("8");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await equalRuns(page, 48, 48)).toBeGreaterThan(1000);
});
