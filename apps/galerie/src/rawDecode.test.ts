import { describe, expect, it } from "vitest";

import { parseRawDecodeResponse } from "./rawDecode";

function response(overrides: Partial<{
  version: number;
  orientation: number;
  bitDepth: number;
  flags: number;
  width: number;
  nativeWidth: number;
  nativeHeight: number;
  samples: number[];
  metadata: Record<string, unknown>;
}> = {}): Uint8Array {
  const width = overrides.width ?? 2;
  const height = 1;
  const nativeWidth = overrides.nativeWidth ?? 4;
  const nativeHeight = overrides.nativeHeight ?? 2;
  const metadata = new TextEncoder().encode(JSON.stringify({
    nativeWidth,
    nativeHeight,
    sourceOrientation: overrides.orientation ?? 6,
    outputWidth: width,
    outputHeight: height,
    activeArea: [0, 0, nativeWidth, nativeHeight],
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
    ...overrides.metadata,
  }));
  const samples = overrides.samples ?? [1, 2, 3, 0xffff, 4, 5, 6, 0xffff];
  const bytes = new Uint8Array(40 + metadata.length + samples.length * 2);
  bytes.set([0x4d, 0x47, 0x52, 0x57]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, overrides.version ?? 3, true);
  view.setUint16(6, 40, true);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  view.setUint32(16, nativeWidth, true);
  view.setUint32(20, nativeHeight, true);
  bytes[24] = overrides.orientation ?? 6;
  bytes[25] = overrides.bitDepth ?? 16;
  view.setUint16(26, overrides.flags ?? 7, true);
  view.setUint32(28, metadata.length, true);
  view.setBigUint64(32, BigInt(samples.length), true);
  bytes.set(metadata, 40);
  samples.forEach((sample, index) => view.setUint16(40 + metadata.length + index * 2, sample, true));
  return bytes;
}

describe("native RAW response", () => {
  it("parses checked provenance and packed RGBA16 samples", () => {
    const decoded = parseRawDecodeResponse(response());
    expect(decoded).toMatchObject({
      width: 2,
      height: 1,
      nativeWidth: 4,
      nativeHeight: 2,
      orientation: 6,
      bitDepth: 16,
      sceneLinear: true,
      orientationApplied: true,
      decoderVersion: "decoder-9",
      colorSpace: "extended-linear-srgb",
      range: "full",
      alpha: "opaque",
      scaleNumerator: 1,
      scaleDenominator: 2,
      activeArea: [0, 0, 4, 2],
    });
    expect([...decoded.pixels]).toEqual([1, 2, 3, 0xffff, 4, 5, 6, 0xffff]);
    expect(
      parseRawDecodeResponse(response({
        orientation: 1,
        flags: 5,
        metadata: { sourceOrientation: 1, orientationApplied: false },
      })).orientationApplied,
    ).toBe(false);
  });

  it("rejects protocol drift, malformed lengths, and non-opaque RAW alpha", () => {
    expect(() => parseRawDecodeResponse(response({ version: 2 }))).toThrow(/protocol 2/);
    expect(() => parseRawDecodeResponse(response({ orientation: 0 }))).toThrow(/metadata/);
    expect(() =>
      parseRawDecodeResponse(response({ metadata: { orientationApplied: false } })),
    ).toThrow(/mismatched provenance/);
    expect(() => parseRawDecodeResponse(response({ bitDepth: 8 }))).toThrow(/metadata/);
    expect(() => parseRawDecodeResponse(response({ width: 3 }))).toThrow(/metadata/);
    expect(() =>
      parseRawDecodeResponse(response({ samples: [1, 2, 3, 0, 4, 5, 6, 0xffff] })),
    ).toThrow(/non-opaque/);
    expect(() =>
      parseRawDecodeResponse(response({ metadata: { sampleFormat: "float16" } })),
    ).toThrow(/provenance/);
    expect(() => parseRawDecodeResponse(response({ flags: 15 }))).toThrow(/metadata/);
    expect(() => parseRawDecodeResponse(response({ nativeWidth: 12_001, nativeHeight: 10_000 })))
      .toThrow(/metadata/);
    expect(() => parseRawDecodeResponse(response({ metadata: { unexpected: true } })))
      .toThrow(/provenance/);
    for (const field of ["decoderBackend", "backendRevision", "decoderVersion", "osBuild"]) {
      expect(() => parseRawDecodeResponse(response({ metadata: { [field]: "" } })))
        .toThrow(/provenance/);
      expect(() => parseRawDecodeResponse(response({ metadata: { [field]: "x".repeat(1025) } })))
        .toThrow(/provenance/);
    }
    for (const [field, value] of Object.entries({
      colorSpace: "srgb",
      sampleFormat: "float16",
      channelOrder: "bgra",
      colorModel: "device-rgb",
      transfer: "srgb",
      range: "limited",
      alpha: "straight",
      baseRendering: "generic",
      whiteBalanceMode: "auto",
    })) {
      expect(() => parseRawDecodeResponse(response({ metadata: { [field]: value } })))
        .toThrow(/provenance/);
    }
    expect(() =>
      parseRawDecodeResponse(response({ metadata: { scaleNumerator: 2, scaleDenominator: 4 } })),
    ).toThrow(/mismatched provenance/);
    expect(() =>
      parseRawDecodeResponse(response({ metadata: { activeArea: [0, 0, 5, 2] } })),
    ).toThrow(/mismatched provenance/);
    expect(() =>
      parseRawDecodeResponse(response({
        orientation: 1,
        flags: 7,
        metadata: { sourceOrientation: 1, orientationApplied: true },
      })),
    ).toThrow(/mismatched provenance/);
    expect(() =>
      parseRawDecodeResponse(response({
        orientation: 6,
        flags: 5,
        metadata: { orientationApplied: false },
      })),
    ).toThrow(/mismatched provenance/);
  });
});
