import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Diffuse ───────────────────────────
// Adobe spec (helpx "Filter effects reference"): Diffuse shuffles pixels with
// a random neighbour to soften focus — Normal moves pixels randomly, Darken
// Only replaces light pixels with darker ones (never brightens), Lighten Only
// the reverse, and Anisotropic follows the direction of least color change.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// the 20×20 grid of luminances (grey, so R = brightness) of the active doc.
async function grid(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const out: number[] = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) out.push(((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return out;
  });
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

// 20×20: left half grey-200, right half grey-100.
async function twoBand(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "diff");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 10, 20, 0); E.fill_selection(200, 200, 200, 255);
    E.select_rect(10, 0, 10, 20, 0); E.fill_selection(100, 100, 100, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: Darken Only never brightens ──────────────────────
test("diffuse darken-only never brightens a pixel (and changes some)", async ({ page }) => {
  await twoBand(page);
  const before = await grid(page);
  await page.evaluate(() => (window as any).__mv.fil.diffuse(1));
  const after = await grid(page);
  let changed = 0;
  for (let i = 0; i < 400; i++) {
    expect(after[i]).toBeLessThanOrEqual(before[i]);
    if (after[i] !== before[i]) changed++;
  }
  expect(changed).toBeGreaterThan(0);
});

// ── Integration: Lighten Only never darkens ───────────────────────
test("diffuse lighten-only never darkens a pixel", async ({ page }) => {
  await twoBand(page);
  const before = await grid(page);
  await page.evaluate(() => (window as any).__mv.fil.diffuse(2));
  const after = await grid(page);
  for (let i = 0; i < 400; i++) expect(after[i]).toBeGreaterThanOrEqual(before[i]);
});

test("diffuse anisotropic follows a strong edge instead of crossing it", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "anisotropic");
    const E = mv.engine.engine;
    for (let y = 0; y < 20; y++) {
      E.select_rect(0, y, 10, 1, 0); E.fill_selection(30 + y * 2, 30 + y * 2, 30 + y * 2, 255);
      E.select_rect(10, y, 10, 1, 0); E.fill_selection(180 + y * 2, 180 + y * 2, 180 + y * 2, 255);
    }
    E.select_none(); mv.engine.commit();
  });
  const before = await grid(page);
  await page.evaluate(() => (window as any).__mv.fil.diffuse(3));
  const after = await grid(page);
  expect(after).not.toEqual(before);
  for (let y = 0; y < 20; y++) {
    expect(after[y * 20 + 9]).toBeLessThan(100);
    expect(after[y * 20 + 10]).toBeGreaterThan(150);
  }
});

// ── Mouse + UI: the Diffuse… dialog with Darken Only ──────────────
test("the Diffuse… dialog with Darken Only never brightens", async ({ page }) => {
  await twoBand(page);
  const before = await grid(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Diffuse…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Anisotropic", { exact: true })).toBeVisible();
  await page.getByText("Darken Only", { exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const after = await grid(page);
  for (let i = 0; i < 400; i++) expect(after[i]).toBeLessThanOrEqual(before[i]);
});
