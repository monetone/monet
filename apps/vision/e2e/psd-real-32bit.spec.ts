import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end import of a REAL 32-bit/channel (float) Photoshop document (ag-psd's
// MIT-licensed test/read/32bits/src.psd; see packages/monet-ui/crates/monet-format/test-assets/fixtures/ag-psd-MIT.txt). Its channels use
// ZIP-with-prediction; 32-bit float prediction is the TIFF floating-point
// predictor. monet-format previously failed to parse such files entirely, so the
// document would not open. This guards that real 32-bit layers reach the engine.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", name)));

const KIND_RASTER = 0;
const MODE_RGB = 0;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("imports a real 32-bit float PSD (ZIP-with-prediction channels)", async ({ page }) => {
  test.slow();
  const r = await page.evaluate((arr) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    const editErrors: string[] = [];
    const previousEditError = mv.engine.onEditError;
    mv.engine.onEditError = (message: string) => editErrors.push(message);
    mv.store.openFormat(new Uint8Array(arr), "real-32bit-rgb");
    const count = E().layer_count();
    const names: string[] = [];
    const kinds: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = E().layer_id_at(i);
      names.push(E().layer_name(id));
      kinds.push(E().layer_kind(id));
    }
    // Sample the active "Layer 0" at its document-space centre. The all-layer
    // display composite is colour-managed/tone-mapped, while this layer-local
    // anchor matches the independently decoded ag-psd source sample.
    const packed = E().pick_sample(147, 161, 0, 1) >>> 0;
    E().select_rect(147, 161, 1, 1, 0);
    E().fill_selection(255, 0, 255, 255);
    E().select_none();
    const committed = mv.engine.commit();
    const edited = E().pick_sample(147, 161, 0, 1) >>> 0;
    mv.engine.onEditError = previousEditError;
    return {
      w: E().width(),
      h: E().height(),
      count,
      names,
      kinds,
      mode: E().doc_mode(),
      depth: E().doc_depth(),
      sample: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255],
      committed,
      edited: [(edited >>> 24) & 255, (edited >>> 16) & 255, (edited >>> 8) & 255, edited & 255],
      editErrors,
    };
  }, fixture("real-32bit-rgb.psd"));

  expect(r.w).toBe(300);
  expect(r.h).toBe(300);
  // Editable RGB imports intentionally do not retain the read-only Photoshop
  // source payload, so doc_mode/doc_depth are the authoritative app state.
  expect(r.mode).toBe(MODE_RGB);
  expect(r.depth).toBe(16);
  expect(r.sample).toEqual([0, 171, 90, 128]);
  expect(r.committed).toBe(true);
  expect(r.edited).toEqual([255, 0, 255, 255]);
  expect(r.editErrors).toEqual([]);
  // Both real layers recovered (from Lr32 + the float channel decode) — not a
  // single flattened "Background", and not a failed/empty open.
  expect(r.count).toBe(2);
  expect(r.names).toContain("Layer 1");
  expect(r.names).toContain("Layer 0");
  expect(r.names).not.toContain("Background");
  expect(r.kinds.every((k) => k === KIND_RASTER)).toBe(true);
});

test("Auto preserves real HDR data and offers one-click 16-bit conversion", async ({ page }) => {
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const header = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n");
    const hdr = new Uint8Array(header.length + 4);
    hdr.set(header);
    hdr.set([128, 64, 32, 131], header.length); // RGB = 4, 2, 1
    const source = mv.engine.buildImage(hdr);
    const psd = source.export_psd();
    source.free();

    mv.store.openFormat(psd, "actual-hdr.psd");
    const E = () => mv.engine.engine;
    const preserved = { depth: E().doc_depth(), hdr: E().has_hdr_samples() };
    E().select_rect(0, 0, 1, 1, 0);
    E().fill_selection(255, 0, 255, 255);
    const firstCommit = mv.engine.commit();
    E().fill_selection(255, 0, 255, 255);
    const secondCommit = mv.engine.commit();
    return { ...preserved, firstCommit, secondCommit };
  });

  expect(result).toEqual({ depth: 32, hdr: true, firstCommit: false, secondCommit: false });
  await expect(page.getByRole("alert")).toHaveCount(1);
  await page.getByRole("button", { name: "Convert to 16-bit" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mv.engine.engine.doc_depth())).toBe(16);
});
