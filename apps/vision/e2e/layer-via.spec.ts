import { test, expect, type Page } from "@playwright/test";
import { gotoApp, layerCount } from "./helpers";

// ── Photoshop Layer ▸ New ▸ Layer Via Copy (⌘J) / Layer Via Cut (⇧⌘J) ──
// Adobe spec (helpx + Photoshop Training Channel): with an active selection,
// ⌘J copies the selected pixels of the active layer to a NEW layer at the
// exact same position, leaving the source intact; ⇧⌘J does the same but CUTS
// the pixels — removing them from the source. With no selection, ⌘J duplicates
// the whole layer and ⇧⌘J is greyed out. The app wrongly mapped ⌘J to a plain
// Duplicate Layer (whole layer even with a selection); this fixes parity.
//
//   https://photoshoptrainingchannel.com/tips/new-layer-via-copy-shortcut-selections/

const DOCW = 200;
const DOCH = 140;
// selection square: doc (60,40)–(140,100). Center inside; corners outside.
const SEL = { x: 60, y: 40, w: 80, h: 60 };
const IN = { x: 100, y: 70 };
const OUT = { x: 20, y: 20 };

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

// Read a composite pixel with a set of VISUAL layer indices hidden (0 = top),
// then restore visibility. This is how we discriminate copy vs cut: the
// pixels sit at the same position, so the composite looks identical until we
// hide a layer and look at what's underneath.
async function pixelHiding(page: Page, hide: number[], x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ hide, x, y }) => {
    const E = (window as any).__mv.engine.engine;
    const n = E.layer_count();
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(E.layer_id_at(i));
    const was = ids.map((id) => E.layer_visible(id));
    hide.forEach((i) => E.set_layer_visible(ids[i], false));
    E.composite();
    const c = E.pick_color(x, y) >>> 0;
    ids.forEach((id, i) => E.set_layer_visible(id, was[i]));
    E.composite();
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { hide, x, y });
}

const isRed = (p: number[]) => p[0] > 180 && p[2] < 90 && p[3] > 200;
const isWhite = (p: number[]) => p[0] > 200 && p[1] > 200 && p[2] > 200 && p[3] > 200;

// White base + a solid-red active layer on top. Returns the doc→client map.
async function setup(page: Page, withSelection: boolean) {
  await gotoApp(page);
  await page.evaluate(({ w, h, sel, withSelection }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "lvc"); // white base layer
    const E = mv.engine.engine;        // capture AFTER newDocument (it swaps the engine)
    E.add_layer("red");                // active layer on top
    E.select_all(); E.fill_selection(220, 20, 20, 255); E.select_none();
    if (withSelection) E.select_rect(sel.x, sel.y, sel.w, sel.h, 0);
    mv.store.setTool("marquee");
    mv.engine.commit();
    mv.store.fit();
  }, { w: DOCW, h: DOCH, sel: SEL, withSelection });
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

// ── Integration: Layer Via Copy lifts only the selection, source intact ─
test("layerViaCopy copies just the selection to a new layer, leaving the source intact", async ({ page }) => {
  await setup(page, true);
  expect(await layerCount(page)).toBe(2);
  await page.evaluate(() => (window as any).__mv.store.layerViaCopy());
  expect(await layerCount(page)).toBe(3); // a new layer appeared

  // Hide the new top layer → the source is unchanged (still red everywhere).
  expect(isRed(await pixelHiding(page, [0], IN.x, IN.y))).toBe(true);
  expect(isRed(await pixelHiding(page, [0], OUT.x, OUT.y))).toBe(true);
  // Show ONLY the new layer (hide source + base) → red inside, transparent out.
  expect(isRed(await pixelHiding(page, [1, 2], IN.x, IN.y))).toBe(true);
  expect((await pixelHiding(page, [1, 2], OUT.x, OUT.y))[3]).toBeLessThan(40);
});

// ── Integration: Layer Via Cut also removes the selection from the source ─
test("layerViaCut moves the selection to a new layer and clears it from the source", async ({ page }) => {
  await setup(page, true);
  await page.evaluate(() => (window as any).__mv.store.layerViaCut());
  expect(await layerCount(page)).toBe(3);

  // Hide the new top layer → the source now has a hole (white base shows
  // inside the selection) but is intact (red) outside it.
  expect(isWhite(await pixelHiding(page, [0], IN.x, IN.y))).toBe(true);
  expect(isRed(await pixelHiding(page, [0], OUT.x, OUT.y))).toBe(true);
  // The new layer carries the cut pixels (red inside, transparent outside).
  expect(isRed(await pixelHiding(page, [1, 2], IN.x, IN.y))).toBe(true);
  expect((await pixelHiding(page, [1, 2], OUT.x, OUT.y))[3]).toBeLessThan(40);
});

// ── Mouse + menu: marquee drag then Layer ▸ Layer Via Copy ─────────────
test("a marquee drag then the Layer ▸ Layer Via Copy menu copies the selection up", async ({ page }) => {
  const m = await setup(page, false);
  await marqueeDrag(page, m); // real selection with the mouse
  await openMenu(page, "Layer");
  expect(await clickMenuItem(page, "Layer Via Copy")).toBe(true);
  await page.waitForTimeout(120);
  expect(await layerCount(page)).toBe(3);
  // source intact (Copy, not Cut): hiding the new layer still shows red inside.
  expect(isRed(await pixelHiding(page, [0], IN.x, IN.y))).toBe(true);
  // the new layer holds only the selected square.
  expect((await pixelHiding(page, [1, 2], OUT.x, OUT.y))[3]).toBeLessThan(40);
});

// ── Mouse + shortcut: marquee drag then ⇧⌘J (Layer Via Cut) ────────────
test("a marquee drag then ⇧⌘J cuts the selection onto a new layer", async ({ page }) => {
  const m = await setup(page, false);
  await marqueeDrag(page, m);
  await page.keyboard.press("Meta+Shift+KeyJ");
  await page.waitForTimeout(120);
  expect(await layerCount(page)).toBe(3);
  // Cut → hiding the new layer reveals a hole (white) inside the source.
  expect(isWhite(await pixelHiding(page, [0], IN.x, IN.y))).toBe(true);
  expect(isRed(await pixelHiding(page, [0], OUT.x, OUT.y))).toBe(true);
});

// ── No selection: ⌘J duplicates the whole layer; ⇧⌘J is a no-op ────────
test("with no selection, layerViaCopy duplicates the whole layer", async ({ page }) => {
  await setup(page, false); // no selection
  await page.evaluate(() => (window as any).__mv.store.layerViaCopy());
  expect(await layerCount(page)).toBe(3);
  // a FULL duplicate → the new layer is red everywhere (not masked to a square).
  expect(isRed(await pixelHiding(page, [1, 2], IN.x, IN.y))).toBe(true);
  expect(isRed(await pixelHiding(page, [1, 2], OUT.x, OUT.y))).toBe(true);
});

test("with no selection, layerViaCut does nothing", async ({ page }) => {
  await setup(page, false);
  await page.evaluate(() => (window as any).__mv.store.layerViaCut());
  expect(await layerCount(page)).toBe(2); // unchanged
});
