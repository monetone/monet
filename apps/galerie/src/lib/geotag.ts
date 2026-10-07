// geotag — Map ▸ Tracklog (Load Tracklog / Auto-Tag Selected Photos / Set
// Tracklog Time Offset) and the Saved Locations panel, as pure local math:
// capture-time ↔ GPX track matching plus radius geofencing. No tiles, no
// geocoder, no network. The Private flag's export-side strip lives at the
// shared chokepoint in exportMetadata.ts.

import type { PresetStorage } from "./exportPresets";

// ─── GPX tracklog ──────────────────────────────────────────────────────────

export interface TrackPoint {
  /** Epoch seconds (GPX `<time>` is UTC ISO-8601). */
  time: number;
  lat: number;
  lon: number;
}

/**
 * Parse a GPX document's `<trkpt>`s, sorted by time. Points without a parsable
 * `<time>` or with out-of-range coordinates are dropped — a timeless point
 * can't be matched to a capture time. Regex, not DOMParser, for the same
 * reason as monet-photo's xmp module: framework-free, tests run in node.
 */
export function parseGpx(xml: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const m of xml.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const lat = Number(/\blat="([^"]+)"/.exec(m[1])?.[1]);
    const lon = Number(/\blon="([^"]+)"/.exec(m[1])?.[1]);
    const iso = /<time>([^<]+)<\/time>/.exec(m[2])?.[1];
    if (!iso || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const ms = Date.parse(iso.trim());
    if (!Number.isFinite(ms)) continue;
    points.push({ time: ms / 1000, lat, lon });
  }
  return points.sort((a, b) => a.time - b.time);
}

/** Sane upper bound on a loaded tracklog. GPX is untrusted input — an
 *  arbitrary file the user points a file picker at — and parseGpx has no size
 *  limit of its own (regex over the whole string). A real day's track is
 *  KB–low-MB; 20 MB is generous headroom without letting a multi-GB file get
 *  matched in full. */
export const MAX_GPX_BYTES = 20_000_000;

/** parseGpx, bounded for untrusted input. Returns null (not "[]") when the
 *  file is over the limit, so the caller can tell "too large to try" apart
 *  from "parsed fine, zero usable points". */
export function parseGpxBounded(xml: string, maxBytes = MAX_GPX_BYTES): TrackPoint[] | null {
  return xml.length > maxBytes ? null : parseGpx(xml);
}

/** LR's Set Tracklog Time Offset: "±HH:mm" → signed seconds; null when unparsable. */
export function parseTrackOffset(v: string): number | null {
  const m = /^([+-]?)(\d{1,2}):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60);
}

/**
 * Position on the track at capture time `t` (epoch seconds). `offset` seconds
 * are added to the track's clock before matching (LR's tracklog time offset),
 * so a camera 2h ahead of the logger matches with offset = +7200. Linear
 * interpolation between the bracketing points; null outside the track's time
 * window — LR leaves such photos untagged rather than snapping to an endpoint.
 */
export function locateAtTime(
  track: TrackPoint[],
  t: number,
  offset = 0,
): { lat: number; lon: number } | null {
  if (track.length === 0) return null;
  const q = t - offset; // query in raw track time
  if (q < track[0].time || q > track[track.length - 1].time) return null;
  // Binary search for the last point at or before q.
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid].time <= q) lo = mid;
    else hi = mid - 1;
  }
  const a = track[lo];
  const b = track[Math.min(lo + 1, track.length - 1)];
  const span = b.time - a.time;
  const f = span > 0 ? (q - a.time) / span : 0;
  // ponytail: naive lerp — wrong across the antimeridian; use shortest-arc
  // lon interpolation if someone logs a track through ±180°.
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

export interface AutoTagMatch {
  id: number;
  lat: number;
  lon: number;
}

/**
 * Auto-Tag Selected Photos: match each photo's capture time (epoch seconds,
 * the catalog's capture_time) against the track. Photos without a capture time
 * or outside the track window are left out — the caller writes the rest via
 * catalog.setGps.
 */
export function autoTagPhotos(
  photos: ReadonlyArray<{ id: number; captureTime: number | null }>,
  track: TrackPoint[],
  offset = 0,
): AutoTagMatch[] {
  return summarizeAutoTag(photos, track, offset).tagged;
}

export interface AutoTagSummary {
  tagged: AutoTagMatch[];
  /** No catalog capture_time — nothing to match against. */
  noCaptureTime: number;
  /** Had a capture time, but outside the track's covered window. */
  outOfRange: number;
}

/**
 * autoTagPhotos with an honest breakdown of *why* the rest were left
 * untagged — a silent partial tag is worse than a visible count.
 */
export function summarizeAutoTag(
  photos: ReadonlyArray<{ id: number; captureTime: number | null }>,
  track: TrackPoint[],
  offset = 0,
): AutoTagSummary {
  const tagged: AutoTagMatch[] = [];
  let noCaptureTime = 0;
  let outOfRange = 0;
  for (const p of photos) {
    if (p.captureTime == null) {
      noCaptureTime++;
      continue;
    }
    const pos = locateAtTime(track, p.captureTime, offset);
    if (pos) tagged.push({ id: p.id, ...pos });
    else outOfRange++;
  }
  return { tagged, noCaptureTime, outOfRange };
}

// ─── Saved Locations ───────────────────────────────────────────────────────

export type RadiusUnit = "ft" | "mi" | "m" | "km";

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  unit: RadiusUnit;
  /** LR's Private flag: exports strip all IPTC location metadata for photos inside. */
  isPrivate: boolean;
}

const METERS_PER: Record<RadiusUnit, number> = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };

export function radiusMeters(loc: Pick<SavedLocation, "radius" | "unit">): number {
  return loc.radius * METERS_PER[loc.unit];
}

/** Great-circle distance in meters (haversine, spherical earth). */
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371008.8; // mean earth radius
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isWithinLocation(loc: SavedLocation, lat: number, lon: number): boolean {
  return distanceMeters(loc.lat, loc.lon, lat, lon) <= radiusMeters(loc);
}

/** True when the point falls inside any Private saved location. */
export function inPrivateLocation(
  locations: ReadonlyArray<SavedLocation>,
  lat: number,
  lon: number,
): boolean {
  return locations.some((l) => l.isPrivate && isWithinLocation(l, lat, lon));
}

// ─── Saved Locations persistence (same localStorage idiom as recentCatalogs) ─

const KEY = "galerie.savedLocations";
export const UNITS: readonly RadiusUnit[] = ["ft", "mi", "m", "km"];

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isSavedLocation(v: unknown): v is SavedLocation {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.lat === "number" && Math.abs(o.lat) <= 90 &&
    typeof o.lon === "number" && Math.abs(o.lon) <= 180 &&
    typeof o.radius === "number" && o.radius > 0 &&
    UNITS.includes(o.unit as RadiusUnit) &&
    typeof o.isPrivate === "boolean"
  );
}

/** The saved locations; missing/corrupt storage → []. */
export function listSavedLocations(storage: PresetStorage | null = defaultStorage()): SavedLocation[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedLocation) : [];
  } catch {
    return [];
  }
}

export function saveSavedLocations(
  locations: SavedLocation[],
  storage: PresetStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(locations));
  } catch {
    // storage unavailable — the panel just won't remember across sessions
  }
}
