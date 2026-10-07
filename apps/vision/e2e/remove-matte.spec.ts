import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Matting ▸ Remove White Matte / Remove Black Matte ──
// Adobe spec (helpx "Remove fringe pixels"): when content was composited on a
// white or black background, the anti-aliased edge pixels keep a halo of that
// colour. Remove White/Black Matte un-mixes the matte from those edge pixels.
// One-click — no dialog. A 50%-grey-at-50%-alpha pixel reads as white once the
// black matte is removed, or black once the white matte is removed.
//
//   https://helpx.adobe.com/photoshop/using/defringing-selections.html

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
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

// a flat 50%-grey field at 50% alpha on a transparent layer (white base hidden).
async function grayHalf(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "matte");
    const E = mv.engine.engine; // capture AFTER newDocument
    const base = E.active_layer_id();
    E.add_layer("content");
    E.set_layer_visible(base, false); // hide the white base → real transparency
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(128, 128, 128, 128); // grey @ 50% alpha
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: removing each matte un-mixes the edge colour ──────
test("remove black matte recovers white; remove white matte recovers black", async ({ page }) => {
  await grayHalf(page);
  await page.evaluate(() => (window as any).__mv.store.removeMatte(false)); // black matte → white
  let p = await rgba(page, 20, 20);
  expect(p[0]).toBeGreaterThan(250);
  expect(p[3]).toBe(128); // alpha preserved

  await grayHalf(page);
  await page.evaluate(() => (window as any).__mv.store.removeMatte(true)); // white matte → black
  p = await rgba(page, 20, 20);
  expect(p[0]).toBeLessThan(8);
  expect(p[3]).toBe(128);
});

// ── Mouse + UI: the one-click Layer ▸ Remove White Matte menu item ─
test("the Layer ▸ Remove White Matte menu item recovers black", async ({ page }) => {
  await grayHalf(page);
  await openMenu(page, "Layer");
  expect(await clickMenuItem(page, "Remove White Matte")).toBe(true);
  await page.waitForTimeout(150);
  expect((await rgba(page, 20, 20))[0]).toBeLessThan(8);
});
