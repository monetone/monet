import { expect, test, type JSHandle, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// Exercise the generated WASM binding directly: EngineClient.buildFormat opens
// non-RGB imports for editing and intentionally releases the retained source.
// This tiny fixture mirrors imported_photoshop_containment::flattened_photoshop
// in the native engine tests, without depending on licensed Photoshop files.
function flattenedPhotoshop(mode: 1 | 9, depth: 8 | 16, psb: boolean): number[] {
  const bytes = [0x38, 0x42, 0x50, 0x53]; // 8BPS
  const be16 = (value: number) => bytes.push(value >>> 8, value & 255);
  const be32 = (value: number) => bytes.push(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  const channels = mode === 1 ? 1 : 3;
  be16(psb ? 2 : 1);
  bytes.push(...new Array(6).fill(0));
  be16(channels);
  be32(1); // height
  be32(2); // width
  be16(depth);
  be16(mode);
  be32(0); // color mode data
  be32(0); // image resources
  if (psb) be32(0); // high half of PSB's 64-bit layer/mask length
  be32(0); // layer/mask length
  be16(0); // uncompressed, planar merged composite
  for (let channel = 0; channel < channels; channel++) {
    if (depth === 16) {
      be16(0x2000 + channel * 0x0800);
      be16(0xa000 - channel * 0x0800);
    } else {
      bytes.push(32 + channel * 16, 192 - channel * 16);
    }
  }
  return bytes;
}

async function importSource(page: Page, bytes: number[]) {
  return page.evaluateHandle((source) => {
    const Engine = (window as any).__mv.engine.engine.constructor;
    return Engine.fromFormat(new Uint8Array(source));
  }, bytes);
}

async function documentState(engine: JSHandle<any>) {
  return engine.evaluate((E) => {
    const width = E.width() as number, height = E.height() as number;
    return {
      width, height,
      mode: E.doc_mode() as number,
      depth: E.doc_depth() as number,
      readOnly: E.imported_photoshop_read_only() as boolean,
      sourceMode: E.imported_photoshop_source_mode() as number,
      sourceDepth: E.imported_photoshop_source_depth() as number,
      sourceIsPsb: E.imported_photoshop_source_is_psb() as boolean,
      active: E.active_layer_id() as number,
      layers: Array.from({ length: E.layer_count() as number }, (_, index) => {
        const id = E.layer_id_at(index) as number;
        return { id, name: E.layer_name(id) as string, kind: E.layer_kind(id) as number, visible: E.layer_visible(id) as boolean };
      }),
      activePixels: Array.from(E.active_layer_rgba8() as Uint8Array),
      // Public pixel reads capture every output byte without touching WASM memory
      // or consuming the pending rejection through another export/error boundary.
      output: Array.from({ length: width * height }, (_, index) => E.pick_color(index % width, Math.floor(index / width)) >>> 0),
      history: {
        labels: Array.from(E.history_labels() as string[]),
        current: E.history_current() as number,
        undoDepth: E.undo_depth() as number,
        undoPushes: E.undo_pushes() as number,
        canUndo: E.can_undo() as boolean,
        canRedo: E.can_redo() as boolean,
      },
    };
  });
}

async function freeEngine(engine: JSHandle<any>) {
  try { await engine.evaluate((E) => E.free()); }
  finally { await engine.dispose(); }
}

type PreviewCopy = { name: string; method: string; args: number[]; format: "png" | "jpeg" | "tiff" | "webp"; width: number; height: number };
function previewCopies(layer: number): PreviewCopy[] {
  return [
    { name: "isolated PNG", method: "export_layer_png", args: [layer], format: "png", width: 2, height: 1 },
    { name: "isolated JPEG", method: "export_layer_jpeg", args: [layer, 90], format: "jpeg", width: 2, height: 1 },
    { name: "PNG", method: "export_png", args: [], format: "png", width: 2, height: 1 },
    { name: "JPEG", method: "export_jpeg", args: [90], format: "jpeg", width: 2, height: 1 },
    { name: "TIFF", method: "export_tiff", args: [], format: "tiff", width: 2, height: 1 },
    { name: "WebP", method: "export_webp", args: [], format: "webp", width: 2, height: 1 },
    { name: "scaled PNG", method: "export_scaled_png", args: [2], format: "png", width: 4, height: 2 },
    { name: "scaled JPEG", method: "export_scaled_jpeg", args: [2, 90], format: "jpeg", width: 4, height: 2 },
  ];
}

async function expectPreviewCopy(page: Page, bytes: number[], copy: PreviewCopy) {
  expect(bytes.length, copy.name).toBeGreaterThan(0);
  if (copy.format === "png") expect(bytes.slice(0, 8), copy.name).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  if (copy.format === "jpeg") expect(bytes.slice(0, 3), copy.name).toEqual([255, 216, 255]);
  if (copy.format === "webp") {
    expect(bytes.slice(0, 4), copy.name).toEqual([82, 73, 70, 70]); // RIFF
    expect(bytes.slice(8, 12), copy.name).toEqual([87, 69, 66, 80]); // WEBP
  }
  if (copy.format === "tiff") {
    // Chromium does not decode TIFF; accept either standard TIFF byte order.
    expect([[73, 73, 42, 0], [77, 77, 0, 42]], copy.name).toContainEqual(bytes.slice(0, 4));
    return;
  }
  const dimensions = await page.evaluate(async ({ bytes, format }) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: `image/${format}` }));
    try { return [image.width, image.height]; }
    finally { image.close(); }
  }, { bytes, format: copy.format });
  expect(dimensions, copy.name).toEqual([copy.width, copy.height]);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

for (const source of [
  { name: "Lab PSB", mode: 9 as const, depth: 8 as const, psb: true, documentMode: 3 },
  { name: "Grayscale PSD", mode: 1 as const, depth: 16 as const, psb: false, documentMode: 1 },
]) {
  test(`${source.name} preview copies reconcile rejected edits and preserve the exact source`, async ({ page }) => {
    const original = flattenedPhotoshop(source.mode, source.depth, source.psb);
    const engine = await importSource(page, original);
    try {
      const before = await documentState(engine);
      expect(before).toMatchObject({
        width: 2, height: 1, mode: source.documentMode, depth: source.depth,
        readOnly: true, sourceMode: source.mode, sourceDepth: source.depth, sourceIsPsb: source.psb,
        history: { labels: [], current: 0, undoDepth: 0, undoPushes: 0, canUndo: false, canRedo: false },
      });
      expect(before.layers).toHaveLength(1);
      expect(before.output[0]).not.toBe(before.output[1]);

      for (const copy of previewCopies(before.active)) {
        const result = await engine.evaluate((E, { method, args }) => {
          E.clear_last_edit_error();
          const rejected = E.add_layer("must not leak into preview copy");
          // Export is the first host boundary after add_layer: reading the error
          // or original source first would conceal a missing preview restore.
          const bytes = Array.from(E[method](...args) as Uint8Array);
          return { rejected, bytes };
        }, copy);
        expect(result.rejected, copy.name).toBe(0);
        expect(await documentState(engine), copy.name).toEqual(before);
        expect(await engine.evaluate((E) => Array.from(E.export_imported_photoshop_original() as Uint8Array)), copy.name).toEqual(original);
        expect(await engine.evaluate((E) => E.last_edit_error()), copy.name).toBe("This imported non-RGB Photoshop document is read-only; convert it to RGB before editing");
        await expectPreviewCopy(page, result.bytes, copy);
      }
    } finally { await freeEngine(engine); }
  });
}

test("exact-source export without a retained Photoshop source throws a browser string", async ({ page }) => {
  const engine = await page.evaluateHandle(() => {
    const Engine = (window as any).__mv.engine.engine.constructor;
    return new Engine(2, 1);
  });
  try {
    const before = await documentState(engine);
    expect(before.readOnly).toBe(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await engine.evaluate((E) => {
        try { E.export_imported_photoshop_original(); return null; }
        catch (error) { return { type: typeof error, message: String(error) }; }
      });
      expect(error).toEqual({ type: "string", message: "document has no preserved non-RGB Photoshop source" });
      expect(await documentState(engine)).toEqual(before);
    }
  } finally { await freeEngine(engine); }
});

test("opening Lab for editing clears the source and keeps RGB flat exports refused", async ({ page }) => {
  const engine = await importSource(page, flattenedPhotoshop(9, 8, false));
  try {
    expect(await engine.evaluate((E) => E.edit_imported_photoshop())).toBe(true);
    const before = await documentState(engine);
    expect(before).toMatchObject({ mode: 3, readOnly: false, sourceMode: 255, sourceDepth: 0, sourceIsPsb: false });
    for (const copy of previewCopies(before.active).filter((copy) => !copy.name.startsWith("isolated"))) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const error = await engine.evaluate((E, { method, args }) => {
          E.clear_last_edit_error();
          try { E[method](...args); return null; }
          catch (error) { return { type: typeof error, message: String(error), editError: E.last_edit_error() }; }
        }, copy);
        const message = `This Lab document cannot be written as an RGB ${copy.format === "jpeg" ? "JPEG" : copy.format === "webp" ? "WebP" : copy.format.toUpperCase()}. Save as Photoshop, or convert it to RGB Color.`;
        expect(error, copy.name).toEqual({ type: "string", message, editError: message });
        expect(await documentState(engine), copy.name).toEqual(before);
      }
    }
  } finally { await freeEngine(engine); }
});

test("a released RGB import switched back to Lab cannot use retained-preview export permission", async ({ page }) => {
  const engine = await importSource(page, flattenedPhotoshop(9, 8, false));
  try {
    expect(await engine.evaluate((E) => E.convert_imported_photoshop_to_rgb())).toBe(true);
    expect(await documentState(engine)).toMatchObject({ mode: 0, readOnly: false, sourceMode: 255, sourceDepth: 0, sourceIsPsb: false });
    const rgb = await engine.evaluate((E) => Array.from(E.export_png() as Uint8Array));
    await expectPreviewCopy(page, rgb, { name: "converted RGB PNG", method: "export_png", args: [], format: "png", width: 2, height: 1 });
    await engine.evaluate((E) => E.set_mode(3));
    const before = await documentState(engine);
    expect(before).toMatchObject({ mode: 3, readOnly: false });
    const error = await engine.evaluate((E) => {
      try { E.export_png(); return null; }
      catch (error) { return { type: typeof error, message: String(error) }; }
    });
    expect(error).toEqual({ type: "string", message: "This Lab document cannot be written as an RGB PNG. Save as Photoshop, or convert it to RGB Color." });
    expect(await documentState(engine)).toEqual(before);
  } finally { await freeEngine(engine); }
});
