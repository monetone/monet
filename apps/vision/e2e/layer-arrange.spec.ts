import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Arrange ──────────────────────────────────────
// Adobe spec (Photoshop Essentials / helpx): Layer ▸ Arrange reorders the
// active layer — Bring to Front (⇧⌘]), Bring Forward (⌘]), Send Backward
// (⌘[), Send to Back (⇧⌘[). The app had no Arrange commands/shortcuts.
//
//   https://www.photoshopessentials.com/basics/layer-shortcuts/

const DOCW = 160;
const DOCH = 120;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
async function order(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return Array.from({ length: E.layer_count() }, (_, i) => E.layer_id_at(i));
  });
}
async function ids(page: Page): Promise<{ blue: number; green: number; red: number }> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine; // [red(top), green, blue(bottom)]
    return { red: E.layer_id_at(0), green: E.layer_id_at(1), blue: E.layer_id_at(2) };
  });
}
const isRed = (p: number[]) => p[0] > 170 && p[1] < 90 && p[2] < 90;
const isGreen = (p: number[]) => p[1] > 150 && p[0] < 90;
const isBlue = (p: number[]) => p[2] > 170 && p[0] < 90;

// Three opaque full-canvas layers: blue (bottom) · green · red (top, active).
async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "arr");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 0, 230, 255); E.select_none(); // base blue
    E.add_layer("green"); E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 200, 0, 255); E.select_none();
    E.add_layer("red"); E.select_rect(0, 0, w, h, 0); E.fill_selection(230, 0, 0, 255); E.select_none();
    mv.engine.commit(); // active = red (top)
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
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

// ── Integration: Send to Back / Bring to Front ─────────────────────
test("arrangeLayer(SendToBack) drops the active layer to the bottom", async ({ page }) => {
  await setup(page);
  const { red, green } = await ids(page);
  expect(isRed(await pixel(page, 80, 60))).toBe(true); // red on top initially
  await page.evaluate(() => (window as any).__mv.store.arrangeLayer(3)); // active = red → back
  expect(isGreen(await pixel(page, 80, 60))).toBe(true); // green now on top
  const o = await order(page);
  expect(o[0]).toBe(green);
  expect(o[2]).toBe(red); // red is now the bottom layer
});

test("arrangeLayer(BringToFront) raises the active layer to the top", async ({ page }) => {
  await setup(page);
  const { blue } = await ids(page);
  await page.evaluate((blue) => (window as any).__mv.store.selectLayer(blue), blue);
  await page.evaluate(() => (window as any).__mv.store.arrangeLayer(0)); // blue → front
  expect(isBlue(await pixel(page, 80, 60))).toBe(true);
  expect((await order(page))[0]).toBe(blue);
});

// ── Keyboard: ⇧⌘[ send to back · ⌘] bring forward ──────────────────
test("⇧⌘[ sends the active layer to the back", async ({ page }) => {
  await setup(page); // active = red top
  const { red } = await ids(page);
  await page.keyboard.press("Meta+Shift+BracketLeft");
  expect(isGreen(await pixel(page, 80, 60))).toBe(true); // red dropped → green on top
  expect((await order(page))[2]).toBe(red);
});

test("⌘] brings the active layer forward one step", async ({ page }) => {
  await setup(page);
  const { blue, green } = await ids(page);
  await page.evaluate((blue) => (window as any).__mv.store.selectLayer(blue), blue); // active = bottom blue
  await page.keyboard.press("Meta+BracketRight"); // bring forward one
  // order was [red, green, blue]; blue moves up one → [red, blue, green]
  const o = await order(page);
  expect(o[1]).toBe(blue);
  expect(o[2]).toBe(green);
});

// ── Mouse + menu: Layer ▸ Arrange ▸ Send to Back ───────────────────
test("the Layer ▸ Arrange ▸ Send to Back menu item drops the active layer", async ({ page }) => {
  await setup(page); // active = red top
  await openMenu(page, "Layer");
  await page.getByText("Arrange", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Send to Back")).toBe(true);
  await page.waitForTimeout(150);
  expect(isGreen(await pixel(page, 80, 60))).toBe(true); // red sent to back → green on top
});
