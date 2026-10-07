import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Transform on the ACTIVE LAYER ─────────────────
// Adobe spec (helpx "Rotate and flip images"): Edit ▸ Transform ▸ Flip
// Horizontal / Flip Vertical / Rotate 180° mirror or turn ONLY the active
// layer — "any of the rotation options apply only to each layer selected,"
// without affecting the rest of the stack. This is distinct from Image ▸
// Flip Canvas, which remaps the whole document. The app only had the
// canvas-level flips; this adds the layer-level Transform commands.
//
//   https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/rotate-or-flip-images.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
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

// White base + a top (active) layer with a red strip on the LEFT half,
// transparent elsewhere. Flipping the top layer moves the red to the right
// and reveals the untouched white base on the left.
async function twoLayerDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "lx"); // white base layer
    const E = mv.engine.engine;       // capture AFTER newDocument (it swaps the engine)
    E.add_layer("top");               // active layer on top
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(230, 30, 30, 255); // red left half
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}

const isRed = (p: number[]) => p[0] > 180 && p[2] < 90;
const isWhite = (p: number[]) => p[0] > 200 && p[2] > 200;

// ── Integration: flip only the active layer ────────────────────────
test("flipLayerH mirrors only the active layer, leaving the base untouched", async ({ page }) => {
  await twoLayerDoc(page);
  expect(isRed(await pixel(page, 30, 70))).toBe(true);    // red on the left before
  expect(isWhite(await pixel(page, 170, 70))).toBe(true); // white base on the right before
  await page.evaluate(() => (window as any).__mv.xform.flipLayerH());
  expect(isRed(await pixel(page, 170, 70))).toBe(true);   // red moved to the right
  expect(isWhite(await pixel(page, 30, 70))).toBe(true);  // white base revealed on the left
});

test("flipLayerV mirrors the active layer vertically", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "lv");
    const E = mv.engine.engine;
    E.add_layer("top");
    E.select_rect(0, 0, w, h / 2, 0); E.fill_selection(230, 30, 30, 255); // red TOP half
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
  expect(isRed(await pixel(page, 100, 30))).toBe(true);   // red on top before
  expect(isWhite(await pixel(page, 100, 110))).toBe(true);
  await page.evaluate(() => (window as any).__mv.xform.flipLayerV());
  expect(isRed(await pixel(page, 100, 110))).toBe(true);  // red moved to the bottom
  expect(isWhite(await pixel(page, 100, 30))).toBe(true);
});

test("rotateLayer180 turns the active layer upside-down", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "lr");
    const E = mv.engine.engine;
    E.add_layer("top");
    E.select_rect(0, 0, 40, 30, 0); E.fill_selection(230, 30, 30, 255); // red TOP-LEFT corner
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
  expect(isRed(await pixel(page, 20, 15))).toBe(true);        // top-left before
  expect(isWhite(await pixel(page, 180, 125))).toBe(true);
  await page.evaluate(() => (window as any).__mv.xform.rotateLayer180());
  expect(isRed(await pixel(page, 180, 125))).toBe(true);      // rotated to bottom-right
  expect(isWhite(await pixel(page, 20, 15))).toBe(true);
});

// ── Mouse + UI: the Edit ▸ Flip Horizontal menu command ────────────
test("the Edit ▸ Flip Horizontal menu item flips the active layer", async ({ page }) => {
  await twoLayerDoc(page);
  expect(isRed(await pixel(page, 30, 70))).toBe(true); // red on the left before
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Flip Horizontal")).toBe(true);
  await page.waitForTimeout(120);
  expect(isRed(await pixel(page, 170, 70))).toBe(true);  // red moved to the right
  expect(isWhite(await pixel(page, 30, 70))).toBe(true); // base on the left
});

// ── Distinct from Image ▸ Flip Canvas (whole document) ─────────────
// The layer flip must NOT touch the inactive base layer; the canvas flip MUST.
// Put a green marker on the BOTTOM layer, an empty active layer on top.
async function bottomMarkerDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "cm"); // white base
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, h, 0); E.fill_selection(20, 200, 60, 255); // green strip on the base, left
    E.select_none();
    E.add_layer("top"); // empty active layer on top
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}
const isGreen = (p: number[]) => p[1] > 150 && p[0] < 120;

test("flipping the active (empty) layer leaves the bottom layer's marker put", async ({ page }) => {
  await bottomMarkerDoc(page);
  expect(isGreen(await pixel(page, 20, 70))).toBe(true);  // green on the left
  await page.evaluate(() => (window as any).__mv.xform.flipLayerH()); // flips the empty top layer
  expect(isGreen(await pixel(page, 20, 70))).toBe(true);  // still on the left — bottom untouched
  expect(isGreen(await pixel(page, 180, 70))).toBe(false);
});

test("Image ▸ Flip Canvas Horizontal mirrors the whole stack (bottom layer too)", async ({ page }) => {
  await bottomMarkerDoc(page);
  expect(isGreen(await pixel(page, 20, 70))).toBe(true);  // green on the left before
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Flip Canvas Horizontal")).toBe(true);
  await page.waitForTimeout(120);
  expect(isGreen(await pixel(page, 180, 70))).toBe(true); // canvas flip moved the bottom marker
  expect(isGreen(await pixel(page, 20, 70))).toBe(false);
});
