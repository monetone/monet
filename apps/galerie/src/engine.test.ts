import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";

import { newAiSubjectMask, newGradientMask } from "./lib/maskEdit";

interface MockEngine {
  camera_raw_develop: ReturnType<typeof vi.fn>;
  composite: ReturnType<typeof vi.fn>;
  width: ReturnType<typeof vi.fn>;
  height: ReturnType<typeof vi.fn>;
  active_layer_rgba8: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
  free: ReturnType<typeof vi.fn>;
  proxy_engine: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const instances: MockEngine[] = [];
  const fromDims = { w: 1, h: 1 };
  function makeEngine(w: number, h: number): MockEngine {
    const fill = (px: number[]): Uint8Array => {
      const buf = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) buf.set(px, i * 4);
      return buf;
    };
    let rgba = fill([1, 2, 3, 255]);
    const engine: MockEngine = {
      // Exposure rides flat param index 4 (see recipeToParams / develop_buf ABI).
      camera_raw_develop: vi.fn((p: Float32Array) => {
        rgba = fill(p[4] !== 0 ? [9, 8, 7, 255] : [1, 2, 3, 255]);
      }),
      composite: vi.fn(),
      width: vi.fn(() => w),
      height: vi.fn(() => h),
      active_layer_rgba8: vi.fn(() => rgba),
      undo: vi.fn(),
      free: vi.fn(),
      proxy_engine: vi.fn((_x: number, _y: number, _w: number, _h: number, max: number) => {
        const scale = Math.min(1, max / Math.max(w, h));
        return makeEngine(Math.round(w * scale), Math.round(h * scale));
      }),
    };
    instances.push(engine);
    return engine;
  }
  return {
    instances,
    fromDims,
    makeEngine,
    fromImage: vi.fn(() => makeEngine(fromDims.w, fromDims.h)),
    fromRaw: vi.fn(() => makeEngine(fromDims.w, fromDims.h)),
    fromRgba16: vi.fn((w: number, h: number) => makeEngine(w, h)),
    isTauri: vi.fn(() => false),
    decodeRawPath: vi.fn(),
  };
});

vi.mock("@engine", () => ({
  default: vi.fn(async () => ({})),
  Engine: { fromImage: mocks.fromImage, fromRaw: mocks.fromRaw, fromRgba16: mocks.fromRgba16 },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("./rawDecode", () => ({
  RAW_PROXY_MAX_EDGE: 4096,
  decodeRawPath: mocks.decodeRawPath,
}));
// A warm Select Subject cache — previews must ignore it (it is session-only, so
// baking it into a cached preview would key two different images identically).
vi.mock("./lib/subjectMask", () => ({
  getSubjectCoverage: vi.fn(() => new Float32Array(320 * 320).fill(1)),
}));

import { decodeImage } from "./engine";

const adjusted = JSON.stringify({
  ...createDefaultRecipe(),
  basic: { ...createDefaultRecipe().basic, exposure: 1 },
});

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.fromDims.w = 1;
  mocks.fromDims.h = 1;
  mocks.fromImage.mockClear();
  mocks.fromRaw.mockClear();
  mocks.fromRgba16.mockClear();
  mocks.isTauri.mockReturnValue(false);
  mocks.decodeRawPath.mockReset();
});

describe("preview recipe execution", () => {
  it("applies the develop recipe before returning display bytes", async () => {
    const base = await decodeImage(new Uint8Array([1]), false);
    const developed = await decodeImage(new Uint8Array([1]), false, undefined, 256, adjusted);

    expect([...base.rgba]).toEqual([1, 2, 3, 255]);
    expect([...developed.rgba]).toEqual([9, 8, 7, 255]);
    // Source ≤ maxEdge → develops in place: exposure at index 4, proxyScale 1 at index 1.
    const params = mocks.instances[1].camera_raw_develop.mock.calls[0][0] as Float32Array;
    expect(params[4]).toBe(1);
    expect(params[1]).toBe(1);
  });

  it("develops on a bounded proxy when the source long edge exceeds maxEdge", async () => {
    // Deliberately small: the mock allocates a real w*h*4 buffer, and what is
    // under test is the proxy geometry + proxyScale arithmetic, not pixel
    // volume. Camera-sized dimensions here cost ~160 MB per run and made this
    // test flake past the 5s default timeout under a parallel root suite.
    mocks.fromDims.w = 800;
    mocks.fromDims.h = 400;
    await decodeImage(new Uint8Array([1]), true, "/photo.arw", 400, adjusted);

    // isTauri()=false → byte decoder: full engine (0) spawns a half-size proxy (1).
    expect(mocks.instances[0].proxy_engine).toHaveBeenCalledWith(0, 0, 800, 400, 400);
    expect(mocks.instances[0].free).toHaveBeenCalled();
    expect(mocks.instances[0].camera_raw_develop).not.toHaveBeenCalled();
    const params = mocks.instances[1].camera_raw_develop.mock.calls[0][0] as Float32Array;
    expect(params[1]).toBeCloseTo(0.5); // proxyScale = maxEdge 400 / long 800
  });

  it("decodes RAW via the byte decoder (Engine.fromRaw) when not on desktop", async () => {
    await decodeImage(new Uint8Array([1]), true, "/photo.arw", 0, adjusted);

    expect(mocks.fromRaw).toHaveBeenCalledTimes(1);
    expect(mocks.fromImage).not.toHaveBeenCalled();
    expect(mocks.fromRgba16).not.toHaveBeenCalled();
    expect(mocks.instances[0].camera_raw_develop).toHaveBeenCalled();
  });

  it("desktop RAW decodes natively (fromRgba16), carrying WB intent + provenance", async () => {
    mocks.isTauri.mockReturnValue(true);
    const pixels = new Uint16Array([0, 0, 0, 65535, 0, 0, 0, 65535]);
    mocks.decodeRawPath.mockResolvedValue({
      width: 2,
      height: 1,
      pixels,
      scaleNumerator: 1,
      scaleDenominator: 4,
      orientation: 1,
      provenance: { sourceDigest: "abc" },
    });

    const out = await decodeImage(new Uint8Array([1]), true, "/photo.arw", 256, adjusted);

    // Native decode receives the recipe's rawDecode intent + the clamped maxEdge.
    expect(mocks.decodeRawPath).toHaveBeenCalledWith("/photo.arw", 256, JSON.parse(adjusted).rawDecode);
    // Scene-linear RGBA16 fed to the engine (linear_srgb=true); no byte decoder.
    expect(mocks.fromRgba16).toHaveBeenCalledWith(2, 1, pixels, true);
    expect(mocks.fromRaw).not.toHaveBeenCalled();
    // proxyScale rides the native decode ratio (scaleNumerator/scaleDenominator).
    const params = mocks.instances[0].camera_raw_develop.mock.calls[0][0] as Float32Array;
    expect(params[1]).toBeCloseTo(0.25);
    // Provenance survives on the interactive result.
    expect(out.decodedRaw).toMatchObject({ scaleNumerator: 1, scaleDenominator: 4 });
  });
});

/** Recipe carrying one left→right gradient mask with a non-neutral exposure. */
function withGradientMask(): DevelopRecipeV2 {
  const recipe = createDefaultRecipe();
  const mask = newGradientMask("linearGradient", "m1", "Gradient 1");
  const base = mask.components[0];
  if (base.kind !== "linearGradient") throw new Error("newGradientMask lost its component kind");
  return {
    ...recipe,
    masks: {
      ...recipe.masks,
      masks: [{
        ...mask,
        components: [{ ...base, x1: 0, y1: 0.5, x2: 1, y2: 0.5 }],
        adjustments: { ...mask.adjustments, exposure: 1 },
      }],
    },
  };
}

describe("preview local masks", () => {
  beforeEach(() => {
    mocks.fromDims.w = 8;
    mocks.fromDims.h = 4;
  });

  it("composites a parametric mask into the thumbnail", async () => {
    const out = await decodeImage(new Uint8Array([1]), false, undefined, 0, JSON.stringify(withGradientMask()));

    // Base develop + one re-render with the mask's local sliders folded in.
    expect(mocks.instances[0].camera_raw_develop).toHaveBeenCalledTimes(2);
    expect(mocks.instances[0].camera_raw_develop.mock.calls[1][0][4]).toBe(1);
    // Coverage ramps 0 → 1 along the gradient axis, so the row walks from the
    // global render (R=1) to the masked one (R=9), monotonically.
    const px = (x: number) => out.rgba[x * 4];
    expect(px(0)).toBe(1);
    expect(px(7)).toBe(9);
    for (let x = 1; x < 8; x++) expect(px(x)).toBeGreaterThanOrEqual(px(x - 1));
  });

  it("ignores AI (Select Subject) masks so a cached preview stays deterministic", async () => {
    const recipe = createDefaultRecipe();
    const ai = newAiSubjectMask("m1", "Subject 1", "cache-1");
    const json = JSON.stringify({
      ...recipe,
      masks: { ...recipe.masks, masks: [{ ...ai, adjustments: { ...ai.adjustments, exposure: 1 } }] },
    });

    const out = await decodeImage(new Uint8Array([1]), false, undefined, 0, json);

    expect(mocks.instances[0].camera_raw_develop).toHaveBeenCalledTimes(1);
    expect([...out.rgba.slice(0, 4)]).toEqual([1, 2, 3, 255]);
  });

  it("keeps the maskless hot path at a single develop", async () => {
    await decodeImage(new Uint8Array([1]), false, undefined, 0, adjusted);

    expect(mocks.instances[0].camera_raw_develop).toHaveBeenCalledTimes(1);
  });
});
