import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Wave ──────────────────────────────
// Adobe spec (helpx "Distort filters"): Wave "works much like the Ripple filter
// but with greater control. Options include the number of wave generators, the
// wavelength, the height (amplitude) of the wave, and the wave type: Sine,
// Triangle, or Square." So a straight line is displaced by the chosen wave.
//
//   https://helpx.adobe.com/photoshop/using/distort-filters.html

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
  for (let y = 0; y < 40; y++) xs.push(await lineX(page, y));
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

// white 40×40 with a 1px black vertical line at x=20.
async function vlineDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "wave");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(20, 0, 1, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: a sine wave bends a straight line ─────────────────
test("wave bends a straight vertical line across rows", async ({ page }) => {
  await vlineDoc(page);
  // 1 generator, wavelength 16, amplitude 5, horizontal only, sine.
  await page.evaluate(() => (window as any).__mv.distort.wave(1, 16, 16, 5, 5, 1, 0, 0, false));
  expect(await lineRange(page)).toBeGreaterThanOrEqual(6);
});

// ── Mouse + UI: the Filter ▸ Distort ▸ Wave… dialog ────────────────
test("the Filter ▸ Distort ▸ Wave… dialog bends the line", async ({ page }) => {
  await vlineDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Wave…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Number of Generators" }).fill("1");
  await page.getByRole("spinbutton", { name: "Amplitude Min" }).fill("5");
  await page.getByRole("spinbutton", { name: "Scale Vert %" }).fill("0");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  expect(await lineRange(page)).toBeGreaterThanOrEqual(4);
});
