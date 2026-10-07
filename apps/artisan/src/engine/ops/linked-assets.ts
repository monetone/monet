// ─────────────────────────────────────────────────────────────
// ops/linked-assets — placed image link/embed state transitions
// ─────────────────────────────────────────────────────────────
// Illustrator's Links panel tracks placed-file identity and status separately
// from the rendered image href. These helpers keep that metadata persistent while
// leaving actual file picking/reading to browser/Tauri UI callers.

import { assetModeFromHref, assetNameFromSource, makePlacedAsset, newId } from "../model/factory";
import { findItem } from "../model/query";
import type { Document, ID, ImageItem, PlacedAsset, PlacedAssetStatus } from "../model/types";

export interface RelinkImageOptions {
  href?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
  now?: string;
}

export interface EmbedImageOptions {
  href?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
  now?: string;
}

const nowIso = (now?: string): string => now ?? new Date().toISOString();

const imageById = (doc: Document, id: ID): ImageItem | null => {
  const item = findItem(doc, id)?.item;
  return item?.type === "image" ? item : null;
};

const ensureAsset = (item: ImageItem): PlacedAsset => {
  if (!item.asset) item.asset = makePlacedAsset(item.href, { id: newId("asset") });
  return item.asset;
};

export const relinkImage = (doc: Document, id: ID, source: string, opts: RelinkImageOptions = {}): boolean => {
  const item = imageById(doc, id);
  if (!item) return false;
  const href = opts.href ?? source;
  const asset = ensureAsset(item);
  const stamp = nowIso(opts.now);
  item.href = href;
  item.asset = {
    ...asset,
    mode: "linked",
    status: "ok",
    name: opts.name ?? assetNameFromSource(source),
    source,
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    ...(opts.sizeBytes !== undefined ? { sizeBytes: opts.sizeBytes } : {}),
    ...(opts.lastModified !== undefined ? { lastModified: opts.lastModified } : {}),
    linkedAt: asset.linkedAt ?? stamp,
    updatedAt: stamp,
  };
  return true;
};

export const embedImage = (doc: Document, id: ID, opts: EmbedImageOptions = {}): boolean => {
  const item = imageById(doc, id);
  if (!item) return false;
  const href = opts.href ?? item.href;
  const asset = ensureAsset(item);
  const stamp = nowIso(opts.now);
  const source = asset.source ?? (assetModeFromHref(href) === "linked" ? href : undefined);
  item.href = href;
  item.asset = {
    ...asset,
    mode: "embedded",
    status: "ok",
    name: opts.name ?? asset.name ?? assetNameFromSource(asset.source ?? href),
    ...(source ? { source } : {}),
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    ...(opts.sizeBytes !== undefined ? { sizeBytes: opts.sizeBytes } : {}),
    ...(opts.lastModified !== undefined ? { lastModified: opts.lastModified } : {}),
    embeddedAt: asset.embeddedAt ?? stamp,
    updatedAt: stamp,
  };
  return true;
};

export const setImageAssetStatus = (
  doc: Document,
  id: ID,
  status: PlacedAssetStatus,
  opts: { now?: string } = {},
): boolean => {
  const item = imageById(doc, id);
  if (!item) return false;
  const asset = ensureAsset(item);
  const stamp = nowIso(opts.now);
  item.asset = {
    ...asset,
    status,
    updatedAt: stamp,
  };
  return true;
};

export const updateLinkedImage = (
  doc: Document,
  id: ID,
  opts: RelinkImageOptions = {},
): boolean => {
  const item = imageById(doc, id);
  if (!item) return false;
  const asset = ensureAsset(item);
  if (asset.mode !== "linked") return false;
  const href = opts.href ?? item.href;
  const stamp = nowIso(opts.now);
  item.href = href;
  item.asset = {
    ...asset,
    status: "ok",
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    ...(opts.sizeBytes !== undefined ? { sizeBytes: opts.sizeBytes } : {}),
    ...(opts.lastModified !== undefined ? { lastModified: opts.lastModified } : {}),
    updatedAt: stamp,
  };
  return true;
};
