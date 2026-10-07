// ─────────────────────────────────────────────────────────────
// time.ts — frame ⇄ timecode ⇄ seconds math for frame-based timelines.
//
// Frames are the canonical unit for video NLEs (Cinema); audio NLEs (Rythme)
// work in seconds and use their own formatter, but the generic helpers here
// (clamp, sourceFrameAt) are unit-agnostic. Framework-free + unit-tested.
// ─────────────────────────────────────────────────────────────

/** Clamp `n` into [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Whole frames → seconds at `fps`. */
export function framesToSeconds(frames: number, fps: number): number {
  return fps > 0 ? frames / fps : 0;
}

/** Seconds → whole frames at `fps` (rounded). */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Frames → `HH:MM:SS:FF` (or `HH:MM:SS;FF` drop-frame). Non-drop is correct for
 * integer rates; drop-frame applies the SMPTE 29.97/59.94 rule.
 */
export function framesToTimecode(frames: number, fps: number, drop = false): string {
  const rate = Math.round(fps);
  if (rate <= 0) return "00:00:00:00";
  let f = Math.max(0, Math.round(frames));
  const sep = drop ? ";" : ":";

  if (drop && (rate === 30 || rate === 60)) {
    const dropPerMin = rate === 60 ? 4 : 2;
    const framesPer10Min = rate * 60 * 10 - dropPerMin * 9;
    const framesPerMin = rate * 60 - dropPerMin;
    const d = Math.floor(f / framesPer10Min);
    const m = f % framesPer10Min;
    if (m >= dropPerMin) {
      f += dropPerMin * 9 * d + dropPerMin * Math.floor((m - dropPerMin) / framesPerMin);
    } else {
      f += dropPerMin * 9 * d;
    }
  }

  const ff = f % rate;
  const totalSecs = Math.floor(f / rate);
  const ss = totalSecs % 60;
  const mm = Math.floor(totalSecs / 60) % 60;
  const hh = Math.floor(totalSecs / 3600);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(hh)}:${p2(mm)}:${p2(ss)}${sep}${p2(ff)}`;
}

/** Parse `HH:MM:SS:FF` / `MM:SS:FF` / `SS:FF` (`;` allowed for the frame sep) → frames. */
export function timecodeToFrames(tc: string, fps: number): number {
  const rate = Math.round(fps);
  if (rate <= 0) return 0;
  const parts = tc.trim().split(/[:;]/).map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts;
  return ((hh * 60 + mm) * 60 + ss) * rate + ff;
}

/** A compact `M:SS` / `H:MM:SS` clock for durations (no frames). */
export function formatClock(frames: number, fps: number): string {
  const total = Math.floor(framesToSeconds(frames, fps));
  const ss = total % 60;
  const mm = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
}

/**
 * Map a timeline position within a clip to a source position, honoring the
 * clip's in-point and playback speed (unit-agnostic — frames or seconds).
 */
export function sourceFrameAt(timelineFrame: number, clipStart: number, inPoint: number, speed: number): number {
  const offset = timelineFrame - clipStart;
  return Math.max(0, Math.round(inPoint + offset * (speed || 1)));
}
