import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Tiles ─────────────────────────────
// Adobe spec (helpx "Stylize filters"): Tiles "Breaks up an image into a series
// of tiles, offsetting the image from its original position. You can choose…
// Background Color, Foreground Color, Inverse Image, or Unaltered Image" to fill
// the area between the tiles. Controlled by Number Of Tiles and Maximum Offset.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// classify pixels into expected buckets.
async function counts(page: Page, w: number, h: number): Promise<Record<string, number>> {
  return await page.evaluate(({ w, h }) => {
    const E = (window as any).__mv.engine.engine;
    const out: Record<string, number> = { white: 0, black: 0, other: 0 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = E.pick_color(x, y) >>> 0;
      const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
      if (r === 255 && g === 255 && b === 255) out.white++;
      else if (r === 0 && g === 0 && b === 0) out.black++;
      else out.other++;
    }
    return out;
  }, { w, h });
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

// white 40×40 image, background colour set to black.
async function whiteOnBlackBg(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "tiles");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.store.setBackground({ h: 0, s: 0, v: 0, a: 1 }); // black canvas
    mv.engine.commit();
  });
}

// ── Integration: tiles offset and the background shows in the gaps ─
test("tiles offsets the image and the background colour shows in the gaps", async ({ page }) => {
  await whiteOnBlackBg(page);
  await page.evaluate(() => (window as any).__mv.fil.tiles(4, 80, 0)); // 4 tiles, 80% offset, bg fill
  const c = await counts(page, 40, 40);
  expect(c.white).toBeGreaterThan(0); // displaced tiles keep the image
  expect(c.black).toBeGreaterThan(0); // gaps reveal the background colour
  expect(c.other).toBe(0);            // solid colours only — no blending
});

// ── Mouse + UI: the Filter ▸ Tiles… dialog ─────────────────────────
test("the Filter ▸ Tiles… dialog offsets the tiles", async ({ page }) => {
  await whiteOnBlackBg(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Tiles…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Number Of Tiles" }).fill("4");
  await page.getByRole("spinbutton", { name: "Maximum Offset %" }).fill("80");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const c = await counts(page, 40, 40);
  expect(c.white).toBeGreaterThan(0);
  expect(c.black).toBeGreaterThan(0); // default fill is Background (black)
});
