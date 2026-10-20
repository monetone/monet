import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const engineModule = vi.hoisted(() => ({
  memory: new WebAssembly.Memory({ initial: 1 }),
  init: vi.fn(),
  fromFormat: vi.fn(),
  captureMetadata: vi.fn(),
}));

engineModule.init.mockResolvedValue({ memory: engineModule.memory });

vi.mock("@engine", () => ({
  default: engineModule.init,
  Engine: class Engine {
    static fromFormat(): Engine { return engineModule.fromFormat() as Engine; }
    static captureMetadata(bytes: Uint8Array): string { return engineModule.captureMetadata(bytes) as string; }
    static fromImage(): Engine { return new Engine(); }
    static fromRaw(): Engine { return new Engine(); }
    static loadProject(): Engine { return new Engine(); }
  },
}));

import { sampleDisplayLut } from "@monet-ui/monet-color";
import { EngineClient, changedRect, initEngine } from "./EngineClient";

describe("EngineClient", () => {
  beforeAll(async () => {
    await initEngine();
  });

  it("throws a clear error when callers access the live engine before boot", () => {
    const client = new EngineClient();
    expect(() => client.e).toThrow("Engine not ready");
  });

  it("reads capture metadata without replacing the active document", () => {
    const client = new EngineClient(), bytes = new Uint8Array([1, 2, 3]);
    const source = { make: "Camera", model: "Body", lens: "Lens", focalLengthMm: 50, aperture: 2.8, focalLength35Mm: 75 };
    engineModule.captureMetadata.mockReturnValueOnce(JSON.stringify(source)).mockReturnValueOnce("{}");
    expect(client.captureMetadata(bytes)).toEqual(source);
    expect(engineModule.captureMetadata).toHaveBeenLastCalledWith(bytes);
    expect(client.captureMetadata(new Uint8Array())).toEqual({});
    expect(client.engine).toBeNull();
  });

  it("uses actual HDR samples and the import override to choose Photoshop depth", () => {
    const client = new EngineClient();
    const psd = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1]);
    for (const [policy, hdr, converted] of [
      ["auto", false, true],
      ["auto", true, false],
      ["preserve", false, false],
      ["convert16", true, true],
    ] as const) {
      const imported = {
        edit_imported_photoshop: vi.fn(),
        doc_depth: () => 32,
        has_hdr_samples: vi.fn(() => hdr),
        set_depth: vi.fn(),
        purge: vi.fn(),
        set_history_source: vi.fn(),
      };
      engineModule.fromFormat.mockReturnValueOnce(imported);

      expect(client.buildFormat(psd, policy)).toBe(imported);
      expect(imported.edit_imported_photoshop).toHaveBeenCalledOnce();
      expect(imported.set_depth).toHaveBeenCalledTimes(converted ? 1 : 0);
      expect(imported.purge).toHaveBeenCalledTimes(converted ? 1 : 0);
      expect(imported.set_history_source).toHaveBeenCalledTimes(converted ? 1 : 0);
    }

    const message = 'Layer "Shape 1": its shape outline could not be read';
    const warned = {
      edit_imported_photoshop: vi.fn(),
      doc_depth: () => 32,
      has_hdr_samples: () => false,
      last_edit_error: () => message,
      clear_last_edit_error: vi.fn(),
      set_depth: vi.fn(),
      purge: vi.fn(),
      set_history_source: vi.fn(),
    };
    engineModule.fromFormat.mockReturnValueOnce(warned);
    const onEditError = vi.fn();
    client.onEditError = onEditError;
    client.buildFormat(psd, "auto");
    expect(warned.set_depth).toHaveBeenCalledWith(16);
    expect(onEditError).toHaveBeenCalledOnce();
    expect(onEditError).toHaveBeenCalledWith(message);
    expect(onEditError.mock.invocationCallOrder[0]).toBeGreaterThan(warned.set_depth.mock.invocationCallOrder[0]);
  });

  it("guards every project-byte consumer before a preserved Photoshop source can be discarded", () => {
    const client = new EngineClient();
    const saveProject = vi.fn(() => new Uint8Array([1, 2, 3]));
    const contained = {
      imported_photoshop_read_only: () => true,
      save_project: saveProject,
    } as never;

    expect(() => client.projectBytes(contained)).toThrow("Export the original or convert it to RGB");
    expect(saveProject).not.toHaveBeenCalled();

    const bytes = new Uint8Array([4, 5, 6]);
    expect(client.projectBytes({ save_project: () => bytes } as never)).toBe(bytes);
    const typed = vi.fn(() => bytes);
    const legacy = vi.fn(() => new Uint8Array([9]));
    expect(client.projectBytes({ try_save_project: typed, save_project: legacy } as never)).toBe(bytes);
    expect(typed).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
    expect(() => client.projectBytes({ save_project: () => new Uint8Array() } as never)).toThrow("empty project");

    const previewSave = vi.fn(() => bytes);
    expect(() => client.projectBytes({
      history_transaction_active: () => true,
      save_project: previewSave,
    } as never)).toThrow("Finish or cancel the current edit");
    expect(previewSave).not.toHaveBeenCalled();
  });

  it("guards graphics-container consumers and prefers the typed engine serializer", () => {
    const client = new EngineClient();
    const legacy = vi.fn(() => new Uint8Array([9]));
    const contained = {
      imported_photoshop_read_only: () => true,
      saveGraphicsContainer: legacy,
    } as never;
    expect(() => client.graphicsContainerBytes(contained)).toThrow("Export the original or convert it to RGB");
    expect(legacy).not.toHaveBeenCalled();

    const bytes = new Uint8Array([7, 8]);
    const typed = vi.fn(() => bytes);
    expect(client.graphicsContainerBytes({
      trySaveGraphicsContainer: typed,
      saveGraphicsContainer: legacy,
    } as never)).toBe(bytes);
    expect(typed).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
    expect(() => client.graphicsContainerBytes({
      saveGraphicsContainer: () => new Uint8Array(),
    } as never)).toThrow("empty graphics");

    const previewSave = vi.fn(() => bytes);
    expect(() => client.graphicsContainerBytes({
      history_transaction_active: () => true,
      saveGraphicsContainer: previewSave,
    } as never)).toThrow("Finish or cancel the current edit");
    expect(previewSave).not.toHaveBeenCalled();
  });

  it("re-adopts document dimensions on commit when history changes geometry", () => {
    const client = new EngineClient();
    const onCommit = vi.fn();
    const onSync = vi.fn();
    const blit = vi.spyOn(client, "blit").mockImplementation(() => {});
    client.engine = {
      width: () => 20,
      height: () => 12,
    } as never;
    client.width = 10;
    client.height = 8;
    client.onCommit = onCommit;
    client.onSync = onSync;

    client.commit();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(client.width).toBe(20);
    expect(client.height).toBe(12);
    expect(client.docGen).toBe(1);
    expect(blit).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("refreshes engine output without marking the document committed", () => {
    const client = new EngineClient();
    const onCommit = vi.fn();
    const onSync = vi.fn();
    const blit = vi.spyOn(client, "blit").mockImplementation(() => {});
    client.engine = {
      width: () => 10,
      height: () => 8,
    } as never;
    client.width = 10;
    client.height = 8;
    client.onCommit = onCommit;
    client.onSync = onSync;

    client.refreshFromEngine();

    expect(onCommit).not.toHaveBeenCalled();
    expect(blit).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("repaints transaction previews without marking them committed", () => {
    const client = new EngineClient();
    const onCommit = vi.fn();
    const onSync = vi.fn();
    const blit = vi.spyOn(client, "blit").mockImplementation(() => {});
    let transactionActive = true;
    client.engine = {
      width: () => 10,
      height: () => 8,
      history_transaction_active: () => transactionActive,
    } as never;
    client.width = 10;
    client.height = 8;
    client.onCommit = onCommit;
    client.onSync = onSync;

    client.commit();
    transactionActive = false;
    client.commit();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(blit).toHaveBeenCalledTimes(2);
    expect(onSync).toHaveBeenCalledTimes(2);
  });

  it("repaints only the dirty region on a region commit", () => {
    const client = new EngineClient();
    const onCommit = vi.fn();
    const onSync = vi.fn();
    const blitRegion = vi.spyOn(client, "blitRegion").mockImplementation(() => {});
    client.engine = {
      width: () => 10,
      height: () => 8,
    } as never;
    client.width = 10;
    client.height = 8;
    client.onCommit = onCommit;
    client.onSync = onSync;

    expect(client.commitRegion(2, 3, 4, 5)).toBe(true);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(blitRegion).toHaveBeenCalledTimes(1);
    expect(blitRegion).toHaveBeenCalledWith(2, 3, 4, 5);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected float edit without dirtying the document", () => {
    const client = new EngineClient();
    const onCommit = vi.fn();
    const onEditError = vi.fn();
    const onSync = vi.fn();
    const clearEditError = vi.fn();
    const blit = vi.spyOn(client, "blit").mockImplementation(() => {});
    client.engine = {
      width: () => 10,
      height: () => 8,
      last_edit_error: () => "Convert to 16 or 8 bits/channel first",
      clear_last_edit_error: clearEditError,
    } as never;
    client.width = 10;
    client.height = 8;
    client.onCommit = onCommit;
    client.onEditError = onEditError;
    client.onSync = onSync;

    expect(client.commit()).toBe(false);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onEditError).toHaveBeenCalledWith("Convert to 16 or 8 bits/channel first");
    expect(clearEditError).toHaveBeenCalledTimes(1);
    expect(blit).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  // Was "refuses the geometry afterDocChange path without adopting state": that
  // asserted the #56 bug — a document activation that finds a STALE refusal
  // latched on the newly activated engine kept the previous document's size, so
  // every blit read the new engine's buffer with the wrong stride.
  it("adopts the activated document's geometry even when a stale edit error is latched (#56)", () => {
    const client = new EngineClient();
    const onEditError = vi.fn();
    const clearEditError = vi.fn();
    const blit = vi.spyOn(client, "blit").mockImplementation(() => {});
    client.engine = {
      width: () => 20,
      height: () => 12,
      last_edit_error: () => "32-bit geometry is unsupported",
      clear_last_edit_error: clearEditError,
    } as never;
    client.width = 10;
    client.height = 8;
    client.onEditError = onEditError;

    expect(client.afterDocChange()).toBe(false); // the refusal still short-circuits the caller

    expect(client.width).toBe(20);
    expect(client.height).toBe(12);
    expect(client.docGen).toBe(1);
    expect(onEditError).toHaveBeenCalledWith("32-bit geometry is unsupported");
    expect(clearEditError).toHaveBeenCalledTimes(1);
    expect(blit).toHaveBeenCalledTimes(1); // consumeEditError's repaint, now correctly sized
  });

  it("composites dirty rects before repainting region strokes", () => {
    const client = new EngineClient();
    const compositeRegion = vi.fn();
    const blitRegion = vi.spyOn(client, "blitRegion").mockImplementation(() => {});
    client.engine = { composite_region: compositeRegion } as never;

    client.paintRegion(2, 3, 4, 5);
    client.paintRegion(0, 0, 0, 5);

    expect(compositeRegion).toHaveBeenCalledTimes(1);
    expect(compositeRegion).toHaveBeenCalledWith(2, 3, 6, 8);
    expect(blitRegion).toHaveBeenCalledTimes(1);
    expect(blitRegion).toHaveBeenCalledWith(2, 3, 4, 5);
  });

  it("rebuilds output views after WebAssembly memory grows", () => {
    const client = new EngineClient();
    const pixels = new Uint8ClampedArray(4);
    const putImageData = vi.fn();
    client.engine = { output_ptr: () => 0 } as never;
    client.width = 1;
    client.height = 1;
    Object.assign(client, {
      ctx: { putImageData },
      imageData: { data: pixels },
    });

    new Uint8Array(engineModule.memory.buffer, 0, 4).set([1, 2, 3, 4]);
    const detached = engineModule.memory.buffer;
    client.blit();
    expect([...pixels]).toEqual([1, 2, 3, 4]);

    engineModule.memory.grow(1);
    expect(detached.byteLength).toBe(0);
    new Uint8Array(engineModule.memory.buffer, 0, 4).set([5, 6, 7, 8]);
    client.blit();

    expect([...pixels]).toEqual([5, 6, 7, 8]);
    expect(putImageData).toHaveBeenCalledTimes(2);
  });

  it("copies every blit onto the Window ▸ Arrange mirrors, dab by dab (#478)", () => {
    const client = new EngineClient();
    client.engine = { output_ptr: () => 0 } as never;
    client.width = 4;
    client.height = 3;
    const img = { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4) };
    Object.assign(client, { ctx: { putImageData: vi.fn() }, imageData: img });
    const puts: unknown[][] = [];
    const mirror = { width: 0, height: 0, getContext: () => ({ putImageData: (...a: unknown[]) => puts.push(a) }) };

    client.addMirror(mirror as never);
    // A fresh (or outgrown) mirror is sized to the document and filled whole.
    expect([mirror.width, mirror.height]).toEqual([4, 3]);
    expect(puts.pop()).toEqual([img, 0, 0]);

    // Then only the dirty rect the document canvas took, never the whole image.
    client.blitRegion(1, 1, 2, 1);
    expect(puts.pop()).toEqual([img, 0, 0, 1, 1, 2, 1]);
    client.blit();
    expect(puts.pop()).toEqual([img, 0, 0, 0, 0, 4, 3]);

    client.removeMirror(mirror as never);
    client.blitRegion(0, 0, 1, 1);
    expect(puts).toEqual([]);
  });

  it("desaturates the on-screen blit only, never the engine output", () => {
    const client = new EngineClient();
    const pixels = new Uint8ClampedArray(4);
    const putImageData = vi.fn();
    client.engine = { output_ptr: () => 0 } as never;
    client.width = 1;
    client.height = 1;
    Object.assign(client, { ctx: { putImageData }, imageData: { data: pixels } });
    const output = new Uint8Array(engineModule.memory.buffer, 0, 4);
    output.set([200, 40, 40, 255]);

    client.blit();
    expect([...pixels]).toEqual([200, 40, 40, 255]);

    // Color Settings ▸ Advanced ▸ Desaturate Monitor Colors By 50%: halfway to
    // the pixel's luminance (0.3·200 + 0.59·40 + 0.11·40 = 88), and repainted.
    client.setMonitorDesaturation(50);
    expect([...pixels]).toEqual([144, 64, 64, 255]);
    expect(putImageData).toHaveBeenCalledTimes(2);
    client.setMonitorDesaturation(100);
    expect([...pixels]).toEqual([88, 88, 88, 255]);
    // What save and export read is the engine output, which stays as it was.
    expect([...new Uint8Array(engineModule.memory.buffer, 0, 4)]).toEqual([200, 40, 40, 255]);

    client.setMonitorDesaturation(0);
    expect([...pixels]).toEqual([200, 40, 40, 255]);
    client.setMonitorDesaturation(Number.NaN); // unreadable: off, not a garbled screen
    expect([...pixels]).toEqual([200, 40, 40, 255]);
  });

  it("selects Out of Gamut from the document pixels, not the display-transformed canvas", () => {
    const client = new EngineClient();
    const pixels = new Uint8ClampedArray(4);
    client.engine = { output_ptr: () => 0 } as never;
    client.width = 1;
    client.height = 1;
    Object.assign(client, { ctx: { putImageData: vi.fn() }, imageData: { data: pixels } });
    new Uint8Array(engineModule.memory.buffer, 0, 4).set([0, 255, 0, 255]); // pure green: no press prints it
    expect([...client.outOfGamutMask()]).toEqual([255]);

    // A fully desaturated screen shows grey, which every press prints; the
    // selection must still see the green the document holds.
    client.setMonitorDesaturation(100);
    expect(pixels[0]).toBe(pixels[1]);
    expect([...client.outOfGamutMask()]).toEqual([255]);
  });

  it("tells the float windows' streams every rect the canvas takes (#477)", () => {
    const client = new EngineClient();
    client.engine = { output_ptr: () => 0 } as never;
    client.width = 4;
    client.height = 3;
    const img = { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4) };
    Object.assign(client, { ctx: { putImageData: vi.fn() }, imageData: img });
    const out = new Uint8Array(engineModule.memory.buffer, 0, 4 * 3 * 4);
    out.fill(0);
    const rects: number[][] = [];
    const listener = (...r: number[]) => { rects.push(r); };
    client.blitListeners.add(listener);

    client.blitRegion(1, 1, 2, 1);
    expect(rects).toEqual([[1, 1, 2, 1]]);
    // A full repaint (a commit) tells them only what changed on the canvas:
    // after a stroke, the stroke — not the whole document, again.
    out.set([9, 9, 9, 255], (2 * 4 + 1) * 4); // pixel (1, 2)
    out.set([9, 9, 9, 255], (1 * 4 + 3) * 4); // pixel (3, 1)
    client.blit();
    expect(rects[1]).toEqual([1, 1, 3, 2]);
    client.blit(); // nothing changed since
    expect(rects).toHaveLength(2);
    expect(client.displayImage()).toBe(img);

    // With a display transform on, the canvas no longer shows the engine's
    // pixels as they are, so a repaint is reported whole.
    Object.assign(client, { proofOn: true });
    client.blit();
    expect(rects[2]).toEqual([0, 0, 4, 3]);
    Object.assign(client, { proofOn: false });

    client.blitListeners.delete(listener);
    client.blitRegion(0, 0, 1, 1);
    expect(rects).toHaveLength(3);
  });

  it("sends a whole frame after resizing to transparent pixels", () => {
    const client = new EngineClient();
    let width = 4;
    client.engine = { width: () => width, height: () => 2, output_ptr: () => 0 } as never;
    client.width = width;
    client.height = 2;
    new Uint8Array(engineModule.memory.buffer, 0, 4 * 2 * 4).fill(0);
    const context = {
      putImageData: vi.fn(),
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    };
    client.setCanvas({ width: 4, height: 2, getContext: () => context } as never);
    const listener = vi.fn();
    client.blitListeners.add(listener);

    width = 2;
    client.afterDocChange();

    expect(listener).toHaveBeenCalledWith(0, 0, 2, 2);
    client.blit(); // no change after the resize frame
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("finds the bounding rect of the pixels that differ", () => {
    const a = new Uint32Array(6 * 4), b = a.slice();
    expect(changedRect(a, b, 6, 4)).toBeNull();
    b[1 * 6 + 4] = 1;
    b[3 * 6 + 2] = 1;
    expect(changedRect(a, b, 6, 4)).toEqual({ x: 2, y: 1, w: 3, h: 3 });
  });


  it("replays remote strokes only onto an existing unlocked target", () => {
    const client = new EngineClient();
    let active = 1;
    const layers = [1, 2];
    const locked = new Set([2]);
    const setActive = vi.fn((id: number) => { active = id; });
    const strokeBegin = vi.fn(() => true);
    const strokeTo = vi.fn();
    const strokeEnd = vi.fn();
    const composite = vi.fn();
    vi.spyOn(client, "blit").mockImplementation(() => {});
    client.engine = {
      layer_count: () => layers.length,
      layer_id_at: (i: number) => layers[i],
      layer_locked: (id: number) => locked.has(id),
      active_layer_id: () => active,
      set_active_layer: setActive,
      set_brush: vi.fn(),
      stroke_begin: strokeBegin,
      stroke_to: strokeTo,
      stroke_end: strokeEnd,
      composite,
    } as never;
    const op = { layer: 2, brush: [10, 1, 1, 1, 0.1, 0, 0, 0, 255, 0], pts: [4, 5, 1] };

    client.applyRemoteStroke({ ...op, layer: 99 });
    client.applyRemoteStroke(op);
    expect(strokeBegin).not.toHaveBeenCalled();

    locked.clear();
    client.applyRemoteStroke(op);
    expect(setActive.mock.calls.map(([id]) => id)).toEqual([2, 1]);
    expect(strokeBegin).toHaveBeenCalledOnce();
    expect(strokeTo).toHaveBeenCalledWith(4, 5, 1);
    expect(strokeEnd).toHaveBeenCalledOnce();
    expect(composite).toHaveBeenCalledOnce();
  });

  // A document's engine, modelled down to the stroke API the collab replay uses.
  function fakeStrokeEngine() {
    let active = 1;
    return {
      active,
      setActive: vi.fn((id: number) => { active = id; }),
      setBrush: vi.fn(),
      strokeBegin: vi.fn(() => true),
      strokeTo: vi.fn(),
      strokeEnd: vi.fn(),
      composite: vi.fn(),
      engine: null as never,
    };
  }
  function bindEngine(f: ReturnType<typeof fakeStrokeEngine>) {
    let active = 1;
    f.engine = {
      width: () => 4,
      height: () => 4,
      layer_count: () => 2,
      layer_id_at: (i: number) => [1, 2][i],
      layer_locked: () => false,
      active_layer_id: () => active,
      set_active_layer: (id: number) => { active = id; f.setActive(id); },
      set_brush: f.setBrush,
      stroke_begin: f.strokeBegin,
      stroke_to: f.strokeTo,
      stroke_end: f.strokeEnd,
      composite: f.composite,
    } as never;
    return f;
  }

  const LOCAL_BRUSH = [20, 0.5, 1, 1, 0.1, 1, 2, 3, 255, 0];
  const remoteOp = { layer: 2, brush: [8, 1, 1, 1, 0.1, 9, 9, 9, 255, 1], pts: [4, 5, 1] };

  it("defers a remote stroke that arrives mid-local-stroke, then restores the local brush (#6)", () => {
    const client = new EngineClient();
    const doc = bindEngine(fakeStrokeEngine());
    vi.spyOn(client, "blit").mockImplementation(() => {});
    client.onStroke = vi.fn(); // a collab session is bound
    client.lastBrush = [...LOCAL_BRUSH];
    client.engine = doc.engine;

    client.strokeCaptureBegin(); // the user's drag opens a stroke transaction
    client.strokeCapturePoint(1, 1, 1);
    client.applyRemoteStroke(remoteOp); // a peer's op lands mid-drag

    // Replaying now would overwrite the stroke base and end the local stroke —
    // the rest of the user's drag would paint nothing.
    expect(doc.strokeBegin).not.toHaveBeenCalled();
    expect(doc.setBrush).not.toHaveBeenCalled();

    client.strokeCapturePoint(2, 2, 1);
    client.strokeCaptureEnd();

    expect(client.onStroke).toHaveBeenCalledWith({ layer: 1, brush: LOCAL_BRUSH, pts: [1, 1, 1, 2, 2, 1] });
    expect(doc.strokeBegin).toHaveBeenCalledOnce(); // flushed once the drag ended
    expect(doc.strokeTo).toHaveBeenCalledWith(4, 5, 1);
    expect(doc.setBrush.mock.calls.at(-1)).toEqual([...LOCAL_BRUSH.slice(0, 9), false]);
  });

  // Allow Tool Recording (#471): the capture channel was built for collab and
  // refused to open without a session bound, so an action could never see a
  // stroke. It now opens for either sink, and a recorded stroke replays through
  // the same paint path a peer's does.
  it("captures a stroke for the recorder with no collab session bound", () => {
    const client = new EngineClient();
    const doc = bindEngine(fakeStrokeEngine());
    client.lastBrush = [...LOCAL_BRUSH];
    client.engine = doc.engine;

    const recorded = vi.fn();
    client.onStrokeRecorded = recorded;
    client.strokeCaptureBegin();
    client.strokeCapturePoint(1, 1, 1);
    client.strokeCapturePoint(2, 2, 0.5);
    client.strokeCaptureEnd();

    expect(recorded).toHaveBeenCalledOnce();
    expect(recorded).toHaveBeenCalledWith({ layer: 1, brush: LOCAL_BRUSH, pts: [1, 1, 1, 2, 2, 0.5] });
    expect(client.onStroke).toBeNull(); // and no collab broadcast was invented

    // Toggle it off and painting costs nothing again.
    recorded.mockClear();
    client.onStrokeRecorded = null;
    client.strokeCaptureBegin();
    client.strokeCapturePoint(3, 3, 1);
    client.strokeCaptureEnd();
    expect(recorded).not.toHaveBeenCalled();
  });

  it("replays a recorded stroke on the active layer, restoring the brush after", () => {
    const client = new EngineClient();
    const doc = bindEngine(fakeStrokeEngine());
    vi.spyOn(client, "blit").mockImplementation(() => {});
    client.lastBrush = [...LOCAL_BRUSH];
    client.engine = doc.engine;

    const brush = [8, 1, 1, 1, 0.1, 9, 9, 9, 255, 1];
    client.replayStroke(brush, [4, 5, 1, 6, 7, 0.5]);

    expect(doc.setBrush.mock.calls[0]).toEqual([...brush.slice(0, 9), true]); // erase flag decoded
    expect(doc.strokeTo.mock.calls).toEqual([[4, 5, 1], [6, 7, 0.5]]);
    expect(doc.strokeEnd).toHaveBeenCalledOnce();
    expect(doc.setBrush.mock.calls.at(-1)).toEqual([...LOCAL_BRUSH.slice(0, 9), false]);
  });

  it("still broadcasts to collab while the recorder is listening too", () => {
    const client = new EngineClient();
    const doc = bindEngine(fakeStrokeEngine());
    vi.spyOn(client, "blit").mockImplementation(() => {});
    client.onStroke = vi.fn();
    client.onStrokeRecorded = vi.fn();
    client.lastBrush = [...LOCAL_BRUSH];
    client.engine = doc.engine;

    client.strokeCaptureBegin();
    client.strokeCapturePoint(1, 1, 1);
    client.strokeCaptureEnd();

    const stroke = { layer: 1, brush: LOCAL_BRUSH, pts: [1, 1, 1] };
    expect(client.onStroke).toHaveBeenCalledWith(stroke);
    expect(client.onStrokeRecorded).toHaveBeenCalledWith(stroke);
  });

  it("never replays a peer's stroke into another document, and resumes on the collab doc (#80)", () => {
    const client = new EngineClient();
    const a = bindEngine(fakeStrokeEngine());
    const b = bindEngine(fakeStrokeEngine());
    vi.spyOn(client, "blit").mockImplementation(() => {});
    client.onStroke = vi.fn();
    client.lastBrush = [...LOCAL_BRUSH];

    client.activate(a.engine);
    client.collabDoc = client.docKey(); // what startCollab binds
    client.activate(b.engine); // the user opens/switches to a second document

    client.applyRemoteStroke(remoteOp);
    expect(b.strokeBegin).not.toHaveBeenCalled(); // layer 2 exists in B too — id collision

    client.strokeCaptureBegin(); // and B's local strokes are not the room's document
    client.strokeCapturePoint(1, 1, 1);
    client.strokeCaptureEnd();
    expect(client.onStroke).not.toHaveBeenCalled();

    client.activate(a.engine); // back to the shared document
    expect(a.strokeBegin).toHaveBeenCalledOnce();
    expect(a.strokeTo).toHaveBeenCalledWith(4, 5, 1);
    expect(b.strokeBegin).not.toHaveBeenCalled();
  });

  it("returns zero histograms when no engine is active", () => {
    const client = new EngineClient();
    expect(client.channelHistogram("r")).toEqual(new Array(256).fill(0));
    expect(client.channelHistogramBars("lab-a", 4)).toEqual([0, 0, 0, 0]);
    expect(client.allChannelHistograms(4)).toEqual({ r: [0, 0, 0, 0], g: [0, 0, 0, 0], b: [0, 0, 0, 0] });
  });

  it("times composite, the display copy, and putImageData as three phases", () => {
    const client = new EngineClient();
    const w = 8, h = 8;
    const pixels = new Uint8Array(client.mem.buffer, 0, w * h * 4);
    pixels.fill(7);
    const putImageData = vi.fn();
    const ctx = {
      createImageData: (cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
      putImageData,
    };
    client.setCanvas({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement);
    const composite = vi.fn();
    client.engine = { composite, output_ptr: () => 0, width: () => w, height: () => h } as unknown as typeof client.engine;
    client.width = w;
    client.height = h;
    const lut = new Uint8Array(2 * 2 * 2 * 3);
    for (let i = 0; i < lut.length; i += 3) lut.set([0, 255, 255], i);
    lut.set([255, 0, 0], 0);
    const displayLut = vi.fn(() => lut);
    (client.engine as unknown as { display_lut: typeof displayLut }).display_lut = displayLut;
    client.setDisplayProfile(2, true, null, null);
    const compensate = vi.spyOn(client, "displayCompensate");
    putImageData.mockClear();
    composite.mockClear();

    const timing = client.measurePresentation(3);

    expect(composite).toHaveBeenCalledTimes(3);
    expect(compensate).not.toHaveBeenCalled();
    expect(putImageData).toHaveBeenCalledTimes(3);
    expect(composite.mock.invocationCallOrder[0]).toBeLessThan(putImageData.mock.invocationCallOrder[0]);
    const presented = putImageData.mock.calls[0][0] as { data: Uint8ClampedArray };
    const once = sampleDisplayLut(lut, 2, 7, 7, 7);
    const twice = sampleDisplayLut(lut, 2, once[0], once[1], once[2]);
    expect(once).not.toEqual([7, 7, 7]);
    expect(twice).not.toEqual(once);
    expect([presented.data[0], presented.data[1], presented.data[2], presented.data[3]]).toEqual([...once, 7]);
    expect(timing).toMatchObject({
      width: w,
      height: h,
      iterations: 3,
      samples: 2,
      surface: "attached",
      colorTransform: "lut",
    });
    let sum = 0;
    for (let i = 0; i < presented.data.length; i++) sum += presented.data[i];
    expect(timing.copiedByteSum).toBe(sum);
    for (const ms of [timing.cold.engineMs, timing.cold.copyColorMs, timing.cold.presentMs, timing.engineMs, timing.copyColorMs, timing.presentMs]) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(ms)).toBe(true);
    }
  });

  it("presents on a document canvas when the view has not mounted", () => {
    const client = new EngineClient();
    const w = 4, h = 2;
    new Uint8Array(client.mem.buffer, 0, w * h * 4).fill(3);
    const putImageData = vi.fn();
    const ctx = {
      createImageData: (cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
      putImageData,
    };
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } as unknown as Document;
    client.engine = { composite: vi.fn(), output_ptr: () => 0, width: () => w, height: () => h } as unknown as typeof client.engine;
    client.width = w;
    client.height = h;
    try {
      expect(client.hasPresentationSurface()).toBe(false);
      const timing = client.measurePresentation(1);
      expect(timing.surface).toBe("document");
      expect(timing.samples).toBe(1);
      expect(timing.copiedByteSum).toBe(w * h * 4 * 3);
      expect(putImageData).toHaveBeenCalledOnce();
    } finally {
      globalThis.document = previous;
    }
  });

  it("refuses a presentation measurement before the engine exists", () => {
    expect(() => new EngineClient().measurePresentation()).toThrow("Engine not ready");
  });
});

describe("presentation timing is the scripted blit", () => {
  const app = readFileSync(fileURLToPath(new URL("../state/app.ts", import.meta.url)), "utf8");
  const ops = app.slice(app.indexOf("function visionOps()"), app.indexOf("export function runScript"));
  const reads = app.slice(app.indexOf("function visionReads()"), app.indexOf("function visionOps()"));

  it("runs measurePresentation from measureFrame and only reads the stored split", () => {
    expect(ops).toContain("engine.measurePresentation(");
    expect(ops).toContain("engine.hasPresentationSurface()");
    expect(reads).toContain("frameTiming: () => frameTimingResult");
    expect(reads).not.toContain("measurePresentation");
    expect(reads).not.toMatch(/engine\.commit\(|\.set\(|store\.(?!state)[a-z]/);
  });
});
