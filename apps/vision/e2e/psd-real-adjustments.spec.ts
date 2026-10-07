import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end import of a REAL, third-party Photoshop document (not the synthetic
// sample.psd): test/read/adjustment-layers/src.psd from the MIT-licensed ag-psd
// project (see packages/monet-ui/crates/monet-format/test-assets/fixtures/ag-psd-MIT.txt). It carries one raster
// layer plus all sixteen adjustment-layer types. The regression guard is that a
// Color Lookup (clrL) adjustment layer must reach the engine as an adjustment
// layer (kind 1), not a raster layer (kind 0) — it previously imported wrong.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", name)));

// Engine layer-kind bytes (see engine adapter format_import.rs).
const KIND_RASTER = 0;
const KIND_ADJUSTMENT = 1;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("imports a real Photoshop adjustment-layer stack (incl. Color Lookup)", async ({ page }) => {
  const r = await page.evaluate((arr) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    mv.store.openFormat(new Uint8Array(arr), "real-adjustment-layers");
    const layers: Record<string, number> = {};
    const count = E().layer_count();
    for (let i = 0; i < count; i++) {
      const id = E().layer_id_at(i);
      layers[E().layer_name(id)] = E().layer_kind(id);
    }
    return { w: E().width(), h: E().height(), count, layers };
  }, fixture("real-adjustment-layers.psd"));

  expect(r.w).toBe(200);
  expect(r.h).toBe(200);
  // 1 raster + 16 adjustment layers, none dropped.
  expect(r.count).toBe(17);

  // The single pixel layer stays raster.
  expect(r.layers["Layer 1"]).toBe(KIND_RASTER);

  // Every adjustment layer reaches the engine as an adjustment layer. The
  // headline case is Color Lookup, which used to import as a raster layer.
  const adjustmentNames = [
    "Brightness/Contrast 1", "Levels 1", "Curves 1", "Exposure 1", "Vibrance 1",
    "Hue/Saturation 1", "Color Balance 1", "Black & White 1", "Photo Filter 1",
    "Channel Mixer 1", "Color Lookup 1", "Invert 1", "Posterize 1", "Threshold 1",
    "Gradient Map 1", "Selective Color 1",
  ];
  for (const name of adjustmentNames) {
    expect(r.layers[name], `${name} should import as an adjustment layer`).toBe(KIND_ADJUSTMENT);
  }

  // Exactly one raster + sixteen adjustments overall.
  const kinds = Object.values(r.layers);
  expect(kinds.filter((k) => k === KIND_RASTER).length).toBe(1);
  expect(kinds.filter((k) => k === KIND_ADJUSTMENT).length).toBe(16);
});

test("decodes adjustment parameters through the engine", async ({ page }) => {
  // Exposure/Hue-Saturation/Color-Balance (binary blocks) and Black & White (a
  // descriptor with no prior parser) used to decode no parameters, so the engine
  // got the identity fallback. Assert the real parameters reach the engine.
  const r = await page.evaluate((arr) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    mv.store.openFormat(new Uint8Array(arr), "real-adjustment-layers");
    const out: Record<string, { kind: number; params: number[] }> = {};
    const count = E().layer_count();
    for (let i = 0; i < count; i++) {
      const id = E().layer_id_at(i);
      out[E().layer_name(id)] = { kind: E().layer_adj_kind(id), params: Array.from(E().layer_adj_params(id) as Float32Array) };
    }
    return out;
  }, fixture("real-adjustment-layers.psd"));

  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-3);

  // Exposure → adj kind 9, params [exposure, offset, gamma].
  expect(r["Exposure 1"].kind).toBe(9);
  near(r["Exposure 1"].params[0], -2);
  near(r["Exposure 1"].params[1], 0);
  near(r["Exposure 1"].params[2], 1);

  // Hue/Saturation → adj kind 2, params [hue, saturation, lightness].
  expect(r["Hue/Saturation 1"].kind).toBe(2);
  near(r["Hue/Saturation 1"].params[0], 0);
  near(r["Hue/Saturation 1"].params[1], -0.4);
  near(r["Hue/Saturation 1"].params[2], 0.05);

  // Color Balance → adj kind 10, params [shadows×3, midtones×3, highlights×3].
  expect(r["Color Balance 1"].kind).toBe(10);
  [0, 0, 0, 0.16, -0.21, 0.33, 0.38, 0.35, 0.38].forEach((want, i) => near(r["Color Balance 1"].params[i], want));

  // Black & White → adj kind 6, Photoshop's six-band model: [neutral 1, 0, 0,
  // Reds, Yellows, Greens, Cyans, Blues, Magentas (% / 100), tint on, tint hue°,
  // tint saturation]. psd-tools reads this blwh as -40/235/144/-68/-3/-107 %
  // with useTint and a tint of RGB(55.6, 156.9, 215.0): HSL hue 201.88°, 0.666.
  expect(r["Black & White 1"].kind).toBe(6);
  expect(r["Black & White 1"].params).toHaveLength(12);
  [1, 0, 0, -0.4, 2.35, 1.44, -0.68, -0.03, -1.07, 1, 201.8792, 0.6658].forEach((want, i) =>
    near(r["Black & White 1"].params[i], want));
});
