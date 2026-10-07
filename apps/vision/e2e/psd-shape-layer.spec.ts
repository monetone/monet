import { test, expect, type Page } from "@playwright/test";
import { readPsd, writePsd, type Layer } from "ag-psd";
import { gotoApp } from "./helpers";

// ── Photoshop shape layers open as editable shapes (#454) ──────────
// A layer whose vmsk/vsms outline carries a solid SoCo fill (or a vscg holding
// one) and no enabled stroke opens as a vector layer: Direct Selection drags
// its anchors, the Paths panel lists its path, and Save As writes the edited
// outline back as live-shape blocks. ag-psd authors the source and reads the
// re-export, which proves the bytes are well formed, not that Photoshop
// accepts them.

const W = 100;
const H = 80;
const RED = { r: 220, g: 40, b: 30 };
const RECT = [[20, 20], [60, 20], [60, 50], [20, 50]];
const inRect = (x: number, y: number) => x >= 20 && x < 60 && y >= 20 && y < 50;

function plane(fn: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(fn(x, y), (y * W + x) * 4);
  return { width: W, height: H, data };
}

/** A white background under "Shape 1", a red rectangle shape layer. A disabled
 *  stroke makes ag-psd store the fill as vscg + vstk instead of SoCo. */
function shapePsd(withDisabledStroke = false): number[] {
  const shape: Layer = {
    name: "Shape 1", left: 0, top: 0, right: W, bottom: H,
    imageData: plane((x, y) => (inRect(x, y) ? [RED.r, RED.g, RED.b, 255] : [0, 0, 0, 0])),
    vectorMask: {
      paths: [{
        open: false, operation: "combine", fillRule: "non-zero",
        knots: RECT.map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
      }],
    },
    vectorFill: { type: "color", color: RED },
  };
  if (withDisabledStroke) shape.vectorStroke = { strokeEnabled: false, fillEnabled: true };
  const bytes = writePsd({
    width: W, height: H,
    imageData: plane((x, y) => (inRect(x, y) ? [RED.r, RED.g, RED.b, 255] : [255, 255, 255, 255])),
    children: [
      { name: "Background", left: 0, top: 0, right: W, bottom: H, imageData: plane(() => [255, 255, 255, 255]) },
      shape,
    ],
  });
  return Array.from(new Uint8Array(bytes));
}

/** Turn the vmsk's first subpath length record into selector 9, a path record
 *  type that does not exist. */
function corruptOutline(bytes: number[]): number[] {
  const out = bytes.slice();
  const tag = Array.from("8BIMvmsk", (c) => c.charCodeAt(0));
  const at = out.findIndex((_, i) => tag.every((b, j) => out[i + j] === b));
  expect(at).toBeGreaterThan(0);
  for (let p = at + 12 + 8; p + 26 <= out.length; p += 26) {
    const selector = (out[p] << 8) | out[p + 1];
    if (selector === 0 || selector === 3) {
      out[p] = 0;
      out[p + 1] = 9;
      return out;
    }
  }
  throw new Error("vmsk has no subpath length record");
}

/** Open PSD bytes the way File ▸ Open does, collecting every edit-error
 *  message while still handing it to the app's own toast. */
async function openCapturing(page: Page, bytes: number[], name: string) {
  return await page.evaluate(({ bytes, name }) => {
    const mv = (window as any).__mv;
    const messages: string[] = [];
    const previous = mv.engine.onEditError;
    mv.engine.onEditError = (message: string) => {
      messages.push(message);
      previous?.(message);
    };
    try {
      mv.store.openFormat(new Uint8Array(bytes), name);
    } finally {
      mv.engine.onEditError = previous;
    }
    const E = mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    return {
      id,
      messages,
      kind: E.layer_kind(id),
      name: E.layer_name(id),
      depth: E.doc_depth(),
      fill: ((E.pick_color(40, 35) >>> 8) & 0xffffff).toString(16),
    };
  }, { bytes, name });
}

for (const [label, withDisabledStroke] of [["SoCo", false], ["vscg + vstk", true]] as const) {
  test(`opens a Photoshop shape layer (${label}) as an editable shape listed in the Paths panel`, async ({ page }) => {
    await gotoApp(page);
    const opened = await openCapturing(page, shapePsd(withDisabledStroke), "shape.psd");
    expect(opened).toMatchObject({ kind: 3, name: "Shape 1", messages: [], fill: "dc281e" });
    const grabs = await page.evaluate((id) => {
      const E = (window as any).__mv.engine.engine;
      return { corner: E.vector_nearest_anchor(id, 20, 20, 0.5), handle: E.vector_nearest_handle(id, 20, 20, 4) };
    }, opened.id);
    expect(grabs.corner).not.toBe("");
    expect(grabs.handle).toBe(""); // a corner knot has no handle to steal the grab

    await page.locator('[data-tab-id="paths"]').click();
    const row = page.locator('[data-mv-path-row="shape"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveText("Shape 1 Shape Path");
  });
}

test("Direct Selection drags an imported anchor with the real mouse and re-export keeps a vector shape", async ({ page }) => {
  await gotoApp(page);
  const { id, kind } = await openCapturing(page, shapePsd(), "shape.psd");
  expect(kind).toBe(3);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("directselect");
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = canvases.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / W;
  const cy = (d: number) => box.y + d * box.h / H;
  await page.mouse.move(cx(20), cy(20));
  await page.mouse.down();
  await page.mouse.move(cx(25), cy(23), { steps: 2 });
  await page.mouse.move(cx(30), cy(26), { steps: 2 });
  await page.mouse.up();

  const anchors = (step: "drag" | "undo" | "redo") => page.evaluate(({ id, step }) => {
    const mv = (window as any).__mv;
    if (step === "undo") mv.store.undo();
    if (step === "redo") mv.store.redo();
    const E = mv.engine.engine;
    return { moved: E.vector_nearest_anchor(id, 30, 26, 2) !== "", original: E.vector_nearest_anchor(id, 20, 20, 2) !== "" };
  }, { id, step });
  expect(await anchors("drag")).toEqual({ moved: true, original: false });
  expect(await anchors("undo")).toEqual({ moved: false, original: true });
  expect(await anchors("redo")).toEqual({ moved: true, original: false });

  // The bytes Save As writes, read back by an independent PSD reader.
  const saved = await page.evaluate(() => Array.from((window as any).__mv.exportPSDBytes() as Uint8Array));
  const psd = readPsd(new Uint8Array(saved).buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const shape = psd.children!.find((layer) => layer.name === "Shape 1")!;
  const path = shape.vectorMask!.paths[0];
  expect(path.operation).toBe("combine");
  const [x, y] = path.knots[0].points.slice(2, 4);
  expect(Math.abs(x - 30)).toBeLessThan(0.5);
  expect(Math.abs(y - 26)).toBeLessThan(0.5);
  // 8.24 fixed point through f32 lands within float noise of the corners.
  expect(path.knots.slice(1).map((knot) => knot.points.slice(2, 4).map(Math.round))).toEqual([[60, 20], [60, 50], [20, 50]]);
  const fill = shape.vectorFill as { type: string; color: { r: number; g: number; b: number } };
  expect(fill.type).toBe("color");
  for (const channel of ["r", "g", "b"] as const) expect(Math.abs(fill.color[channel] - RED[channel])).toBeLessThan(0.5);
});

test("a malformed shape outline opens as pixels with one warning, including a 32-bit open", async ({ page }) => {
  await gotoApp(page);
  const eight = await openCapturing(page, corruptOutline(shapePsd()), "malformed.psd");
  expect(eight).toMatchObject({ kind: 0, fill: "dc281e", depth: 8 });
  expect(eight.messages).toHaveLength(1);
  expect(eight.messages[0]).toContain('Layer "Shape 1"');
  expect(eight.messages[0]).toContain("could not be read");
  await expect(page.getByText(/could not be read/).first()).toBeVisible();
  await page.locator('[data-tab-id="paths"]').click();
  await expect(page.locator('[data-mv-path-row="shape"]')).toHaveCount(0);

  // A 32-bit PSD without HDR samples opens converted to 16 bits, and that
  // conversion used to clear the warning before the document drained it.
  const float = await page.evaluate(({ w, h, red }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "float shape");
    mv.store.setDepth(32);
    const E = mv.engine.engine;
    E.add_vector_layer(JSON.stringify({ layers: [{ items: [{
      type: "rect", id: "box", transform: { a: 1, b: 0, c: 0, d: 1, e: 20, f: 20 }, width: 40, height: 30,
      fill: { type: "solid", color: { ...red, a: 1 } },
    }] }] }), "Shape 1");
    mv.engine.afterDocChange();
    mv.store.setFilePrefs({ photoshop32BitImport: "auto" });
    return { depth: E.doc_depth(), bytes: Array.from(mv.exportPSDBytes() as Uint8Array) };
  }, { w: W, h: H, red: RED });
  expect(float.depth).toBe(32);
  const converted = await openCapturing(page, corruptOutline(float.bytes), "malformed-32.psd");
  expect(converted).toMatchObject({ kind: 0, depth: 16 });
  expect(converted.messages).toHaveLength(1);
  expect(converted.messages[0]).toContain("could not be read");
});
