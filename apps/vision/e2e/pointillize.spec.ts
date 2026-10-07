import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Pixelate ▸ Pointillize ──────────────────────
// Adobe spec (helpx "Filter effects reference" / Pixelate): "Breaks up the color
// in an image into randomly placed dots, as in a pointillist painting, and uses
// the background color as a canvas area between the dots." Controlled by Cell
// Size. So dots take the image colour and the gaps take the background colour.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// classify every pixel into one of the expected colour buckets.
async function counts(page: Page, w: number, h: number): Promise<Record<string, number>> {
  return await page.evaluate(({ w, h }) => {
    const E = (window as any).__mv.engine.engine;
    const out: Record<string, number> = { white: 0, green: 0, red: 0, blue: 0, other: 0 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = E.pick_color(x, y) >>> 0;
      const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
      if (r === 255 && g === 255 && b === 255) out.white++;
      else if (r === 0 && g === 255 && b === 0) out.green++;
      else if (r === 255 && g === 0 && b === 0) out.red++;
      else if (r === 0 && g === 0 && b === 255) out.blue++;
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

// white 48×48 image, with the background colour set to green.
async function whiteOnGreenBg(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(48, 48, "pointl");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 48, 48, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.store.setBackground({ h: 120, s: 1, v: 1, a: 1 }); // green canvas
    mv.engine.commit();
  });
}

// ── Integration: dots over the background colour ───────────────────
test("pointillize scatters white dots over the green background colour", async ({ page }) => {
  await whiteOnGreenBg(page);
  await page.evaluate(() => (window as any).__mv.fil.pointillize(8));
  const c = await counts(page, 48, 48);
  expect(c.white).toBeGreaterThan(0);  // dots keep the source colour
  expect(c.green).toBeGreaterThan(0);  // gaps show the background colour
  expect(c.red + c.blue + c.other).toBe(0); // nothing else appears
});

// ── Mouse + UI: the Pointillize… dialog Cell Size field ────────────
test("the Filter ▸ Pointillize… dialog Cell Size field pointillizes", async ({ page }) => {
  await whiteOnGreenBg(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Pointillize…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Cell Size" }).fill("8");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const c = await counts(page, 48, 48);
  expect(c.white).toBeGreaterThan(0);
  expect(c.green).toBeGreaterThan(0);
  expect(c.other).toBe(0);
});
