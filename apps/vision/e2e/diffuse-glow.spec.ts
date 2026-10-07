import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Diffuse Glow ──────────────────────
// Adobe spec (helpx "Distort filters"): Diffuse Glow "renders an image as though
// it were viewed through a soft diffusion filter… The glow is rendered using the
// background color." Controlled by Graininess, Glow Amount and Clear Amount —
// highlights bloom toward the background colour, shadows stay clear.
//
//   https://helpx.adobe.com/photoshop/using/distort-filters.html

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const lum = (p: number[]) => p[0];

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

// dark-grey left / light-grey right, with the background colour set to white.
async function darkLight(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "glow");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(30, 30, 30, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(220, 220, 220, 255);
    E.select_none();
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white glow
    mv.engine.commit();
  });
}

// ── Integration: highlights bloom, shadows stay clear ──────────────
test("diffuse glow blooms the highlight and leaves the shadow", async ({ page }) => {
  await darkLight(page);
  await page.evaluate(() => (window as any).__mv.distort.diffuseGlow(0, 10, 5));
  expect(lum(await rgb(page, 5, 20))).toBe(30);          // shadow stays clear
  expect(lum(await rgb(page, 35, 20))).toBeGreaterThan(235); // highlight blooms toward white
});

// ── Mouse + UI: the Filter ▸ Distort ▸ Diffuse Glow… dialog ────────
test("the Filter ▸ Distort ▸ Diffuse Glow… dialog OK blooms the highlight", async ({ page }) => {
  await darkLight(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Diffuse Glow…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "OK", exact: true }).click(); // defaults (glow 10, clear 5)
  await page.waitForTimeout(150);
  expect(lum(await rgb(page, 35, 20))).toBeGreaterThan(235);
  expect(lum(await rgb(page, 5, 20))).toBe(30);
});
