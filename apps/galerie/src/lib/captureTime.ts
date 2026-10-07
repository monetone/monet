// captureTime — pure conversions between epoch seconds (the catalog's
// capture_time) and the `<input type="datetime-local">` value format, in the
// user's local timezone (Lightroom's Edit Capture Time works in local time).

const pad = (n: number): string => String(n).padStart(2, "0");

/** Epoch seconds → "YYYY-MM-DDTHH:mm" (local) for a datetime-local input. */
export function epochToLocalInput(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm[:ss]" (local) → epoch seconds; null when unparsable. */
export function localInputToEpoch(v: string): number | null {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}
