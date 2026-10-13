// app.ts action-layer regressions that a node unit test can pin: the Filter
// Gallery's transient undo pushes (#28), Save for Web's unmanaged decode (#33),
// the PDF page decode (#34), the untagged Export at Sizes (#35), Revert's pinned
// document (#55), swallowed script failures (#60), the Libraries quota report
// (#137), the swallowed GIF open (#64) and the recovery timer's transient edits
// (#57). The engine, storage and DOM are stubbed — only the action layer is
// under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false })); // isTauri() per test (#57)
const recoveryFs = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));
const skinMl = vi.hoisted(() => ({
  detect: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/data", join: async (...p: string[]) => p.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => recoveryFs);
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("../ml/onnx", () => ({
  detectFaceLandmarksML: (...args: unknown[]) => skinMl.detect(...args),
}));
vi.mock("./skinSmoothing", () => ({
  applySkinSmoothing: (...args: unknown[]) => skinMl.apply(...args),
}));

import {
  actions,
  browseAndRunScript,
  colorTableHexes,
  openGifFile,
  commitBlurSteps,
  commitGalleryStack,
  dataVars,
  engine,
  fil,
  exportPDF,
  exportPDFX1a,
  exportLayerCompsToFiles,
  exportSizes,
  library,
  ml,
  previewGalleryStack,
  perspectiveWarp,
  recoverLastSession,
  revertDocument,
  revertGalleryStack,
  runBlurSteps,
  setDocumentNoticeSink,
  startAutoRecover,
  store,
  webExportBytes,
  writeRecoverySnapshots,
  type BlurCommandStep,
} from "./app";
import { readNativeFileBounded } from "./nativeBoundedRead";
import type { GalleryEffect } from "./filterGallery";
import { ZERO_WARP_OFFSETS } from "./perspectiveWarp";

function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

// Models the engine history transaction the gallery owns: its saved redo branch,
// deferred History-States trimming and monotonic push counter.
function fakeEngine(cap: number) {
  const entries: string[] = []; // the undo stack, oldest first
  const redo: string[] = [];
  const state: {
    cap: number;
    pushes: number;
    redoBeforeLastPush: string[];
    transaction: null | { undoDepth: number; redo: string[]; redoBeforeLastPush: string[] };
    locked: boolean;
    throwFilter: boolean;
    kind: number;
  } = { cap, pushes: 0, redoBeforeLastPush: [], transaction: null, locked: false, throwFilter: false, kind: 0 };
  const calls: Array<[string, ...unknown[]]> = [];
  const trim = () => { while (entries.length > state.cap) entries.shift(); };
  const push = (label: string) => {
    state.pushes++;
    entries.push(label);
    if (!state.transaction) trim();
    state.redoBeforeLastPush = redo.splice(0);
  };
  return {
    entries, redo, calls,
    state,
    set_history_states(n: number) { state.cap = n; if (!state.transaction) trim(); },
    undo_pushes() { return state.pushes; },
    push_history(label: string) { push(label); },
    drop_last_undo() {
      entries.pop();
      redo.splice(0, redo.length, ...state.redoBeforeLastPush);
      state.redoBeforeLastPush = [];
    },
    undo() { const entry = entries.pop(); if (entry) redo.push(entry); },
    begin_history_transaction() {
      if (state.transaction) return false;
      state.transaction = {
        undoDepth: entries.length,
        redo: redo.splice(0),
        redoBeforeLastPush: state.redoBeforeLastPush.splice(0),
      };
      return true;
    },
    reset_history_transaction() {
      if (!state.transaction || entries.length < state.transaction.undoDepth) return false;
      entries.length = state.transaction.undoDepth;
      redo.length = 0;
      state.redoBeforeLastPush = [];
      return true;
    },
    cancel_history_transaction() {
      if (!this.reset_history_transaction()) return false;
      const transaction = state.transaction!;
      state.transaction = null;
      redo.push(...transaction.redo);
      state.redoBeforeLastPush = transaction.redoBeforeLastPush;
      trim();
      return true;
    },
    commit_history_transaction() {
      if (!state.transaction || entries.length < state.transaction.undoDepth) return false;
      if (entries.length === state.transaction.undoDepth) {
        this.cancel_history_transaction();
        return false;
      }
      state.transaction = null;
      redo.length = 0;
      state.redoBeforeLastPush = [];
      trim();
      return true;
    },
    history_transaction_active() { return state.transaction !== null; },
    layer_kind() { return state.kind; },
    smart_add_filter(_layer: number, fid: number, params: Float32Array) {
      if (state.locked) return;
      calls.push(["smart_add_filter", fid, Array.from(params)]);
      push("Smart Filter");
    },
    filter_gallery_blur_pins(kind: number, radius: number, pins: Float32Array, bokeh: number, color: number) {
      if (state.locked) return;
      calls.push(["gallery", kind, radius, Array.from(pins), bokeh, color]);
      push("Gallery Blur");
    },
    filter_spin_blur_pins(angle: number, strobe: number, pins: Float32Array) {
      if (state.locked) return;
      calls.push(["spin", angle, strobe, Array.from(pins)]);
      push("Spin Blur");
    },
    filter_path_blur_paths(angle: number, speed: number, taper: number, centered: boolean, rear: boolean, paths: Float32Array) {
      if (state.locked) return;
      calls.push(["path", angle, speed, taper, centered, rear, Array.from(paths)]);
      push("Path Blur");
    },
    filter_path_blur(angle: number, speed: number, taper: number, centered: boolean) {
      if (state.locked) return;
      calls.push(["path-fallback", angle, speed, taper, centered]);
      push("Path Blur");
    },
    filter_add_noise_seeded(amount: number, mono: boolean, gaussian: boolean, seed: number) {
      if (state.locked) return;
      calls.push(["noise", amount, mono, gaussian, seed]);
      push("Add Noise");
    },
    filter_crystallize() {
      if (state.throwFilter) throw new Error("filter failed");
      if (!state.locked) push("Crystallize");
    },
    filter_pointillize() { if (!state.locked) push("Pointillize"); },
    width() { return 0; },
    height() { return 0; },
  };
}

const effect = (id: string): GalleryEffect => ({ id, values: [10], visible: true });

it("does not apply stale face landmarks after a content edit commits mid-detection", async () => {
  const e = fakeEngine(5);
  engine.engine = e as never;
  engine.docGen = 1;
  skinMl.apply.mockReturnValue(true);
  skinMl.detect.mockImplementationOnce(async () => {
    e.push_history("Brush stroke while landmarks run");
    return { ok: true, faces: [[[1, 1], [2, 2]]], w: 10, h: 8, model: "face-landmarks" };
  });
  const progress: string[] = [];

  try {
    await expect(ml.skinSmoothing(50, 50, (message) => progress.push(message)))
      .resolves.toEqual({ ok: false, faces: 0 });
    expect(progress).toContain("Cancelled — document changed.");
    expect(skinMl.apply).not.toHaveBeenCalled();
  } finally {
    skinMl.detect.mockReset();
    skinMl.apply.mockReset();
    engine.engine = null;
  }
});

it("does not bake an untouched Perspective Warp", () => {
  const width = vi.fn(() => 100);
  engine.engine = { width, height: vi.fn(() => 100) } as never;

  perspectiveWarp(ZERO_WARP_OFFSETS);

  expect(width).not.toHaveBeenCalled();
  engine.engine = null;
});

describe("Filter Gallery history transaction (#28/#83)", () => {
  let onSync: typeof engine.onSync;
  let onCommit: typeof engine.onCommit;
  let dirtyCommit: () => void;
  // The full store resync reads far more engine surface than this feature; the
  // undo bookkeeping is what is under test.
  beforeEach(() => {
    installStorage();
    onSync = engine.onSync;
    onCommit = engine.onCommit;
    dirtyCommit = vi.fn();
    engine.onSync = null;
    engine.onCommit = dirtyCommit;
  });
  afterEach(() => { engine.onSync = onSync; engine.onCommit = onCommit; engine.engine = null; });

  it("keeps the oldest real undo states through repeated previews at the cap", () => {
    const e = fakeEngine(3);
    engine.engine = e as never;
    store.setHistoryStates(3);
    for (const label of ["Brush", "Levels", "Crop"]) e.push_history(label); // sitting at the cap

    const stack = [effect("crystallize"), effect("pointillize")];
    let open = previewGalleryStack(stack, false);
    open = previewGalleryStack(stack, open);
    expect(open).toBe(true);
    expect(e.entries).toHaveLength(5); // cap eviction is deferred while previewing
    revertGalleryStack(open, e as never);

    expect(e.entries).toEqual(["Brush", "Levels", "Crop"]); // nothing of the user's was evicted
    expect(e.state.cap).toBe(3);
    expect(dirtyCommit).not.toHaveBeenCalled();
  });

  it("restores a pre-existing redo branch on Cancel, then ends it on commit", () => {
    const e = fakeEngine(3);
    engine.engine = e as never;
    store.setHistoryStates(3);
    for (const label of ["Brush", "Levels", "Crop"]) e.push_history(label);
    e.undo();
    expect(e.redo).toEqual(["Crop"]);

    let open = previewGalleryStack([effect("crystallize")], false);
    open = previewGalleryStack([effect("crystallize"), effect("pointillize")], open);
    revertGalleryStack(open, e as never);
    expect(e.entries).toEqual(["Brush", "Levels"]);
    expect(e.redo).toEqual(["Crop"]);

    expect(commitGalleryStack([effect("crystallize"), effect("pointillize")])).toBe(true);

    expect(e.entries).toEqual(["Brush", "Levels", "Filter Gallery"]);
    expect(e.redo).toEqual([]);
    expect(dirtyCommit).toHaveBeenCalledOnce();
  });

  it("cancels a refused commit without a ghost label or lost redo", () => {
    const e = fakeEngine(3);
    engine.engine = e as never;
    for (const label of ["Brush", "Levels", "Crop"]) e.push_history(label);
    e.undo();
    e.state.locked = true;

    actions.start();
    try {
      expect(commitGalleryStack([effect("crystallize")])).toBe(false);
      expect(actions.count(), "a refused/no-op commit must not record a macro step").toBe(0);
    } finally {
      actions.stop();
    }

    expect(e.entries).toEqual(["Brush", "Levels"]);
    expect(e.redo).toEqual(["Crop"]);
    expect(e.state.transaction).toBeNull();
    expect(dirtyCommit).not.toHaveBeenCalled();
  });

  it("cancels the transaction when the first preview throws", () => {
    const e = fakeEngine(3);
    e.push_history("Brush");
    e.state.throwFilter = true;
    engine.engine = e as never;

    expect(() => previewGalleryStack([effect("crystallize")], false)).toThrow("filter failed");

    expect(e.entries).toEqual(["Brush"]);
    expect(e.state.transaction).toBeNull();
    expect(engine.syncSuspended).toBe(false);
    expect(dirtyCommit).not.toHaveBeenCalled();
  });

  it("force-unmount cleanup cancels the captured document, not its active replacement", () => {
    const target = fakeEngine(3);
    engine.engine = target as never;
    target.push_history("Brush");
    target.push_history("Levels");
    target.undo();
    const open = previewGalleryStack([effect("crystallize")], false);

    const replacement = fakeEngine(3);
    replacement.push_history("Other document");
    engine.engine = replacement as never;
    revertGalleryStack(open, target as never);

    expect(target.entries).toEqual(["Brush"]);
    expect(target.redo).toEqual(["Levels"]);
    expect(target.state.transaction).toBeNull();
    expect(replacement.entries).toEqual(["Other document"]);
  });
});

describe("Blur Gallery replay command", () => {
  let onSync: typeof engine.onSync;
  let onCommit: typeof engine.onCommit;
  beforeEach(() => {
    installStorage();
    onSync = engine.onSync;
    onCommit = engine.onCommit;
    engine.onSync = null;
    engine.onCommit = vi.fn();
    actions.clearNamed();
  });
  afterEach(() => {
    actions.stop();
    actions.clearNamed();
    engine.onSync = onSync;
    engine.onCommit = onCommit;
    engine.engine = null;
  });

  it("uses one seed for destructive pixels and the smart-filter params", () => {
    const seed = 0x12_3456;
    const step: BlurCommandStep = { op: "noise", amount: 0.2, mono: true, gaussian: true, seed };
    const pixel = fakeEngine(5);
    engine.engine = pixel as never;
    runBlurSteps([step], new Float32Array(), false);
    expect(pixel.calls).toContainEqual(["noise", 0.2, true, true, seed]);

    const smartObject = fakeEngine(5);
    smartObject.state.kind = 7;
    engine.engine = smartObject as never;
    runBlurSteps([step], new Float32Array(), false);
    const params = smartObject.calls.find(([name]) => name === "smart_add_filter")?.[2] as number[];
    expect(params).toEqual([expect.closeTo(0.2), 1, seed, 1]);
  });

  it("refuses a drawn Path on a smart object before applying sibling steps", () => {
    const smartObject = fakeEngine(5);
    smartObject.state.kind = 7;
    engine.engine = smartObject as never;
    const steps: BlurCommandStep[] = [
      { op: "gallery", kind: 1, radius: 12, pins: new Float32Array(), bokeh: 0, bokehColor: 0 },
      { op: "path", angle: 0, speed: 40, taper: 0, centered: false },
    ];

    expect(runBlurSteps(steps, Float32Array.of(2, 10, 20), false)).toBe(0);
    expect(smartObject.calls).toEqual([]);
  });

  it("exports, imports and replays every composed step, path and seed", () => {
    const steps: BlurCommandStep[] = [
      { op: "gallery", kind: 1, radius: 12, pins: Float32Array.of(10, 20, 1, 30, 0.5, 0, 1), bokeh: 0.2, bokehColor: 0.1 },
      { op: "path", angle: 5, speed: 40, taper: 0.25, centered: true },
      { op: "spin", angle: 30, strobe: 2, pins: Float32Array.of(10, 20, 30, 24, 0, 0.25) },
      { op: "noise", amount: 0.1, mono: true, gaussian: false, seed: 0x12_3456 },
    ];
    const paths = Float32Array.of(2, 10, 20, 80, 90);
    const first = fakeEngine(10);
    engine.engine = first as never;

    actions.start();
    const mark = actions.mark();
    expect(commitBlurSteps(steps, paths, true)).toBe(true);
    actions.commit(mark, () => { commitBlurSteps(steps, paths, true); },
      ["commitBlurSteps", [steps, paths, true]]);
    actions.stop();
    expect(actions.count()).toBe(1);
    expect(actions.save("Blur recipe")).toBeGreaterThan(0);
    const json = actions.exportJson();
    expect(json).toContain("commitBlurSteps");

    actions.clearNamed();
    expect(actions.importJson(json)).toMatchObject({ imported: 1, rejected: [] });
    const replay = fakeEngine(10);
    engine.engine = replay as never;
    actions.playNamed(actions.list()[0].id);

    expect(replay.calls.map(([name]) => name)).toEqual(["gallery", "path", "spin", "noise"]);
    expect(replay.calls.find(([name]) => name === "path")?.slice(-2)).toEqual([true, Array.from(paths)]);
    expect(replay.calls.find(([name]) => name === "noise")?.at(-1)).toBe(0x12_3456);
    expect(replay.entries).toEqual(["Blur Gallery"]);
  });
});

describe("action recorder preview checkpoints", () => {
  it("rolls transient steps back and commits exactly one accepted step", async () => {
    const baseline = vi.fn();
    const transient = vi.fn();
    const accepted = vi.fn();
    actions.start();
    try {
      actions.record(baseline, ["contentAwareFill", []]);
      const cancelMark = actions.mark();
      actions.record(transient, ["removeDistractions", [0.5]]);
      actions.rollback(cancelMark);
      expect(actions.count()).toBe(1);

      const acceptMark = actions.mark();
      actions.record(transient, ["removeDistractions", [0.75]]);
      actions.commit(acceptMark, accepted, ["removeReflections", [0.65]]);
      expect(actions.count()).toBe(2);
    } finally {
      actions.stop();
    }

    await actions.play();
    expect(baseline).toHaveBeenCalledOnce();
    expect(transient).not.toHaveBeenCalled();
    expect(accepted).toHaveBeenCalledOnce();
  });

  it("keeps the final proxied preview descriptor after restoring its checkpoint", () => {
    const onSync = engine.onSync;
    const onCommit = engine.onCommit;
    installStorage();
    actions.clearNamed();
    engine.onSync = null;
    engine.onCommit = vi.fn();
    engine.engine = fakeEngine(10) as never;
    actions.start();
    try {
      const mark = actions.mark();
      actions.suspend(true);
      fil.crystallize(7);
      actions.suspend(false);
      actions.commit(mark, () => {});
      actions.stop();
      const id = actions.save("Accepted preview");
      expect(actions.isPersistable(id)).toBe(true);
      expect(actions.exportJson()).toContain('"fil.crystallize"');
    } finally {
      actions.stop();
      actions.clearNamed();
      engine.onSync = onSync;
      engine.onCommit = onCommit;
      engine.engine = null;
    }
  });
});

describe("saved action persistence", () => {
  afterEach(() => {
    engine.onEditError = null;
    vi.restoreAllMocks();
  });

  it("surfaces a rejected action-library write", () => {
    installStorage();
    const onEditError = vi.fn();
    engine.onEditError = onEditError;
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });

    actions.clearNamed();

    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("actions"));
  });
});

// A canvas/Image/ImageBitmap stand-in: enough for pngToImageData and the Save
// for Web canvas encoder, and it records how the PNG was decoded.
function installDom() {
  const decoded: { bitmapOptions: unknown[]; images: number } = { bitmapOptions: [], images: 0 };
  const ctx = {
    drawImage() {},
    putImageData() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  const canvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: unknown) => void, type: string) => cb({ type, arrayBuffer: async () => new ArrayBuffer(4) }),
  });
  const g = globalThis as Record<string, unknown>;
  g.document = { createElement: () => canvas() };
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.createImageBitmap = async (_blob: unknown, options?: unknown) => {
    decoded.bitmapOptions.push(options);
    return { width: 2, height: 2, close() {} };
  };
  g.Image = class {
    width = 2; height = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { decoded.images++; queueMicrotask(() => this.onload?.()); }
  };
  return decoded;
}

describe("Save for Web colour management (#33)", () => {
  afterEach(() => { engine.engine = null; });

  it("decodes the profile-tagged engine PNG without colour management", async () => {
    installStorage();
    const decoded = installDom();
    engine.engine = { export_png: () => new Uint8Array([1, 2, 3]) } as never;

    const out = await webExportBytes({ format: "png", quality: 85, matte: "transparent", convertToSRgb: false, metadata: "none" });

    expect(out?.mime).toBe("image/png");
    // The document→sRGB LUT is applied in TS, so the browser must not convert first.
    expect(decoded.bitmapOptions).toEqual([{ colorSpaceConversion: "none" }]);
    expect(decoded.images).toBe(0);
  });
});

// installDom() plus the two things a file-writing export needs: a download
// anchor and a document body to hang it on.
function installExportDom() {
  const decoded = installDom();
  const saved: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const createElement = (g.document as { createElement: (t: string) => unknown }).createElement;
  g.document = {
    body: { appendChild() {} },
    createElement: (tag: string) => {
      if (tag !== "a") return createElement(tag);
      const a = { href: "", download: "", click: () => saved.push(a.download), remove() {} };
      return a;
    },
  };
  return { decoded, saved };
}

describe("PDF export colour management (#34)", () => {
  afterEach(() => { engine.engine = null; vi.restoreAllMocks(); });

  it.each([
    ["JPEG pages", {}],
    ["lossless pages", { compression: "lossless" as const }],
  ])("decodes the profile-tagged engine PNG unmanaged for %s", async (_label, opts) => {
    installStorage();
    const { decoded, saved } = installExportDom();
    engine.engine = {
      export_png: () => new Uint8Array([1, 2, 3]),
      layer_count: () => 0,
    } as never;

    await exportPDF("doc.psd", opts);

    // The page is tagged with the document profile, so its samples must stay in
    // document space — a managed decode would hand back browser-converted sRGB.
    expect(decoded.bitmapOptions).toEqual([{ colorSpaceConversion: "none" }]);
    expect(decoded.images).toBe(0);
    expect(saved).toEqual(["doc.pdf"]);
  });

  it("names the press the PDF/X-1a plates were really separated for (#437)", async () => {
    installStorage();
    installExportDom();
    const alerts: string[] = [];
    vi.stubGlobal("alert", (message: string) => alerts.push(message));
    const pdfs: Blob[] = [];
    (globalThis as { URL: unknown }).URL = {
      createObjectURL: (blob: Blob) => { pdfs.push(blob); return "blob:test"; },
      revokeObjectURL: () => {},
    };
    const icc = (tag: string) => {
      const bytes = new Uint8Array(132);
      for (let i = 0; i < 4; i++) bytes[16 + i] = tag.charCodeAt(i);
      return bytes;
    };
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => icc("CMYK").buffer }));
    // A raw 1×1 8-bit CMYK PSD: header, three empty sections, compression 0, four plates.
    const psd = new Uint8Array(44);
    psd.set([0x38, 0x42, 0x50, 0x53, 0, 1]);
    psd.set([0, 4, 0, 0, 0, 1, 0, 0, 0, 1, 0, 8, 0, 4], 12);
    const outputIntent = async (error: string) => {
      engine.engine = {
        export_psd_cmyk_with_icc: () => psd,
        mode_profile_icc: () => icc("CMYK"),
        mode_profile_name: () => "Mystery Press",
        mode_profile_error: () => error,
        layer_count: () => 0,
      } as never;
      await exportPDFX1a("doc");
      return new TextDecoder("latin1").decode(await pdfs.at(-1)!.arrayBuffer());
    };

    expect(await outputIntent("")).toContain("/OutputConditionIdentifier (Custom)");
    // Refused on reload: the built-in model made the plates, so the file must
    // not claim the saved profile's press condition.
    const refused = await outputIntent("Destination ICC profile must be between 132 bytes and 10 MiB");
    expect(refused).toContain("/OutputConditionIdentifier (FOGRA39L)");
    expect(refused).not.toContain("Mystery Press");
    expect(alerts).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("Layer Comps exports blend like the canvas (#438)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("renders each comp in a clone that takes Color Settings' blend gammas", () => {
    installStorage();
    installExportDom();
    const order: string[] = [];
    const clone = {
      set_blend_gamma: vi.fn(() => order.push("gamma")),
      layer_offset: () => [],
      export_png: vi.fn(() => { order.push("export"); return new Uint8Array([9]); }),
      free: vi.fn(),
    };
    vi.spyOn(engine, "projectBytes").mockReturnValue(new Uint8Array([1]));
    vi.spyOn(engine, "buildProject").mockReturnValue(clone as never);
    store.setColorPolicyPrefs({ blendRgbColorsUsingGamma: true, blendRgbGamma: 1 });
    vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, layerComps: [{ name: "A", layers: [] }] as never });

    exportLayerCompsToFiles("doc");
    vi.restoreAllMocks();
    store.setColorPolicyPrefs({ blendRgbColorsUsingGamma: false });

    expect(clone.set_blend_gamma).toHaveBeenCalledWith(1, 0);
    expect(order).toEqual(["gamma", "export"]);
    expect(clone.free).toHaveBeenCalled();
  });
});

describe("Export at Sizes embeds the document profile (#35)", () => {
  const icc = new Uint8Array([1, 2, 3, 4]);
  afterEach(() => { engine.engine = null; vi.restoreAllMocks(); });

  function taggedEngine() {
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...store.state,
      colorProfileAssigned: true,
      iccProfileBytes: icc,
      dataSets: [{ headline: "A" }],
      variables: [],
    });
    const e = {
      export_scaled_png: vi.fn(() => new Uint8Array([9])),
      export_scaled_png_with_icc: vi.fn(() => new Uint8Array([9])),
      export_png: vi.fn(() => new Uint8Array([9])),
      export_png_with_icc: vi.fn(() => new Uint8Array([9])),
    };
    engine.engine = e as never;
    return e;
  }

  it("tags every scale like the sibling Export As path", () => {
    installStorage();
    installExportDom();
    const e = taggedEngine();

    exportSizes([1, 2], "shot.png");

    expect(e.export_scaled_png).not.toHaveBeenCalled();
    expect(e.export_scaled_png_with_icc.mock.calls).toEqual([[1, icc], [2, icc]]);
  });

  it("tags Data Sets as Files too", async () => {
    installStorage();
    installExportDom();
    const e = taggedEngine();

    await dataVars.exportAll();

    expect(e.export_png).not.toHaveBeenCalled();
    expect(e.export_png_with_icc).toHaveBeenCalledWith(icc);
  });
});

describe("File ▸ Scripts ▸ Browse surfaces failures (#60)", () => {
  afterEach(() => { setDocumentNoticeSink(null); vi.unstubAllGlobals(); });

  it("reports a script that failed instead of looking like a clean run", async () => {
    installStorage();
    const notices: string[] = [];
    setDocumentNoticeSink((m) => notices.push(m));
    const input = {
      type: "", accept: "", files: [{ size: 16, text: async () => "vision.log('x')" }],
      onchange: null as (() => void) | null,
      click: () => input.onchange?.(),
      remove() {},
    };
    (globalThis as Record<string, unknown>).document = {
      body: { appendChild() {} },
      createElement: () => input,
    };

    // No Worker in node, so runScript RESOLVES an error message — exactly the
    // shape (timeout, disallowed op, script throw) this path used to discard.
    await browseAndRunScript();

    expect(notices).toHaveLength(1);
    expect(notices[0]).toBeTruthy();
  });
});

describe("Revert pins its document (#55)", () => {
  const read = vi.mocked(readNativeFileBounded);
  let notices: string[] = [];

  beforeEach(() => {
    installStorage();
    notices = [];
    setDocumentNoticeSink((m) => notices.push(m));
  });
  afterEach(() => {
    setDocumentNoticeSink(null);
    vi.restoreAllMocks();
    engine.engine = null;
  });

  it("does not revert another document the user switched to during the read", async () => {
    vi.spyOn(store, "activePath").mockReturnValue("/docs/a.png");
    const revertActiveDoc = vi.spyOn(store, "revertActiveDoc").mockImplementation(() => {});
    const setActivePath = vi.spyOn(store, "setActivePath").mockImplementation(() => {});
    const switched = { ...store.state, activeDocId: store.state.activeDocId + 1 };
    let release = (_bytes: Uint8Array) => {};
    read.mockReturnValue(new Promise<Uint8Array>((resolve) => { release = resolve; }));

    const pending = revertDocument();
    vi.spyOn(store, "state", "get").mockReturnValue(switched); // user clicks the other tab
    release(new Uint8Array([1, 2, 3]));
    await pending;

    expect(revertActiveDoc).not.toHaveBeenCalled();
    expect(setActivePath).not.toHaveBeenCalled();
    expect(notices).toHaveLength(1);
  });

  it("reverts and re-pins the path when the same document is still active", async () => {
    vi.spyOn(store, "activePath").mockReturnValue("/docs/a.png");
    const revertActiveDoc = vi.spyOn(store, "revertActiveDoc").mockImplementation(() => {});
    const setActivePath = vi.spyOn(store, "setActivePath").mockImplementation(() => {});
    vi.spyOn(engine, "buildImage").mockReturnValue({} as never);
    read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await revertDocument();

    expect(revertActiveDoc).toHaveBeenCalledTimes(1);
    expect(setActivePath).toHaveBeenCalledWith("/docs/a.png");
    expect(notices).toEqual([]);
  });
});

describe("Auto-recovery leaves a live paint-symmetry transform alone (#57)", () => {
  let commit: ReturnType<typeof vi.fn>;
  const snap = () => store.getSnapshot() as unknown as { paintSymmetry: number };

  beforeEach(() => {
    installStorage();
    commit = vi.fn(() => false); // "nothing changed" — keeps the engine resync out of it
    engine.engine = {
      paint_symmetry_axis_x: () => 100,
      paint_symmetry_axis_y: () => 50,
      paint_symmetry_angle: () => 0,
      paint_symmetry_scale: () => 1,
      commit_paint_symmetry: commit,
    } as never;
    snap().paintSymmetry = 1; // Paint Symmetry on (engine-synced field)
    store.beginPaintSymmetryTransform();
    expect(store.getSnapshot().paintSymmetryTransforming).toBe(true);
  });
  afterEach(() => {
    store.cancelPaintSymmetryTransform();
    snap().paintSymmetry = 0;
    engine.engine = null;
    tauri.enabled = false;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("serializes without committing the half-finished axis", () => {
    store.saveProjectForDoc(store.state.activeDocId, [], { commitTransientEdits: false });

    expect(commit).not.toHaveBeenCalled();
    expect(store.getSnapshot().paintSymmetryTransforming).toBe(true); // the user is still dragging
  });

  it("still commits for a user-invoked save", () => {
    store.saveProjectForDoc(store.state.activeDocId);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().paintSymmetryTransforming).toBe(false);
  });

  it("asks the recovery snapshot not to commit transient edits", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("TAURI_ENV_DEBUG", "");
    tauri.enabled = true;
    const docId = store.state.activeDocId;
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...store.getSnapshot(),
      documents: [{ id: docId, name: "a.mvision", dirty: true }],
    } as never);
    vi.spyOn(store, "docContentRevision").mockReturnValue(3);
    vi.spyOn(store, "docName").mockReturnValue("a.mvision");
    const save = vi.spyOn(store, "saveProjectForDoc").mockReturnValue(new Uint8Array([1]));

    expect(await writeRecoverySnapshots()).toBe(1);
    expect(save.mock.calls[0][2]).toEqual({ commitTransientEdits: false });
  });

  it("does nothing in Vite or native debug environments", async () => {
    vi.stubEnv("DEV", true);
    tauri.enabled = true;
    const save = vi.spyOn(store, "saveProjectForDoc");
    const interval = vi.spyOn(globalThis, "setInterval");
    recoveryFs.exists.mockClear();

    expect(await writeRecoverySnapshots()).toBe(0);
    expect(await recoverLastSession()).toBe(0);
    startAutoRecover();
    vi.stubEnv("DEV", false);
    vi.stubEnv("TAURI_ENV_DEBUG", "true");
    expect(await writeRecoverySnapshots()).toBe(0);
    expect(await recoverLastSession()).toBe(0);
    startAutoRecover();
    expect(save).not.toHaveBeenCalled();
    expect(recoveryFs.exists).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });
});

describe("Open GIF surfaces a corrupt file (#64)", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("alerts instead of rejecting when the import throws", async () => {
    installStorage();
    const alerts: string[] = [];
    vi.stubGlobal("alert", (m: string) => { alerts.push(m); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "openGif").mockImplementation(() => { throw new Error("gif frames: truncated"); });
    const file = {
      name: "broken.gif",
      size: 8,
      slice: () => ({ arrayBuffer: async () => new ArrayBuffer(6) }),
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as File;

    await expect(openGifFile(file)).resolves.toBeUndefined();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("broken.gif");
    expect(alerts[0]).toContain("gif frames: truncated");
  });
});

describe("Libraries capture reports a full store (#137)", () => {
  afterEach(() => { engine.engine = null; vi.restoreAllMocks(); });

  it("returns the stored list and notifies instead of a graphic that was never written", async () => {
    const cells = installStorage();
    installDom();
    const notices: string[] = [];
    setDocumentNoticeSink((m) => notices.push(m));
    engine.engine = { export_png: () => new Uint8Array([1, 2, 3]) } as never;
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => "data:image/png;base64,AA",
      }),
    };
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };

    const list = await library.capture("Logo");

    expect(list).toEqual([]); // nothing was persisted → nothing to show
    expect(notices).toHaveLength(1);
    expect(cells.has("mv.library")).toBe(false);
    setDocumentNoticeSink(null);
  });

  it("reports a rejected removal and keeps the stored graphic", () => {
    const cells = installStorage();
    const graphic = { id: "logo", name: "Logo", dataUrl: "data:image/png;base64,AA", w: 1, h: 1 };
    cells.set("mv.library", JSON.stringify([graphic]));
    const notices: string[] = [];
    setDocumentNoticeSink((m) => notices.push(m));
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };

    expect(library.remove(graphic.id)).toEqual([graphic]);
    expect(notices).toEqual([expect.stringContaining("Could not remove from Libraries")]);
    setDocumentNoticeSink(null);
  });
});

describe("Color Table opens on the document palette (#442)", () => {
  afterEach(() => { engine.engine = null; vi.restoreAllMocks(); });

  it("lists the palette the document was indexed to, in slot order", () => {
    const composite = vi.spyOn(engine, "colorTable");
    engine.engine = { indexed_palette_rgb: () => Uint8Array.from([255, 255, 255, 255, 0, 0]) } as never;
    expect(colorTableHexes()).toEqual(["#ffffff", "#ff0000"]);
    expect(composite, "not the composite's colours in scan order").not.toHaveBeenCalled();
  });

  it("falls back to the composite's colours for a document never indexed", () => {
    vi.spyOn(engine, "colorTable").mockReturnValue([[1, 2, 3]]);
    engine.engine = { indexed_palette_rgb: () => new Uint8Array() } as never;
    expect(colorTableHexes()).toEqual(["#010203"]);
  });
});
