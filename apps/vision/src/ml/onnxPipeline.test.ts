// Behavioural coverage for the on-device inference PIPELINES in onnx.ts — the
// pre/post-processing around the model call, which is where every silent
// regression lives (channel order, plane strides, tile clamping, matte
// compositing, coordinate space).
//
// onnx.test.ts already covers the cancellation guards with a canvas stub whose
// getImageData answers a constant colour, so no test could ever observe what the
// pipelines actually compute. This file installs a FUNCTIONAL canvas fake
// (nearest-neighbour scaling, real pixel storage) so the assertions are on real
// output pixels. The ONNX runtime itself is mocked here on purpose — the real
// onnxruntime-web tensor contract is proven separately against a committed
// synthetic model in onnxRuntime.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── functional canvas fake ─────────────────────────────────────
interface Surface { w: number; h: number; px: Uint8ClampedArray }

const dom = vi.hoisted(() => ({
  // The document composite the fake PNG decoder hands back.
  doc: { w: 1, h: 1, px: new Uint8ClampedArray(4) } as Surface,
  // The last surface handed to toBlob (i.e. what super-resolution encodes).
  encoded: null as Surface | null,
  encodeFails: false,
}));

function surface(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Surface {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fill(x, y), p = (y * w + x) * 4;
    px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
  }
  return { w, h, px };
}

/** Nearest-neighbour scale of `src` into `dst` at (dx,dy) sized dw×dh. Browser
 *  drawImage interpolates; nearest keeps the assertions deterministic while
 *  preserving the property the pipelines rely on (a stretch, never a crop). */
function blit(src: Surface, dst: Surface, dx: number, dy: number, dw: number, dh: number): void {
  for (let y = 0; y < dh; y++) {
    const ty = dy + y; if (ty < 0 || ty >= dst.h) continue;
    const sy = Math.min(src.h - 1, Math.floor((y * src.h) / dh));
    for (let x = 0; x < dw; x++) {
      const tx = dx + x; if (tx < 0 || tx >= dst.w) continue;
      const sx = Math.min(src.w - 1, Math.floor((x * src.w) / dw));
      const s = (sy * src.w + sx) * 4, d = (ty * dst.w + tx) * 4;
      dst.px[d] = src.px[s]; dst.px[d + 1] = src.px[s + 1];
      dst.px[d + 2] = src.px[s + 2]; dst.px[d + 3] = src.px[s + 3];
    }
  }
}

interface FakeCanvas {
  width: number; height: number;
  __surface(): Surface;
  getContext(): unknown;
  toBlob(cb: (blob: Blob | null) => void, type?: string): void;
}

function makeCanvas(): FakeCanvas {
  let surf: Surface | null = null;
  const canvas = {
    width: 0,
    height: 0,
    __surface(): Surface {
      if (!surf || surf.w !== canvas.width || surf.h !== canvas.height) {
        surf = { w: canvas.width, h: canvas.height, px: new Uint8ClampedArray(canvas.width * canvas.height * 4) };
      }
      return surf;
    },
    getContext() {
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (id: { data: Uint8ClampedArray }) => {
          const d = canvas.__surface();
          d.px.set(id.data.subarray(0, d.px.length));
        },
        drawImage: (src: { __surface(): Surface }, dx: number, dy: number, dw?: number, dh?: number) => {
          const s = src.__surface();
          blit(s, canvas.__surface(), dx, dy, dw ?? s.w, dh ?? s.h);
        },
        getImageData: (x: number, y: number, w: number, h: number) => {
          const s = canvas.__surface();
          const out = new Uint8ClampedArray(w * h * 4);
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const sp = ((y + j) * s.w + (x + i)) * 4, dp = (j * w + i) * 4;
            out[dp] = s.px[sp]; out[dp + 1] = s.px[sp + 1]; out[dp + 2] = s.px[sp + 2]; out[dp + 3] = s.px[sp + 3];
          }
          return { width: w, height: h, data: out };
        },
      };
    },
    toBlob(cb: (blob: Blob | null) => void) {
      if (dom.encodeFails) { cb(null); return; }
      const s = canvas.__surface();
      dom.encoded = { w: s.w, h: s.h, px: s.px.slice() };
      cb(new Blob([new Uint8Array([137, 80, 78, 71])]));
    },
  };
  return canvas;
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  get naturalWidth() { return dom.doc.w; }
  get naturalHeight() { return dom.doc.h; }
  __surface(): Surface { return dom.doc; }
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}

function installCanvasDom(): void {
  const OriginalUrl = globalThis.URL;
  class FakeURL extends OriginalUrl {
    static createObjectURL = vi.fn(() => "blob:doc");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
      return makeCanvas();
    },
  });
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", FakeURL);
}

// ── app / engine mocks ─────────────────────────────────────────
const app = vi.hoisted(() => {
  const engineApi = {
    undo_pushes: vi.fn(() => 0),
    width: vi.fn(() => dom.doc.w),
    height: vi.fn(() => dom.doc.h),
    export_png: vi.fn(() => new Uint8Array([137, 80, 78, 71])),
    get_selection_mask: vi.fn(() => new Uint8Array(0)),
    has_selection: vi.fn(() => false),
    select_none: vi.fn(),
    select_rect: vi.fn(),
    resize_canvas: vi.fn(),
    set_selection_mask: vi.fn(),
    stamp_image: vi.fn(),
    mark_ai_generated: vi.fn(),
    active_layer_id: vi.fn(() => 7),
  };
  return {
    engine: { docGen: 1, commit: vi.fn(), e: engineApi },
    store: { addLayer: vi.fn(), openImage: vi.fn(), requestFit: vi.fn(), setLayerOpacity: vi.fn() },
  };
});

// ── ONNX runtime mock ──────────────────────────────────────────
interface FakeTensor { type: string; data: Float32Array | Uint8Array; dims: number[] }

const net = vi.hoisted(() => ({
  /** U²-Net saliency pattern: a left-half subject, or a flat (degenerate) map. */
  subject: "left-half" as "left-half" | "flat",
  /** Per-plane constants the style net emits (catches a channel/stride swap). */
  style: [200, 100, 50] as [number, number, number],
  /** Every feed seen, in order. */
  feeds: [] as { url: string; tensor: FakeTensor }[],
}));

const ort = vi.hoisted(() => ({
  env: { wasm: { wasmPaths: "", numThreads: 0, proxy: true } },
  Tensor: class Tensor {
    constructor(public readonly type: string, public readonly data: Float32Array | Uint8Array, public readonly dims: number[]) {}
  },
  InferenceSession: {
    create: vi.fn(async (url: string) => ({
      inputNames: ["input"],
      outputNames: ["output"],
      run: vi.fn(async (feeds: Record<string, FakeTensor>) => {
        const tensor = Object.values(feeds)[0];
        net.feeds.push({ url, tensor });
        if (url.includes("super-res")) {
          // Faithful 3× upsampler: the identity behaviour a working ESPCN
          // approximates, so any luma the pipeline loses is the pipeline's doing.
          const TS = 224, OT = 672;
          const src = tensor.data as Float32Array;
          const out = new Float32Array(OT * OT);
          for (let j = 0; j < OT; j++) for (let i = 0; i < OT; i++) {
            out[j * OT + i] = src[((j / 3) | 0) * TS + ((i / 3) | 0)];
          }
          return { output: { data: out } };
        }
        if (url.includes("u2netp")) {
          const N = 320;
          const out = new Float32Array(N * N);
          if (net.subject === "left-half") for (let i = 0; i < N * N; i++) out[i] = i % N < N / 2 ? 1 : 0;
          else out.fill(0.25);
          return { output: { data: out } };
        }
        const N = 224, plane = N * N;
        const out = new Float32Array(3 * plane);
        out.fill(net.style[0], 0, plane);
        out.fill(net.style[1], plane, 2 * plane);
        out.fill(net.style[2], 2 * plane, 3 * plane);
        return { output: { data: out } };
      }),
    })),
  },
}));

const modelSource = vi.hoisted(() => ({
  filePresent: vi.fn(async () => true),
  resolveModelUrl: vi.fn(async (_def: unknown, rel: string) => `/models/${rel}`),
  bestUnit: vi.fn(async (baseId: string) => ({ id: baseId, files: [{ rel: `${baseId}.onnx` }] })),
}));

const diffusion = vi.hoisted(() => ({
  generateRGBA: vi.fn(async () => ({ ok: true, rgba: new Uint8ClampedArray(0), w: 0, h: 0 })),
  generateInpaintRGBA: vi.fn(async () => ({ ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 })),
  generateImageFromReference: vi.fn(async () => ({ ok: true, w: 512, h: 512 })),
}));

vi.mock("../state/app", () => app);
vi.mock("onnxruntime-web", () => ort);
vi.mock("./modelSource", () => modelSource);
vi.mock("./diffusion", () => diffusion);

const px = (s: Surface, x: number, y: number): number[] => {
  const p = (y * s.w + x) * 4;
  return [s.px[p], s.px[p + 1], s.px[p + 2], s.px[p + 3]];
};
const stamped = (): Surface => {
  const call = app.engine.e.stamp_image.mock.calls.at(-1)!;
  const [, , w, h, buf] = call as unknown as [number, number, number, number, Uint8Array];
  return { w, h, px: new Uint8ClampedArray(buf) };
};

beforeEach(() => {
  installCanvasDom();
  vi.clearAllMocks();
  app.engine.docGen = 1;
  app.engine.e.active_layer_id.mockReturnValue(7);
  modelSource.filePresent.mockResolvedValue(true);
  diffusion.generateImageFromReference.mockResolvedValue({ ok: true, w: 512, h: 512 });
  net.subject = "left-half";
  net.style = [200, 100, 50];
  net.feeds = [];
  dom.encoded = null;
  dom.encodeFails = false;
  dom.doc = surface(10, 8, () => [24, 48, 96]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("styleTransfer — stamp and Style Opacity wiring", () => {
  it("unpacks the net's CHW planes into the stamped RGBA layer", async () => {
    const { styleTransfer } = await import("./onnx");

    const result = await styleTransfer("candy");

    expect(result).toEqual({ ok: true, w: 10, h: 8, style: "candy" });
    const out = stamped();
    expect(out.w).toBe(10);
    expect(out.h).toBe(8);
    // R/G/B come from planes 0/1/2 — a stride or channel swap flips these.
    expect(px(out, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(px(out, 9, 7)).toEqual([200, 100, 50, 255]);
  });

  it("hands Style Opacity to the new layer as a live 0..100 layer property", async () => {
    const { styleTransfer } = await import("./onnx");
    app.engine.e.active_layer_id.mockReturnValue(42);

    await styleTransfer("mosaic", 0, undefined, { styleOpacity: 0.4 });

    expect(app.store.setLayerOpacity).toHaveBeenCalledTimes(1);
    expect(app.store.setLayerOpacity).toHaveBeenCalledWith(42, 40);
    // …and it is set AFTER the stamp, so it lands on the style layer.
    expect(app.store.setLayerOpacity.mock.invocationCallOrder[0])
      .toBeGreaterThan(app.engine.e.stamp_image.mock.invocationCallOrder[0]);
  });

  it("leaves layer opacity untouched at full Style Opacity", async () => {
    const { styleTransfer } = await import("./onnx");

    await styleTransfer("candy", 0, undefined, { styleOpacity: 1 });
    await styleTransfer("candy"); // omitted → defaults to 1

    expect(app.store.setLayerOpacity).not.toHaveBeenCalled();
  });
});

describe("superResolution — tiling, edge clamping and YCbCr recombination", () => {
  it("rejects when the browser cannot encode the enlarged canvas", async () => {
    dom.encodeFails = true;
    const { superResolution } = await import("./onnx");

    await expect(superResolution()).rejects.toThrow("PNG encode failed (30×24)");
    expect(app.store.openImage).not.toHaveBeenCalled();
  });

  it("produces exactly 3× dimensions from a size that is not a multiple of the tile", async () => {
    const { superResolution } = await import("./onnx");

    const result = await superResolution();

    expect(result).toEqual({ ok: true, inW: 10, inH: 8, outW: 30, outH: 24 });
    expect(app.store.openImage).toHaveBeenCalledTimes(1);
    expect(app.store.openImage.mock.calls[0][1]).toBe("Super-Resolution 30×24");
    expect(dom.encoded).not.toBeNull();
    expect([dom.encoded!.w, dom.encoded!.h]).toEqual([30, 24]);
  });

  it("clamps the tile's source sampling to the edge instead of wrapping rows", async () => {
    dom.doc = surface(10, 8, (x, y) => { const v = 10 + x * 20 + y * 5; return [v, v, v]; });
    const { superResolution } = await import("./onnx");

    await superResolution();

    const TS = 224;
    const tile = net.feeds.at(-1)!.tensor.data as Float32Array;
    expect(net.feeds.at(-1)!.tensor.dims).toEqual([1, 1, TS, TS]);
    const lastCol = tile[0 * TS + 9];
    expect(lastCol).toBeCloseTo((10 + 9 * 20) / 255, 5);
    // Past the right edge: clamped to x = w-1, NOT wrapped into the next row.
    expect(tile[0 * TS + 10]).toBeCloseTo(lastCol, 6);
    expect(tile[0 * TS + 223]).toBeCloseTo(lastCol, 6);
    expect(tile[1 * TS + 0]).not.toBeCloseTo(lastCol, 3);
    // Same on the vertical axis: below the bottom edge clamps to y = h-1.
    expect(tile[8 * TS + 0]).toBeCloseTo(tile[7 * TS + 0], 6);
  });

  it("keeps flat grey grey through the YCbCr round-trip, out to the far corner", async () => {
    dom.doc = surface(10, 8, () => [128, 128, 128]);
    const { superResolution } = await import("./onnx");

    await superResolution();

    const out = dom.encoded!;
    for (const [x, y] of [[0, 0], [15, 11], [29, 23]] as const) {
      const [r, g, b, a] = px(out, x, y);
      expect(Math.abs(r - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs(g - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs(b - 128)).toBeLessThanOrEqual(1);
      expect(a).toBe(255);
    }
  });
});

describe("subjectOutline — U²-Net matte → develop-recipe outline", () => {
  it("returns a normalized closed outline over the subject side, pressure 1", async () => {
    dom.doc = surface(40, 32, () => [200, 30, 30]);
    const { subjectOutline } = await import("./onnx");

    const outline = await subjectOutline();

    expect(outline).not.toBeNull();
    expect(outline!.length).toBeGreaterThanOrEqual(3);
    for (const p of outline!) {
      expect(p.pressure).toBe(1);
      // Recipe mask points are normalized [0..1], not document pixels.
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    // The salient blob is the LEFT half — a mirrored/transposed matte would
    // push the outline past the midline.
    expect(Math.max(...outline!.map((p) => p.x))).toBeLessThan(0.62);
    expect(Math.min(...outline!.map((p) => p.x))).toBeLessThan(0.05);
  });

  it("returns null for a degenerate matte instead of an empty outline", async () => {
    net.subject = "flat";
    const { subjectOutline } = await import("./onnx");

    await expect(subjectOutline()).resolves.toBeNull();
  });

  it("rejects when the model cannot be loaded rather than reporting 'no subject'", async () => {
    vi.resetModules(); // fresh module → empty session cache
    ort.InferenceSession.create.mockRejectedValueOnce(new Error("model not installed"));
    const { subjectOutline } = await import("./onnx");

    await expect(subjectOutline()).rejects.toThrow("model not installed");
  });
});

describe("generateBackgroundML — subject matted over a generated backdrop", () => {
  beforeEach(() => {
    dom.doc = surface(10, 8, () => [255, 0, 0]); // subject pixels are red
    diffusion.generateRGBA.mockResolvedValue({
      ok: true,
      rgba: new Uint8ClampedArray(surface(512, 512, () => [0, 0, 255]).px), // backdrop is blue
      w: 512,
      h: 512,
    });
  });

  it("keeps the subject, replaces the background, and discloses the AI backdrop", async () => {
    const { generateBackgroundML } = await import("./onnx");

    const result = await generateBackgroundML("a beach", 8);

    expect(result.ok).toBe(true);
    expect(result.w).toBe(10);
    expect(result.h).toBe(8);
    expect(result.coverage).toBeCloseTo(0.5, 6); // left half is the subject
    const out = stamped();
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255]); // subject preserved
    expect(px(out, 9, 0)).toEqual([0, 0, 255, 255]); // background replaced
    expect(app.engine.e.mark_ai_generated).toHaveBeenCalledTimes(1);
    // Whole-image stamp: the live selection must be cleared FIRST or the
    // composite gets clipped to whatever the user has selected.
    expect(app.engine.e.select_none.mock.invocationCallOrder[0])
      .toBeLessThan(app.engine.e.stamp_image.mock.invocationCallOrder[0]);
    expect(app.engine.commit).toHaveBeenCalled();
  });

  it("short-circuits without touching the document when no SD weights are installed", async () => {
    diffusion.generateRGBA.mockResolvedValue({ ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 });
    const { generateBackgroundML } = await import("./onnx");

    const result = await generateBackgroundML("a beach", 8);

    expect(result).toEqual({ ok: false, w: 0, h: 0, coverage: 0 });
    expect(app.store.addLayer).not.toHaveBeenCalled();
    expect(app.engine.e.stamp_image).not.toHaveBeenCalled();
    expect(app.engine.e.mark_ai_generated).not.toHaveBeenCalled();
  });
});

describe("generateImageReference — img2img reference preparation", () => {
  it("stretches the composite to the model's native 512² and passes the controls through", async () => {
    // Distinctive columns: a crop would lose one of the two edges.
    dom.doc = surface(10, 8, (x) => (x === 0 ? [255, 0, 0] : x === 9 ? [0, 255, 0] : [0, 0, 0]));
    const { generateImageReference } = await import("./onnx");

    const result = await generateImageReference("a cat", 12, 0.35, undefined, { seed: 7, guidance: 3.5, negativePrompt: "blurry" });

    expect(result).toEqual({ ok: true, w: 512, h: 512 });
    expect(diffusion.generateImageFromReference).toHaveBeenCalledTimes(1);
    const [ref, opts] = diffusion.generateImageFromReference.mock.calls[0] as unknown as [Surface["px"], Record<string, unknown>];
    expect(ref.length).toBe(512 * 512 * 4);
    const asSurface: Surface = { w: 512, h: 512, px: ref };
    // Both source edges survive → the non-square document was stretched, not cropped.
    expect(px(asSurface, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(asSurface, 511, 0)).toEqual([0, 255, 0, 255]);
    expect(px(asSurface, 511, 511)).toEqual([0, 255, 0, 255]);
    expect(opts).toEqual({ prompt: "a cat", steps: 12, strength: 0.35, seed: 7, guidance: 3.5, negativePrompt: "blurry" });
  });

  it("propagates a failed generation without inventing a result", async () => {
    diffusion.generateImageFromReference.mockResolvedValue({ ok: false, w: 0, h: 0 });
    const { generateImageReference } = await import("./onnx");

    await expect(generateImageReference("a cat", 12, 1)).resolves.toEqual({ ok: false, w: 0, h: 0 });
  });
});
