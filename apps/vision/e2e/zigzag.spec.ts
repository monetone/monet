import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ ZigZag ────────────────────────────
// Adobe spec (helpx "Distort filters"): ZigZag distorts pixels around the
// centre with a sine of the distance — Amount sets the magnitude, Ridges the
// number of direction reversals, Style is Around Center / Out From Center /
// Pond Ripples (water ripples). The app had Spherize/Twirl/Polar/Ripple.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// vertical span of the darkest pixel (the black line) across columns 4..36.
async function lineRange(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const ys: number[] = [];
    for (let x = 4; x < 36; x++) {
      let by = 0, bl = 999;
      for (let y = 0; y < 40; y++) {
        const l = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
        if (l < bl) { bl = l; by = y; }
      }
      ys.push(by);
    }
    return Math.max(...ys) - Math.min(...ys);
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

// 40×40 white with a 2px horizontal black line at y≈8.
async function hlineDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "zz");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(0, 7, 40, 2, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: a straight line warps ─────────────────────────────
test("zigzag warps a straight horizontal line", async ({ page }) => {
  await hlineDoc(page);
  expect(await lineRange(page)).toBe(0); // straight before
  await page.evaluate(() => (window as any).__mv.distort.zigzag(100, 5, 1));
  expect(await lineRange(page)).toBeGreaterThanOrEqual(3); // now it ripples across columns
});

// ── Mouse + UI: the Filter ▸ Distort ▸ ZigZag… dialog ──────────────
test("the Filter ▸ Distort ▸ ZigZag… dialog OK ripples the image", async ({ page }) => {
  await hlineDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "ZigZag…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("ZigZag", { exact: true })).toBeVisible(); // the dialog title
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await lineRange(page)).toBeGreaterThanOrEqual(2); // default amount/ridges
});
