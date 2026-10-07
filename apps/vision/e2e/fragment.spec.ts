import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Pixelate ▸ Fragment ─────────────────────────
// Adobe spec (helpx "Filter effects reference" / Pixelate): "Creates four
// copies of the pixels in the selection, averages them, and offsets them from
// each other." It is a one-click filter — no dialog, no parameters. So a lone
// bright pixel becomes four quarter-bright ghosts and the original goes dark.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

async function lum(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });
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

// 40×40 black, with one white pixel at the centre (20,20).
async function dotDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "frag");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 20, 1, 1, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: the lone pixel splits into four diagonal ghosts ───
test("fragment splits a lone pixel into four quarter-bright diagonal ghosts", async ({ page }) => {
  await dotDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.fragment());
  expect(await lum(page, 20, 20)).toBe(0); // the original goes dark
  for (const [x, y] of [[16, 16], [24, 24], [16, 24], [24, 16]]) {
    expect(await lum(page, x, y)).toBeGreaterThan(55); // ~1/4 of 255
    expect(await lum(page, x, y)).toBeLessThan(72);
  }
  expect(await lum(page, 20, 16)).toBe(0); // axis neighbours stay dark (diagonal offset)
});

// ── Mouse + UI: the one-click Filter ▸ Fragment menu item ──────────
test("the Filter ▸ Fragment menu item applies the filter", async ({ page }) => {
  await dotDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Fragment")).toBe(true);
  await page.waitForTimeout(150);
  expect(await lum(page, 20, 20)).toBe(0);            // original gone
  expect(await lum(page, 16, 16)).toBeGreaterThan(55); // a ghost appeared
});
