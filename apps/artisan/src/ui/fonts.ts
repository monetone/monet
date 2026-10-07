// ─────────────────────────────────────────────────────────────
// ui/fonts — the font menu for the Type panel
// ─────────────────────────────────────────────────────────────
// A curated list of broadly-available font-family stacks (the value is the CSS
// stack we store on the text item; the label is what the menu shows). The webview
// can't reliably enumerate installed system fonts without the permission-gated
// Local Font Access API, so we ship a sensible Illustrator-like default set and
// always fold in whatever family the current object actually uses (see
// `fontOptions`) so an imported/unknown font still shows up selected.

export interface FontOption {
  label: string;
  value: string;
}

export const FONT_FAMILIES: FontOption[] = [
  { label: "System UI", value: "system-ui, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: "Gill Sans", value: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
  { label: "Futura", value: 'Futura, "Trebuchet MS", Arial, sans-serif' },
  { label: "Avenir", value: '"Avenir Next", Avenir, "Segoe UI", sans-serif' },
  { label: "Optima", value: 'Optima, Candara, "Segoe UI", sans-serif' },
  { label: "Impact", value: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Georgia", value: "Georgia, Cambria, serif" },
  { label: "Garamond", value: 'Garamond, Baskerville, "Times New Roman", serif' },
  { label: "Baskerville", value: 'Baskerville, "Goudy Old Style", Garamond, serif' },
  { label: "Palatino", value: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Menlo", value: 'Menlo, Monaco, Consolas, "Courier New", monospace' },
  { label: "Brush Script", value: '"Brush Script MT", "Comic Sans MS", cursive' },
];

/** A short, human-friendly label for a CSS font-family stack (the first family,
 *  de-quoted) — used when the stored stack isn't one of the curated entries. */
export function familyLabel(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? stack;
  return first.replace(/^["']|["']$/g, "") || stack;
}

/** Whether the first family in a stack resolves to an installed font. Uses the
 *  FontFaceSet API (available in the webview, unlike the permission-gated Local
 *  Font Access API); when that can't be determined (non-DOM/test env, or an
 *  unsupported engine) it returns true so we never cry wolf. Generic families
 *  (sans-serif, serif, …) always resolve. */
export function isFamilyAvailable(stack: string): boolean {
  const first = (stack.split(",")[0]?.trim() ?? "").replace(/^["']|["']$/g, "");
  if (!first) return true;
  try {
    const d = typeof document !== "undefined" ? document : undefined;
    if (d && d.fonts && typeof d.fonts.check === "function") return d.fonts.check(`16px "${first}"`);
  } catch {
    /* unsupported — fall through to "available" */
  }
  return true;
}

/** The menu options for a given current family: the curated list, with the
 *  current stack appended (and labelled) when it isn't already present, so the
 *  font `<Select>` can always render the active font as the chosen option. */
export function fontOptions(current: string): FontOption[] {
  if (FONT_FAMILIES.some((f) => f.value === current)) return FONT_FAMILIES;
  return [{ label: familyLabel(current), value: current }, ...FONT_FAMILIES];
}
