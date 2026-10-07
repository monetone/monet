// MetadataOverlay — LR's Loupe Info overlay: a compact read-out of the active
// photo's catalog metadata (file, camera, exposure triangle, capture, GPS).
// Values come straight from the PhotoRow (normalized EXIF columns); the pure
// formatters live in lib/exifFormat. Absent fields are skipped.

import type { PhotoRow } from "../catalog/types";
import {
  formatAperture,
  formatCamera,
  formatFocal,
  formatGps,
  formatIso,
  formatShutter,
} from "../lib/exifFormat";
import { loupeInfo, type LoupeInfoVariant } from "../lib/loupeInfoOptions";
import { basename } from "./GridCell";

function captureDate(sec: number | null): string | null {
  if (sec == null) return null;
  // Capture time is EXIF wall time stored as UTC; format in UTC so the
  // displayed digits equal the camera's clock (LR shows wall time verbatim).
  return new Date(sec * 1000).toLocaleString(undefined, { timeZone: "UTC" });
}

/** The active photo's metadata as label/value pairs (nulls = absent, skipped by
 *  callers). Shared by the Loupe overlay and the docked Metadata panel. */
export function metadataRows(photo: PhotoRow): [string, string | null][] {
  return [
    ["File", basename(photo.path)],
    ["Dimensions", `${photo.width} × ${photo.height}`],
    ["Camera", formatCamera(photo.cameraMake, photo.cameraModel)],
    ["Lens", photo.lens],
    ["Focal", formatFocal(photo.focalLength)],
    ["Aperture", formatAperture(photo.fNumber)],
    ["Shutter", formatShutter(photo.exposureTime)],
    ["ISO", formatIso(photo.iso)],
    ["Captured", captureDate(photo.captureTime)],
    ["GPS", formatGps(photo.gpsLat, photo.gpsLon)],
  ];
}

/** LR's Loupe Info sets: the user-chosen fields for Info 1 / Info 2 (defaults =
 *  file + capture identity / file + exposure). Row order is the field list's,
 *  not `metadataRows`'. (The docked Metadata panel keeps the full rows.) */
export function infoRows(
  photo: PhotoRow,
  variant: LoupeInfoVariant,
  fields: readonly string[] = loupeInfo()[variant],
): [string, string | null][] {
  const all = new Map(metadataRows(photo));
  return fields.map((f) => [f, all.get(f) ?? null]);
}

export function MetadataOverlay({ photo, variant }: { photo: PhotoRow; variant?: LoupeInfoVariant }) {
  return (
    <dl className="gal-info">
      {(variant ? infoRows(photo, variant) : metadataRows(photo))
        .filter(([, v]) => v != null)
        .map(([k, v]) => (
          <div key={k} className="gal-info-row">
            <dt className="gal-info-k">{k}</dt>
            <dd className="gal-info-v">{v}</dd>
          </div>
        ))}
    </dl>
  );
}
