// ─────────────────────────────────────────────────────────────
// engine/audio/db — decibel ↔ linear gain conversions
// ─────────────────────────────────────────────────────────────
// Audio work happens in two units: linear amplitude (a multiplier, 1.0 = unity)
// and decibels (logarithmic, 0 dBFS = full scale). These helpers convert
// between them with a sane floor so silence maps to a finite "very quiet" dB
// rather than -Infinity blowing up downstream maths/formatting.

/** A practical floor for dB readouts; quieter than this reads as silence. */
export const DB_FLOOR = -120;

/** Linear amplitude → decibels (full-scale). gain ≤ 0 ⇒ DB_FLOOR. */
export function gainToDb(gain: number): number {
  if (gain <= 0) return DB_FLOOR;
  return 20 * Math.log10(gain);
}

/** Decibels (full-scale) → linear amplitude. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Clamp a sample to the valid [-1, 1] range (hard clip). */
export function clampSample(x: number): number {
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}

/** Clamp any number to an inclusive range. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
