// Helpers for Photoshop's Layer ▸ New ▸ Group… dialog. Pure / engine-free so the
// name logic unit-tests in node; the dialog composes the existing store group
// methods (and reuses clampLayerOpacity from newLayer.ts for the opacity field).

// The next "Group N" name, where N is one past the highest existing "Group <int>"
// (Photoshop's auto-numbering). Names that aren't of that form are ignored.
export function defaultGroupName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Group (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Group ${max + 1}`;
}

// The dialog's typed name when non-blank, else the auto-numbered default.
export function resolveGroupName(input: string, names: string[]): string {
  const trimmed = input.trim();
  return trimmed || defaultGroupName(names);
}
