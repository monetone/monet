// exifFormat — pure formatters for the catalog's normalized EXIF columns into
// the strings a Loupe Info overlay / Metadata panel shows (Phase 4 DAM). Kept
// DOM-free + unit-tested; each returns null when the value is absent/nonsensical
// so the UI can skip the row. Capture-date formatting stays in the component
// (locale-dependent), not here.

/** Shutter speed: `1/125 s` under a second, `2 s` at/over a second. */
export function formatShutter(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

/** Aperture: `f/1.8`. */
export function formatAperture(f: number | null): string | null {
  if (f == null || f <= 0) return null;
  return `f/${Number(f.toFixed(1))}`;
}

/** Focal length: `50 mm`. */
export function formatFocal(mm: number | null): string | null {
  if (mm == null || mm <= 0) return null;
  return `${Math.round(mm)} mm`;
}

/** ISO: `ISO 400`. */
export function formatIso(iso: number | null): string | null {
  return iso == null || iso <= 0 ? null : `ISO ${iso}`;
}

/** Camera make + model, de-duplicated (makers often repeat the brand). */
export function formatCamera(make: string | null, model: string | null): string | null {
  const m = make?.trim() ?? "";
  const md = model?.trim() ?? "";
  if (!m && !md) return null;
  if (m && md && md.toLowerCase().startsWith(m.toLowerCase())) return md;
  return [m, md].filter(Boolean).join(" ");
}

/** GPS as `lat, lon` at 5 decimals, or null when either coordinate is missing. */
export function formatGps(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
