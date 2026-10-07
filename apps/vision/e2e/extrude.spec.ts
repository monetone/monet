import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Extrude — Type (Blocks / Pyramids) ─
// PS Extrude has Blocks/Pyramids plus controls for image-vs-solid block fronts
// and hiding objects that cross the selection boundary.
//   https://helpx.adobe.com/photoshop/using/stylize-filters.html

const D = 8;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}

// One flat bright cell (size == canvas), so the extrusion covers the whole doc.
async function flatDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "extrude");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d, d, 0); E.fill_selection(200, 200, 200, 255);
    E.select_none();
    mv.engine.commit();
  }, D);
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

// ── Pyramids shade from a central peak; Blocks keep a flat top ──────
test("Pyramids shade from a central peak; Blocks keep a flat top", async ({ page }) => {
  await flatDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.extrude(8, 0.5, true, 0)); // Blocks
  const bCentre = await red(page, 4, 4);
  const bCorner = await red(page, 2, 2);
  await flatDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.extrude(8, 0.5, true, 1)); // Pyramids
  const pCentre = await red(page, 4, 4);
  const pCorner = await red(page, 2, 2);
  expect(bCentre).toBe(bCorner);                    // flat plateau on the Blocks top
  expect(pCentre).toBeGreaterThan(pCorner + 8);     // Pyramids: continuous peak→edge gradient
});

test("Solid Front Faces switches between the cell average and source image", async ({ page }) => {
  await flatDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 4, 8, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
    mv.fil.extrude(8, 0, true, 0, true, false);
  });
  expect(await red(page, 1, 4)).toBe(await red(page, 6, 4));

  await flatDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 4, 8, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
    mv.fil.extrude(8, 0, true, 0, false, false);
  });
  expect(await red(page, 1, 4)).toBeLessThan(20);
  expect(await red(page, 6, 4)).toBe(200);
});

test("Mask Incomplete Blocks hides objects that cross the selection", async ({ page }) => {
  await flatDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 4, 8, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(0, 0, 6, 8, 0); mv.engine.commit();
    mv.fil.extrude(8, 0, true, 0, true, true);
  });
  expect(await red(page, 1, 4)).toBe(0);
});

// ── Mouse + UI: the Extrude dialog exposes the Type control ────────
test("the Filter ▸ Stylize ▸ Extrude… dialog exposes the Type control", async ({ page }) => {
  await flatDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Extrude…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Type", { exact: true }).first()).toBeVisible();     // the new control
  await expect(page.getByText("Pyramids", { exact: true }).first()).toBeVisible(); // its Pyramids option
  await expect(page.getByText("Solid Front Faces", { exact: true })).toBeVisible();
  await expect(page.getByText("Mask Incomplete Blocks", { exact: true })).toBeVisible();
  await page.getByText("Pyramids", { exact: true }).first().click();
  await expect(page.getByText("Solid Front Faces", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
});
