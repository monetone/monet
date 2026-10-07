import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Texture ▸ Stained Glass ─────────────────────
// Adobe spec (helpx "Filter effects reference" / Texture): "Repaints an image as
// single-colored adjacent cells outlined in the foreground color." Controlled by
// Cell Size, Border Thickness and Light Intensity. So cells take the image
// colour and the seams between them are painted in the foreground colour.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

async function counts(page: Page, w: number, h: number): Promise<Record<string, number>> {
  return await page.evaluate(({ w, h }) => {
    const E = (window as any).__mv.engine.engine;
    const out: Record<string, number> = { red: 0, blue: 0, black: 0, other: 0 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = E.pick_color(x, y) >>> 0;
      const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
      if (r === 255 && g === 0 && b === 0) out.red++;
      else if (r === 0 && g === 0 && b === 255) out.blue++;
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

// red | blue split, with the foreground colour set to black (the lead).
async function redBlue(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(48, 48, "glass");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 24, 48, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(24, 0, 24, 48, 0); E.fill_selection(0, 0, 255, 255);
    E.select_none();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black lead
    mv.engine.commit();
  });
}

// ── Integration: cells keep the source colour, seams are the fg lead ──
test("stained glass keeps red/blue cells and draws a black foreground lead", async ({ page }) => {
  await redBlue(page);
  await page.evaluate(() => (window as any).__mv.fil.stainedGlass(6, 1, 0));
  const c = await counts(page, 48, 48);
  expect(c.red).toBeGreaterThan(0);   // cells keep the image colours
  expect(c.blue).toBeGreaterThan(0);
  expect(c.black).toBeGreaterThan(0); // seams drawn in the foreground colour
  expect(c.other).toBe(0);            // solid colours only
});

// ── Mouse + UI: the Filter ▸ Stained Glass… dialog ─────────────────
test("the Filter ▸ Stained Glass… dialog draws the lead", async ({ page }) => {
  await redBlue(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Stained Glass…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Cell Size" }).fill("6");
  await page.getByRole("spinbutton", { name: "Border Thickness" }).fill("1");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const c = await counts(page, 48, 48);
  expect(c.black).toBeGreaterThan(0);
  expect(c.red + c.blue).toBeGreaterThan(0);
});
