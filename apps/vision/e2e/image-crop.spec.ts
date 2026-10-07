import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Crop (crop to selection) ─────────────────────
// Adobe spec (helpx + community): with an active selection, Image ▸ Crop trims
// the canvas to the bounding RECTANGLE of the selection — an irregular (e.g.
// lasso) selection is cropped to the rectangle that contains it. Requires a
// selection (no-op otherwise). Distinct from the Crop *tool* (drag a rect).
//
//   https://community.adobe.com/t5/photoshop-ecosystem-discussions/crop-to-marquee-selection/m-p/14187684

const DOCW = 200;
const DOCH = 140;
const SQ = { x: 60, y: 40, w: 80, h: 60 }; // selection region

async function dims(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [E.width(), E.height()];
  });
}
async function bounds(page: Page): Promise<number[]> {
  return await page.evaluate(() => [...(window as any).__mv.engine.engine.selection_bounds()]);
}
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[2] < 90 && p[3] > 200;

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

async function setup(page: Page, fillRed: boolean): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, sq, fillRed }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "crop"); // white base
    const E = mv.engine.engine;          // capture AFTER newDocument
    if (fillRed) { E.select_rect(sq.x, sq.y, sq.w, sq.h, 0); E.fill_selection(220, 20, 20, 255); E.select_none(); }
    mv.store.setTool("marquee");
    mv.engine.commit();
    mv.store.fit();
  }, { w: DOCW, h: DOCH, sq: SQ, fillRed });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

async function marqueeDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(SQ.x), m.cy(SQ.y));
  await page.mouse.down();
  await page.mouse.move(m.cx(SQ.x + SQ.w), m.cy(SQ.y + SQ.h), { steps: 3 });
  await page.mouse.up();
}

// ── Integration: crop to a rectangular selection ───────────────────
test("cropToSelection crops the canvas to the selection bbox", async ({ page }) => {
  await setup(page, true); // red fills the selection region
  await page.evaluate(({ sq }) => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(sq.x, sq.y, sq.w, sq.h, 0);
  }, { sq: SQ });
  expect(await dims(page)).toEqual([DOCW, DOCH]);
  await page.evaluate(() => (window as any).__mv.xform.cropToSelection());
  expect(await dims(page)).toEqual([SQ.w, SQ.h]); // 80×60
  expect(isRed(await pixel(page, 0, 0))).toBe(true);            // selected content at origin
  expect(isRed(await pixel(page, SQ.w - 1, SQ.h - 1))).toBe(true);
});

// ── Integration: an irregular selection crops to its bounding rectangle ─
test("an irregular selection crops to its bounding rectangle", async ({ page }) => {
  await setup(page, false);
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(20, 20, 30, 30, 0);   // block A
    E.select_rect(120, 80, 40, 30, 1);  // add block B → L-shaped selection
  });
  const b = await bounds(page); // [x, y, w, h] of the union bbox
  await page.evaluate(() => (window as any).__mv.xform.cropToSelection());
  expect(await dims(page)).toEqual([b[2], b[3]]);
});

// ── Mouse + menu: marquee drag then Image ▸ Crop ───────────────────
test("a marquee drag then the Image ▸ Crop menu crops to that selection", async ({ page }) => {
  const m = await setup(page, false);
  await marqueeDrag(page, m);
  const b = await bounds(page); // the real mouse-made selection bbox
  expect(b[2]).toBeGreaterThan(40); // a real selection was made
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Crop")).toBe(true);
  await page.waitForTimeout(150);
  expect(await dims(page)).toEqual([b[2], b[3]]);
});

// ── No selection: Image ▸ Crop is a no-op ──────────────────────────
test("Image ▸ Crop does nothing with no active selection", async ({ page }) => {
  await setup(page, false); // no selection
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Crop")).toBe(true);
  await page.waitForTimeout(150);
  expect(await dims(page)).toEqual([DOCW, DOCH]); // unchanged
});
