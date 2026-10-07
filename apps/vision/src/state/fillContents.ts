// Pure helpers for the Edit ▸ Fill dialog's "Contents" dropdown. Engine-free so the
// colour resolution unit-tests in node; the store/dialog feed the resolved RGB to
// the existing fill_blend (Color…) or route Content-Aware to content_aware_fill and
// History to fill_history.
export type FillContent = "fg" | "bg" | "color" | "contentAware" | "pattern" | "history" | "black" | "gray" | "white";
export type RGB = [number, number, number];

// The Contents options, in Photoshop's order. Color…, Content-Aware, and History
// are the parity additions. (Preserve Transparency is a separate Fill-dialog
// checkbox, not a Contents option.)
export const FILL_CONTENTS: { value: FillContent; label: string }[] = [
  { value: "fg", label: "Foreground Color" },
  { value: "bg", label: "Background Color" },
  { value: "color", label: "Color…" },
  { value: "contentAware", label: "Content-Aware" },
  { value: "pattern", label: "Pattern" },
  { value: "history", label: "History" },
  { value: "black", label: "Black" },
  { value: "gray", label: "50% Gray" },
  { value: "white", label: "White" },
];

// The solid RGB a colour-based fill paints. Returns null for fills that don't use a
// flat colour (pattern, content-aware, history) — the caller routes those to their
// own op (fill_pattern / content_aware_fill / fill_history).
export function resolveFillRgb(contents: FillContent, fg: RGB, bg: RGB, custom: RGB): RGB | null {
  switch (contents) {
    case "fg": return fg;
    case "bg": return bg;
    case "color": return custom;
    case "black": return [0, 0, 0];
    case "white": return [255, 255, 255];
    case "gray": return [128, 128, 128];
    default: return null; // pattern, contentAware, history
  }
}

// Parse "#rrggbb" to an RGB triple; malformed components fall back to 0.
export function hexToRgb(hex: string): RGB {
  const h = hex.replace(/^#/, "");
  const byte = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Number.isFinite(v) ? v : 0;
  };
  return [byte(0), byte(2), byte(4)];
}
