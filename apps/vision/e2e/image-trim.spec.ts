import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Trim ─────────────────────────────────────────
// Adobe spec (helpx "Crop and straighten photos" / Trim command): Image ▸ Trim
// crops away a uniform border — Based On Transparent Pixels, Top Left Pixel
// Color, or Bottom Right Pixel Color — on any subset of the Top/Bottom/Left/
// Right sides. The app had no Trim command at all; this adds it.
//
//   https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html

const DOCW = 200;
const DOCH = 140;
// red content square: doc (60,40)–(140,100) → 80×60, white border around it.
const SQ = { x: 60, y: 40, w: 80, h: 60 };

async function dims(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [E.width(), E.height()];
  });
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

// White doc with a red square in the middle (white border on all sides).
async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h, sq }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "trim"); // white base
    const E = mv.engine.engine;          // capture AFTER newDocument
    E.select_rect(sq.x, sq.y, sq.w, sq.h, 0); E.fill_selection(220, 20, 20, 255);
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH, sq: SQ });
}

// ── Integration: Based On Top Left (white) trims the border ─────────
test("trim by top-left colour crops to the content square", async ({ page }) => {
  await setup(page);
  expect(await dims(page)).toEqual([DOCW, DOCH]);
  await page.evaluate(() => (window as any).__mv.xform.trim(1, true, true, true, true));
  expect(await dims(page)).toEqual([SQ.w, SQ.h]); // 80×60
  expect(isRed(await pixel(page, 0, 0))).toBe(true);            // content at the origin
  expect(isRed(await pixel(page, SQ.w - 1, SQ.h - 1))).toBe(true);
});

// ── Integration: only Left + Right sides ────────────────────────────
test("trimming only Left and Right keeps the full height", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mv.xform.trim(1, false, false, true, true));
  expect(await dims(page)).toEqual([SQ.w, DOCH]); // width trimmed, height kept
});

// ── Integration: Based On Transparent pixels ────────────────────────
test("trim by transparent pixels crops away the empty border", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h, sq }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "trimT");
    const E = mv.engine.engine;
    const base = E.layer_id_at(0); // the white base (visual top of a 1-layer doc)
    E.add_layer("content");        // transparent active layer
    E.select_rect(sq.x, sq.y, sq.w, sq.h, 0); E.fill_selection(220, 20, 20, 255);
    E.select_none();
    E.set_layer_visible(base, false); // hide the opaque base → transparent border
    mv.engine.commit();
  }, { w: DOCW, h: DOCH, sq: SQ });
  await page.evaluate(() => (window as any).__mv.xform.trim(0, true, true, true, true));
  expect(await dims(page)).toEqual([SQ.w, SQ.h]);
  expect(isRed(await pixel(page, 0, 0))).toBe(true);
});

// ── Mouse + UI: the Image ▸ Trim… dialog (default = Top Left, all sides) ─
test("the Image ▸ Trim… menu opens a dialog whose OK trims to the content", async ({ page }) => {
  await setup(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Trim…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Based On", { exact: true })).toBeVisible();
  await expect(page.getByText("Trim Away", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await dims(page)).toEqual([SQ.w, SQ.h]);
});

// ── Mouse + UI: unchecking Top & Bottom trims only L/R ──────────────
test("unchecking Top and Bottom in the dialog trims only the sides", async ({ page }) => {
  await setup(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Trim…")).toBe(true);
  await page.waitForTimeout(200);
  // uncheck Top and Bottom (exact match avoids the "Top Left" segment label)
  await page.getByText("Top", { exact: true }).click();
  await page.getByText("Bottom", { exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await dims(page)).toEqual([SQ.w, DOCH]); // height preserved
});
