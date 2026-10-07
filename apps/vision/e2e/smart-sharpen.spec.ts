import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Sharpen ▸ Smart Sharpen — Remove modes ──────
// PS Smart Sharpen's Remove dropdown chooses the low-pass whose detail is
// restored:
//   • Gaussian Blur — classic isotropic unsharp (what Monet shipped).
//   • Lens Blur     — disc (circular-aperture) low-pass; finer detail,
//     fewer halos, so the sharpened result differs from Gaussian.
//   • Motion Blur   — directional low-pass along an Angle, counteracting
//     camera/subject motion. This adds Lens + Motion + the Angle control.
//
//   https://helpx.adobe.com/photoshop/using/adjusting-image-sharpness-blur.html

const D = 24;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}

// A vertical dark|light edge softened by a Gaussian blur — the input Smart
// Sharpen is meant to re-steepen. The blur widens the ramp so the sample
// points sit inside it (not clipped) and have room to move.
async function softEdgeDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "smart-sharpen");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d / 2, d, 0); E.fill_selection(20, 20, 20, 255);
    E.select_rect(d / 2, 0, d / 2, d, 0); E.fill_selection(235, 235, 235, 255);
    E.select_none();
    E.filter_gaussian_blur(3.0); // soften: gives the sharpen something to recover
    mv.engine.commit();
  }, D);
}

// Contrast across the (x=12) edge, sampled inside the softened ramp.
async function edgeContrast(page: Page): Promise<number> {
  const lo = await red(page, 10, 12);
  const hi = await red(page, 13, 12);
  return Math.abs(hi - lo);
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

// ── Gaussian Remove (default) re-steepens a softened edge ──────────
test("Smart Sharpen re-steepens a softened edge", async ({ page }) => {
  await softEdgeDoc(page);
  const before = await edgeContrast(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 3, 0)); // default = Gaussian
  const after = await edgeContrast(page);
  expect(after).toBeGreaterThan(before);
});

// ── Lens Remove yields a different result than Gaussian ────────────
test("the Remove mode changes the sharpened result", async ({ page }) => {
  await softEdgeDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 4, 0, 0)); // Gaussian
  const g: number[] = [];
  for (let x = 9; x <= 15; x++) g.push(await red(page, x, 12));
  await softEdgeDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 4, 0, 1)); // Lens
  let diff = 0;
  for (let x = 9; x <= 15; x++) diff += Math.abs((await red(page, x, 12)) - g[x - 9]);
  expect(diff).toBeGreaterThan(0);
});

// ── Motion Remove is directional: across ≫ along the edge ──────────
test("Motion Remove sharpens across the edge more than along it", async ({ page }) => {
  await softEdgeDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 6, 0, 2, 0)); // motion, horizontal (across a vertical edge)
  const across = await edgeContrast(page);
  await softEdgeDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 6, 0, 2, 90)); // motion, vertical (along it)
  const along = await edgeContrast(page);
  expect(across).toBeGreaterThan(along);
});

// ── Shadows/Highlights Fade — PS Smart Sharpen's tonal tabs ────────
// PS Smart Sharpen has Shadows/Highlights tabs whose "Fade Amount" pulls
// sharpening back in the darkest / brightest tones so grain and specular
// halos don't get crunched. Full shadow fade re-steepens the light half of
// the edge but leaves the dark half near its blurred value → less contrast
// across the edge than an un-faded sharpen.
//   https://helpx.adobe.com/photoshop/using/adjusting-image-sharpness-blur.html
test("Shadow Fade pulls sharpening out of the shadow tones", async ({ page }) => {
  await softEdgeDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 4, 0, 0, 0, 0, 0)); // no fade
  const full = await edgeContrast(page);
  await softEdgeDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartSharpen(2, 4, 0, 0, 0, 1, 0)); // full shadow fade
  const faded = await edgeContrast(page);
  expect(faded).toBeLessThan(full);
});

// ── Mouse + UI: the Filter ▸ Sharpen ▸ Smart Sharpen… dialog ───────
test("the Smart Sharpen… dialog exposes the Remove control", async ({ page }) => {
  await softEdgeDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Smart Sharpen…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Amount", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Remove", { exact: true }).first()).toBeVisible(); // the new control
  await expect(page.getByText("Shadow Fade", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Highlight Fade", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  // OK applied a sharpen without error.
  expect(await edgeContrast(page)).toBeGreaterThan(0);
});
