import { WEB_EXPORT_FORMATS, webExportFilename, type WebExportFormat, type WebExportMetadata } from "./webExportPrefs";

// VIS-SFW-02: the numbers and vocabulary behind Save for Web's preview
// workspace — format list, metadata scope, size / download-time readouts, and
// the Optimize to File Size search. Kept in this leaf (no engine, no DOM) so it
// is unit-testable; `app.ts` owns the pixels.

/** Save for Web's format list — every one of these persists. */
export type SaveForWebFormat = WebExportFormat;

export const SAVE_FOR_WEB_FORMATS: readonly { value: SaveForWebFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "gif", label: "GIF" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
];

export type SaveForWebMetadata = WebExportMetadata;

/** Runtime validation for a format arriving from stored prefs or a script. */
export function isPersistedWebFormat(format: SaveForWebFormat): format is WebExportFormat {
  return WEB_EXPORT_FORMATS.includes(format);
}

/** Formats whose Quality slider does anything. PNG is lossless, GIF is palette. */
export function webQualityApplies(format: SaveForWebFormat): boolean {
  return format === "jpeg" || format === "webp" || format === "avif";
}

export function webExportMime(format: SaveForWebFormat): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

export function saveForWebFilename(baseName: string, format: SaveForWebFormat): string {
  if (isPersistedWebFormat(format)) return webExportFilename(baseName, format);
  const stem = (baseName || "monet-vision").replace(/\.[^.]+$/, "");
  return `${stem}.${format}`;
}

/** Save for Web's optimized-size readout ("182.4 KB"). Binary K, so it matches
 *  what the OS reports for the file that just landed on disk. */
export function formatByteSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

/** The connection speeds the preview's download estimate offers, in kilobits/s. */
export const DOWNLOAD_SPEEDS: readonly { kbps: number; label: string }[] = [
  { kbps: 56.6, label: "56.6 Kbps" },
  { kbps: 1500, label: "1.5 Mbps" },
  { kbps: 10_000, label: "10 Mbps" },
  { kbps: 100_000, label: "100 Mbps" },
];

/** Seconds to transfer `bytes` at `kbps` kilobits/s (decimal kilo, the unit
 *  every ISP quotes). A non-positive speed means "unknown" → 0. */
export function downloadSeconds(bytes: number, kbps: number): number {
  return kbps > 0 ? (Math.max(0, bytes) * 8) / (kbps * 1000) : 0;
}

export function formatDownloadTime(bytes: number, kbps: number): string {
  const total = Math.round(downloadSeconds(bytes, kbps));
  if (total < 1) return "<1 sec";
  if (total < 60) return `${total} sec`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} min`;
}

/** How many encodes Optimize to File Size is allowed. A full-composite encode
 *  is not cheap, so the search is capped — 7 halvings cover the whole 1–100
 *  quality range exactly, so this is convergence, not a shortcut. */
export const MAX_OPTIMIZE_PROBES = 7;

/** Save for Web's "Optimize to File Size": the highest Quality whose encode
 *  still fits `targetBytes`. `sizeAt` encodes at a quality and reports the byte
 *  count. When nothing fits, the smallest file actually measured wins — the
 *  caller asked for a ceiling, so undershooting is the honest answer, and
 *  reporting a measured size beats guessing at one. */
export async function optimizeQualityToSize(
  targetBytes: number,
  sizeAt: (quality: number) => Promise<number>,
  min = 1,
  max = 100,
): Promise<{ quality: number; bytes: number }> {
  let best: { quality: number; bytes: number } | null = null;
  let smallest = { quality: max, bytes: Number.POSITIVE_INFINITY };
  let lo = min;
  let hi = max;
  for (let probe = 0; probe < MAX_OPTIMIZE_PROBES && lo <= hi; probe++) {
    const quality = Math.floor((lo + hi) / 2);
    const bytes = await sizeAt(quality);
    if (quality <= smallest.quality) smallest = { quality, bytes };
    if (bytes <= targetBytes) { best = { quality, bytes }; lo = quality + 1; } else hi = quality - 1;
  }
  return best ?? smallest;
}
