// Typed bridge to Galerie's bounded native camera-RAW RGBA16 decoder.

import type { RawDecodeIntent } from "@monet-ui/monet-photo";
import { invoke, isTauri } from "@tauri-apps/api/core";

const MAGIC = [0x4d, 0x47, 0x52, 0x57]; // "MGRW"
const PROTOCOL_VERSION = 3;
const FIXED_HEADER_LENGTH = 40;
const RAW_MAX_PIXELS = 120_000_000;
export const RAW_PROXY_MAX_EDGE = 4096;

export interface RawFrameMetadata {
  nativeWidth: number;
  nativeHeight: number;
  sourceOrientation: number;
  outputWidth: number;
  outputHeight: number;
  /** `[x, y, width, height]` in Core Image's un-oriented native source coordinates. */
  activeArea: [number, number, number, number];
  outputOrientation: 1;
  orientationApplied: boolean;
  decoderBackend: string;
  backendRevision: string;
  decoderVersion: string;
  osBuild: string;
  colorSpace: string;
  sampleFormat: "uint16";
  channelOrder: "rgba";
  colorModel: "profiled-scene-linear-reference-rgb";
  transfer: "linear";
  range: "full";
  alpha: "opaque";
  baseRendering: "core-image-camera-profile";
  whiteBalanceMode: RawDecodeIntent["mode"];
  neutralTemperature: number;
  neutralTint: number;
  scaleNumerator: number;
  scaleDenominator: number;
  provenanceDigest: string;
  sourceDigest: string;
  workingProfileDigest: string;
  decodeIntentDigest: string;
}

export interface NativeRawImage extends RawFrameMetadata {
  width: number;
  height: number;
  orientation: number;
  bitDepth: 16;
  sceneLinear: true;
  littleEndian: true;
  pixels: Uint16Array;
  provenance: {
    sourceDigest: string;
    backend: string;
    backendRevision: string;
    decoderVersion: string;
    activeArea: [number, number, number, number];
    workingProfileDigest: string;
    decodeIntentDigest: string;
    alphaMode: "opaque";
  };
}

export interface RawDecoderCapabilities {
  available: boolean;
  backend: string;
  backendRevision: string;
  osBuild: string;
  outputColorSpace: string;
  outputBitDepth: number;
  proxyMaxEdge: number;
  supportedCameraModels: string[];
  note: string;
}

export interface RawProbe {
  decoderBackend: string;
  backendRevision: string;
  decoderVersion: string;
  osBuild: string;
  nativeWidth: number;
  nativeHeight: number;
  activeArea: [number, number, number, number];
  sourceOrientation: number;
  outputOrientation: 1;
  orientationApplied: boolean;
  workingProfileDigest: string;
  outputWidth: number;
  outputHeight: number;
  scaleNumerator: number;
  scaleDenominator: number;
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
}

const RAW_METADATA_KEYS = [
  "activeArea",
  "alpha",
  "backendRevision",
  "baseRendering",
  "channelOrder",
  "colorModel",
  "colorSpace",
  "decodeIntentDigest",
  "decoderBackend",
  "decoderVersion",
  "nativeHeight",
  "nativeWidth",
  "neutralTemperature",
  "neutralTint",
  "orientationApplied",
  "osBuild",
  "outputHeight",
  "outputOrientation",
  "outputWidth",
  "provenanceDigest",
  "range",
  "sampleFormat",
  "scaleDenominator",
  "scaleNumerator",
  "sourceDigest",
  "sourceOrientation",
  "transfer",
  "whiteBalanceMode",
  "workingProfileDigest",
];

function checkedMetadata(value: unknown): RawFrameMetadata {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(RAW_METADATA_KEYS)
  ) {
    throw new Error("native RAW decoder returned invalid provenance metadata");
  }
  const m = value as RawFrameMetadata;
  if (
    !m ||
    !Number.isInteger(m.nativeWidth) ||
    m.nativeWidth <= 0 ||
    !Number.isInteger(m.nativeHeight) ||
    m.nativeHeight <= 0 ||
    !Number.isInteger(m.sourceOrientation) ||
    m.sourceOrientation < 1 ||
    m.sourceOrientation > 8 ||
    !Number.isInteger(m.outputWidth) ||
    m.outputWidth <= 0 ||
    !Number.isInteger(m.outputHeight) ||
    m.outputHeight <= 0 ||
    !Array.isArray(m.activeArea) ||
    m.activeArea.length !== 4 ||
    m.activeArea.some((part) => !Number.isInteger(part) || part < 0) ||
    m.activeArea[2] === 0 ||
    m.activeArea[3] === 0 ||
    m.outputOrientation !== 1 ||
    !Number.isInteger(m.scaleNumerator) ||
    m.scaleNumerator <= 0 ||
    !Number.isInteger(m.scaleDenominator) ||
    m.scaleDenominator <= 0 ||
    !boundedText(m.decoderBackend) ||
    !boundedText(m.backendRevision) ||
    !boundedText(m.decoderVersion) ||
    !boundedText(m.osBuild) ||
    m.colorSpace !== "extended-linear-srgb" ||
    m.sampleFormat !== "uint16" ||
    m.channelOrder !== "rgba" ||
    m.colorModel !== "profiled-scene-linear-reference-rgb" ||
    m.transfer !== "linear" ||
    m.range !== "full" ||
    m.alpha !== "opaque" ||
    m.baseRendering !== "core-image-camera-profile" ||
    !["asShot", "neutralChromaticity"].includes(m.whiteBalanceMode) ||
    !Number.isFinite(m.neutralTemperature) ||
    !Number.isFinite(m.neutralTint) ||
    !/^[0-9a-f]{64}$/i.test(m.provenanceDigest) ||
    !/^[0-9a-f]{64}$/i.test(m.sourceDigest) ||
    !/^[0-9a-f]{64}$/i.test(m.workingProfileDigest) ||
    !/^[0-9a-f]{64}$/i.test(m.decodeIntentDigest)
  ) {
    throw new Error("native RAW decoder returned invalid provenance metadata");
  }
  return m;
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function parseRawDecodeResponse(packed: Uint8Array): NativeRawImage {
  if (packed.byteLength < FIXED_HEADER_LENGTH) {
    throw new Error("native RAW decoder returned a short response");
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (packed[i] !== MAGIC[i]) throw new Error("native RAW decoder returned invalid magic");
  }

  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const version = view.getUint16(4, true);
  const headerLength = view.getUint16(6, true);
  if (version !== PROTOCOL_VERSION) throw new Error(`unsupported native RAW protocol ${version}`);
  if (headerLength !== FIXED_HEADER_LENGTH) {
    throw new Error("native RAW decoder returned an invalid header length");
  }

  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const nativeWidth = view.getUint32(16, true);
  const nativeHeight = view.getUint32(20, true);
  const orientation = packed[24];
  const bitDepth = packed[25];
  const flags = view.getUint16(26, true);
  const metadataLength = view.getUint32(28, true);
  const sampleCount = Number(view.getBigUint64(32, true));
  const expectedSamples = width * height * 4;
  const samplesStart = headerLength + metadataLength;
  const expectedLength = samplesStart + sampleCount * 2;
  if (
    width === 0 ||
    height === 0 ||
    width > RAW_PROXY_MAX_EDGE ||
    height > RAW_PROXY_MAX_EDGE ||
    nativeWidth === 0 ||
    nativeHeight === 0 ||
    nativeWidth * nativeHeight > RAW_MAX_PIXELS ||
    orientation < 1 ||
    orientation > 8 ||
    bitDepth !== 16 ||
    (flags !== 5 && flags !== 7) ||
    sampleCount !== expectedSamples ||
    !Number.isSafeInteger(expectedLength) ||
    expectedLength !== packed.byteLength
  ) {
    throw new Error("native RAW decoder returned invalid image metadata");
  }

  const metadata = checkedMetadata(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed.subarray(headerLength, samplesStart))),
  );
  if (
    metadata.nativeWidth !== nativeWidth ||
    metadata.nativeHeight !== nativeHeight ||
    metadata.sourceOrientation !== orientation ||
    metadata.outputWidth !== width ||
    metadata.outputHeight !== height ||
    metadata.activeArea[0] + metadata.activeArea[2] > nativeWidth ||
    metadata.activeArea[1] + metadata.activeArea[3] > nativeHeight ||
    metadata.orientationApplied !== ((flags & 2) !== 0) ||
    metadata.orientationApplied !== (orientation !== 1) ||
    gcd(metadata.scaleNumerator, metadata.scaleDenominator) !== 1 ||
    metadata.scaleNumerator * Math.max(nativeWidth, nativeHeight) !==
      metadata.scaleDenominator * Math.max(width, height)
  ) {
    throw new Error("native RAW decoder returned mismatched provenance metadata");
  }

  const pixels = new Uint16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) pixels[i] = view.getUint16(samplesStart + i * 2, true);
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0xffff) throw new Error("native RAW decoder returned non-opaque alpha");
  }
  const provenance = {
    sourceDigest: metadata.sourceDigest,
    backend: metadata.decoderBackend,
    backendRevision: metadata.backendRevision,
    decoderVersion: metadata.decoderVersion,
    activeArea: metadata.activeArea,
    workingProfileDigest: metadata.workingProfileDigest,
    decodeIntentDigest: metadata.decodeIntentDigest,
    alphaMode: "opaque" as const,
  };

  return {
    ...metadata,
    width,
    height,
    nativeWidth,
    nativeHeight,
    orientation,
    bitDepth,
    sceneLinear: true,
    orientationApplied: (flags & 2) !== 0,
    littleEndian: true,
    pixels,
    provenance,
  };
}

/** Decode one RAW source path into a bounded native RGBA16 proxy. */
export async function decodeRawPath(
  path: string,
  maxEdge: number,
  intent: RawDecodeIntent = { mode: "asShot" },
): Promise<NativeRawImage> {
  if (!isTauri()) throw new Error("native camera-RAW decode requires the Galerie desktop app");
  if (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > RAW_PROXY_MAX_EDGE) {
    throw new Error(`RAW max edge must be between 1 and ${RAW_PROXY_MAX_EDGE}`);
  }
  const intentBytes = new TextEncoder().encode(JSON.stringify(intent));
  const pathBytes = new TextEncoder().encode(path);
  const request = new Uint8Array(8 + intentBytes.byteLength + pathBytes.byteLength);
  const view = new DataView(request.buffer);
  view.setUint32(0, maxEdge, true);
  view.setUint32(4, intentBytes.byteLength, true);
  request.set(intentBytes, 8);
  request.set(pathBytes, 8 + intentBytes.byteLength);
  const packed = new Uint8Array(
    await invoke<ArrayBuffer>("plugin:raw-decode|decode_raw_rgba16", request),
  );
  return parseRawDecodeResponse(packed);
}

// ── Camera Raw cache (PERF-12) ──────────────────────────────────────────────
// Re-entering Develop on a photo used to re-run the whole native demosaic;
// Lightroom keeps a Camera Raw cache of partially-processed RAW data so the
// return trip is near-instant. Same idea here, one tier up: the decoded RGBA16
// proxy itself, memoized in memory under a byte budget with LRU eviction.
// Only the Develop/export session routes cache (see engine.ts) — thumbnail and
// import decodes are one-shot and would just evict the frames Develop wants.
//
// ponytail: two ceilings. (1) In-memory and process-lifetime only, where LR's
// is a sizeable on-disk store that survives restarts — a disk tier belongs
// beside the preview store in src-tauri/src/catalog.rs. (2) Keyed by
// path+edge+intent, not by content, so a RAW replaced in place under the same
// path serves stale pixels until a purge; fold in mtime (probe_image_metadata
// already returns it) if in-place replacement ever becomes real.

/** Bounded so a big catalog cannot balloon the webview: ~5 full 4096px frames.
 *  Lightroom's equivalent knob lives in Preferences > Performance (PERF-03). */
const DEFAULT_RAW_CACHE_BYTES = 512 * 1024 * 1024;

let rawCacheLimit = DEFAULT_RAW_CACHE_BYTES;
let rawCacheBytes = 0;
/** Insertion order = LRU order; a hit re-inserts to move itself to the end. */
const rawCache = new Map<string, NativeRawImage>();

function evictRawCache(): void {
  for (const [key, frame] of rawCache) {
    if (rawCacheBytes <= rawCacheLimit) break;
    rawCache.delete(key);
    rawCacheBytes -= frame.pixels.byteLength;
  }
}

/** Every hand-out owns its pixels: the develop worker path *transfers* the
 *  buffer (which detaches it), and a copy of an already-decoded frame is orders
 *  of magnitude cheaper than the demosaic it replaces. */
const withOwnPixels = (frame: NativeRawImage): NativeRawImage => ({
  ...frame,
  pixels: frame.pixels.slice(),
});

/** `decodeRawPath` through the Camera Raw cache — same result, decoded once
 *  per (path, maxEdge, decode intent) for as long as it survives eviction. */
export async function decodeRawPathCached(
  path: string,
  maxEdge: number,
  intent: RawDecodeIntent = { mode: "asShot" },
): Promise<NativeRawImage> {
  const key = `${maxEdge}\u0000${JSON.stringify(intent)}\u0000${path}`;
  const hit = rawCache.get(key);
  if (hit) {
    rawCache.delete(key);
    rawCache.set(key, hit); // most recently used
    return withOwnPixels(hit);
  }
  const frame = await decodeRawPath(path, maxEdge, intent);
  // A frame bigger than the whole budget would evict everything to store itself.
  if (frame.pixels.byteLength <= rawCacheLimit) {
    rawCache.set(key, frame);
    rawCacheBytes += frame.pixels.byteLength;
    evictRawCache();
  }
  return withOwnPixels(frame);
}

/** Preferences > Performance > Purge Cache (the button lands with PERF-03). */
export function purgeRawCache(): void {
  rawCache.clear();
  rawCacheBytes = 0;
}

/** Resize the budget; over-budget frames are evicted immediately. */
export function setRawCacheLimitBytes(bytes: number): void {
  rawCacheLimit = Math.max(0, Math.floor(bytes));
  evictRawCache();
}

/** What a Preferences panel shows next to Purge Cache. */
export function rawCacheStats(): { frames: number; bytes: number; limitBytes: number } {
  return { frames: rawCache.size, bytes: rawCacheBytes, limitBytes: rawCacheLimit };
}

export function getRawDecoderCapabilities(): Promise<RawDecoderCapabilities> {
  return invoke<RawDecoderCapabilities>("plugin:raw-decode|raw_decoder_capabilities");
}

export function probeRawPath(
  path: string,
  maxEdge: number,
  intent: RawDecodeIntent = { mode: "asShot" },
): Promise<RawProbe> {
  return invoke<RawProbe>("plugin:raw-decode|probe_raw", { path, maxEdge, intent });
}

/** Source-file metadata probed natively at import. `available` is true when
 *  the platform EXIF reader ran (macOS ImageIO); `mtime` is filled on every
 *  platform. Absent fields are normal — files without EXIF import fine. */
export interface ImageMetadataProbe {
  available: boolean;
  /** Source file mtime, unix seconds. */
  mtime: number | null;
  /** Capture time, unix seconds (EXIF wall time interpreted as UTC). */
  captureTime: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
  /** Shutter speed in seconds. */
  exposureTime: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
}

export function probeImageMetadata(path: string): Promise<ImageMetadataProbe> {
  return invoke<ImageMetadataProbe>("plugin:raw-decode|probe_image_metadata", { path });
}

export function rawFrameMetadata(raw: Omit<NativeRawImage, "pixels">): RawFrameMetadata {
  const {
    nativeWidth,
    nativeHeight,
    sourceOrientation,
    outputWidth,
    outputHeight,
    activeArea,
    outputOrientation,
    orientationApplied,
    decoderBackend,
    backendRevision,
    decoderVersion,
    osBuild,
    colorSpace,
    sampleFormat,
    channelOrder,
    colorModel,
    transfer,
    range,
    alpha,
    baseRendering,
    whiteBalanceMode,
    neutralTemperature,
    neutralTint,
    scaleNumerator,
    scaleDenominator,
    provenanceDigest,
    sourceDigest,
    workingProfileDigest,
    decodeIntentDigest,
  } = raw;
  return {
    nativeWidth,
    nativeHeight,
    sourceOrientation,
    outputWidth,
    outputHeight,
    activeArea,
    outputOrientation,
    orientationApplied,
    decoderBackend,
    backendRevision,
    decoderVersion,
    osBuild,
    colorSpace,
    sampleFormat,
    channelOrder,
    colorModel,
    transfer,
    range,
    alpha,
    baseRendering,
    whiteBalanceMode,
    neutralTemperature,
    neutralTint,
    scaleNumerator,
    scaleDenominator,
    provenanceDigest,
    sourceDigest,
    workingProfileDigest,
    decodeIntentDigest,
  };
}
