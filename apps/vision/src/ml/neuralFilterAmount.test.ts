import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// VIS-FX-05: the Neural Filters dialog exposes per-filter strength sliders.
// These tests prove the `amount` parameter added to colorizeML / harmonizeML /
// restoreML actually blends: 0 leaves the composite untouched, 1 applies the
// full model result, midpoints interpolate. Mock scaffold mirrors
// neuralFilters.test.ts; the canvas mock here additionally propagates the
// first written pixel through drawImage so resize() reflects model output
// (every synthetic tensor is a uniform fill, so one pixel represents all).

const h = vi.hoisted(() => {
  const engineApi = {
    export_png: vi.fn(() => new Uint8Array([1, 2, 3])),
    get_selection_mask: vi.fn(() => new Uint8Array(4)), // 2×2, no selection
    stamp_image: vi.fn(),
    select_none: vi.fn(),
  };
  const app = {
    engine: { docGen: 1, commit: vi.fn(), e: engineApi },
    store: { addLayer: vi.fn(), openImage: vi.fn() },
    neural: { colorize: vi.fn() },
  };
  return { app };
});

const ort = vi.hoisted(() => {
  const outputFor = (url: string): Float32Array => {
    if (url.includes("colorizer")) return new Float32Array(2 * 512 * 512).fill(20); // DDColor ab
    return new Float32Array(3 * 256 * 256).fill(0.5); // harmonizer / fbcnn → 128 gray
  };
  return {
    env: { wasm: { wasmPaths: "", numThreads: 0, proxy: true } },
    Tensor: class Tensor {
      constructor(public readonly type: string, public readonly data: Float32Array, public readonly dims: number[]) {}
    },
    InferenceSession: {
      create: vi.fn(async (url: string) => ({
        inputNames: url.includes("harmonizer") ? ["image", "mask"] : ["input"],
        outputNames: ["output"],
        run: vi.fn(async () => ({ output: { data: outputFor(url) } })),
      })),
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

// Canvas mock: putImageData remembers the first pixel on its canvas, drawImage
// copies it across canvases, getImageData tiles it (falling back to the
// 24/48/96 composite pattern when only an <img> was drawn, i.e. composite()).
function installCanvasDom(): void {
  const OriginalUrl = globalThis.URL;
  class FakeURL extends OriginalUrl {
    static createObjectURL = vi.fn(() => "blob:fake");
    static revokeObjectURL = vi.fn();
  }
  const makeContext = (canvas: { __px?: number[] }) => ({
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    createImageData: (w: number, hh: number) => ({ data: new Uint8ClampedArray(w * hh * 4) }),
    putImageData: (id: { data: Uint8ClampedArray }) => { canvas.__px = [...id.data.slice(0, 4)]; },
    drawImage: (src: { __px?: number[] }) => { if (src?.__px) canvas.__px = [...src.__px]; },
    getImageData: (_x: number, _y: number, w: number, hh: number) => {
      const px = canvas.__px ?? [24, 48, 96, 255];
      const data = new Uint8ClampedArray(w * hh * 4);
      for (let i = 0; i < w * hh; i++) data.set(px, i * 4);
      return { data };
    },
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
      const canvas: { width: number; height: number; __px?: number[]; getContext?: unknown } = { width: 0, height: 0 };
      canvas.getContext = () => makeContext(canvas);
      return canvas;
    },
  });
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", FakeURL);
}

/** RGB of the first stamped pixel from the sole stamp_image call. */
function stampedPixel(): [number, number, number, number] {
  expect(h.app.engine.e.stamp_image).toHaveBeenCalledOnce();
  const rgba = h.app.engine.e.stamp_image.mock.calls[0][4] as Uint8Array;
  return [rgba[0], rgba[1], rgba[2], rgba[3]];
}

describe("neural-filter amount blending (VIS-FX-05)", () => {
  beforeEach(() => {
    vi.resetModules(); // drop onnx.ts's session cache between cases
    installCanvasDom();
    vi.clearAllMocks();
    h.app.engine.docGen = 1;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Colorize amount 0 keeps every pixel neutral (chroma fully suppressed)", async () => {
    const { colorizeML } = await import("./onnx");
    expect((await colorizeML(undefined, 0)).ok).toBe(true);
    const [r, g, b, a] = stampedPixel();
    expect(r).toBe(g);
    expect(g).toBe(b); // lab2rgb(L, 0, 0) is gray
    expect(a).toBe(255);
  });

  it("Colorize default amount applies the predicted chroma", async () => {
    const { colorizeML } = await import("./onnx");
    expect((await colorizeML()).ok).toBe(true);
    const [r, g, b] = stampedPixel();
    expect(r === g && g === b).toBe(false); // ab = +20/+20 shifts off neutral
  });

  it("Harmonize blends toward the original by amount", async () => {
    const { harmonizeML } = await import("./onnx");
    expect((await harmonizeML(undefined, 0.5)).ok).toBe(true);
    // composite 24/48/96 → model 128 gray, halfway: 76/88/112
    expect(stampedPixel()).toEqual([76, 88, 112, 255]);
  });

  it("Harmonize amount 0 returns the original composite", async () => {
    const { harmonizeML } = await import("./onnx");
    expect((await harmonizeML(undefined, 0)).ok).toBe(true);
    expect(stampedPixel()).toEqual([24, 48, 96, 255]);
  });

  it("Photo Restoration blends toward the original by amount", async () => {
    const { restoreML } = await import("./onnx");
    expect((await restoreML(undefined, 0.5)).ok).toBe(true);
    expect(stampedPixel()).toEqual([76, 88, 112, 255]);
  });

  it("Photo Restoration default amount applies the full model result", async () => {
    const { restoreML } = await import("./onnx");
    expect((await restoreML()).ok).toBe(true);
    expect(stampedPixel()).toEqual([128, 128, 128, 255]);
  });

  it("out-of-range amounts clamp to 0..1", async () => {
    const { restoreML } = await import("./onnx");
    expect((await restoreML(undefined, 7)).ok).toBe(true);
    expect(stampedPixel()).toEqual([128, 128, 128, 255]); // same as amount 1
  });
});
