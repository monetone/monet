import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tier-2 neural-filter drops (plan 06). The real weights are user-supplied /
// gitignored, so these tests mock onnxruntime-web with synthetic per-model
// tensors and prove the WIRING: the post-processing lands a layer (or ranking),
// the doc-changed guard cancels a stale result, and an unloadable model throws a
// clean "not installed" message instead of an unhandled ORT rejection.

const h = vi.hoisted(() => {
  const engineApi = {
    export_png: vi.fn(() => new Uint8Array([1, 2, 3])),
    get_selection_mask: vi.fn(() => new Uint8Array(4)), // 2×2, no selection
    stamp_image: vi.fn(),
    select_none: vi.fn(),
    filter_deblock: vi.fn(),
    liquify_begin: vi.fn(() => true),
    liquify_dab: vi.fn(() => [0, 0, 0, 0]),
    liquify_end: vi.fn(),
  };
  const app = {
    engine: { docGen: 1, commit: vi.fn(), e: engineApi },
    store: { addLayer: vi.fn(), openImage: vi.fn() },
    neural: { colorize: vi.fn() },
  };
  const cfg = { bump: false, reject: false };
  return { app, cfg };
});

const ort = vi.hoisted(() => {
  const inputsFor = (url: string) => (url.includes("harmonizer") ? ["image", "mask"] : ["input"]);
  const outputFor = (url: string): Float32Array => {
    if (url.includes("colorizer")) return new Float32Array(2 * 512 * 512).fill(20); // DDColor ab [1,2,512,512]
    if (url.includes("midas")) return new Float32Array(256 * 256).map((_, i) => i / (256 * 256));
    if (url.includes("harmonizer") || url.includes("fbcnn")) return new Float32Array(3 * 256 * 256).fill(0.5);
    if (url.includes("font_classifier")) return Float32Array.from({ length: 49 }, (_, i) => (i === 12 ? 9 : i * 0.001)); // 49-class ResNet, idx 12 = Helvetica top
    if (url.includes("face_landmarks")) return new Float32Array(68 * 2).fill(0.5);
    return new Float32Array(3 * 224 * 224);
  };
  return {
    env: { wasm: { wasmPaths: "", numThreads: 0, proxy: true } },
    Tensor: class Tensor {
      constructor(public readonly type: string, public readonly data: Float32Array, public readonly dims: number[]) {}
    },
    InferenceSession: {
      create: vi.fn(async (url: string) => {
        if (h.cfg.reject) throw new Error("404");
        return {
          inputNames: inputsFor(url),
          outputNames: ["output"],
          run: vi.fn(async () => {
            if (h.cfg.bump) h.app.engine.docGen++;
            return { output: { data: outputFor(url) } };
          }),
        };
      }),
    },
  };
});

vi.mock("../state/app", () => h.app);
vi.mock("onnxruntime-web", () => ort);

class FakeImage {
  onload: (() => void) | null = null;
  naturalWidth = 2;
  naturalHeight = 2;
  set src(_v: string) { queueMicrotask(() => this.onload?.()); }
}

function installCanvasDom(): void {
  const OriginalUrl = globalThis.URL;
  class FakeURL extends OriginalUrl {
    static createObjectURL = vi.fn(() => "blob:fake");
    static revokeObjectURL = vi.fn();
  }
  const makeContext = () => ({
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    createImageData: (w: number, hh: number) => ({ data: new Uint8ClampedArray(w * hh * 4) }),
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, hh: number) => {
      const data = new Uint8ClampedArray(w * hh * 4);
      for (let i = 0; i < w * hh; i++) { data[i * 4] = 24; data[i * 4 + 1] = 48; data[i * 4 + 2] = 96; data[i * 4 + 3] = 255; }
      return { data };
    },
    putImageData: vi.fn(),
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
      return { width: 0, height: 0, getContext: () => makeContext() };
    },
  });
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", FakeURL);
}

describe("Tier-2 neural-filter wiring", () => {
  beforeEach(() => {
    vi.resetModules(); // drop onnx.ts's session cache between cases
    installCanvasDom();
    vi.clearAllMocks();
    h.app.engine.docGen = 1;
    h.cfg.bump = false;
    h.cfg.reject = false;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Colorize stamps a colorized layer", async () => {
    const { colorizeML } = await import("./onnx");
    const r = await colorizeML();
    expect(r.ok).toBe(true);
    expect(r.model).toBe("colorizer");
    expect(h.app.store.addLayer).toHaveBeenCalledOnce();
    expect(h.app.engine.e.stamp_image).toHaveBeenCalledOnce();
  });

  it("Depth Blur stamps a defocused layer", async () => {
    const { depthBlurML } = await import("./onnx");
    const r = await depthBlurML(0.5, 1);
    expect(r).toEqual({ ok: true, w: 2, h: 2, model: "midas" });
    expect(h.app.engine.e.stamp_image).toHaveBeenCalledOnce();
  });

  it("Harmonize stamps a harmonized layer (image + mask inputs)", async () => {
    const { harmonizeML } = await import("./onnx");
    const r = await harmonizeML();
    expect(r.ok).toBe(true);
    expect(r.model).toBe("harmonizer");
    expect(h.app.engine.e.stamp_image).toHaveBeenCalledOnce();
  });

  it("Photo Restoration stamps a cleaned layer", async () => {
    const { restoreML } = await import("./onnx");
    const r = await restoreML();
    expect(r.ok).toBe(true);
    expect(r.model).toBe("fbcnn");
    expect(h.app.engine.e.stamp_image).toHaveBeenCalledOnce();
  });

  it("Match Font returns a ranked family list without touching the document", async () => {
    const { matchFontML } = await import("./onnx");
    const r = await matchFontML();
    expect(r.ok).toBe(true);
    expect(r.ranking).toHaveLength(5);
    expect(r.ranking[0]).toBe("Helvetica"); // index 12 has the top logit (9)
    expect(h.app.store.addLayer).not.toHaveBeenCalled();
  });

  it("Face-Aware Liquify drives landmark warps through the engine mesh", async () => {
    const { faceAwareLiquifyML } = await import("./onnx");
    const r = await faceAwareLiquifyML(0.5, 0.5, 0.5);
    expect(r.ok).toBe(true);
    expect(r.model).toBe("face-landmarks");
    expect(h.app.engine.e.liquify_begin).toHaveBeenCalledOnce();
    expect(h.app.engine.e.liquify_end).toHaveBeenCalledOnce();
    expect(r.dabs).toBe(6); // 2 eyes + 2 mouth corners + 2 jaw
    expect(h.app.engine.e.liquify_dab).toHaveBeenCalledTimes(6);
  });

  it("cancels a stale layer result after the document changes mid-run", async () => {
    h.cfg.bump = true; // the model run bumps docGen → docChanged
    const { colorizeML, depthBlurML, harmonizeML, restoreML } = await import("./onnx");
    for (const job of [colorizeML(), depthBlurML(), harmonizeML(), restoreML()]) {
      const r = await job;
      expect(r.ok).toBe(false);
    }
    expect(h.app.store.addLayer).not.toHaveBeenCalled();
    expect(h.app.engine.e.stamp_image).not.toHaveBeenCalled();
  });

  it("throws a clean 'not installed' message when a model is absent", async () => {
    h.cfg.reject = true;
    const { colorizeML, depthBlurML, harmonizeML, restoreML, matchFontML, faceAwareLiquifyML } = await import("./onnx");
    for (const job of [colorizeML(), depthBlurML(), harmonizeML(), restoreML(), matchFontML(), faceAwareLiquifyML()]) {
      await expect(job).rejects.toThrow(/not installed/);
    }
  });
});
