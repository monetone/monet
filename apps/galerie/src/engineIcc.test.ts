// COLOR-02: a byte-decoded photo carrying a wider embedded profile must be
// converted to Galerie's sRGB working space at decode, or the Loupe/grid/export
// present Adobe RGB or Display P3 numbers as sRGB and the photo reads
// oversaturated. The conversion has to land on the engine that actually renders
// (the proxy), and a bad profile must degrade to the old behaviour, not throw.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockEngine {
  assign_profile: ReturnType<typeof vi.fn>;
  convert_profile_with_icc: ReturnType<typeof vi.fn>;
  proxy_engine: ReturnType<typeof vi.fn>;
  free: ReturnType<typeof vi.fn>;
  width: ReturnType<typeof vi.fn>;
  height: ReturnType<typeof vi.fn>;
  composite: ReturnType<typeof vi.fn>;
  active_layer_rgba8: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const instances: MockEngine[] = [];
  const dims = { w: 8, h: 8 };
  const convertThrows = { on: false };
  function makeEngine(w: number, h: number): MockEngine {
    const engine: MockEngine = {
      assign_profile: vi.fn(),
      convert_profile_with_icc: vi.fn(() => {
        if (convertThrows.on) throw new Error("ICC transform is unsupported");
      }),
      proxy_engine: vi.fn((_x, _y, _w, _h, max: number) => {
        const s = Math.min(1, max / Math.max(w, h));
        return makeEngine(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
      }),
      free: vi.fn(),
      width: vi.fn(() => w),
      height: vi.fn(() => h),
      composite: vi.fn(),
      active_layer_rgba8: vi.fn(() => new Uint8Array(w * h * 4)),
      undo: vi.fn(),
    };
    instances.push(engine);
    return engine;
  }
  return {
    instances,
    dims,
    convertThrows,
    fromImage: vi.fn(() => makeEngine(dims.w, dims.h)),
    fromRaw: vi.fn(() => makeEngine(dims.w, dims.h)),
    fromRgba16: vi.fn((w: number, h: number) => makeEngine(w, h)),
  };
});

vi.mock("@engine", () => ({
  default: vi.fn(async () => ({})),
  Engine: { fromImage: mocks.fromImage, fromRaw: mocks.fromRaw, fromRgba16: mocks.fromRgba16 },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("./rawDecode", () => ({ RAW_PROXY_MAX_EDGE: 4096, decodeRawPath: vi.fn() }));

import { decodeImage } from "./engine";

/** A minimal JPEG whose APP2 segment carries an ICC_PROFILE marker naming `name`
 *  — the shape `detectEmbeddedRgbProfile` matches on. */
function taggedJpeg(name: string): Uint8Array {
  const payload = [...new TextEncoder().encode(`ICC_PROFILE\0\0\0${name}`)];
  const length = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe2, (length >> 8) & 0xff, length & 0xff, ...payload, // APP2
    0xff, 0xda, // SOS — stop scanning
  ]);
}

/** PNG with an sRGB chunk: already the working space, nothing to convert. */
function srgbPng(): Uint8Array {
  const type = [...new TextEncoder().encode("sRGB")];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 1, ...type, 0, 0, 0, 0, 0,
  ]);
}

const ADOBE_RGB = 2;
const DISPLAY_P3 = 1;
const SRGB = 0;
const RELATIVE_COLORIMETRIC = 1;

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.convertThrows.on = false;
  mocks.dims.w = 8;
  mocks.dims.h = 8;
  vi.clearAllMocks();
});

describe("embedded-profile normalization at decode", () => {
  it("converts an Adobe RGB source to sRGB", async () => {
    await decodeImage(taggedJpeg("Adobe RGB (1998)"));
    const [engine] = mocks.instances;
    expect(engine.assign_profile).toHaveBeenCalledWith(ADOBE_RGB);
    expect(engine.convert_profile_with_icc).toHaveBeenCalledWith(
      ADOBE_RGB,
      new Uint8Array(0),
      SRGB,
      new Uint8Array(0),
      RELATIVE_COLORIMETRIC,
      false, // black-point compensation
      false, // dither
      "", // destination name (CMYK/Gray/Lab only)
    );
  });

  it("converts a Display P3 source to sRGB", async () => {
    await decodeImage(taggedJpeg("Display P3"));
    expect(mocks.instances[0].assign_profile).toHaveBeenCalledWith(DISPLAY_P3);
  });

  it("leaves sRGB and untagged sources alone", async () => {
    await decodeImage(srgbPng());
    await decodeImage(new Uint8Array([1, 2, 3, 4]));
    for (const engine of mocks.instances) {
      expect(engine.assign_profile).not.toHaveBeenCalled();
      expect(engine.convert_profile_with_icc).not.toHaveBeenCalled();
    }
  });

  it("converts the proxy engine that renders, not the discarded full-res one", async () => {
    mocks.dims.w = 64;
    mocks.dims.h = 64;
    await decodeImage(taggedJpeg("Adobe RGB (1998)"), false, undefined, 16);
    const [full, proxy] = mocks.instances;
    expect(full.free).toHaveBeenCalled();
    expect(full.convert_profile_with_icc).not.toHaveBeenCalled();
    expect(proxy.convert_profile_with_icc).toHaveBeenCalledTimes(1);
  });

  it("keeps the photo when the profile cannot be transformed", async () => {
    mocks.convertThrows.on = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const img = await decodeImage(taggedJpeg("Adobe RGB (1998)"));
    expect(img.width).toBe(8);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
