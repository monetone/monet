// The wasm init memo must not cache a FAILED init (#148): a transient fetch or
// instantiate error would otherwise kill AVIF opening for the whole session.
// The real decode is exercised in e2e/avif-import.spec against @jsquash.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { initMock, decodeMock } = vi.hoisted(() => ({ initMock: vi.fn(), decodeMock: vi.fn() }));
vi.mock("@jsquash/avif/decode", () => ({ default: decodeMock, init: initMock }));
vi.mock("@jsquash/avif/codec/dec/avif_dec.wasm?url", () => ({ default: "avif_dec.wasm" }));

const img = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;

describe("decodeAvif wasm init", () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
    decodeMock.mockReset().mockResolvedValue(img);
  });

  it("initializes the decoder once across calls", async () => {
    initMock.mockResolvedValue(undefined);
    const { decodeAvif } = await import("./avifDecoder");
    await decodeAvif(new ArrayBuffer(8));
    await decodeAvif(new ArrayBuffer(8));
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it("retries init after a failed one instead of caching the rejection", async () => {
    initMock.mockRejectedValueOnce(new Error("wasm fetch failed")).mockResolvedValue(undefined);
    const { decodeAvif } = await import("./avifDecoder");
    await expect(decodeAvif(new ArrayBuffer(8))).rejects.toThrow("wasm fetch failed");
    await expect(decodeAvif(new ArrayBuffer(8))).resolves.toBe(img);
    expect(initMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the decoder produces no image", async () => {
    initMock.mockResolvedValue(undefined);
    decodeMock.mockResolvedValue(null);
    const { decodeAvif } = await import("./avifDecoder");
    await expect(decodeAvif(new ArrayBuffer(8))).rejects.toThrow("no image");
  });
});
