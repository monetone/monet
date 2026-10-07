// Camera Raw cache (PERF-12): re-entering Develop on a photo must not re-run
// the native demosaic. Everything here rides the real decode bridge with only
// the Tauri IPC mocked, so the cache is proven over genuine packed responses.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn<(...args: unknown[]) => Promise<ArrayBuffer>>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import {
  decodeRawPathCached,
  purgeRawCache,
  rawCacheStats,
  setRawCacheLimitBytes,
} from "./rawDecode";

/** A minimal valid MGRW v3 response: 2×1 output from a 4×2 sensor, 16 bytes of
 *  RGBA16. `tag` rides the first sample so a frame is identifiable. */
function response(tag: number): ArrayBuffer {
  const metadata = new TextEncoder().encode(JSON.stringify({
    nativeWidth: 4,
    nativeHeight: 2,
    sourceOrientation: 6,
    outputWidth: 2,
    outputHeight: 1,
    activeArea: [0, 0, 4, 2],
    outputOrientation: 1,
    orientationApplied: true,
    decoderBackend: "macos-core-image",
    backendRevision: "2",
    decoderVersion: "decoder-9",
    osBuild: "macOS 26.4 (25E246)",
    colorSpace: "extended-linear-srgb",
    sampleFormat: "uint16",
    channelOrder: "rgba",
    colorModel: "profiled-scene-linear-reference-rgb",
    transfer: "linear",
    range: "full",
    alpha: "opaque",
    baseRendering: "core-image-camera-profile",
    whiteBalanceMode: "asShot",
    neutralTemperature: 5200,
    neutralTint: 0,
    scaleNumerator: 1,
    scaleDenominator: 2,
    provenanceDigest: "44".repeat(32),
    sourceDigest: "11".repeat(32),
    workingProfileDigest: "22".repeat(32),
    decodeIntentDigest: "33".repeat(32),
  }));
  const samples = [tag, 2, 3, 0xffff, 4, 5, 6, 0xffff];
  const bytes = new Uint8Array(40 + metadata.length + samples.length * 2);
  bytes.set([0x4d, 0x47, 0x52, 0x57]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 3, true);
  view.setUint16(6, 40, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, 2, true);
  bytes[24] = 6;
  bytes[25] = 16;
  view.setUint16(26, 7, true);
  view.setUint32(28, metadata.length, true);
  view.setBigUint64(32, BigInt(samples.length), true);
  bytes.set(metadata, 40);
  samples.forEach((s, i) => view.setUint16(40 + metadata.length + i * 2, s, true));
  return bytes.buffer;
}

/** Byte size of one cached frame (8 samples × 2 bytes). */
const FRAME_BYTES = 16;

beforeEach(() => {
  invoke.mockReset();
  purgeRawCache();
  setRawCacheLimitBytes(512 * 1024 * 1024);
});

describe("camera raw cache", () => {
  it("decodes once per (path, edge, intent) and hands out equal pixels", async () => {
    invoke.mockResolvedValue(response(1));

    const first = await decodeRawPathCached("/a.arw", 1024);
    const second = await decodeRawPathCached("/a.arw", 1024);

    expect(invoke).toHaveBeenCalledTimes(1); // the re-entry is free
    expect([...second.pixels]).toEqual([...first.pixels]);
    expect(second).toMatchObject({ width: 2, height: 1, sourceDigest: "11".repeat(32) });
    expect(rawCacheStats()).toMatchObject({ frames: 1, bytes: FRAME_BYTES });
  });

  it("gives every hand-out its own buffer (the worker path transfers it)", async () => {
    invoke.mockResolvedValue(response(7));

    const first = await decodeRawPathCached("/a.arw", 1024);
    expect(first.pixels.buffer.byteLength).toBe(FRAME_BYTES); // detachable on its own
    first.pixels[0] = 999; // stand-in for a transfer/overwrite by the consumer

    const second = await decodeRawPathCached("/a.arw", 1024);
    expect(second.pixels).not.toBe(first.pixels);
    expect(second.pixels[0]).toBe(7);
  });

  it("keys on edge, decode intent and path", async () => {
    invoke.mockResolvedValue(response(1));

    await decodeRawPathCached("/a.arw", 1024);
    await decodeRawPathCached("/a.arw", 512); // draft tier — its own frame
    await decodeRawPathCached("/a.arw", 1024, { mode: "asShot" }); // the default → hit
    await decodeRawPathCached("/a.arw", 1024, {
      mode: "neutralChromaticity",
      x: 0.31,
      y: 0.33,
      derivationDigest: "abc",
    });
    await decodeRawPathCached("/b.arw", 1024);

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(rawCacheStats().frames).toBe(4);
  });

  it("evicts least-recently-used frames over the byte budget", async () => {
    invoke.mockResolvedValue(response(1));
    setRawCacheLimitBytes(FRAME_BYTES * 2);

    await decodeRawPathCached("/a.arw", 1024);
    await decodeRawPathCached("/b.arw", 1024);
    await decodeRawPathCached("/a.arw", 1024); // hit → A is now the newest
    await decodeRawPathCached("/c.arw", 1024); // over budget → B goes
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(rawCacheStats()).toMatchObject({ frames: 2, bytes: FRAME_BYTES * 2 });

    await decodeRawPathCached("/a.arw", 1024); // still cached
    expect(invoke).toHaveBeenCalledTimes(3);
    await decodeRawPathCached("/b.arw", 1024); // evicted → re-decoded
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("purges on demand and honours a shrunken budget", async () => {
    invoke.mockResolvedValue(response(1));

    await decodeRawPathCached("/a.arw", 1024);
    await decodeRawPathCached("/b.arw", 1024);
    setRawCacheLimitBytes(FRAME_BYTES);
    expect(rawCacheStats()).toMatchObject({ frames: 1, bytes: FRAME_BYTES, limitBytes: 16 });

    purgeRawCache();
    expect(rawCacheStats()).toMatchObject({ frames: 0, bytes: 0 });
    await decodeRawPathCached("/b.arw", 1024);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("never caches a frame larger than the whole budget", async () => {
    invoke.mockResolvedValue(response(1));
    setRawCacheLimitBytes(FRAME_BYTES - 1);

    const one = await decodeRawPathCached("/a.arw", 1024);
    await decodeRawPathCached("/a.arw", 1024);

    expect([...one.pixels]).toEqual([1, 2, 3, 0xffff, 4, 5, 6, 0xffff]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(rawCacheStats()).toMatchObject({ frames: 0, bytes: 0 });
  });
});
