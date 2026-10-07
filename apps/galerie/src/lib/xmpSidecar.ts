// xmpSidecar — Save/Read Metadata to File: IPTC core fields + a crs: develop
// block, serialized as XMP. LR-style routing (`writeXmpFor`/`readXmpText`):
// the packet lives INSIDE the file for containers that hold one (JPEG/PNG via
// embedXmp) and in a `<stem>.xmp` sidecar for proprietary raw — a sidecar for
// a JPEG is metadata the rest of the world never looks for.
//
// The serializer and parser used to be hand-rolled here, in a dialect Vision
// couldn't read (and whose writes erased Vision's `mvcr:Payload` from the same
// `<stem>.xmp`). Both now delegate to `@monet-ui/monet-photo`'s `xmp` module —
// THE shared Camera Raw dialect — so what Galerie writes is exactly what Vision
// reads, and vice versa. This file is Galerie's call-shape adapter plus the
// Tauri fs edges.
//
// COURIER RULE: Vision owns the `mvcr:Payload` block. Galerie carries it —
// `readXmpFields` hands back `monetRaw` verbatim and `buildXmpSidecar` re-emits
// it byte-for-byte — but never interprets it.

import { readFile, readTextFile, rename, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

import {
  serializeCameraRawXmp,
  tryParseCameraRawXmp,
  xmpSidecarPath,
  type DevelopRecipeV2,
  type XmpPhotoMetadata,
  type XmpSnapshot,
} from "@monet-ui/monet-photo";

import type { PhotoMetadata } from "../catalog/types";
import { embedXmpJpeg, embedXmpPng, extractXmpJpeg, extractXmpPng, xpacket } from "./embedXmp";

/** IPTC/core fields serialized alongside the develop block. */
export interface XmpMetaFields {
  city?: string | null;
  stateProvince?: string | null;
  country?: string | null;
  jobTitle?: string | null;
  credit?: string | null;
  source?: string | null;
  /** 0..5 star rating (0 = unrated, omitted). */
  rating: number;
  /** Color label name (e.g. "Red"), or null. */
  label: string | null;
  title: string | null;
  caption: string | null;
  creator: string | null;
  copyright: string | null;
  /** Flat keyword names → dc:subject. */
  keywords: string[];
  /** Hierarchical keyword paths ("Parent|Child") → lr:hierarchicalSubject. */
  hierarchical: string[];
}

/**
 * Serialize a photo's metadata + develop recipe as a Lightroom/ACR-compatible
 * XMP sidecar. `recipeJson` may be null (no develop block written).
 *
 * `monetRaw` is Vision's payload as recovered from the sidecar being replaced —
 * pass it and the write is a lossless courier for Vision's block instead of
 * silently deleting the other app's develop settings.
 *
 * `snapshots` are named develop snapshots (LR's `crs:Snapshots`); each
 * `recipe` takes any stored shape, same as `recipeJson`.
 */
export function buildXmpSidecar(
  meta: XmpMetaFields,
  recipeJson: string | null,
  monetRaw: string | null = null,
  snapshots: { name: string; recipe?: unknown }[] = [],
): string {
  return serializeCameraRawXmp({
    recipe: recipeJson ? (JSON.parse(recipeJson) as unknown) : null,
    metadata: meta,
    monetRaw,
    snapshots,
  });
}

/** The sidecar path for a source: `<source-without-extension>.xmp` beside it. */
export { xmpSidecarPath as sidecarPath };

/** Write the XMP sidecar beside the source file; returns the written path. */
export async function writeXmpSidecar(sourcePath: string, xml: string): Promise<string> {
  const path = xmpSidecarPath(sourcePath);
  await writeTextFile(path, xml);
  return path;
}

// ─── Where a format's XMP lives ────────────────────────────────────────────

/** LR writes metadata INTO files that can hold a packet and only sidecars
 *  proprietary raw. `"sidecar"` is therefore the raw (and unsupported-container)
 *  case, not the default.
 *  ponytail: TIFF/PSD/DNG can carry a packet too, but need an IFD /
 *  image-resource writer we don't have — they take the sidecar until
 *  embedXmp grows one. */
export type XmpTarget = "jpeg" | "png" | "sidecar";

export function xmpTargetFor(sourcePath: string): XmpTarget {
  const dot = sourcePath.lastIndexOf(".");
  switch (dot >= 0 ? sourcePath.slice(dot + 1).toLowerCase() : "") {
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "png":
      return "png";
    default:
      return "sidecar";
  }
}

/** Save Metadata to File for one source: the packet goes INTO the file when the
 *  container carries one, else beside it as `<stem>.xmp`. Returns the path
 *  written (LR's Sidecar Files field: the source itself means "embedded") plus
 *  the exact text `readXmpText` will read back, so the metadata-status baseline
 *  digests the same string either way. */
export async function writeXmpFor(
  sourcePath: string,
  xml: string,
): Promise<{ path: string; onDisk: string }> {
  const target = xmpTargetFor(sourcePath);
  if (target === "sidecar") return { path: await writeXmpSidecar(sourcePath, xml), onDisk: xml };
  const bytes = await readFile(sourcePath);
  // Embed first: a throw here (not a JPEG, packet too big for one APP1) must
  // leave the master untouched rather than half-written.
  const out = target === "jpeg" ? embedXmpJpeg(bytes, xml) : embedXmpPng(bytes, xml);
  // Temp + rename: an interrupted write must never truncate the user's master.
  const tmp = `${sourcePath}.monet-tmp`;
  await writeFile(tmp, out);
  await rename(tmp, sourcePath);
  return { path: sourcePath, onDisk: xpacket(xml) };
}

/** The XMP text on disk for a source — the embedded packet for containers that
 *  carry one, else the sidecar. null when there is none or it's unreadable
 *  (best-effort: absence is never an error). */
export async function readXmpText(sourcePath: string): Promise<string | null> {
  const target = xmpTargetFor(sourcePath);
  try {
    if (target === "sidecar") return await readTextFile(xmpSidecarPath(sourcePath));
    const bytes = await readFile(sourcePath);
    return target === "jpeg" ? extractXmpJpeg(bytes) : extractXmpPng(bytes);
  } catch {
    return null;
  }
}

// ─── Read side (Read Metadata from File) ───────────────────────────────────

/** The metadata + develop settings recovered from an XMP sidecar. `recipe` is
 *  the ABI-backed develop patch, or null if the sidecar carries none. */
export interface XmpReadFields {
  rating: number | null;
  label: string | null;
  title: string | null;
  caption: string | null;
  creator: string | null;
  copyright: string | null;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  jobTitle: string | null;
  credit: string | null;
  source: string | null;
  keywords: string[];
  hierarchical: string[];
  recipe: Partial<DevelopRecipeV2> | null;
  /** Named develop snapshots recovered from `crs:Snapshots`, in document order. */
  snapshots: XmpSnapshot[];
  /** Vision's `mvcr:Payload` base64, verbatim — carried, never interpreted. */
  monetRaw: string | null;
}

const NO_FIELDS: XmpReadFields = {
  rating: null,
  label: null,
  title: null,
  caption: null,
  creator: null,
  copyright: null,
  city: null,
  stateProvince: null,
  country: null,
  jobTitle: null,
  credit: null,
  source: null,
  keywords: [],
  hierarchical: [],
  recipe: null,
  snapshots: [],
  monetRaw: null,
};

/** Parse an XMP sidecar's metadata + (ABI-backed) develop settings. Defensive:
 *  a file that isn't a usable Camera Raw XMP yields all-empty fields rather than
 *  throwing — for the sidecar probe, absence and garbage are both "nothing to
 *  apply". */
export function readXmpFields(xml: string): XmpReadFields {
  const doc = tryParseCameraRawXmp(xml);
  if (!doc) return { ...NO_FIELDS };
  const m = doc.metadata;
  return {
    rating: m.rating ?? null,
    label: m.label ?? null,
    title: m.title ?? null,
    caption: m.caption ?? null,
    creator: m.creator ?? null,
    copyright: m.copyright ?? null,
    city: m.city ?? null,
    stateProvince: m.stateProvince ?? null,
    country: m.country ?? null,
    jobTitle: m.jobTitle ?? null,
    credit: m.credit ?? null,
    source: m.source ?? null,
    keywords: m.keywords ?? [],
    hierarchical: m.hierarchical ?? [],
    recipe: doc.recipe,
    snapshots: doc.snapshots,
    monetRaw: doc.monetRaw,
  };
}

/** LR "Read Metadata from File" semantics: the sidecar's IPTC replaces the
 *  catalog's wholesale — a field the sidecar omits clears, same as the core
 *  title/caption/creator/copyright four. No pre-cluster-sidecar leniency
 *  (alpha: no backwards compatibility). */
export function sidecarMetadataPatch(m: XmpPhotoMetadata): PhotoMetadata {
  return {
    title: m.title ?? null,
    caption: m.caption ?? null,
    creator: m.creator ?? null,
    copyright: m.copyright ?? null,
    city: m.city ?? null,
    stateProvince: m.stateProvince ?? null,
    country: m.country ?? null,
    jobTitle: m.jobTitle ?? null,
    credit: m.credit ?? null,
    source: m.source ?? null,
  };
}

/** Read + parse a source's XMP from wherever it lives (embedded packet or
 *  sidecar), or null if there is none. */
export async function readXmpSidecar(sourcePath: string): Promise<XmpReadFields | null> {
  const xml = await readXmpText(sourcePath);
  return xml == null ? null : readXmpFields(xml);
}
