import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Transform ▸ Skew ──────────────────────────────
// Adobe spec (helpx "Skew, distort items"): Skew "slants an item vertically and
// horizontally." It shears the layer about its centre — a vertical line slants
// across the rows. The app had Free Transform / Perspective but no Skew.
//
//   https://helpx.adobe.com/photoshop/using/scale-rotate-skew-distort-apply.html

async function lineX(page: Page, y: number): Promise<number> {
  return await page.evaluate((y) => {
    const E = (window as any).__mv.engine.engine;
    let bx = 0, bl = 256;
    for (let x = 0; x < 40; x++) { const l = ((E.pick_color(x, y) >>> 0) >>> 24) & 255; if (l < bl) { bl = l; bx = x; } }
    return bx;
  }, y);
}
async function lineRange(page: Page): Promise<number> {
  const xs: number[] = [];
  for (let y = 2; y < 38; y++) xs.push(await lineX(page, y));
  return Math.max(...xs) - Math.min(...xs);
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

// a black vertical line on a transparent layer over the white Background, so the
// skew's transparent corners show white (not confused with the black line).
async function vlineDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "skew");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.add_layer("line"); // transparent, active
    E.select_rect(20, 0, 1, 40, 0); E.fill_selection(0, 0, 0, 255); // black line
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: a horizontal skew slants the vertical line ────────
test("skew slants a vertical line across the rows", async ({ page }) => {
  await vlineDoc(page);
  expect(await lineRange(page)).toBe(0); // straight before
  await page.evaluate(() => (window as any).__mv.xform.skewLayer(30, 0));
  expect(await lineRange(page)).toBeGreaterThanOrEqual(8);
  expect(await lineX(page, 20)).toBe(20); // the centre row is the pivot
});

// ── Mouse + UI: the Edit ▸ Transform ▸ Skew… dialog ────────────────
test("the Edit ▸ Skew… dialog Horizontal field slants the line", async ({ page }) => {
  await vlineDoc(page);
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Skew…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Horizontal" }).fill("30");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await lineRange(page)).toBeGreaterThanOrEqual(8);
});
