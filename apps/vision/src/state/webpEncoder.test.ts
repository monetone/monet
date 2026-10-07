// The wasm init memo must not cache a FAILED init (#154): a transient fetch or
// instantiate error would otherwise kill WebP export for the whole session.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { initMock, encodeMock } = vi.hoisted(() => ({ initMock: vi.fn(), encodeMock: vi.fn() }));
vi.mock("@jsquash/webp/encode", () => ({ default: encodeMock, init: initMock }));
vi.mock("@jsquash/webp/codec/enc/webp_enc_simd.wasm?url", () => ({ default: "webp_enc_simd.wasm" }));
vi.mock("@jsquash/webp/codec/enc/webp_enc.wasm?url", () => ({ default: "webp_enc.wasm" }));

const img = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;

describe("encodeWebpLossy wasm init", () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
    encodeMock.mockReset().mockResolvedValue(new ArrayBuffer(4));
  });

  it("initializes the encoder once and passes the quality through", async () => {
    initMock.mockResolvedValue(undefined);
    const { encodeWebpLossy } = await import("./webpEncoder");
    await encodeWebpLossy(img, 80);
    await encodeWebpLossy(img, 60);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(encodeMock).toHaveBeenLastCalledWith(img, { quality: 60, lossless: 0 });
  });

  it("locates the SIMD build by name and the base build otherwise", async () => {
    initMock.mockResolvedValue(undefined);
    const { encodeWebpLossy } = await import("./webpEncoder");
    await encodeWebpLossy(img, 80);
    const locateFile = initMock.mock.calls[0][0].locateFile as (p: string) => string;
    expect(locateFile("webp_enc_simd.wasm")).toBe("webp_enc_simd.wasm");
    expect(locateFile("webp_enc.wasm")).toBe("webp_enc.wasm");
  });

  it("retries init after a failed one instead of caching the rejection", async () => {
    initMock.mockRejectedValueOnce(new Error("wasm fetch failed")).mockResolvedValue(undefined);
    const { encodeWebpLossy } = await import("./webpEncoder");
    await expect(encodeWebpLossy(img, 80)).rejects.toThrow("wasm fetch failed");
    await expect(encodeWebpLossy(img, 80)).resolves.toBeInstanceOf(ArrayBuffer);
    expect(initMock).toHaveBeenCalledTimes(2);
  });
});
