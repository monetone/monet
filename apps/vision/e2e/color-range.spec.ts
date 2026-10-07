import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Color Range ─────────────────────────────────
// Adobe spec (helpx "Select a color range"): selects a specified color
// throughout the image (non-contiguous, unlike the Magic Wand), with a
// Fuzziness slider (0–200) that controls the range and produces a graded,
// partially-selected mask. The app had the Magic Wand but no Color Range.
//
//   https://helpx.adobe.com/photoshop/using/selecting-color-range.html

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isGreen = (p: number[]) => p[1] > 200 && p[0] < 60 && p[2] < 60;
const isBlue = (p: number[]) => p[2] > 200 && p[0] < 60 && p[1] < 60;

// fill the current selection with green and commit (to read the selection back).
async function fillGreen(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.fill_selection(0, 255, 0, 255);
    mv.engine.commit();
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

// red left / blue right, foreground set to red (the colour-range target).
async function redBlue(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "cr");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(0, 0, 255, 255);
    E.select_none();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red target
    mv.engine.commit();
  });
}

// ── Integration: selects the matching colour only ──────────────────
test("color range selects the red and leaves the blue unselected", async ({ page }) => {
  await redBlue(page);
  await page.evaluate(() => (window as any).__mv.store.colorRangeSelect(50, 0));
  await fillGreen(page);
  expect(isGreen(await pixel(page, 5, 20))).toBe(true);  // red was selected → filled
  expect(isBlue(await pixel(page, 35, 20))).toBe(true);  // blue not selected → untouched
});

// ── Mouse + UI: the Select ▸ Color Range… dialog ───────────────────
test("the Select ▸ Color Range… dialog Fuzziness field selects the red", async ({ page }) => {
  await redBlue(page);
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Color Range…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Color Range", { exact: true })).toBeVisible(); // dialog title
  await page.getByRole("spinbutton", { name: "Fuzziness" }).fill("50");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  await fillGreen(page);
  expect(isGreen(await pixel(page, 5, 20))).toBe(true);
  expect(isBlue(await pixel(page, 35, 20))).toBe(true);
});
