import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Reselect (⇧⌘D) ──────────────────────────────
// Adobe spec (Photoshop Training Channel): Select ▸ Reselect restores the most
// recently deselected selection — Photoshop remembers the last set of marching
// ants even after other edits. The app had Deselect (⌘D) but no Reselect.
//
//   https://photoshoptrainingchannel.com/tips/restoring-selections/

const DOCW = 200;
const DOCH = 140;
const SEL = { x: 40, y: 30, w: 80, h: 50 };

async function hasSel(page: Page): Promise<boolean> {
  return await page.evaluate(() => (window as any).__mv.engine.engine.has_selection());
}
async function bounds(page: Page): Promise<number[]> {
  return await page.evaluate(() => [...(window as any).__mv.engine.engine.selection_bounds()]);
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

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "resel");
    mv.store.setTool("marquee");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

async function marqueeDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(SEL.x), m.cy(SEL.y));
  await page.mouse.down();
  await page.mouse.move(m.cx(SEL.x + SEL.w), m.cy(SEL.y + SEL.h), { steps: 3 });
  await page.mouse.up();
}

// ── Integration: reselect restores the deselected selection ────────
test("reselect restores the most recently deselected selection", async ({ page }) => {
  await setup(page);
  await page.evaluate(({ s }) => (window as any).__mv.engine.engine.select_rect(s.x, s.y, s.w, s.h, 0), { s: SEL });
  const want = await bounds(page);
  await page.evaluate(() => (window as any).__mv.store.deselect());
  expect(await hasSel(page)).toBe(false);
  await page.evaluate(() => (window as any).__mv.store.reselect());
  expect(await hasSel(page)).toBe(true);
  expect(await bounds(page)).toEqual(want);
});

// ── Mouse + keyboard: marquee drag, ⌘D, then ⇧⌘D ───────────────────
test("a marquee drag, ⌘D to deselect, then ⇧⌘D brings it back", async ({ page }) => {
  const m = await setup(page);
  await marqueeDrag(page, m);
  const b = await bounds(page);
  expect(b[2]).toBeGreaterThan(40); // a real mouse selection
  await page.keyboard.press("Meta+KeyD"); // Deselect
  expect(await hasSel(page)).toBe(false);
  await page.keyboard.press("Meta+Shift+KeyD"); // Reselect
  expect(await hasSel(page)).toBe(true);
  expect(await bounds(page)).toEqual(b);
});

// ── Mouse + menu: Select ▸ Reselect ────────────────────────────────
test("the Select ▸ Reselect menu item restores the selection", async ({ page }) => {
  const m = await setup(page);
  await marqueeDrag(page, m);
  const b = await bounds(page);
  await page.evaluate(() => (window as any).__mv.store.deselect());
  expect(await hasSel(page)).toBe(false);
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Reselect")).toBe(true);
  await page.waitForTimeout(120);
  expect(await hasSel(page)).toBe(true);
  expect(await bounds(page)).toEqual(b);
});

// ── No history: Reselect is a no-op ────────────────────────────────
test("Reselect does nothing when nothing was ever deselected", async ({ page }) => {
  await setup(page); // never selected anything
  expect(await hasSel(page)).toBe(false);
  await page.keyboard.press("Meta+Shift+KeyD");
  expect(await hasSel(page)).toBe(false);
});
