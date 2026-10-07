import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end import of a REAL 16-bit/channel Photoshop document (ag-psd's
// MIT-licensed test/read/16bits/src.psd; see packages/monet-ui/crates/monet-format/test-assets/fixtures/ag-psd-MIT.txt). 16-/32-bit files
// store their layer records in an `Lr16`/`Lr32` additional-info block, leaving
// the main Layer Info empty. The regression guard: the real layer "Layer 1" must
// reach the engine, not a flattened "Background" — monet-format previously missed
// the Lr16 block and collapsed every layered 16-bit file to one merged layer.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", name)));

const KIND_RASTER = 0;
const MODE_RGB = 0;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("imports a real 16-bit PSD's layer from its Lr16 block", async ({ page }) => {
  const r = await page.evaluate((arr) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    mv.store.openFormat(new Uint8Array(arr), "real-16bit-rgb");
    const count = E().layer_count();
    const names: string[] = [];
    const kinds: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = E().layer_id_at(i);
      names.push(E().layer_name(id));
      kinds.push(E().layer_kind(id));
    }
    const packed = E().pick_sample(248, 261, 0, 0) >>> 0;
    return {
      w: E().width(),
      h: E().height(),
      count,
      names,
      kinds,
      mode: E().doc_mode(),
      depth: E().doc_depth(),
      sample: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255],
    };
  }, fixture("real-16bit-rgb.psd"));

  expect(r.w).toBe(500);
  expect(r.h).toBe(500);
  // Editable RGB imports intentionally do not retain the read-only Photoshop
  // source payload, so doc_mode/doc_depth are the authoritative app state.
  expect(r.mode).toBe(MODE_RGB);
  expect(r.depth).toBe(16);
  expect(r.sample).toEqual([76, 51, 26, 255]);
  // The real layer is recovered from Lr16 — exactly one layer, named "Layer 1".
  expect(r.count).toBe(1);
  expect(r.names).toContain("Layer 1");
  // Not the flattened-composite fallback (which the merged path names "Background").
  expect(r.names).not.toContain("Background");
  expect(r.kinds[0]).toBe(KIND_RASTER);
});
