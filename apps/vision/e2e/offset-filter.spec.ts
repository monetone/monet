import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Other ▸ Offset ──────────────────────────────
// Adobe spec (helpx "Apply specific filters"): Offset shifts the layer by a
// Horizontal (+ right) and Vertical (+ down) amount; the newly exposed area is
// Wrapped Around, Repeated from the edge, or Set to the Background colour. The
// app had no Offset filter; this adds it (engine + Filter ▸ Other ▸ Offset…).
//
//   https://helpx.adobe.com/photoshop/using/applying-specific-filters.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[1] < 80 && p[2] < 80;
const isWhite = (p: number[]) => p[0] > 200 && p[1] > 200 && p[2] > 200;
const isBlue = (p: number[]) => p[2] > 180 && p[0] < 80;

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

// White doc with a red square touching the top-left corner ([0,20)×[0,20)).
async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "off");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 20, 0); E.fill_selection(220, 20, 20, 255); E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}

// ── Integration: Wrap Around ───────────────────────────────────────
test("offset wraps content off one edge onto the opposite", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mv.fil.offset(60, 0, 0)); // right 60, wrap
  expect(isRed(await pixel(page, 70, 10))).toBe(true);  // square moved to x≈[60,80)
  expect(isWhite(await pixel(page, 10, 10))).toBe(true); // its old spot is now white
});

// ── Integration: Set to Background ─────────────────────────────────
test("offset with Set to Background fills the exposed area with the bg colour", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "offb");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(220, 20, 20, 255); E.select_none(); // all red
    E.set_background(0, 0, 255, 255); // blue bg
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
  await page.evaluate(() => (window as any).__mv.fil.offset(40, 0, 2)); // right 40, exposed = bg
  expect(isBlue(await pixel(page, 10, 70))).toBe(true);  // exposed left columns
  expect(isRed(await pixel(page, 100, 70))).toBe(true);  // shifted red content
});

// ── Mouse + UI: the Filter ▸ Other ▸ Offset… dialog (default = Wrap) ─
test("the Offset… dialog OK shifts the layer with Wrap Around", async ({ page }) => {
  await setup(page);
  await openMenu(page, "Filter");
  await page.getByText("Other", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Offset…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Undefined Areas", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  // default 10,10 wrap → square moves to [10,30); its old corner becomes white
  expect(isRed(await pixel(page, 15, 15))).toBe(true);
  expect(isWhite(await pixel(page, 5, 5))).toBe(true);
});

// ── Mouse + UI: choosing Repeat Edge changes the exposed area ───────
test("choosing Repeat Edge in the dialog repeats the edge pixels", async ({ page }) => {
  await setup(page);
  await openMenu(page, "Filter");
  await page.getByText("Other", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Offset…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByText("Repeat Edge", { exact: true }).click(); // segment
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  // default 10,10 repeat → the red corner edge is repeated into the exposed area
  expect(isRed(await pixel(page, 5, 5))).toBe(true); // NOT white (that would be Wrap)
});
