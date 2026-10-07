import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Modify ▸ Expand / Contract ──────────────────
// Adobe spec (helpx "Expand or contract selections"): enter a pixel value; the
// selection border is moved outward (Expand) or inward (Contract) by that many
// pixels. The app had no way to grow/shrink a selection by a pixel amount.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/expand-or-contract-selection.html

const DOCW = 200;
const DOCH = 140;

const bounds = (page: Page) => page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);

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
    mv.store.newDocument(w, h, "mod");
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

// ── Integration: the morphology through the engine FFI ─────────────
test("expand_selection grows and contract_selection shrinks the bounds", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "m");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0);
    const base = Array.from(E.selection_bounds());
    E.expand_selection(3);
    const exp = Array.from(E.selection_bounds());
    E.select_none(); E.select_rect(10, 10, 20, 20, 0);
    E.contract_selection(3);
    const con = Array.from(E.selection_bounds());
    return { base, exp, con };
  });
  expect(r.base).toEqual([10, 10, 20, 20]);
  expect(r.exp).toEqual([7, 7, 26, 26]);   // grew 3px on each side
  expect(r.con).toEqual([13, 13, 14, 14]); // shrank 3px on each side
});

// ── Mouse: a marquee selection can be expanded ─────────────────────
test("a marquee selection grows by the expand amount on each side", async ({ page }) => {
  const m = await setupMarquee(page);
  await marqueeDrag(page, m, 50, 40, 130, 100); // a rect away from the edges
  const before = await bounds(page);
  expect(before[2]).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__mv.store.expandSelection(8));
  const after = await bounds(page);
  expect(before[0] - after[0]).toBe(8);          // left edge moved out 8px
  expect(after[2] - before[2]).toBe(16);         // width grew 8px on each side
  expect(after[3] - before[3]).toBe(16);         // …and height
});

// ── UI: the Expand dialog grows the selection ──────────────────────
test("the Expand… menu opens a dialog whose Expand button grows the selection", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { (window as any).__mv.engine.engine.select_rect(40, 30, 80, 60, 0); });
  const before = await bounds(page);
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Expand…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Expand / Contract Selection", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  const after = await bounds(page);
  expect(before[0] - after[0]).toBe(4);  // default 4px
  expect(after[2] - before[2]).toBe(8);
});
