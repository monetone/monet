import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Stroke ────────────────────────────────────────
// Adobe spec (helpx "Stroke a selection or layer with color"): Stroke paints a
// coloured border of a given Width along the selection edge, at a Location of
// Inside, Center, or Outside, using (by default) the foreground colour. The app
// had no Stroke command.
//
//   https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/stroke-selection-layer-color.html

const DOCW = 200;
const DOCH = 140;

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
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

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "stroke");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red stroke colour
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

// ── Integration: stroke through the engine FFI ─────────────────────
test("stroke_selection paints a band along the edge, not the interior", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "s");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0);
    E.stroke_selection(2, 255, 0, 0, 255, 1); // Width 2, Center, red
    E.composite();
    const green = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 16) & 255;
    return { edge: green(10, 20), interior: green(20, 20), outside: green(5, 5) };
  });
  expect(r.edge).toBeLessThan(80);       // red stroke (green channel low)
  expect(r.interior).toBeGreaterThan(200); // interior untouched (white)
  expect(r.outside).toBeGreaterThan(200);  // far outside untouched
});

// ── Mouse: stroke a marquee selection's outline ────────────────────
test("stroking a marquee paints its outline with the foreground colour", async ({ page }) => {
  const m = await setup(page);
  await marqueeDrag(page, m, 50, 40, 130, 100);
  const b = await bounds(page);
  const midY = b[1] + Math.floor(b[3] / 2);
  await page.evaluate(() => (window as any).__mv.store.strokeSelection(4, 1)); // Width 4, Center
  expect((await pixel(page, b[0], midY))[1]).toBeLessThan(80);                        // left edge stroked red
  expect((await pixel(page, b[0] + Math.floor(b[2] / 2), midY))[1]).toBeGreaterThan(200); // interior untouched
});

// ── UI: the Stroke dialog ──────────────────────────────────────────
test("the Edit ▸ Stroke… menu opens a dialog whose OK strokes the selection", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.e.select_rect(40, 30, 80, 60, 0);
    mv.engine.commit();
  });
  expect((await pixel(page, 40, 60))[1]).toBeGreaterThan(200); // edge white before
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Stroke…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Stroke", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect((await pixel(page, 40, 60))[1]).toBeLessThan(120); // edge stroked after
});
