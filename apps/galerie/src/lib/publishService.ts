// publishService — Lightroom Classic's Publish Services, Hard Drive publisher.
//
// A publish service IS a manual catalog collection that carries its settings in
// the otherwise-unused rule field (the PREVIOUS_IMPORT_MARKER trick in
// state/store.ts), so membership, drag-drop and "browse it in the grid" all come
// for free with no schema change. What the service actually wrote to disk lives
// in ONE localStorage blob keyed by service + photo, exactly like
// metadataStatus's sync baselines: comparing a member's signature today against
// the recorded one classifies it New / Modified / Published, and a record whose
// photo is no longer a member is Deleted — its file is removed on the next
// publish. Publish pushes only that diff.
//
// ponytail: records are localStorage keyed by catalog photo id, so two catalogs
// with overlapping ids share them — move to catalog tables when publish state
// must become a smart-collection criterion (same upgrade path metadataStatus
// names). Third-party publish plug-ins are an explicit non-goal.

import type { CollectionRow, PhotoRow } from "../catalog/types";
import type { PresetStorage } from "./exportPresets";
import { contentDigest } from "./metadataStatus";

/** Per-photo publish state inside a service (LR's grid sections). "deleted" is
 *  carried by a leftover record, not by a member, so it is not a member state. */
export type PublishState = "new" | "modified" | "published";

/** What the service wrote for one photo, and what it looked like at the time. */
export interface PublishedRecord {
  /** Absolute path of the file written into the published folder. */
  path: string;
  /** Signature of the photo + service settings when it was written. */
  signature: string;
  publishedAt: number;
  /** Mark to Republish — forces "modified" even when nothing actually changed. */
  republish?: boolean;
}

/** The Hard Drive publisher's settings (LR's Export Settings, trimmed to what a
 *  published folder needs). Persisted as the collection's rule JSON.
 *  ponytail: JPEG/PNG at one size — the full Export dialog config could be
 *  stored here verbatim once a publisher needs watermarks or sharpening. */
export interface PublishServiceConfig {
  /** Published folder — the destination directory on disk. */
  dir: string;
  format: "jpeg" | "png";
  /** JPEG quality 0–1 (ignored for PNG). */
  quality: number;
  /** Fit within this long edge (px); null = full resolution. */
  longEdge: number | null;
}

/** Marker that makes a manual collection a publish service (mirrors
 *  PREVIOUS_IMPORT_MARKER's `monetSystemCollection` convention). */
export const PUBLISH_SERVICE_KIND = "publish-hard-drive";

/** A publish service: its backing collection plus the parsed settings. */
export interface PublishServiceRow {
  row: CollectionRow;
  config: PublishServiceConfig;
}

export const DEFAULT_PUBLISH_CONFIG: PublishServiceConfig = {
  dir: "",
  format: "jpeg",
  quality: 0.85,
  longEdge: 2048,
};

/** Serialize settings into the collection's rule field. */
export function publishServiceMarker(config: PublishServiceConfig): string {
  return JSON.stringify({ monetSystemCollection: PUBLISH_SERVICE_KIND, ...config });
}

/** Parse a collection's rule field as publish settings; null when it is not a
 *  publish service. Values are validated — this is persisted user data that
 *  ends up as a filesystem destination and an encoder setting. */
export function parsePublishService(ruleAst: string | null): PublishServiceConfig | null {
  let parsed: Partial<PublishServiceConfig> & { monetSystemCollection?: unknown };
  try {
    parsed = JSON.parse(ruleAst ?? "");
  } catch {
    return null;
  }
  if (parsed?.monetSystemCollection !== PUBLISH_SERVICE_KIND) return null;
  if (typeof parsed.dir !== "string" || !parsed.dir) return null;
  const format = parsed.format === "png" ? "png" : "jpeg";
  const quality =
    typeof parsed.quality === "number" && parsed.quality > 0 && parsed.quality <= 1
      ? parsed.quality
      : DEFAULT_PUBLISH_CONFIG.quality;
  const longEdge =
    typeof parsed.longEdge === "number" && parsed.longEdge >= 1
      ? Math.floor(parsed.longEdge)
      : null;
  return { dir: parsed.dir, format, quality, longEdge };
}

/** The publish services in the sidebar tree, in tree order. */
export function findPublishServices(rows: readonly CollectionRow[]): PublishServiceRow[] {
  const out: PublishServiceRow[] = [];
  for (const row of rows) {
    if (row.kind !== "collection") continue;
    const config = parsePublishService(row.ruleAst);
    if (config) out.push({ row, config });
  }
  return out;
}

/** True for collections the Collections panel must hide (they belong to the
 *  Publish panel instead). */
export function isPublishService(row: CollectionRow): boolean {
  return row.kind === "collection" && parsePublishService(row.ruleAst) != null;
}

/** Everything that changes the published file: the develop recipe, the metadata
 *  the export embeds, the source filename, and the service's own settings. A
 *  change to any of them invalidates the published copy (LR marks it Modified). */
export function publishSignature(
  photo: PhotoRow,
  recipeJson: string | null,
  config: PublishServiceConfig,
): string {
  return contentDigest(
    JSON.stringify([
      recipeJson ?? "",
      photo.path,
      photo.copyName,
      photo.orientation,
      photo.title,
      photo.caption,
      photo.creator,
      photo.copyright,
      photo.city,
      photo.stateProvince,
      photo.country,
      photo.jobTitle,
      photo.credit,
      photo.source,
      config.format,
      config.quality,
      config.longEdge,
    ]),
  );
}

/** Classify one member against its record. */
export function publishState(record: PublishedRecord | null, signature: string): PublishState {
  if (!record) return "new";
  if (record.republish || record.signature !== signature) return "modified";
  return "published";
}

export interface PublishPlanEntry {
  photo: PhotoRow;
  state: "new" | "modified";
  signature: string;
}

/** The diff a Publish run pushes: write the new + modified members, delete the
 *  files of photos that left the service. */
export interface PublishPlan {
  publish: PublishPlanEntry[];
  remove: { photoId: number; path: string }[];
}

export function publishPlan(
  members: readonly PhotoRow[],
  signatures: ReadonlyMap<number, string>,
  records: Readonly<Record<number, PublishedRecord>>,
): PublishPlan {
  const plan: PublishPlan = { publish: [], remove: [] };
  const memberIds = new Set(members.map((p) => p.id));
  for (const photo of members) {
    const signature = signatures.get(photo.id) ?? "";
    const state = publishState(records[photo.id] ?? null, signature);
    if (state !== "published") plan.publish.push({ photo, state, signature });
  }
  for (const [id, record] of Object.entries(records)) {
    if (!memberIds.has(Number(id))) plan.remove.push({ photoId: Number(id), path: record.path });
  }
  return plan;
}

/** The four counts LR shows per published collection. */
export interface PublishSummary {
  new: number;
  modified: number;
  published: number;
  deleted: number;
}

export function publishSummary(plan: PublishPlan, memberCount: number): PublishSummary {
  const added = plan.publish.filter((e) => e.state === "new").length;
  return {
    new: added,
    modified: plan.publish.length - added,
    published: memberCount - plan.publish.length,
    deleted: plan.remove.length,
  };
}

// ── Record storage (one blob, mirroring metadataStatus's baselines) ──

const KEY = "galerie.publishRecords";

type RecordBlob = Record<string, Record<string, PublishedRecord>>;

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: RecordBlob | null = null;

function blob(storage: PresetStorage | null): RecordBlob {
  if (cache) return cache;
  try {
    cache = JSON.parse(storage?.getItem(KEY) ?? "{}") as RecordBlob;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(all: RecordBlob, storage: PresetStorage | null): void {
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable — the in-memory cache still serves this session
  }
}

/** Every record a service has written, keyed by photo id. */
export function loadPublishRecords(
  serviceId: number,
  storage: PresetStorage | null = defaultStorage(),
): Record<number, PublishedRecord> {
  return blob(storage)[serviceId] ?? {};
}

/** Record a successful write (one entry per photo the run actually wrote). */
export function recordPublished(
  serviceId: number,
  entries: readonly { photoId: number; path: string; signature: string }[],
  storage: PresetStorage | null = defaultStorage(),
  now = Date.now(),
): void {
  if (!entries.length) return;
  const all = blob(storage);
  const service = { ...(all[serviceId] ?? {}) };
  for (const e of entries) {
    service[e.photoId] = { path: e.path, signature: e.signature, publishedAt: now };
  }
  all[serviceId] = service;
  persist(all, storage);
}

/** Drop records (a deleted file's record, or a photo removed from the service). */
export function forgetPublished(
  serviceId: number,
  photoIds: readonly number[],
  storage: PresetStorage | null = defaultStorage(),
): void {
  const all = blob(storage);
  const service = all[serviceId];
  if (!service) return;
  for (const id of photoIds) delete service[id];
  persist(all, storage);
}

/** LR's Mark to Republish — force these members back to Modified. Ignores ids
 *  that were never published (they are already New). */
export function markToRepublish(
  serviceId: number,
  photoIds: readonly number[],
  storage: PresetStorage | null = defaultStorage(),
): void {
  const all = blob(storage);
  const service = all[serviceId];
  if (!service) return;
  let changed = false;
  for (const id of photoIds) {
    const record = service[id];
    if (!record || record.republish) continue;
    service[id] = { ...record, republish: true };
    changed = true;
  }
  if (changed) persist(all, storage);
}

/** Forget a whole service (its collection was deleted). */
export function forgetPublishService(
  serviceId: number,
  storage: PresetStorage | null = defaultStorage(),
): void {
  const all = blob(storage);
  if (!(serviceId in all)) return;
  delete all[serviceId];
  persist(all, storage);
}

/** Test hook: drop the in-memory blob (mirrors resetMetadataBaselines). */
export function resetPublishRecords(): void {
  cache = null;
}
