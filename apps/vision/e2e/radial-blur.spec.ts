import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Blur ▸ Radial Blur ──────────────────────────
// Adobe spec (helpx "Blur filters"): blurs around a centre point — Spin blurs
// along concentric circles (tangential), Zoom blurs along radial lines (in/out
// from the centre). The app had Gaussian/Box/Motion/Surface blur but no Radial.
//
//   https://helpx.adobe.com/photoshop/using/blur-gallery.html

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

// 40×40: black left, white right (angular variation across the vertical centre).
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "rdb");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: Spin blurs the angular boundary ───────────────────
test("spin radial blur greys the boundary above the centre", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.radialBlur(80, false));
  const v = await lum(page, 20, 3);
  expect(v).toBeGreaterThan(40); expect(v).toBeLessThan(216); // swept across both sides → grey
  expect(await lum(page, 2, 20)).toBeLessThan(40);   // far-left stays black
  expect(await lum(page, 38, 20)).toBeGreaterThan(215); // far-right stays white
});

// ── Integration: Zoom preserves the angular boundary ───────────────
test("zoom radial blur keeps the boundary sharp (perpendicular smear)", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.radialBlur(80, true));
  expect(await lum(page, 20, 3)).toBeGreaterThan(215); // radial smear → stays white
});

// ── Blur Center relocates the sharp zone (Zoom) ────────────────────
// A white-side pixel stays white when the blur centre is near it, but greys
// out when the centre is far to the left (its radial samples cross the edge).
test("the Blur Center relocates the sharp zone", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.radialBlur(100, true, 0.5, 0.5, 1)); // centre near
  const near = await lum(page, 24, 20);
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.radialBlur(100, true, 0.1, 0.5, 1)); // centre far left
  const far = await lum(page, 24, 20);
  expect(near).toBeGreaterThan(far + 30);
});

// ── Quality changes the sampling (Draft vs Best differ) ────────────
test("Quality (Draft vs Best) changes the sampling", async ({ page }) => {
  const band = () => page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const out: number[] = [];
    for (let y = 2; y < 38; y++) out.push((((E.pick_color(20, y) >>> 0) >>> 24) & 255));
    return out;
  });
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.radialBlur(100, false, 0.5, 0.5, 0)); // Draft
  const draft = await band();
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.radialBlur(100, false, 0.5, 0.5, 2)); // Best
  const best = await band();
  let diff = 0;
  for (let i = 0; i < draft.length; i++) diff += Math.abs(draft[i] - best[i]);
  expect(diff).toBeGreaterThan(0);
});

// ── Mouse + UI: the Radial Blur… dialog exposes the new controls ────
test("the Filter ▸ Blur ▸ Radial Blur… dialog exposes Quality + Center and blurs", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Radial Blur…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Blur Method", { exact: true })).toBeVisible();
  await expect(page.getByText("Quality", { exact: true })).toBeVisible();  // new control
  await expect(page.getByText("Center X", { exact: true })).toBeVisible(); // new control
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  const v = await lum(page, 20, 3); // default Spin, amount 50
  expect(v).toBeGreaterThan(40); expect(v).toBeLessThan(216);
});
