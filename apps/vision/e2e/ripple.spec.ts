import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Ripple ────────────────────────────
// Adobe spec (helpx "Distort filters"): Ripple creates an undulating pattern,
// like ripples on the surface of a pond — a sine displacement controlled by an
// Amount and a Size (Small/Medium/Large). The app had Spherize/Twirl/Polar but
// no Ripple.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// the horizontal span of the darkest pixel (the black line) across rows 5..35.
async function lineRange(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const xs: number[] = [];
    for (let y = 5; y < 35; y++) {
      let bx = 0, bl = 999;
      for (let x = 0; x < 40; x++) {
        const l = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
        if (l < bl) { bl = l; bx = x; }
      }
      xs.push(bx);
    }
    return Math.max(...xs) - Math.min(...xs);
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

// 40×40 white with a 2px vertical black line at x≈20.
async function vlineDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "rip");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(19, 0, 2, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: a straight line wobbles ───────────────────────────
test("ripple bends a straight vertical line", async ({ page }) => {
  await vlineDoc(page);
  expect(await lineRange(page)).toBe(0); // perfectly vertical before
  await page.evaluate(() => (window as any).__mv.distort.ripple(120, 0));
  expect(await lineRange(page)).toBeGreaterThanOrEqual(3); // now it wobbles across rows
});

// ── Mouse + UI: the Filter ▸ Distort ▸ Ripple… dialog ──────────────
test("the Filter ▸ Distort ▸ Ripple… dialog OK ripples the image", async ({ page }) => {
  await vlineDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Ripple…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Ripple", { exact: true })).toBeVisible(); // the dialog title
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await lineRange(page)).toBeGreaterThanOrEqual(3); // default amount/size bends it
});
