import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Polar Coordinates ─────────────────
// Adobe spec (helpx "Distort filters"): converts the image between rectangular
// and polar coordinates. Rectangular→Polar wraps the image into a disc (a
// straight top/bottom split becomes concentric rings); Polar→Rectangular is
// the inverse. The app had Spherize/Twirl but no Polar Coordinates.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const D = 40; // small doc

async function lum(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });
}
const blk = async (page: Page, x: number, y: number) => (await lum(page, x, y)) < 40;
const wht = async (page: Page, x: number, y: number) => (await lum(page, x, y)) > 200;

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

// top half black, bottom half white.
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "polar");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d, d / 2, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(0, d / 2, d, d / 2, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  }, D);
}

// a centred black disc (radius 12) on white — radially symmetric.
async function discDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "polar2");
    const E = mv.engine.engine;
    E.select_rect(0, 0, d, d, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    E.select_ellipse(8, 8, 24, 24, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
  }, D);
}

// ── Integration: Rectangular → Polar is radially symmetric ─────────
test("rect-to-polar makes the split radially symmetric (dark centre, light rim)", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.polar(true));
  // inner radius dark on four angles…
  expect(await blk(page, 28, 20)).toBe(true);
  expect(await blk(page, 20, 28)).toBe(true);
  expect(await blk(page, 12, 20)).toBe(true);
  // …outer radius light on four angles.
  expect(await wht(page, 38, 20)).toBe(true);
  expect(await wht(page, 20, 38)).toBe(true);
  expect(await wht(page, 2, 20)).toBe(true);
});

// ── Integration: Polar → Rectangular makes rows uniform ────────────
test("polar-to-rect turns a radial disc into uniform rows", async ({ page }) => {
  await discDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.polar(false));
  expect(await blk(page, 5, 8)).toBe(true); // an inner row, uniformly dark across x
  expect(await blk(page, 35, 8)).toBe(true);
  expect(await wht(page, 5, 30)).toBe(true); // an outer row, uniformly light
  expect(await wht(page, 35, 30)).toBe(true);
});

// ── Mouse + UI: the Polar Coordinates… dialog (default Rect→Polar) ──
test("the Filter ▸ Distort ▸ Polar Coordinates… dialog OK wraps the image", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Polar Coordinates…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Rectangular to Polar", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await blk(page, 20, 20)).toBe(true); // centre dark
  expect(await wht(page, 38, 20)).toBe(true); // rim light
});

// ── Mouse + UI: choosing Polar to Rectangular ──────────────────────
test("choosing Polar to Rectangular in the dialog makes rows uniform", async ({ page }) => {
  await discDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Polar Coordinates…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByText("Polar to Rectangular", { exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await blk(page, 5, 8)).toBe(true);
  expect(await blk(page, 35, 8)).toBe(true);
});
