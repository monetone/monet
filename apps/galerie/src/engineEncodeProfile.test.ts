// GAL-OUT-01: a wide-gamut JPEG/PNG export must convert the developed sRGB
// pixels to the chosen profile through the engine and come back ICC-tagged —
// the engine's tagged encoders embed the document profile's ICC (or explicit
// custom bytes), so what this pins is the glue: 8→16 widening, the convert
// running before the encode, per-profile routing (built-in id vs ProPhoto's
// custom ICC bytes), quality mapping, and the engine being freed on every path.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // Variadic-unknown signatures so `mock.calls[0][n]` types as `unknown`
  // (castable) instead of an empty tuple tsc rejects — vitest runs either way,
  // but `pnpm typecheck` only accepts this form.
  const engine = {
    convert_profile_with_icc: vi.fn<(...args: unknown[]) => void>(),
    export_png_with_icc: vi.fn<(...args: unknown[]) => Uint8Array>(() => new Uint8Array([1, 2, 3])),
    export_scaled_jpeg_with_icc: vi.fn<(...args: unknown[]) => Uint8Array>(() => new Uint8Array([4, 5])),
    free: vi.fn(),
  };
  return { engine, fromRgba16: vi.fn<(...args: unknown[]) => typeof engine>(() => engine) };
});

vi.mock("@engine", () => ({
  default: vi.fn(async () => ({})),
  Engine: { fromRgba16: mocks.fromRgba16 },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("./rawDecode", () => ({ RAW_PROXY_MAX_EDGE: 4096, decodeRawPath: vi.fn() }));

import { encodeRgbaInProfile, prophotoIcc } from "./engine";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("encodeRgbaInProfile", () => {
  it("widens RGBA8 to 16-bit and converts sRGB → Display P3 before the PNG encode", async () => {
    const rgba = new Uint8Array([0, 128, 255, 255]);
    const out = await encodeRgbaInProfile(rgba, 1, 1, "displayP3", "png", 1);

    // v × 257 widening: 0xff must land exactly on 0xffff.
    expect(mocks.fromRgba16).toHaveBeenCalledWith(1, 1, expect.any(Uint16Array), false);
    const wide = mocks.fromRgba16.mock.calls[0][2] as Uint16Array;
    expect(Array.from(wide)).toEqual([0, 128 * 257, 65535, 65535]);

    // sRGB (0) → Display P3 (1), relative colorimetric, no BPC — and the
    // convert must precede the encode or the file tags P3 around sRGB numbers.
    const convert = mocks.engine.convert_profile_with_icc;
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert.mock.calls[0].slice(0, 1)).toEqual([0]);
    expect(convert.mock.calls[0][2]).toBe(1);
    expect(convert.mock.calls[0][4]).toBe(1);
    expect(convert.mock.calls[0][5]).toBe(false);
    expect(convert.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.engine.export_png_with_icc.mock.invocationCallOrder[0]);

    // Built-in destination: no custom ICC — the encoder self-tags from the
    // document profile (empty bytes = "use the working profile's ICC").
    expect((convert.mock.calls[0][3] as Uint8Array).length).toBe(0);
    expect((mocks.engine.export_png_with_icc.mock.calls[0][0] as Uint8Array).length).toBe(0);

    expect(out).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.engine.free).toHaveBeenCalledTimes(1);
  });

  it("routes Adobe RGB (1998) to engine built-in profile id 2", async () => {
    await encodeRgbaInProfile(new Uint8Array(4), 1, 1, "adobeRGB", "png", 1);
    const call = mocks.engine.convert_profile_with_icc.mock.calls[0];
    expect(call[2]).toBe(2);
    expect((call[3] as Uint8Array).length).toBe(0);
  });

  it("converts ProPhoto through its ICC bytes and hands the same bytes to the encoder", async () => {
    await encodeRgbaInProfile(new Uint8Array(4), 1, 1, "prophoto", "png", 1);

    // The ICC constant must be a plausible profile: 'acsp' signature at 36 and
    // a declared size matching the byte length (the engine validates both).
    const icc = prophotoIcc();
    expect(new TextDecoder().decode(icc.subarray(36, 40))).toBe("acsp");
    expect(new DataView(icc.buffer).getUint32(0)).toBe(icc.length);

    const call = mocks.engine.convert_profile_with_icc.mock.calls[0];
    expect(call[3]).toBe(icc);
    // The tagged encoder must embed the SAME bytes the pixels were converted
    // to, or the file lies about its colors.
    expect(mocks.engine.export_png_with_icc).toHaveBeenCalledWith(icc);
  });

  it("encodes JPEG unscaled with 0–1 quality mapped to the engine's 1–100", async () => {
    const out = await encodeRgbaInProfile(new Uint8Array(4), 1, 1, "displayP3", "jpeg", 0.9);
    expect(mocks.engine.export_scaled_jpeg_with_icc).toHaveBeenCalledWith(1, 90, expect.any(Uint8Array));
    expect(mocks.engine.export_png_with_icc).not.toHaveBeenCalled();
    expect(out).toEqual(new Uint8Array([4, 5]));
  });

  it("tags a ProPhoto JPEG with the ProPhoto ICC", async () => {
    await encodeRgbaInProfile(new Uint8Array(4), 1, 1, "prophoto", "jpeg", 0.8);
    expect(mocks.engine.export_scaled_jpeg_with_icc).toHaveBeenCalledWith(1, 80, prophotoIcc());
  });

  it("frees the engine even when the ICC conversion throws", async () => {
    mocks.engine.convert_profile_with_icc.mockImplementationOnce(() => {
      throw new Error("ICC transform is unsupported");
    });
    await expect(encodeRgbaInProfile(new Uint8Array(4), 1, 1, "displayP3", "png", 1))
      .rejects.toThrow("ICC transform is unsupported");
    expect(mocks.engine.export_png_with_icc).not.toHaveBeenCalled();
    expect(mocks.engine.free).toHaveBeenCalledTimes(1);
  });
});
