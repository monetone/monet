import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Pencil tool ──────────────────────────────────────────
// Adobe: the Pencil paints hard-edged, *aliased* strokes — crisp pixel-perfect
// lines with no soft/anti-aliased edge, regardless of the Hardness setting (it is
// always 100% hard). Vision's Pencil is the Brush pipeline with Hardness forced to
// 1 (the engine already renders a non-anti-aliased disc at hardness 1). It joins
// the Brush flyout group. https://helpx.adobe.com/photoshop/using/drawing.html

// Arm a tool with a deliberately LOW hardness, then paint a horizontal stroke via
// the engine FFI at fixed doc coords (deterministic — no pointer mapping), and
// return the red channel of a vertical cross-section through the stroke.
async function strokeColumn(page: Page, tool: string): Promise<number[]> {
  await gotoApp(page);
  return await page.evaluate((tool) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 140, "pencil");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black on the white base
    mv.store.setTool(tool);
    // Low hardness on purpose: the Pencil must override it to 1 (crisp); the Brush
    // must keep it (soft). setBrush → pushBrush pushes the resolved brush to wasm.
    mv.store.setBrush({ size: 18, hardness: 0.25, flow: 1, opacity: 1, smoothing: 0 });
    const E = mv.engine.engine;
    E.stroke_begin();
    E.stroke_to(20, 40, 1);
    E.stroke_to(180, 40, 1);
    E.stroke_end();
    E.composite();
    const out: number[] = [];
    for (let y = 20; y <= 60; y++) out.push(((E.pick_color(100, y) >>> 0) >>> 24) & 255);
    return out;
  }, tool);
}

test("Pencil forces a 100%-hard brush even when Hardness is low", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "p");
    mv.store.setTool("pencil");
    mv.store.setBrush({ hardness: 0.25 });
    return { tool: mv.store.state.tool, lastHardness: mv.engine.lastBrush[1] };
  });
  expect(r.tool).toBe("pencil");
  expect(r.lastHardness).toBe(1); // the Pencil pushed hardness 1 to the engine
});

test("Pencil paints crisp, aliased edges (no intermediate grey)", async ({ page }) => {
  const col = await strokeColumn(page, "pencil");
  const intermediate = col.filter((r) => r > 30 && r < 225);
  expect(intermediate.length).toBe(0);     // no soft ramp — every pixel is black or white
  expect(col.some((r) => r < 30)).toBe(true);   // painted core present
  expect(col.some((r) => r > 225)).toBe(true);  // untouched paper present
});

test("a soft Brush at the same low Hardness has an anti-aliased edge (the difference is real)", async ({ page }) => {
  const col = await strokeColumn(page, "brush");
  const intermediate = col.filter((r) => r > 30 && r < 225);
  expect(intermediate.length).toBeGreaterThan(0); // soft brush ramps through greys
});
