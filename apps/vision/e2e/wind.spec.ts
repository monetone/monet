import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Wind ──────────────────────────────
// Adobe spec (helpx "Stylize filters"): "Creates tiny horizontal lines to
// simulate a wind effect." Methods: Wind, Blast (stronger), Stagger. Direction:
// From the Left / From the Right — the streaks trail downwind from edges, so a
// bright bar grows a one-sided streak while its upwind edge stays sharp.
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

// black 40×40 with a 4px white vertical bar at x=18..21.
async function barDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "wind");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(18, 0, 4, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: direction controls which side streaks ─────────────
test("wind from the left streaks right and keeps the upwind edge sharp", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.wind(0, true)); // from the left
  expect(await lum(page, 20, 20)).toBe(255);      // bar stays bright
  expect(await lum(page, 24, 20)).toBeGreaterThan(120); // streak trails right
  expect(await lum(page, 17, 20)).toBe(0);        // upwind (left) edge stays sharp
});

test("wind from the right streaks left", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.wind(0, false)); // from the right
  expect(await lum(page, 16, 20)).toBeGreaterThan(120); // streak trails left
  expect(await lum(page, 24, 20)).toBe(0);        // upwind (right) edge stays sharp
});

// ── Mouse + UI: the Filter ▸ Wind… dialog ──────────────────────────
test("the Filter ▸ Wind… dialog OK streaks the bar", async ({ page }) => {
  await barDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Wind…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Method", { exact: true })).toBeVisible(); // the dialog is open
  await page.getByRole("button", { name: "OK", exact: true }).click(); // default: Wind, From the Left
  await page.waitForTimeout(150);
  expect(await lum(page, 24, 20)).toBeGreaterThan(120); // streak appeared to the right
  expect(await lum(page, 17, 20)).toBe(0);
});
