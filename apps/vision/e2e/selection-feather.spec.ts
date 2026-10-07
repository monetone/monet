import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Modify ▸ Feather ────────────────────────────
// Adobe spec (helpx "Define feathered edges"): Feather softens a selection's edge
// by a radius in pixels — a wider transition band as the radius grows. The app
// could not feather a selection.
//
//   https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html

const DOCW = 200;
const DOCH = 140;

// Count selection-mask pixels with fractional coverage (0 < v < 255) — the soft band.
async function partials(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    if (!E.has_selection()) return -1;
    const w = E.width(), h = E.height();
    const buf = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * h);
    let p = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (v > 0 && v < 255) p++; }
    return p;
  });
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
    mv.store.newDocument(w, h, "fea");
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

// ── Integration: feather through the engine FFI ────────────────────
test("feather_selection turns a hard edge into a soft band", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "f");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0);
    const w = E.width(), h = E.height();
    const read = () => {
      const b = new Uint8Array(mv.engine.mem.buffer, E.selection_ptr(), w * h);
      let p = 0;
      for (let i = 0; i < b.length; i++) { const v = b[i]; if (v > 0 && v < 255) p++; }
      return { partials: p, centre: b[20 * w + 20], far: b[20 * w + 1] };
    };
    const before = read();
    E.feather_selection(3);
    const after = read();
    return { before, after };
  });
  expect(r.before.partials).toBe(0);            // hard edge to start
  expect(r.after.partials).toBeGreaterThan(50); // a soft transition band
  expect(r.after.centre).toBeGreaterThan(230);  // centre still selected
  expect(r.after.far).toBe(0);                  // far outside still empty
});

// ── Mouse: a marquee selection can be feathered ────────────────────
test("a marquee selection feathers into a soft edge", async ({ page }) => {
  const m = await setupMarquee(page);
  await marqueeDrag(page, m, 50, 40, 130, 100);
  expect(await partials(page)).toBe(0); // hard rectangular marquee
  await page.evaluate(() => (window as any).__mv.store.featherSelection(5));
  expect(await partials(page)).toBeGreaterThan(100); // a feathered band of partial pixels
});

// ── UI: the Feather dialog ─────────────────────────────────────────
test("the Feather… menu opens a dialog whose OK feathers the selection", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { (window as any).__mv.engine.engine.select_rect(40, 30, 80, 60, 0); });
  expect(await partials(page)).toBe(0);
  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Feather…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Feather Selection", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await partials(page)).toBeGreaterThan(100);
});
