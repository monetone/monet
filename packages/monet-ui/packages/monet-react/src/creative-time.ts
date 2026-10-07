// ─────────────────────────────────────────────────────────────
// Monet — creative timecode math (pure, no JSX)
// ─────────────────────────────────────────────────────────────
// Pure, framework-free timecode formatting/parsing for the timeline & motion
// components. A `.ts` (not `.tsx`) sibling so the zero-dep `node:test` suite can
// import it directly — Node 24 strips `.ts` types but refuses `.tsx`. It is
// re-exported by creative-timeline.tsx, so the public surface stays a single
// module (mirrors the creative-color-math → creative-color split).
//
// Two formats, both anchored on a non-negative number of `seconds`:
//   • "smpte"  HH:MM:SS:FF   frames quantized at `fps` (default 24)
//   • "ms"     HH:MM:SS.mmm  milliseconds, three digits
//
// formatTimecode + parseTimecode round-trip: parsing a string the formatter
// produced returns the same seconds (to frame/millisecond resolution). All
// behaviour is unit-tested in test/creative-time.test.ts.
//
// This module has NO relative imports on purpose (like creative-color-math.ts):
// the node:test loader strips a self-contained `.ts` but cannot resolve a
// bundler-style extensionless `./internal` specifier. `clamp` mirrors the
// trivial ./internal helper — kept local so the math stays node-testable.

/** Clamp `n` to the inclusive [min, max] range (mirrors ./internal). */
function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

// ─── options ───────────────────────────────────────────────────

/** Formatting/parsing options shared by the time-based components. */
export interface TimecodeOpts {
  /** Frames per second for the "smpte" frame field. Defaults to 24. */
  fps?: number;
  /** Output/expected shape — "smpte" (HH:MM:SS:FF) or "ms" (HH:MM:SS.mmm). */
  format?: TimecodeFormat;
}

/** The two supported timecode shapes. */
export type TimecodeFormat = "smpte" | "ms";

// ─── small scalar helpers ──────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, "0");
const pad3 = (n: number): string => String(n).padStart(3, "0");

/** Normalize an fps to a positive integer (defaults to 24).
 *
 *  (#205) ROUNDS fractional rates rather than flooring them: NTSC non-drop
 *  timecode counts 30 frame slots per timecode-second at 29.97 (24 at 23.976,
 *  60 at 59.94), which is also what the sibling @monet-ui/monet-timeline
 *  `framesToTimecode` does — flooring gave 29/23/59 and disagreed with the
 *  model layer for the same project. */
function normFps(fps: number | undefined): number {
  const f = Math.round(fps ?? 24);
  return f >= 1 ? f : 24;
}

// ─── formatting ────────────────────────────────────────────────

/** Render `seconds` as a timecode string.
 *
 *  - "smpte" → `HH:MM:SS:FF`, where FF is the frame index within the second,
 *    quantized at `fps` (frame = round(fraction · fps), carrying into the next
 *    second when it lands on `fps`).
 *  - "ms" → `HH:MM:SS.mmm`, milliseconds to three digits.
 *
 *  Negative input is clamped to zero. */
export function formatTimecode(seconds: number, opts: TimecodeOpts = {}): string {
  const format: TimecodeFormat = opts.format ?? "smpte";
  const fps = normFps(opts.fps);
  const total = isFinite(seconds) ? Math.max(0, seconds) : 0;

  if (format === "ms") {
    const whole = Math.floor(total);
    let ms = Math.round((total - whole) * 1000);
    let carry = 0;
    if (ms >= 1000) {
      ms -= 1000;
      carry = 1;
    }
    const s = whole + carry;
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${pad3(ms)}`;
  }

  // smpte: quantize the sub-second remainder to a frame index, carrying a
  // round-up that lands on `fps` into the next whole second.
  const whole = Math.floor(total);
  let frame = Math.round((total - whole) * fps);
  let carry = 0;
  if (frame >= fps) {
    frame -= fps;
    carry = 1;
  }
  const s = whole + carry;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(frame)}`;
}

// ─── parsing ───────────────────────────────────────────────────

/** Parse a timecode string back to seconds.
 *
 *  Accepts the formatter's output for the chosen `format`, plus lenient inputs:
 *  any of the time fields may be 1+ digits, fields may be omitted from the left
 *  (so "SS:FF", "MM:SS:FF" and "HH:MM:SS:FF" all parse; likewise "SS.mmm",
 *  "MM:SS.mmm"). The last `:`-separated group is frames in "smpte" mode; in "ms"
 *  mode the fractional part is taken from a trailing ".mmm" (or "," decimal).
 *
 *  Returns `NaN` when the string can't be parsed, so callers can keep the
 *  previous value (mirrors hexToRgb's null contract). */
export function parseTimecode(input: string, opts: TimecodeOpts = {}): number {
  const format: TimecodeFormat = opts.format ?? "smpte";
  const fps = normFps(opts.fps);
  const raw = input.trim();
  if (raw === "") return NaN;

  if (format === "ms") {
    // split off a fractional part on "." or ","; the rest is H:M:S groups.
    const m = raw.match(/^([0-9:]+)(?:[.,]([0-9]+))?$/);
    if (!m) return NaN;
    const fields = m[1].split(":");
    if (fields.length > 3) return NaN;
    const time = fieldsToSeconds(fields);
    if (Number.isNaN(time)) return NaN;
    let frac = 0;
    if (m[2] != null && m[2] !== "") {
      // interpret the fractional digits as a decimal fraction of a second
      // (".5" → 0.5s, ".500" → 0.5s, ".050" → 0.05s).
      frac = Number(`0.${m[2]}`);
      if (Number.isNaN(frac)) return NaN;
    }
    return time + frac;
  }

  // smpte: all groups are ":"-separated; the final group is the frame index.
  const fields = raw.split(":");
  if (fields.length < 1 || fields.length > 4) return NaN;
  for (const f of fields) {
    if (!/^[0-9]+$/.test(f)) return NaN;
  }
  const frameStr = fields.pop() as string;
  const frame = Number(frameStr);
  if (Number.isNaN(frame)) return NaN;
  const time = fields.length ? fieldsToSeconds(fields) : 0;
  if (Number.isNaN(time)) return NaN;
  // a frame index ≥ fps still resolves (frame/fps just rolls past one second),
  // but clamp the per-second contribution so it never goes negative.
  return time + clamp(frame, 0, Number.MAX_SAFE_INTEGER) / fps;
}

/** Fold up to three right-aligned [.., MM, SS] (or [HH, MM, SS]) numeric field
 *  strings into seconds. Returns NaN on any non-numeric field. */
function fieldsToSeconds(fields: string[]): number {
  if (fields.length === 0) return 0;
  if (fields.length > 3) return NaN;
  const nums: number[] = [];
  for (const f of fields) {
    if (!/^[0-9]+$/.test(f)) return NaN;
    nums.push(Number(f));
  }
  // right-align: last field is seconds, then minutes, then hours.
  let mult = 1;
  let total = 0;
  for (let i = nums.length - 1; i >= 0; i--) {
    total += nums[i] * mult;
    mult *= 60;
  }
  return total;
}

// ─── frame helpers (used by the playhead / keyframe nudges) ─────

/** Seconds-per-frame at `fps` (the Arrow-key step for the time components). */
export function frameDuration(fps: number | undefined): number {
  return 1 / normFps(fps);
}

/** Snap `seconds` to the nearest whole frame at `fps`. */
export function snapToFrame(seconds: number, fps: number | undefined): number {
  const f = normFps(fps);
  return Math.round(seconds * f) / f;
}
