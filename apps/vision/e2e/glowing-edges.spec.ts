import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Glowing Edges ─────────────────────
// Adobe spec (helpx "Stylize filters"): identifies the edges of colour and
// adds a neon-like glow to them — edges become bright on a black field (the
// inverse of Find Edges). Controlled by Edge Width and Edge Brightness. The
// app had Find Edges but no Glowing Edges.
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

// 40×40: black left, white right (one sharp edge at x=20).
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "glow");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// brightest luminance in row 20 near the boundary (cols 16..24).
async function boundaryGlow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    let m = 0;
    for (let x = 16; x < 24; x++) { const l = ((E.pick_color(x, 20) >>> 0) >>> 24) & 255; if (l > m) m = l; }
    return m;
  });
}

// ── Integration: edges glow, flat areas go black ───────────────────
test("glowing edges lights up the boundary and blacks out flat areas", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.glowingEdges(1, 2));
  expect(await boundaryGlow(page)).toBeGreaterThan(180); // the edge glows
  expect(await lum(page, 5, 20)).toBeLessThan(30);   // flat black → black
  expect(await lum(page, 35, 20)).toBeLessThan(30);  // flat white → black (no edge)
});

// ── Mouse + UI: the Glowing Edges… dialog ──────────────────────────
test("the Filter ▸ Glowing Edges… dialog OK glows the edges", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Glowing Edges…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Edge Width", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await boundaryGlow(page)).toBeGreaterThan(180); // default width 2 / brightness 6
  expect(await lum(page, 5, 20)).toBeLessThan(30);
});
