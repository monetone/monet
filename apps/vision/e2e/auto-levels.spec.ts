import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Auto Tone / Auto Contrast ────────────────────
// Adobe spec (helpx "Make quick tonal adjustments" + Photoshop Essentials):
// Auto Tone (⇧⌘L) maps the darkest/lightest pixels of EACH channel to black/
// white (per-channel → can shift colour); Auto Contrast (⌥⇧⌘L) pools all three
// channels into one black/white point (preserves colour). 0.1% clip. The app
// had neither command.
//
//   https://www.photoshopessentials.com/photo-editing/auto-tone-auto-contrast-and-auto-color-in-photoshop/

const DOCW = 200;
const DOCH = 140;

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isBlack = (p: number[]) => p[0] < 8 && p[1] < 8 && p[2] < 8;
const isWhite = (p: number[]) => p[0] > 247 && p[1] > 247 && p[2] > 247;

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

// left half dark grey (40,40,40); right half (80,160,200) — per-channel ranges
// R[40,80] G[40,160] B[40,200], so Auto Tone and Auto Contrast diverge.
async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "auto");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(40, 40, 40, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(80, 160, 200, 255);
    E.select_none();
    mv.engine.commit();
  }, { w: DOCW, h: DOCH });
}

// ── Integration: Auto Tone stretches every channel ─────────────────
test("auto tone stretches each channel so the right half goes white", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mv.adj.autoTone());
  expect(isBlack(await rgb(page, 30, 70))).toBe(true);  // left → black
  expect(isWhite(await rgb(page, 170, 70))).toBe(true); // right → white (per-channel)
});

// ── Integration: Auto Contrast preserves colour ────────────────────
test("auto contrast keeps colour balance (right half is not white)", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mv.adj.autoContrast());
  expect(isBlack(await rgb(page, 30, 70))).toBe(true); // left → black
  const r = await rgb(page, 170, 70);
  expect(r[0]).toBeLessThan(90);     // R not stretched to white…
  expect(r[2]).toBeGreaterThan(247); // …only B reaches white
  expect(r[0]).toBeLessThan(r[1]);   // R<G<B preserved
  expect(r[1]).toBeLessThan(r[2]);
});

// ── Mouse + menu: Image ▸ Auto Tone ────────────────────────────────
test("the Image ▸ Auto Tone menu item stretches the tones", async ({ page }) => {
  await setup(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Auto Tone")).toBe(true);
  await page.waitForTimeout(150);
  expect(isWhite(await rgb(page, 170, 70))).toBe(true);
});

// ── Keyboard: ⇧⌘L runs Auto Tone ───────────────────────────────────
test("⇧⌘L runs Auto Tone", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Meta+Shift+KeyL");
  expect(isWhite(await rgb(page, 170, 70))).toBe(true);
  expect(isBlack(await rgb(page, 30, 70))).toBe(true);
});
