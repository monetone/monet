import { assertReadableFileSize } from "./boundedRead";
import { MAX_PROJECT_ENVELOPE_BYTES } from "./projectEnvelope";

const MIB = 1024 * 1024;

/**
 * Photoshop sources cross two allocation boundaries in the browser build: the
 * File API owns the source ArrayBuffer and wasm-bindgen copies it into WASM.
 * Keeping a single source at or below 256 MiB leaves room for both copies and
 * decoded document state inside browsers' finite WASM address space. PSB can
 * represent larger files, but Vision intentionally rejects those before read.
 */
export const MAX_PHOTOSHOP_SOURCE_BYTES = 256 * MIB;

/** Unknown/ordinary image opens use the same ceiling. A six-byte prefix sniff
 * applies the Photoshop cap even when a source is renamed to another format. */
export const MAX_OPEN_IMAGE_SOURCE_BYTES = MAX_PHOTOSHOP_SOURCE_BYTES;

/** `.mvis` is a zip container, not a browser image handoff. Its read cap is the
 *  same number the writer refuses to exceed, and it sits above the 256 MiB
 *  image-open cap so a layered document Vision just saved can be opened again. */
export const MAX_MVIS_SOURCE_BYTES = 1024 * MIB;

/** PSB is the large-document alternative the oversized-`.mvision` message
 *  points at, so its open cap has to be at least the project envelope's. */
export const MAX_PSB_SOURCE_BYTES = 1024 * MIB;

/** Placed images use the same conservative browser/WASM handoff budget. */
export const MAX_PLACED_IMAGE_SOURCE_BYTES = 256 * MIB;

/** A stack retains multiple sources until they have been imported. Bound the
 * complete selection, not only each individual file. */
export const MAX_IMAGE_STACK_SOURCE_BYTES = 256 * MIB;

export const PHOTOSHOP_RGB_COLOR_MODE = 3;

export type PhotoshopVersion = 1 | 2;
export type ImageReadPurpose = "open" | "place" | "stack";

export interface PhotoshopHeader {
  version: PhotoshopVersion;
  channels: number;
  height: number;
  width: number;
  depth: number;
  colorMode: number;
}

export interface ImageReadLimit {
  maxBytes: number;
  label: string;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

/** Sniff the format exactly as the Rust importer does: `8BPS` plus version 1
 * (PSD) or 2 (PSB). No extension or full-header validity is required here. */
export function photoshopVersion(bytes: Uint8Array): PhotoshopVersion | null {
  if (bytes.length < 6
    || bytes[0] !== 0x38
    || bytes[1] !== 0x42
    || bytes[2] !== 0x50
    || bytes[3] !== 0x53) return null;
  const version = readU16(bytes, 4);
  return version === 1 || version === 2 ? version : null;
}

/** Read only the fixed 26-byte Photoshop header. Structural validation remains
 * the importer's job; this metadata is used solely for app routing/policy. */
export function photoshopHeader(bytes: Uint8Array): PhotoshopHeader | null {
  const version = photoshopVersion(bytes);
  if (version === null || bytes.length < 26) return null;
  return {
    version,
    channels: readU16(bytes, 12),
    height: readU32(bytes, 14),
    width: readU32(bytes, 18),
    depth: readU16(bytes, 22),
    colorMode: readU16(bytes, 24),
  };
}

export function hasPhotoshopExtension(name: string): boolean {
  return /\.(psd|psb)$/i.test(name);
}

/** Signature takes precedence; the extension remains a compatibility fallback
 * so malformed named files still reach the importer and produce its error. */
export function shouldRouteAsPhotoshop(bytes: Uint8Array, name: string): boolean {
  return photoshopVersion(bytes) !== null || hasPhotoshopExtension(name);
}

/** RGB profile prompts/assignment are valid only for PSD mode 3 (RGB). */
export function usesPhotoshopRgbProfilePolicy(bytes: Uint8Array): boolean {
  return photoshopHeader(bytes)?.colorMode === PHOTOSHOP_RGB_COLOR_MODE;
}

/** One ceiling per save format, shared by open and write. A name wins only when
 *  the bytes are not a Photoshop signature — callers that already sniffed a
 *  PSD/PSB header should branch on that first. */
export function documentFormatReadLimit(name: string, signatureBytes?: Uint8Array): ImageReadLimit {
  if (/\.mvis$/i.test(name)) {
    return { maxBytes: MAX_MVIS_SOURCE_BYTES, label: "Monet Vision document" };
  }
  if (/\.mvision$/i.test(name)) {
    return { maxBytes: MAX_PROJECT_ENVELOPE_BYTES, label: "Monet Vision project" };
  }
  const header = signatureBytes ? photoshopHeader(signatureBytes) : null;
  if (header?.version === 2 || /\.psb$/i.test(name)) {
    return { maxBytes: MAX_PSB_SOURCE_BYTES, label: "Large Photoshop document" };
  }
  return imageReadLimit(name, "open", signatureBytes);
}

/** The sentence Save shows when the bytes it is about to write could not be
 *  opened again. Null when the payload fits the format's read limit. */
export function savePayloadTooLarge(ext: string, byteLength: number): string | null {
  const limit = documentFormatReadLimit(`file.${ext.toLowerCase()}`);
  if (byteLength <= limit.maxBytes) return null;
  const used = Math.max(1, Math.ceil(byteLength / MIB));
  const cap = Math.round(limit.maxBytes / MIB);
  const normalized = ext.toLowerCase();
  const alternative = normalized === "mvis" || normalized === "psb"
    ? ""
    : " Save as .mvis or PSB instead.";
  return `This document is too large to save as .${normalized} (${used} MiB; the limit is ${cap} MiB).${alternative}`;
}

/** Return the pre-read cap for a browser File or native path. A caller can pass
 * a bounded prefix so a renamed Photoshop source is identified before the full
 * source crosses the allocation boundary. */
export function imageReadLimit(
  name: string,
  purpose: ImageReadPurpose,
  signatureBytes?: Uint8Array,
): ImageReadLimit {
  if ((signatureBytes && photoshopVersion(signatureBytes) !== null) || hasPhotoshopExtension(name)) {
    return { maxBytes: MAX_PHOTOSHOP_SOURCE_BYTES, label: "Photoshop document" };
  }
  if (purpose === "place") {
    return { maxBytes: MAX_PLACED_IMAGE_SOURCE_BYTES, label: "Placed image" };
  }
  if (purpose === "stack") {
    return { maxBytes: MAX_IMAGE_STACK_SOURCE_BYTES, label: "Stack image" };
  }
  return { maxBytes: MAX_OPEN_IMAGE_SOURCE_BYTES, label: "Image document" };
}

/** Add one source to the retained stack budget, rejecting the selection before
 * that source is read when the aggregate would exceed the WASM-safe ceiling. */
export function nextImageStackReadTotal(retainedBytes: number, nextBytes: number): number {
  assertReadableFileSize(retainedBytes, MAX_IMAGE_STACK_SOURCE_BYTES, "Image stack");
  assertReadableFileSize(nextBytes, MAX_IMAGE_STACK_SOURCE_BYTES, "Stack image");
  const total = retainedBytes + nextBytes;
  assertReadableFileSize(total, MAX_IMAGE_STACK_SOURCE_BYTES, "Image stack");
  return total;
}
