import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Render ▸ Lens Flare ─────────────────────────
// Adobe spec (helpx / Photoshop Essentials): adds a simulated lens flare — a
// bright glow at the Flare Center with a Brightness slider (10–300%) and
// secondary reflections. The brightest point is the flare centre. The app had
// no Render filters; this adds Lens Flare.
//
//   https://www.photoshopessentials.com/photo-effects/how-to-add-lens-flare-to-an-image-with-photoshop/

const D = 60;

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

async function blackDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "flare");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d, d, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
  }, D);
}

// ── Integration: bright centre, falls off with distance ────────────
test("lens flare brightens the centre most and fades outward", async ({ page }) => {
  await blackDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensFlare(1.0)); // centre default = (30,30)
  expect(await lum(page, 30, 30)).toBeGreaterThan(200); // flare centre bright
  const near = await lum(page, 50, 30); // d=20
  const far = await lum(page, 58, 30);  // d=28
  expect(near).toBeGreaterThan(far + 15); // monotonic falloff
  expect(await lum(page, 30, 30)).toBeGreaterThan(await lum(page, 59, 59) + 50); // centre ≫ corner
});

// ── Integration: brightness scales the glow ────────────────────────
test("higher brightness yields a stronger glow", async ({ page }) => {
  await blackDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensFlare(0.4));
  const dim = await lum(page, 52, 30);
  await blackDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensFlare(2.0));
  const bright = await lum(page, 52, 30);
  expect(bright).toBeGreaterThan(dim + 30);
});

// ── Lens Type controls the halo reach (35mm wide vs 105mm tight) ────
test("the lens type controls the halo reach", async ({ page }) => {
  await blackDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensFlare(1.0, 1)); // 35mm Prime — big halo
  const wide = await lum(page, 55, 30); // d=25 from the centre flare
  await blackDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensFlare(1.0, 2)); // 105mm Prime — tight halo
  const tight = await lum(page, 55, 30);
  expect(wide).toBeGreaterThan(tight + 20); // the wider lens reaches farther
});

// ── The flare centre relocates the hotspot ─────────────────────────
test("the flare centre relocates the hotspot", async ({ page }) => {
  await blackDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.lensFlare(1.0, 0, 1 / 6, 1 / 6)); // ~(10,10) on a 60px doc
  expect(await lum(page, 10, 10)).toBeGreaterThan(200); // hotspot at the chosen centre
  expect(await lum(page, 10, 10)).toBeGreaterThan(await lum(page, 10, 55) + 50); // dim far from it
});

// ── Mouse + UI: the Filter ▸ Render ▸ Lens Flare… dialog ───────────
test("the Filter ▸ Render ▸ Lens Flare… dialog OK adds the flare", async ({ page }) => {
  await blackDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Render", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Lens Flare…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Brightness", { exact: true })).toBeVisible();
  await expect(page.getByText("Lens Type", { exact: true })).toBeVisible(); // the new control
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await lum(page, 30, 30)).toBeGreaterThan(200); // default 100% flare at centre
});
