import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Define Pattern + Edit ▸ Fill ▸ Pattern ─────────
// Adobe spec (helpx "Define an image as a preset pattern"): select an area,
// Edit ▸ Define Pattern captures it; Edit ▸ Fill with Use = Pattern then tiles
// it across the selection/layer (aligned to the document origin). The app had
// fg/bg/black/gray/white fills but no pattern.
//
//   https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/define-an-image-as-a-preset-pattern.html

async function px(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[1] < 60 && p[2] < 60;
const isBlue = (p: number[]) => p[2] > 180 && p[0] < 60;
const isYellow = (p: number[]) => p[0] > 180 && p[1] > 180 && p[2] < 60;

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

// 8×8 doc with a 2×2 swatch (red/green/blue/yellow) selected in the top-left.
async function swatchDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(8, 8, "pat");
    const E = mv.engine.engine; // capture AFTER newDocument
    const dot = (x: number, y: number, r: number, g: number, b: number) => { E.select_rect(x, y, 1, 1, 0); E.fill_selection(r, g, b, 255); };
    dot(0, 0, 220, 0, 0); dot(1, 0, 0, 220, 0); dot(0, 1, 0, 0, 220); dot(1, 1, 220, 220, 0);
    E.select_rect(0, 0, 2, 2, 0); // select the 2×2 swatch
    mv.engine.commit();
  });
}

// ── Integration: define then fill tiles the pattern ────────────────
test("define pattern then fill tiles it across the layer", async ({ page }) => {
  await swatchDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.definePattern();
    mv.store.deselect();
    mv.store.fillContents("pattern", 1, "normal");
  });
  expect(isRed(await px(page, 0, 0))).toBe(true);
  expect(isRed(await px(page, 2, 0))).toBe(true);    // repeats every 2px
  expect(isYellow(await px(page, 1, 1))).toBe(true);
  expect(isBlue(await px(page, 4, 5))).toBe(true);   // tile (0,1) = blue
});

// ── Mouse + menu: Edit ▸ Define Pattern ────────────────────────────
test("the Edit ▸ Define Pattern menu captures a pattern", async ({ page }) => {
  await swatchDoc(page);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_pattern())).toBe(false);
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Define Pattern")).toBe(true);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_pattern())).toBe(true);
  // and filling with it tiles
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.deselect(); mv.store.fillContents("pattern", 1, "normal"); });
  expect(isRed(await px(page, 2, 0))).toBe(true);
});

// ── Mouse + UI: the Fill dialog Pattern contents ───────────────────
test("the Edit ▸ Fill dialog with Contents = Pattern tiles the pattern", async ({ page }) => {
  await swatchDoc(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.definePattern(); mv.store.deselect(); });
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Fill…")).toBe(true);
  await page.waitForTimeout(200);
  await chooseOption(page.locator("#mv-fill-contents"), "pattern");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(isYellow(await px(page, 3, 3))).toBe(true); // tile (1,1) = yellow
});
