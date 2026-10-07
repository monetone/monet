import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Modify ▸ Border ─────────────────────────────
// Adobe spec (helpx "Create a selection around a selection border"): Border turns
// the selection into a frame centered on the original edge — Width N extends N/2
// inside and N/2 outside, leaving the interior and far exterior deselected. The
// app had no way to make a border selection.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/create-selection-around-selection-border.html

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

async function setupMarquee(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "bor");
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

// ── Integration: border through the engine FFI ─────────────────────
test("border_selection makes a hollow band around the edge", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "b");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0);
    E.border_selection(3);
    const w = E.width();
    const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * E.height());
    return { interior: buf[20 * w + 20], edge: buf[10 * w + 20], outside: buf[2 * w + 20], bnd: Array.from(E.selection_bounds()) };
  });
  expect(r.interior).toBe(0);   // hollow centre
  expect(r.edge).toBe(255);     // the band along the edge is selected
  expect(r.outside).toBe(0);    // far outside is deselected
  expect(r.bnd).toEqual([7, 7, 26, 26]); // band straddles the original outline
});

// ── Mouse: a marquee selection becomes a border band ───────────────
test("a marquee selection becomes a hollow border band", async ({ page }) => {
  const m = await setupMarquee(page);
  await marqueeDrag(page, m, 50, 40, 130, 100);
  expect(await maskAt(page, 90, 70)).toBe(255); // interior selected before
  await page.evaluate(() => (window as any).__mv.store.borderSelection(8)); // Width 8 → ±4px band
  expect(await maskAt(page, 90, 70)).toBe(0);            // interior now hollow
  expect(await maskAt(page, 50, 70)).toBeGreaterThan(200); // the left edge band stays selected
});

// ── UI: the Border dialog ──────────────────────────────────────────
test("the Border… menu opens a dialog whose OK makes a border band", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { (window as any).__mv.engine.engine.select_rect(40, 30, 80, 60, 0); });
  expect(await maskAt(page, 80, 60)).toBe(255); // interior selected
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Border…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Border Selection", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await maskAt(page, 80, 60)).toBe(0); // interior now hollow
});
