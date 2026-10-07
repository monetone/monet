// ─────────────────────────────────────────────────────────────
// ui/format — display formatting helpers
// ─────────────────────────────────────────────────────────────

import type { DisplayTimeFormat } from "../engine";

/** Seconds → "MM:SS.mmm". */
export function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** dB value → tidy label like "-6.0 dB" / "−∞". */
export function dbLabel(db: number): string {
  if (!Number.isFinite(db) || db <= -120) return "−∞ dB";
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

// ── Display Time Format (Adobe Audition's View ▸ Display Time Format) ─────────
// Audition shows the playhead/selection time in a selectable format. Rythme
// mirrors the four core formats; each is a pure function of the time in seconds
// plus the session's sample rate / tempo / time signature, so they unit-test
// against exact anchors.

export type TimeFormat = DisplayTimeFormat;

/** The formats offered in the View ▸ Display Time Format submenu, in order. */
export const TIME_FORMATS: { id: TimeFormat; label: string }[] = [
  { id: "decimal", label: "Decimal (mm:ss.ms)" },
  { id: "smpte30", label: "SMPTE 30 fps (hh:mm:ss:ff)" },
  { id: "samples", label: "Samples" },
  { id: "barsBeats", label: "Bars and Beats" },
];

export interface TimeFormatOpts {
  sampleRate?: number;
  tempo?: number;
  timeSignature?: [number, number];
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Format a time (seconds) for the active Display Time Format. */
export function formatTime(seconds: number, format: TimeFormat, opts: TimeFormatOpts = {}): string {
  const s = Math.max(0, seconds);
  switch (format) {
    case "samples": {
      const sr = opts.sampleRate && opts.sampleRate > 0 ? opts.sampleRate : 44100;
      return String(Math.round(s * sr));
    }
    case "smpte30": {
      const fps = 30; // non-drop
      const totalFrames = Math.round(s * fps);
      const ff = totalFrames % fps;
      const totalSec = Math.floor(totalFrames / fps);
      return `${p2(Math.floor(totalSec / 3600))}:${p2(Math.floor(totalSec / 60) % 60)}:${p2(totalSec % 60)}:${p2(ff)}`;
    }
    case "barsBeats": {
      // Display formatter — intentionally distinct from engine/model/query.ts
      // secondsToBarsBeats (960 PPQ, quarter-note beats): this is denominator-
      // aware (one beat = a 1/den note) with 1000 display ticks.
      const tempo = opts.tempo && opts.tempo > 0 ? opts.tempo : 120;
      const [num, den] = opts.timeSignature ?? [4, 4];
      const beatsPerBar = num > 0 ? num : 4;
      const beats = ((s * tempo) / 60) * ((den > 0 ? den : 4) / 4); // elapsed beats (one beat = a 1/den note)
      const bar = Math.floor(beats / beatsPerBar) + 1;
      const beatInBar = Math.floor(beats % beatsPerBar) + 1;
      const ticks = Math.floor((beats - Math.floor(beats)) * 1000);
      return `${bar}:${beatInBar}:${String(ticks).padStart(3, "0")}`;
    }
    case "decimal":
    default:
      return timecode(s);
  }
}
