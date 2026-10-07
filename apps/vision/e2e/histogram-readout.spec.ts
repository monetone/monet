import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Histogram Level / Count / Percentile readout ─────────
// Adobe: hovering the histogram reports the Level under the cursor, that level's
// pixel Count, and the cumulative Percentile. Vision drives the readout from the
// pure histogramReadout over the existing 256-bin channel counts. A flat gray-128
// fill puts every pixel at level 128, so the percentile flips 0 → 100 across it.
//   https://helpx.adobe.com/photoshop/using/histograms-pixel-values.html

const pct = (page: Page) => page.locator('[data-mv-hist="percentile"]');

// A 100×100 document filled flat gray 128 (luma histogram: all pixels at 128).
async function grayDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "histreadout");
    const e = mv.engine.engine;
    e.select_rect(0, 0, 100, 100, 0);
    e.fill_selection(128, 128, 128, 255);
    e.select_none();
    mv.engine.commit();
  });
}

test("the histogram readout reports the percentile under the cursor", async ({ page }) => {
  await grayDoc(page);
  await expect(pct(page)).not.toContainText("%"); // blank before hovering
  const graph = page.locator("[data-mv-hist-graph]");
  const box = await graph.boundingBox();
  if (!box) throw new Error("histogram graph not found");
  await graph.hover({ position: { x: box.width * 0.25, y: box.height / 2 } }); // left of level 128
  await expect(pct(page)).toHaveText("Percentile 0.0%");
  await graph.hover({ position: { x: box.width * 0.75, y: box.height / 2 } }); // right of level 128
  await expect(pct(page)).toHaveText("Percentile 100.0%");
});
