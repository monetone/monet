import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Other ▸ Maximum / Minimum ───────────────────
// Adobe spec (helpx "Filter effects reference"): within a Radius, Maximum
// replaces each pixel with the brightest neighbour (dilate → spreads white,
// chokes black); Minimum with the darkest (erode → spreads black). Preserve
// Squareness/Roundness picks a square vs round neighbourhood. The app had
// neither; this adds them (engine + Filter ▸ Other ▸ Maximum…/Minimum…).
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const D = 80; // small doc — Maximum/Minimum are O(r²) per pixel

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isWhite = (p: number[]) => p[0] > 200 && p[1] > 200 && p[2] > 200;
const isBlack = (p: number[]) => p[0] < 40 && p[1] < 40 && p[2] < 40;

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

// `bg` field with a contrasting `fg` square [36,44)×[36,44).
async function setup(page: Page, bg: number[], fg: number[]) {
  await gotoApp(page);
  await page.evaluate(({ d, bg, fg }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "morph");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d, d, 0); E.fill_selection(bg[0], bg[1], bg[2], 255);
    E.select_rect(36, 0 + 36, 8, 8, 0); E.fill_selection(fg[0], fg[1], fg[2], 255);
    E.select_none();
    mv.engine.commit();
  }, { d: D, bg, fg });
}

// ── Integration: Maximum dilates the white square ──────────────────
test("maximum spreads the white square outward", async ({ page }) => {
  await setup(page, [0, 0, 0], [255, 255, 255]); // white square on black
  expect(isBlack(await pixel(page, 33, 40))).toBe(true); // just outside the square before
  await page.evaluate(() => (window as any).__mv.fil.maximum(3, false));
  expect(isWhite(await pixel(page, 33, 40))).toBe(true); // spread by 3 → reaches 33
  expect(isWhite(await pixel(page, 40, 40))).toBe(true);
  expect(isBlack(await pixel(page, 32, 40))).toBe(true); // one past the spread stays black
});

// ── Integration: Minimum dilates the black square ──────────────────
test("minimum spreads the black square outward", async ({ page }) => {
  await setup(page, [255, 255, 255], [0, 0, 0]); // black square on white
  expect(isWhite(await pixel(page, 33, 40))).toBe(true);
  await page.evaluate(() => (window as any).__mv.fil.minimum(3, false));
  expect(isBlack(await pixel(page, 33, 40))).toBe(true); // black spread out
  expect(isWhite(await pixel(page, 32, 40))).toBe(true);
});

// ── Mouse + UI: the Maximum… dialog ────────────────────────────────
test("the Filter ▸ Other ▸ Maximum… dialog OK dilates the white square", async ({ page }) => {
  await setup(page, [0, 0, 0], [255, 255, 255]);
  await openMenu(page, "Filter");
  await page.getByText("Other", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Maximum…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Preserve", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  expect(isWhite(await pixel(page, 33, 40))).toBe(true); // default radius 3 spread
});

// ── Mouse + UI: Minimum… with the Roundness segment ────────────────
test("the Minimum… dialog with Roundness erodes (spreads black)", async ({ page }) => {
  await setup(page, [255, 255, 255], [0, 0, 0]);
  await openMenu(page, "Filter");
  await page.getByText("Other", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Minimum…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("dialog", { name: "Minimum" })
    .getByRole("radio", { name: "Roundness" })
    .click(); // pick the round neighbourhood
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  expect(isBlack(await pixel(page, 33, 40))).toBe(true); // on-axis spread (round)
});
