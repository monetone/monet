import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Modify ▸ Smooth ─────────────────────────────
// Adobe spec (helpx / elated): Smooth examines the pixels around each selected
// pixel within a Sample Radius and keeps it only if the majority are selected —
// rounding sharp corners, filling pinholes and removing isolated specks. The app
// had no way to smooth a selection.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/clean-up-stray-pixels-in-color-based-selection.html

const DOCW = 200;
const DOCH = 140;

const bounds = (page: Page) => page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
async function maskAt(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    if (!E.has_selection()) return -1;
    const w = E.width();
    const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * E.height());
    return buf[y * w + x];
  }, { x, y });
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

async function setupMarquee(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "smo");
    mv.engine.engine.select_none();
    mv.engine.commit();
    mv.store.setTool("marquee");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

async function marqueeDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(m.cx(x0), m.cy(y0));
  await page.mouse.down();
  await page.mouse.move(m.cx(x1), m.cy(y1), { steps: 3 });
  await page.mouse.up();
}

// ── Integration: smooth through the engine FFI ─────────────────────
test("smooth_selection rounds corners and refines the outline", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "s");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0);
    E.smooth_selection(3);
    const w = E.width();
    const b = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * E.height());
    return { corner: b[10 * w + 10], edge: b[10 * w + 20], centre: b[20 * w + 20] };
  });
  expect(r.corner).toBe(0);   // sharp corner rounded off
  expect(r.edge).toBe(255);   // straight edge preserved
  expect(r.centre).toBe(255); // interior preserved
});

// ── Mouse: a marquee selection's corners get rounded ───────────────
test("smoothing a marquee selection rounds off its corners", async ({ page }) => {
  const m = await setupMarquee(page);
  await marqueeDrag(page, m, 50, 40, 130, 100);
  const b = await bounds(page);
  const corner = { x: b[0], y: b[1] };
  const centre = { x: b[0] + Math.floor(b[2] / 2), y: b[1] + Math.floor(b[3] / 2) };
  expect(await maskAt(page, corner.x, corner.y)).toBe(255); // corner selected before
  await page.evaluate(() => (window as any).__mv.store.smoothSelection(6));
  expect(await maskAt(page, corner.x, corner.y)).toBe(0);   // corner rounded off
  expect(await maskAt(page, centre.x, centre.y)).toBe(255); // interior preserved
});

// ── UI: the Smooth dialog ──────────────────────────────────────────
test("the Smooth… menu opens a dialog whose OK rounds the corners", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { (window as any).__mv.engine.engine.select_rect(40, 30, 80, 60, 0); });
  expect(await maskAt(page, 40, 30)).toBe(255); // corner selected
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Smooth…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Smooth Selection", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await maskAt(page, 40, 30)).toBe(0); // corner rounded
});
