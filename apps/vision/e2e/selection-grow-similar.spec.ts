import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Grow / Select ▸ Similar ─────────────────────
// Adobe spec (helpx "Magic Wand"): Grow extends the selection to CONTIGUOUS pixels
// within the Magic Wand tolerance of the selection's colours; Similar selects
// matching pixels THROUGHOUT the image (not just adjacent). The app had neither.
//
//   https://helpx.adobe.com/photoshop/using/tool-techniques/magic-wand-tool.html

const DOCW = 200;
const DOCH = 140;

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

// Three vertical bands red | blue | red (the two reds are disconnected).
async function setupBands(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "gs");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 70, h, 0); E.fill_selection(220, 30, 30, 255);
    E.select_rect(70, 0, 70, h, 0); E.fill_selection(30, 30, 220, 255);
    E.select_rect(140, 0, 60, h, 0); E.fill_selection(220, 30, 30, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("marquee");
    mv.store.setOptions({ wandTolerance: 0.1 });
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

// ── Integration: grow vs similar through the engine FFI ────────────
test("grow is contiguous, similar is global", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const build = () => {
      mv.store.newDocument(20, 20, "g");
      const E = mv.engine.engine;
      E.select_rect(0, 0, 7, 20, 0); E.fill_selection(255, 0, 0, 255);
      E.select_rect(7, 0, 7, 20, 0); E.fill_selection(0, 0, 255, 255);
      E.select_rect(14, 0, 6, 20, 0); E.fill_selection(255, 0, 0, 255);
      E.select_none(); E.composite();
      E.select_rect(2, 2, 3, 3, 0); // a patch in the left red
      return E;
    };
    const read = (E: any) => { const b = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), 400); return { left: b[10 * 20 + 1], right: b[10 * 20 + 16], blue: b[10 * 20 + 10] }; };
    const E1 = build(); E1.grow_selection(0.1); const grow = read(E1);
    const E2 = build(); E2.similar_selection(0.1); const sim = read(E2);
    return { grow, sim };
  });
  expect(r.grow.left).toBe(255); expect(r.grow.right).toBe(0); expect(r.grow.blue).toBe(0);
  expect(r.sim.left).toBe(255); expect(r.sim.right).toBe(255); expect(r.sim.blue).toBe(0);
});

// ── Mouse: Grow stays contiguous, Similar goes global ──────────────
test("a marquee selection Grows contiguously but Similar reaches the disconnected band", async ({ page }) => {
  const m1 = await setupBands(page);
  await marqueeDrag(page, m1, 10, 30, 40, 60); // a patch inside the LEFT red band
  await page.evaluate(() => (window as any).__mv.store.growSelection());
  expect(await maskAt(page, 20, 70)).toBe(255);  // left red filled
  expect(await maskAt(page, 170, 70)).toBe(0);   // right red NOT reached (contiguous)

  const m2 = await setupBands(page);
  await marqueeDrag(page, m2, 10, 30, 40, 60);
  await page.evaluate(() => (window as any).__mv.store.similarSelection());
  expect(await maskAt(page, 20, 70)).toBe(255);  // left red
  expect(await maskAt(page, 170, 70)).toBe(255); // right red ALSO selected (global)
});

// ── UI: the Similar menu item ──────────────────────────────────────
test("the Select ▸ Similar menu item selects the matching disconnected region", async ({ page }) => {
  await setupBands(page);
  await page.evaluate(() => { (window as any).__mv.engine.engine.select_rect(10, 30, 30, 40, 0); });
  expect(await maskAt(page, 170, 70)).toBe(0); // right red not selected yet
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Similar")).toBe(true);
  await page.waitForTimeout(250);
  expect(await maskAt(page, 170, 70)).toBe(255); // Similar reached the right red
});
