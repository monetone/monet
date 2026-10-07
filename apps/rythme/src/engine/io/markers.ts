// ─────────────────────────────────────────────────────────────
// engine/io/markers — marker list export / import (CSV)
// ─────────────────────────────────────────────────────────────
// Audition's "Export Markers" / marker-list CSV: a row per marker with the name,
// start, end, duration and type (Cue point or Region). The parser is the inverse
// and tolerant — it skips the header and any junk row (a non-numeric Start), and
// rebuilds a region whenever an end or a positive duration is present. Times are
// in seconds. Round-trips: parseMarkersCsv(exportMarkersCsv(m)) preserves the
// name / time / region span of every marker.

import { newMarker } from "../model/factory";
import type { Marker } from "../model/types";

const HEADER = "Name,Start,End,Duration,Type";

/**
 * Markers whose point falls in [start, end), re-based to the range origin — the
 * cue points to embed when exporting just that range.
 */
export function markersInRange(markers: Marker[], start: number, end: number): { time: number; name?: string }[] {
  return markers.filter((m) => m.time >= start && m.time < end).map((m) => ({ time: m.time - start, name: m.name }));
}

/** CSV-quote a field if it contains a comma, quote or newline. */
function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Render a marker list as Audition-style CSV (with a header row, seconds). */
export function exportMarkersCsv(markers: Marker[]): string {
  const rows = [HEADER];
  for (const m of markers) {
    const region = m.end != null && m.end > m.time;
    const duration = region ? m.end! - m.time : 0;
    rows.push(
      [
        escapeCsv(m.name),
        m.time.toFixed(6),
        region ? m.end!.toFixed(6) : "",
        duration.toFixed(6),
        region ? "Region" : "Cue",
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}

/** Split one CSV line into fields, honouring quoted fields with escaped quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else field += ch;
  }
  fields.push(field);
  return fields;
}

/** Parse a marker CSV (the inverse of {@link exportMarkersCsv}); tolerant of the header and junk rows. */
export function parseMarkersCsv(csv: string): Marker[] {
  const markers: Marker[] = [];
  for (const line of csv.split(/\r\n|\r|\n/)) {
    if (line.trim() === "") continue;
    const fields = splitCsvLine(line);
    const time = Number.parseFloat(fields[1] ?? "");
    if (!Number.isFinite(time)) continue; // header row or non-marker line

    const name = fields[0] ?? "Marker";
    const type = (fields[4] ?? "").trim().toLowerCase();
    const end = Number.parseFloat(fields[2] ?? "");
    const duration = Number.parseFloat(fields[3] ?? "");

    let span: number | undefined;
    if (Number.isFinite(end) && end > time) span = end;
    else if (Number.isFinite(duration) && duration > 0) span = time + duration;
    if (type === "cue") span = undefined; // an explicit cue is always a point

    markers.push(newMarker({ time, end: span, name }));
  }
  return markers;
}
