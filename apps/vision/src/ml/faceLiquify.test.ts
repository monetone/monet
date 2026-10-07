import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// VIS-FX-06: Face-Aware Liquify's Photoshop-parity control set. The mock model
// emits TWO 68-point faces ([2,136]) so we can prove multi-face parsing,
// faceIndex targeting/clamping, and that every one of the 16 controls lands
// its warp dabs. Real weights are BYO (`face-landmarks` is bundled:false), so
// as in neuralFilters.test.ts we mock onnxruntime-web and test the WIRING.

const h = vi.hoisted(() => {
  const engineApi = {
    export_png: vi.fn(() => new Uint8Array([1, 2, 3])),
    get_selection_mask: vi.fn(() => new Uint8Array(4)), // 2×2, no selection
    liquify_begin: vi.fn(() => true),
    liquify_dab: vi.fn<(...args: unknown[]) => number[]>(() => [0, 0, 0, 0]),
    liquify_end: vi.fn(),
    last_edit_error: vi.fn(() => ""),
    clear_last_edit_error: vi.fn(),
  };
  const app = {
    engine: { docGen: 1, commit: vi.fn(), e: engineApi },
    store: { addLayer: vi.fn(), openImage: vi.fn() },
    neural: { colorize: vi.fn() },
  };
  return { app };
});

const ort = vi.hoisted(() => ({
  env: { wasm: { wasmPaths: "", numThreads: 0, proxy: true } },
  Tensor: class Tensor {
    constructor(public readonly type: string, public readonly data: Float32Array, public readonly dims: number[]) {}
  },
  InferenceSession: {
    create: vi.fn(async () => ({
      inputNames: ["input"],
      outputNames: ["output"],
      run: vi.fn(async () => {
        // Two faces: every landmark of face 0 at normalized 0.25, face 1 at 0.75.
        const lm = new Float32Array(2 * 68 * 2);
        lm.fill(0.25, 0, 136);
        lm.fill(0.75, 136);
        return { output: { data: lm } };
      }),
    })),
  },
}));

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
    getImageData: (_x: number, _y: number, w: number, hh: number) => ({ data: new Uint8ClampedArray(w * hh * 4).fill(128) }),
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

/** All 16 Photoshop-parity controls set → expected dab count per control. */
const ALL_CONTROLS = {
  eyeSize: 2, eyeHeight: 4, eyeWidth: 4, eyeTilt: 2, eyeDistance: 2,
  noseHeight: 1, noseWidth: 2,
  smile: 2, upperLip: 1, lowerLip: 1, mouthWidth: 2, mouthHeight: 2,
  forehead: 1, chinHeight: 1, jawline: 2, faceWidth: 2,
} as const;

describe("Face-Aware Liquify full control set (VIS-FX-06)", () => {
  beforeEach(() => {
    vi.resetModules(); // drop onnx.ts's session cache between cases
    installCanvasDom();
    vi.clearAllMocks();
    h.app.engine.docGen = 1;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("detectFaceLandmarksML exposes every face in document pixels", async () => {
    const { detectFaceLandmarksML } = await import("./onnx");
    const r = await detectFaceLandmarksML();
    expect(r.ok).toBe(true);
    expect(r.faces).toHaveLength(2);
    expect(r.faces[0]).toHaveLength(68);
    // Normalized 0.25 / 0.75 on a 2×2 doc → 0.5 / 1.5 px.
    expect(r.faces[0][0]).toEqual([0.5, 0.5]);
    expect(r.faces[1][0]).toEqual([1.5, 1.5]);
  });

  it("each of the 16 controls drives its own warp dabs", async () => {
    const { faceAwareLiquifyML } = await import("./onnx");
    for (const [key, dabs] of Object.entries(ALL_CONTROLS)) {
      h.app.engine.e.liquify_dab.mockClear();
      const r = await faceAwareLiquifyML({ [key]: 0.5 });
      expect(r.ok, key).toBe(true);
      expect(r.dabs, key).toBe(dabs);
      expect(h.app.engine.e.liquify_dab, key).toHaveBeenCalledTimes(dabs);
    }
  });

  it("all controls together apply the full warp pass and report both faces", async () => {
    const { faceAwareLiquifyML } = await import("./onnx");
    const params = Object.fromEntries(Object.keys(ALL_CONTROLS).map((k) => [k, -0.5]));
    const r = await faceAwareLiquifyML(params);
    expect(r.ok).toBe(true);
    expect(r.faces).toBe(2);
    const total = Object.values(ALL_CONTROLS).reduce((a, b) => a + b, 0);
    expect(r.dabs).toBe(total);
    expect(h.app.engine.e.liquify_begin).toHaveBeenCalledOnce();
    expect(h.app.engine.e.liquify_end).toHaveBeenCalledOnce();
  });

  it("faceIndex targets the chosen face and clamps out-of-range values", async () => {
    const { faceAwareLiquifyML } = await import("./onnx");
    // Face 1's landmarks all sit at 1.5px; eyeSize dabs at the eye centroids.
    await faceAwareLiquifyML({ eyeSize: 0.5, faceIndex: 1 });
    for (const call of h.app.engine.e.liquify_dab.mock.calls) {
      expect(call[0]).toBe(1.5);
      expect(call[1]).toBe(1.5);
    }
    h.app.engine.e.liquify_dab.mockClear();
    // Out-of-range index clamps to the last face instead of crashing.
    const r = await faceAwareLiquifyML({ eyeSize: 0.5, faceIndex: 99 });
    expect(r.ok).toBe(true);
    expect(h.app.engine.e.liquify_dab.mock.calls[0]?.[0]).toBe(1.5);
  });

  it("legacy 3-arg call still maps onto eyeSize/smile/faceWidth", async () => {
    const { faceAwareLiquifyML } = await import("./onnx");
    const r = await faceAwareLiquifyML(0.5, 0.5, 0.5);
    expect(r.ok).toBe(true);
    expect(r.dabs).toBe(6); // 2 eyes + 2 mouth corners + 2 cheek points
  });

  it("reports a refused session start by name and leaves no latched error for the next commit", async () => {
    const { faceAwareLiquifyML } = await import("./onnx");
    const refusal = "Liquify is not 32-bit-float safe; convert the document to 16 or 8 bits/channel first";
    h.app.engine.e.liquify_begin.mockReturnValueOnce(false);
    h.app.engine.e.last_edit_error.mockReturnValueOnce(refusal);
    await expect(faceAwareLiquifyML({ eyeSize: 0.5 })).rejects.toThrow(refusal);
    expect(h.app.engine.e.clear_last_edit_error).toHaveBeenCalledOnce();
    expect(h.app.engine.e.liquify_dab).not.toHaveBeenCalled();
  });
});
