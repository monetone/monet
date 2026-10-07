import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Transform Selection ─────────────────────────
// Adobe spec (helpx "Move, copy and delete selections" / "Transform a
// selection"): Transform Selection scales, rotates and moves the selection
// MARQUEE (the outline) without affecting the pixels inside it — the options
// bar takes numeric W/H % and position. The app had no Transform Selection.
//
//   https://helpx.adobe.com/photoshop/using/moving-copying-deleting-selections.html

async function bounds(page: Page): Promise<number[]> {
  return await page.evaluate(() => [...(window as any).__mv.engine.engine.selection_bounds()]);
}
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[2] < 90;

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

// 40×40 with a red square selected at [10,30)×[10,30).
async function redSquareSelected(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "xfsel");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(10, 10, 20, 20, 0); E.fill_selection(220, 20, 20, 255);
    mv.engine.commit(); // selection stays active
  });
}

// ── Integration: scale shrinks the marquee, pixels untouched ───────
test("transformSelection scales the marquee without moving the pixels", async ({ page }) => {
  await redSquareSelected(page);
  expect(await bounds(page)).toEqual([10, 10, 20, 20]);
  await page.evaluate(() => (window as any).__mv.store.transformSelection(0.5, 0.5, 0, 0));
  expect(await bounds(page)).toEqual([15, 15, 10, 10]); // halved around (20,20)
  expect(isRed(await pixel(page, 12, 12))).toBe(true);   // the red pixels did NOT move
});

// ── Mouse + UI: the Width/Height fields ────────────────────────────
test("the Transform Selection dialog scales by Width/Height percent", async ({ page }) => {
  await redSquareSelected(page);
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Transform Selection…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Width" }).fill("50");
  await page.getByRole("spinbutton", { name: "Height" }).fill("50");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await bounds(page)).toEqual([15, 15, 10, 10]);
});

// ── Mouse + UI: the Move field ─────────────────────────────────────
test("the Transform Selection dialog moves the marquee by Move X", async ({ page }) => {
  await redSquareSelected(page);
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Transform Selection…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Move X" }).fill("10");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await bounds(page)).toEqual([20, 10, 20, 20]); // [10,30) → [20,40)
});
