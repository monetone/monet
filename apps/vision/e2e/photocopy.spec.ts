import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Sketch ▸ Photocopy ──────────────────────────
// Adobe spec (helpx "Filter effects reference" / Sketch): "Simulates the effect
// of photocopying an image. Large areas of darkness tend to copy only around
// their edges, and midtones fall away to either solid black or white." Uses the
// foreground and background colors; controlled by Detail and Darkness.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] === 255 && p[1] === 0 && p[2] === 0;
const isBlue = (p: number[]) => p[0] === 0 && p[1] === 0 && p[2] === 255;

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

// a black square on white, with foreground red and background blue.
async function blackSquare(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "copy");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(10, 10, 20, 20, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });   // red fg (the ink)
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue bg (the paper)
    mv.engine.commit();
  });
}

// ── Integration: dark edges in fg, everything else in bg ───────────
test("photocopy inks the dark edges in the foreground over a background paper", async ({ page }) => {
  await blackSquare(page);
  await page.evaluate(() => (window as any).__mv.fil.photocopy(2, 4));
  expect(isRed(await rgb(page, 10, 20))).toBe(true);  // dark edge → ink
  expect(isBlue(await rgb(page, 20, 20))).toBe(true); // interior of the dark region → paper
  expect(isBlue(await rgb(page, 4, 4))).toBe(true);   // light surroundings → paper
});

// ── Mouse + UI: the Filter ▸ Photocopy… dialog ─────────────────────
test("the Filter ▸ Photocopy… dialog OK inks the edges", async ({ page }) => {
  await blackSquare(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Photocopy…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "OK", exact: true }).click(); // defaults
  await page.waitForTimeout(150);
  expect(isRed(await rgb(page, 10, 20))).toBe(true);
  expect(isBlue(await rgb(page, 4, 4))).toBe(true);
});
