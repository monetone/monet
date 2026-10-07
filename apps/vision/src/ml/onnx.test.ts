import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => {
  // Monotonic committed-edit counter, exactly like the engine's undo_pushes().
  const counters = { pushes: 0 };
  const engineApi = {
    undo_pushes: vi.fn(() => counters.pushes),
    width: vi.fn(() => 10),
    height: vi.fn(() => 8),
    export_png: vi.fn(() => new Uint8Array([1, 2, 3])),
    get_selection_mask: vi.fn(() => new Uint8Array([255, 0, 0, 0])),
    has_selection: vi.fn(() => true),
    select_none: vi.fn(),
    select_rect: vi.fn(),
    resize_canvas: vi.fn(),
    set_selection_mask: vi.fn(),
    stamp_image: vi.fn(),
    mark_ai_generated: vi.fn(),
  };
  return {
    counters,
    engine: {
      docGen: 1,
      commit: vi.fn(),
      e: engineApi,
    },
    store: {
      addLayer: vi.fn(),
      openImage: vi.fn(),
      requestFit: vi.fn(),
    },
  };
});

// Captures the feeds passed to the most recent InferenceSession.run so tests
// can assert tensor dtype/shape/polarity (e.g. LaMa's inverted mask).
const runCapture = vi.hoisted(() => ({ lastFeeds: null as Record<string, { type: string; data: Uint8Array | Float32Array; dims: number[] }> | null, holdDocGen: false, editMidRun: false, onRun: null as (() => void) | null }));

const ort = vi.hoisted(() => ({
  env: { wasm: { wasmPaths: "", numThreads: 0, proxy: true } },
  Tensor: class Tensor {
    constructor(
      public readonly type: string,
      public readonly data: Uint8Array | Float32Array,
      public readonly dims: number[],
    ) {}
  },
  InferenceSession: {
    create: vi.fn(async (url: string) => ({
      inputNames: url.includes("migan") || url.includes("lama") ? ["image", "mask"] : ["input"],
      outputNames: ["output"],
      run: vi.fn(async (feeds: Record<string, { type: string; data: Uint8Array | Float32Array; dims: number[] }>) => {
        runCapture.lastFeeds = feeds ?? null;
        // Stands in for the user acting while the model is busy (hitting Cancel).
        runCapture.onRun?.();
        if (!runCapture.holdDocGen) app.engine.docGen++;
        // A content edit landing mid-job (adjustment, brush, MCP tool): the
        // document is the same, but a history state was pushed.
        if (runCapture.editMidRun) app.counters.pushes++;
        if (url.includes("super-res")) return { output: { data: new Float32Array(672 * 672) } };
        if (url.includes("u2netp")) return { output: { data: new Float32Array(320 * 320).fill(0.5) } };
        if (url.includes("migan")) return { output: { data: new Uint8Array(3 * 512 * 512) } };
        if (url.includes("lama")) return { output: { data: new Float32Array(3 * 512 * 512).fill(0.5) } };
        if (url.includes("drunet")) return { output: { data: new Float32Array(3 * 256 * 256) } };
        return { output: { data: new Float32Array(3 * 224 * 224) } };
      }),
    })),
  },
}));

const modelSource = vi.hoisted(() => ({
  filePresent: vi.fn(async () => true),
  resolveModelUrl: vi.fn(async (_def: unknown, rel: string) => `/models/${rel}`),
  // No quality-tier alternate installed in tests → bestUnit returns the base
  // unit, whose file rel routes the session mock to the right model branch.
  bestUnit: vi.fn(async (baseId: string) => {
    const rel = baseId === "drunet" ? "drunet_color.onnx" : baseId === "super-res" ? "super-res.onnx" : `${baseId}.onnx`;
    return { id: baseId, files: [{ rel }] };
  }),
}));

vi.mock("../state/app", () => app);
vi.mock("onnxruntime-web", () => ort);
vi.mock("./modelSource", () => modelSource);

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 2;
  naturalHeight = 2;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function installCanvasDom(): void {
  const originalUrl = globalThis.URL;
  class FakeURL extends originalUrl {
    static createObjectURL = vi.fn(() => "blob:fake");
    static revokeObjectURL = vi.fn();
  }
  const makeContext = () => ({
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    drawImage: vi.fn(),
    getImageData: (x: number, y: number, w: number, h: number) => {
      void x; void y;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = 24;
        data[i * 4 + 1] = 48;
        data[i * 4 + 2] = 96;
        data[i * 4 + 3] = 255;
      }
      return { data };
    },
    putImageData: vi.fn(),
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => makeContext(),
        toBlob: (cb: (blob: Blob | null) => void, type?: string) => cb(new Blob([new Uint8Array([9, 9, 9])], { type })),
      };
    },
  });
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", FakeURL);
}

describe("ONNX ML cancellation", () => {
  beforeEach(() => {
    installCanvasDom();
    vi.clearAllMocks();
    modelSource.filePresent.mockResolvedValue(true);
    app.engine.docGen = 1;
    app.counters.pushes = 0;
    runCapture.lastFeeds = null;
    runCapture.holdDocGen = false;
    runCapture.editMidRun = false;
    runCapture.onRun = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not stamp style-transfer results after the document changes", async () => {
    const { styleTransfer } = await import("./onnx");
    const progress: string[] = [];

    const result = await styleTransfer("candy", 0, (msg) => progress.push(msg));

    expect(result.ok).toBe(false);
    expect(progress).toContain("Cancelled — document changed.");
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
    expect(app.engine.commit).not.toHaveBeenCalled();
  });

  it("clears the live selection before a full-document result is stamped", async () => {
    runCapture.holdDocGen = true;
    const { styleTransfer } = await import("./onnx");

    await expect(styleTransfer("candy")).resolves.toMatchObject({ ok: true });

    expect(app.engine.e.select_none).toHaveBeenCalledOnce();
    expect(app.engine.e.select_none.mock.invocationCallOrder[0])
      .toBeLessThan(app.store.addLayer.mock.invocationCallOrder[0]);
    expect(app.engine.e.select_none.mock.invocationCallOrder[0])
      .toBeLessThan(app.engine.e.stamp_image.mock.invocationCallOrder[0]);
  });

  it("does not open a stale super-resolution document after the document changes", async () => {
    const { superResolution } = await import("./onnx");

    const result = await superResolution();

    expect(result).toEqual({ ok: false, inW: 0, inH: 0, outW: 0, outH: 0 });
    expect(app.store.openImage).not.toHaveBeenCalled();
  });

  it("does not apply segmentation-derived mutations after the document changes", async () => {
    const { removeBackground, selectSubject } = await import("./onnx");

    await expect(selectSubject()).resolves.toEqual({ ok: false, coverage: 0 });
    expect(app.engine.e.set_selection_mask).not.toHaveBeenCalled();
    expect(app.engine.commit).not.toHaveBeenCalled();

    app.engine.docGen = 1;
    await expect(removeBackground()).resolves.toEqual({ ok: false });
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  // Every other test here covers a cancel/error path, so the success path — the
  // one that actually writes synthesized pixels — went uncovered. It is also the
  // only path that must disclose AI in Content Credentials.
  it("stamps generative-fill output and discloses it as AI-generated", async () => {
    runCapture.holdDocGen = true; // let the fill run to completion
    const { generativeFillML } = await import("./onnx");

    const result = await generativeFillML();

    expect(result.ok).toBe(true);
    expect(app.engine.e.stamp_image).toHaveBeenCalled();
    expect(app.engine.e.mark_ai_generated).toHaveBeenCalled();
  });

  // The hole mask is read at job start but stamped seconds-to-minutes later,
  // while the user keeps working. It must ride in the stamp buffer's alpha —
  // once — instead of being re-applied by whatever is selected at stamp time.
  // (#20, #21)
  it("stamps generative fill through the captured mask alpha, not the live selection", async () => {
    runCapture.holdDocGen = true; // let the fill run to completion
    // 2×2 composite (the fake decoder's size): one hard pixel, one at 50% feather.
    app.engine.e.get_selection_mask.mockReturnValueOnce(new Uint8Array([255, 128, 0, 0]));
    const { generativeFillML } = await import("./onnx");

    await generativeFillML();

    const buf = app.engine.e.stamp_image.mock.calls[0][4] as Uint8Array;
    expect(buf[3]).toBe(255); // hard-selected pixel: fully opaque
    expect(buf[7]).toBe(128); // feathered pixel: the mask, applied ONCE (255·a would be a²)
    expect(buf[11]).toBe(0); // unselected: nothing stamped, so no stale composite lands
    // Cleared BEFORE the stamp, so a selection changed mid-run can neither clip
    // the fill away nor let the engine mask it a second time.
    expect(app.engine.e.select_none.mock.invocationCallOrder[0])
      .toBeLessThan(app.engine.e.stamp_image.mock.invocationCallOrder[0]);
  });

  it("does not stamp generative-fill output after the document changes", async () => {
    const { generativeFillML } = await import("./onnx");

    const result = await generativeFillML();

    expect(result).toEqual({ ok: false, w: 0, h: 0, holePx: 0, box: [] });
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.select_none).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  it("rejects prompt-free fill clearly when the optional MI-GAN model is absent", async () => {
    modelSource.filePresent.mockResolvedValue(false);
    const { generativeFillML } = await import("./onnx");

    await expect(generativeFillML()).rejects.toThrow("MI-GAN is not installed");
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  it("does not stamp LaMa remove output after the document changes", async () => {
    const { lamaFillML } = await import("./onnx");

    const result = await lamaFillML();

    expect(result).toEqual({ ok: false, w: 0, h: 0, holePx: 0, box: [] });
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  it("rejects LaMa remove clearly when the optional model is absent", async () => {
    modelSource.filePresent.mockResolvedValue(false);
    const { lamaFillML } = await import("./onnx");

    await expect(lamaFillML()).rejects.toThrow("LaMa is not installed");
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  it("feeds LaMa float32 tensors with inverted (1=hole) mask polarity", async () => {
    const { lamaFillML } = await import("./onnx");

    await lamaFillML(); // cancels on the docGen bump, but the feeds were captured first
    const feeds = runCapture.lastFeeds!;
    const img = feeds.image, mask = feeds.mask;
    expect(img.type).toBe("float32");
    expect(img.dims).toEqual([1, 3, 512, 512]);
    expect(mask.type).toBe("float32");
    expect(mask.dims).toEqual([1, 1, 512, 512]);
    // image normalized to [0,1] (not raw uint8) — the mock's 24-gray composite → ~0.094
    expect(img.data[0]).toBeLessThanOrEqual(1);
    expect(img.data[0]).toBeCloseTo(24 / 255, 3);
    // LaMa keeps where sel<128 → mask 0 (MI-GAN writes 255 here); every value is binary 0/1
    expect(Array.from(mask.data as Float32Array).every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("does not stamp AI-denoise output after the document changes", async () => {
    const { aiDenoise } = await import("./onnx");

    const result = await aiDenoise();

    expect(result).toEqual({ ok: false, w: 0, h: 0, tiles: 0 });
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  it("routes a blank-prompt Generative Fill to the MI-GAN path", async () => {
    const { generativeFillDiffusion } = await import("./onnx");

    const result = await generativeFillDiffusion("   ", 20);

    // no prompt → prompt-free MI-GAN; the migan run bumps docGen so the stamp
    // is cancelled (ok:false), but the reported model confirms the routing.
    expect(result.model).toBe("mi-gan");
    expect(result.ok).toBe(false);
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  // Jobs outlive the request that started them (poll ml.jobStatus) and nothing
  // blocks the UI or the ~40 sync MCP tools meanwhile. docGen only moves on a
  // document swap/resize, so a plain content edit mid-job passed the guard and
  // the job then buried it under an opaque full-canvas stamp of pre-edit pixels
  // — reported as success. (#59)
  it("does not stamp AI-denoise output after a content edit commits mid-job", async () => {
    runCapture.holdDocGen = true; // same document — only its CONTENT changed
    runCapture.editMidRun = true; // the user's adjustment/stroke lands mid-run
    const { aiDenoise } = await import("./onnx");
    const progress: string[] = [];

    const result = await aiDenoise((msg) => progress.push(msg));

    expect(result).toEqual({ ok: false, w: 0, h: 0, tiles: 0 });
    expect(progress).toContain("Cancelled — document changed.");
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  // A one-off create failure (transient fetch error, ORT hiccup, model not yet
  // in place) used to poison the URL for the whole app session. (#14)
  it("retries a model whose session creation failed once", async () => {
    vi.resetModules(); // fresh module → empty session cache
    ort.InferenceSession.create.mockRejectedValueOnce(new Error("fetch failed"));
    const { selectSubject } = await import("./onnx");

    await expect(selectSubject()).rejects.toThrow("fetch failed");

    runCapture.holdDocGen = true; // let the retry run to completion
    const result = await selectSubject();
    expect(result.ok).toBe(true);
    expect(app.engine.e.set_selection_mask).toHaveBeenCalled();
    expect(ort.InferenceSession.create).toHaveBeenCalledTimes(2);
  });

  it("stops generative expand before selection or inference when canvas growth is refused", async () => {
    app.engine.commit.mockReturnValueOnce(false);
    const { generativeExpandML } = await import("./onnx");
    const progress: string[] = [];

    const result = await generativeExpandML(14, 12, 2, 2, (message) => progress.push(message));

    expect(result).toEqual({ ok: false, w: 10, h: 8, holePx: 0, box: [] });
    expect(app.engine.e.resize_canvas).toHaveBeenCalledWith(14, 12, 2, 2);
    expect(app.engine.e.select_rect).not.toHaveBeenCalled();
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.store.requestFit).not.toHaveBeenCalled();
    expect(progress.at(-1)).toContain("Expansion blocked");
  });
});

// A neural filter used to be all-or-nothing: no way to see it before applying,
// and no way out of a running job except changing the document. Both now hang
// off the same two boundaries the jobs already had (the tile loop and the
// stamp) — preview diverts the stamp, Cancel throws at the next boundary.
describe("ML live preview and cancel", () => {
  beforeEach(() => {
    installCanvasDom();
    // A document big enough for the preview to actually downscale and for the
    // denoise tiler to produce many tiles.
    vi.stubGlobal("Image", class extends FakeImage { naturalWidth = 1024; naturalHeight = 768; });
    vi.clearAllMocks();
    modelSource.filePresent.mockResolvedValue(true);
    app.engine.docGen = 1;
    app.counters.pushes = 0;
    runCapture.lastFeeds = null;
    runCapture.holdDocGen = true; // preview/cancel jobs must run to their own end
    runCapture.editMidRun = false;
    runCapture.onRun = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews a filter at preview resolution and leaves the document untouched", async () => {
    const { previewFilter, styleTransfer, PREVIEW_MAX_SIDE } = await import("./onnx");

    const preview = await previewFilter((p) => styleTransfer("candy", 0, p));

    // 1024×768 → longest side clamped to the preview budget, aspect kept.
    expect([preview.w, preview.h]).toEqual([PREVIEW_MAX_SIDE, 192]);
    expect(preview.before).toHaveLength(preview.w * preview.h * 4);
    expect(preview.after).toHaveLength(preview.w * preview.h * 4);
    // The real network ran — this is the filter itself, not a mock-up of it.
    expect(runCapture.lastFeeds).toBeTruthy();
    // …and nothing landed on the document.
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
    expect(app.engine.commit).not.toHaveBeenCalled();
  });

  it("stops a running denoise at the next tile and stamps nothing", async () => {
    const { aiDenoise } = await import("./onnx");
    const { beginMlJob, cancelMlJob, isMlCancel } = await import("./mlJob");
    const end = beginMlJob();
    runCapture.onRun = () => { cancelMlJob(); }; // the user hits Cancel mid-tile
    const progress: string[] = [];

    const error = await aiDenoise((m) => progress.push(m)).then(() => null, (e: unknown) => e);
    end();

    expect(isMlCancel(error), `expected a cancellation, got ${String(error)}`).toBe(true);
    // 1024×768 tiles into 20 tiles; the job must abandon them, not grind on.
    expect(progress.filter((m) => m.startsWith("Denoising tile"))).toHaveLength(1);
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  // Preview hands the filter a downscaled document. A job that applies itself
  // some other way than the shared stamp (a new document, a selection, a warp)
  // would therefore write preview-resolution pixels into the real document, so
  // it has to refuse the preview instead.
  it("refuses to preview a filter that applies itself another way", async () => {
    const { previewFilter, superResolution, selectSubject } = await import("./onnx");

    await expect(previewFilter((p) => superResolution(p))).rejects.toThrow(/cannot be previewed/);
    await expect(previewFilter((p) => selectSubject(p))).rejects.toThrow(/cannot be previewed/);

    expect(app.store.openImage).not.toHaveBeenCalled();
    expect(app.engine.e.set_selection_mask).not.toHaveBeenCalled();
  });

  it("refuses every destructive non-stamp job before it can mutate under preview", async () => {
    const {
      generateBackgroundML, generateImageReference, generativeExpandML, previewFilter,
    } = await import("./onnx");

    await expect(previewFilter((p) => generativeExpandML(1280, 1024, 128, 128, p)))
      .rejects.toThrow("Generative Expand cannot be previewed.");
    await expect(previewFilter((p) => generateBackgroundML("a beach", 4, p)))
      .rejects.toThrow("Generate Background cannot be previewed.");
    await expect(previewFilter((p) => generateImageReference("a beach", 4, 0.5, p)))
      .rejects.toThrow("Generate Image (reference) cannot be previewed.");

    expect(app.engine.e.resize_canvas).not.toHaveBeenCalled();
    expect(app.engine.e.select_rect).not.toHaveBeenCalled();
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
    expect(app.store.openImage).not.toHaveBeenCalled();
    expect(app.engine.commit).not.toHaveBeenCalled();
  });

  // A cancel must not poison the module for the next job, and Cancel with
  // nothing running must be a no-op rather than arming the next one.
  it("runs the next job to completion after a cancelled one", async () => {
    const { aiDenoise } = await import("./onnx");
    const { beginMlJob, cancelMlJob } = await import("./mlJob");
    const first = beginMlJob();
    expect(cancelMlJob()).toBe(true);
    first();
    expect(cancelMlJob()).toBe(false); // nothing running

    const end = beginMlJob();
    const result = await aiDenoise();
    end();

    expect(result.ok).toBe(true);
    expect(app.engine.e.stamp_image).toHaveBeenCalled();
  });
});
