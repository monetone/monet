// ─────────────────────────────────────────────────────────────
// Opacity keyboard shortcuts — pure helpers for Photoshop's number-key opacity
// (1-9 → 10-90%, 0 → 100%, two digits → exact percent). When an opacity tool is
// active the keys set the tool's opacity; otherwise the active layer's. Engine-free
// so it unit-tests in node; the global keydown handler routes to store actions.
// ─────────────────────────────────────────────────────────────

// Tools whose options bar exposes an Opacity slider (number keys target the tool,
// not the layer, while one of these is active).
const OPACITY_TOOLS = ["brush", "pencil", "erase", "backgrounderaser", "clone", "vanishingpoint", "heal", "patternstamp", "colorreplace", "mixerbrush", "historybrush", "dodge", "burn", "sponge", "smudge", "blur", "sharpen"];

export const DIGIT_SEQUENCE_MS = 1000;

export function isOpacityTool(tool: string): boolean {
  return OPACITY_TOOLS.includes(tool);
}

// 1-9 → 10-90%, 0 → 100% (the shared Photoshop number-key mapping).
const digitPercent = (n: number): number => (n === 0 ? 100 : n * 10);

/** Photoshop number-key opacity: "1".."9" → 10..90, "0" → 100; non-digit → null. */
export function digitOpacity(key: string): number | null {
  if (key.length !== 1 || key < "0" || key > "9") return null;
  return digitPercent(key.charCodeAt(0) - 48); // "0".."9" → 0..9
}

/** Digit for a physical number key — Shift changes e.key, but not e.code. */
export function codeDigit(code: string): string | null {
  const m = /^Digit([0-9])$/.exec(code);
  return m ? m[1] : null;
}

/** Percent for a physical number key (used by Shift+number flow). */
export function codeDigitPercent(code: string): number | null {
  const digit = codeDigit(code);
  return digit === null ? null : digitOpacity(digit);
}

/** One digit uses the 10% mapping; a second digit gives the exact percentage. */
export function digitSequencePercent(first: string | null, next: string): number | null {
  const single = digitOpacity(next);
  if (single === null) return null;
  return first !== null && digitOpacity(first) !== null ? Number(first + next) : single;
}
