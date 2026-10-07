// Helpers for Photoshop's Layer ▸ New ▸ Layer… dialog. Pure / engine-free so the
// name/opacity logic can be unit-tested in node; the dialog composes the existing
// store layer methods.

// The next "Layer N" name, where N is one past the highest existing "Layer <int>"
// (Photoshop's auto-numbering). Names that aren't of that form are ignored.
export function defaultLayerName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Layer (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Layer ${max + 1}`;
}

// Round + clamp an opacity to the 0..100 layer range; non-finite falls back to 100.
export function clampLayerOpacity(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// The dialog's typed name when non-blank, else the auto-numbered default.
export function resolveLayerName(input: string, names: string[]): string {
  const trimmed = input.trim();
  return trimmed || defaultLayerName(names);
}
