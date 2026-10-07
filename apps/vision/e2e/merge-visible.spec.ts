import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Merge Visible (⇧⌘E) ──────────────────────────
// Adobe spec (helpx "Manage layers" + community): Merge Visible collapses all
// VISIBLE layers into one, leaving the composite unchanged and PRESERVING
// hidden layers — unlike Flatten, which discards hidden layers. The app had
// Merge Down (⌘E) and Flatten but no Merge Visible.
//
//   https://community.adobe.com/questions-712/what-is-the-difference-between-merge-down-merge-visible-and-flatten-image-1083175

const DOCW = 200;
const DOCH = 140;

async function layerCount(page: Page): Promise<number> {
  return await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
}
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[2] < 90;
const isBlue = (p: number[]) => p[2] > 180 && p[0] < 90;

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

// blue base + red-left-half top layer (both visible).
async function twoVisible(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "mv");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 0, 230, 255); E.select_none(); // base blue
    E.add_layer("top"); E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(230, 0, 0, 255); E.select_none(); // red left
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}

// ── Integration: merge two visible layers, composite unchanged ─────
test("mergeVisible collapses visible layers without changing the composite", async ({ page }) => {
  await twoVisible(page);
  expect(await layerCount(page)).toBe(2);
  expect(isRed(await pixel(page, 30, 70))).toBe(true);  // left red
  expect(isBlue(await pixel(page, 170, 70))).toBe(true); // right blue
  await page.evaluate(() => (window as any).__mv.store.mergeVisible());
  expect(await layerCount(page)).toBe(1);
  expect(isRed(await pixel(page, 30, 70))).toBe(true);  // unchanged
  expect(isBlue(await pixel(page, 170, 70))).toBe(true);
});

// ── Integration: hidden layers are preserved ───────────────────────
test("mergeVisible keeps hidden layers (unlike Flatten)", async ({ page }) => {
  await gotoApp(page);
  const greenId = await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "mvh");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 0, 230, 255); E.select_none(); // base blue
    const mid = E.add_layer("mid"); E.select_rect(0, 0, w, h, 0); E.fill_selection(0, 220, 0, 255); E.select_none(); // green
    E.add_layer("top"); E.select_rect(0, 0, w, h, 0); E.fill_selection(230, 0, 0, 255); E.select_none(); // red
    E.set_layer_visible(mid, false); // hide green
    mv.engine.commit();
    return mid;
  }, { w: DOCW, h: DOCH });
  expect(await layerCount(page)).toBe(3);
  await page.evaluate(() => (window as any).__mv.store.mergeVisible());
  expect(await layerCount(page)).toBe(2); // merged 2 visible, kept the hidden one
  expect(isRed(await pixel(page, 100, 70))).toBe(true); // composite still red
  const hiddenStillThere = await page.evaluate((id) => {
    const E = (window as any).__mv.engine.engine;
    return !E.layer_visible(id);
  }, greenId);
  expect(hiddenStillThere).toBe(true); // the green layer is present and still hidden
});

// ── Mouse + menu: Layer ▸ Merge Visible ────────────────────────────
test("the Layer ▸ Merge Visible menu item collapses the visible layers", async ({ page }) => {
  await twoVisible(page);
  await openMenu(page, "Layer");
  expect(await clickMenuItem(page, "Merge Visible")).toBe(true);
  await page.waitForTimeout(150);
  expect(await layerCount(page)).toBe(1);
  expect(isRed(await pixel(page, 30, 70))).toBe(true);
});

// ── Keyboard: ⇧⌘E runs Merge Visible (not Merge Down) ──────────────
test("⇧⌘E runs Merge Visible", async ({ page }) => {
  await twoVisible(page);
  await page.keyboard.press("Meta+Shift+KeyE");
  expect(await layerCount(page)).toBe(1);
  expect(isBlue(await pixel(page, 170, 70))).toBe(true);
});
