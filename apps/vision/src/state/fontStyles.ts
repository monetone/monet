// ─────────────────────────────────────────────────────────────
// Font styles — the real subfamilies (Light / Book / Semibold / Black
// Italic …) and variable axes of the families the host discovered.
//
// Photoshop's Character panel and Type options bar offer a *style* dropdown
// next to the family, plus axis sliders for a variable face. Vision's font
// scan (engine/vectorFonts.ts) already inspects every face's real weight and
// italic flag and now reads its `fvar` axes; main.tsx pushes that here so the
// type UI can spend it. Empty in the browser build (no Tauri, no font scan) —
// GENERIC_FONT_STYLES stands in there. Faux bold/italic stay the user's own
// checkboxes: a style pick never writes them.
// ─────────────────────────────────────────────────────────────

import { cleanFontFamily, fontFamilyKey } from "../text/spec";
import type { FontAxis, VectorFontFaceInfo } from "../engine/vectorFonts";

export type { FontAxis };

/** A pickable named style of a family. `value` is its `<Select>` value: the
 *  numeric weight the rest of the type UI is keyed on, or — when the family
 *  ships two faces at the same weight and slope — that face's own name. */
export interface FontStyle { label: string; weight: number; italic: boolean; face?: string; value: string }

/** What a family offers when nothing is known about its real faces. */
export const GENERIC_FONT_STYLES: readonly FontStyle[] = [
  { label: "Regular", weight: 400, italic: false, value: "400" },
  { label: "Italic", weight: 400, italic: true, value: "400i" },
  { label: "Bold", weight: 700, italic: false, value: "700" },
  { label: "Bold Italic", weight: 700, italic: true, value: "700i" },
];

/** Registered names for the common axes, so a slider reads as "Width" rather
 *  than "wdth". Anything else falls through as its raw tag. */
const AXIS_LABELS: Record<string, string> = {
  wght: "Weight", wdth: "Width", opsz: "Optical Size", slnt: "Slant", ital: "Italic", GRAD: "Grade",
};
export const axisLabel = (tag: string): string => AXIS_LABELS[tag] ?? tag;

/** CSS font-weight's named steps — the label a face gets when it carries no
 *  usable name of its own. */
const WEIGHT_NAMES: [number, string][] = [
  [100, "Thin"], [200, "Extra Light"], [300, "Light"], [400, "Regular"], [500, "Medium"],
  [600, "Semibold"], [700, "Bold"], [800, "Extra Bold"], [900, "Black"],
];

/** The generic name for a (weight, italic) pair: "Semibold Italic", "Italic". */
export function weightStyleLabel(weight: number, italic: boolean): string {
  let best = WEIGHT_NAMES[3];
  for (const entry of WEIGHT_NAMES) {
    if (Math.abs(entry[0] - weight) < Math.abs(best[0] - weight)) best = entry;
  }
  if (!italic) return best[1];
  return best[1] === "Regular" ? "Italic" : `${best[1]} Italic`;
}

/** The style name of one face: its full name with the family prefix trimmed off
 *  ("Helvetica Neue Condensed Black" → "Condensed Black"), else the generic
 *  weight name. */
function faceStyleLabel(face: VectorFontFaceInfo): string {
  if (face.subfamily?.trim()) return face.subfamily.trim();
  const full = face.fullName?.trim() ?? "";
  const family = face.family.trim();
  const rest = full.toLowerCase().startsWith(family.toLowerCase()) ? full.slice(family.length).trim() : "";
  return rest || (full && full.toLowerCase() !== family.toLowerCase() ? full : weightStyleLabel(face.weight, face.italic));
}

/** Discovered faces, keyed by family. Module state, like text/spec's FONTS. */
const FACES = new Map<string, VectorFontFaceInfo[]>();
let signature = "";

/** Replace the registry with the host's latest scan. Returns true only when it
 *  changed, so the caller can skip a store bump (same contract as
 *  addDiscoveredFonts). */
export function setFontFaces(faces: readonly VectorFontFaceInfo[]): boolean {
  const next = JSON.stringify(faces);
  if (next === signature) return false;
  signature = next;
  FACES.clear();
  for (const face of faces) {
    // The same cleaning addDiscoveredFonts applies before a family reaches the
    // picker, so a name that needed it lands under the picker's key, not the raw one.
    const key = fontFamilyKey(cleanFontFamily(face.family ?? ""));
    if (!key || !Number.isFinite(face.weight)) continue;
    const list = FACES.get(key);
    if (list) list.push(face); else FACES.set(key, [face]);
  }
  return true;
}

/** The faces registered for a font stack's first family, or undefined when the
 *  host never scanned it (browser build, or a family outside the scan budget). */
function facesFor(font: string): VectorFontFaceInfo[] | undefined {
  const faces = FACES.get(fontFamilyKey(font));
  return faces?.length ? faces : undefined;
}

/** The style dropdown's entries for a font stack: the family's real
 *  subfamilies, lightest-to-heaviest with the romans before the italics; the
 *  generic four when the family was never inspected.
 *  ponytail: a variable face contributes one entry (the face's own name); its
 *  `fvar` named instances ("Inter SemiBold") would need a name-table read in
 *  the scan. The axis sliders reach every one of those weights already. */
export function fontStyles(font: string): FontStyle[] {
  const faces = facesFor(font);
  if (!faces) return [...GENERIC_FONT_STYLES];
  const found = faces.map((face) => ({
    label: faceStyleLabel(face), weight: face.weight, italic: face.italic,
    face: face.postscriptName?.trim() || face.fullName?.trim() || undefined,
  }));
  const byValue = new Map<string, FontStyle>();
  for (const style of found) {
    // (weight, slope) names a face on its own for all but the families that
    // ship two at once ("Bold" vs "Condensed Bold"); only those fall back to
    // the face's own name, so the plain numeric value stays the common case.
    // ponytail: an O(faces²) scan over one family's handful of faces.
    const clash = found.some((other) => other.weight === style.weight && other.italic === style.italic && other.face !== style.face);
    const value = clash && style.face ? `face:${style.face}` : `${style.weight}${style.italic ? "i" : ""}`;
    byValue.set(value, { ...style, value });
  }
  return [...byValue.values()].sort((a, b) =>
    a.italic === b.italic ? a.weight - b.weight : (a.italic ? 1 : -1));
}

/** The variable axes of a font stack — empty when the family has no variable
 *  face (or was never inspected), which is exactly when no sliders show. */
export function fontAxes(font: string, selectedFace?: string): FontAxis[] {
  const byTag = new Map<string, FontAxis>();
  for (const face of facesFor(font) ?? []) {
    if (selectedFace && (face.postscriptName?.trim() || face.fullName?.trim()) !== selectedFace) continue;
    for (const axis of face.axes ?? []) {
      if (axis.max > axis.min && !byTag.has(axis.tag)) byTag.set(axis.tag, axis);
    }
  }
  return [...byTag.values()];
}

/** A slider step that gives an axis at least a hundred positions at a round
 *  decimal, never coarser than 1: wght 100–900 → 1, wdth 62.5–100 and
 *  slnt −10–0 → 0.1, ital 0–1 → 0.01. `fvar` declares no step of its own. */
export const axisStep = (axis: FontAxis): number =>
  Math.min(1, 10 ** Math.floor(Math.log10((axis.max - axis.min) / 100)));

/** Which option the dropdown shows for a resolved (weight, italic): the run's
 *  own face when it named one, else the nearest same-slope style, so a document
 *  carrying a weight the family no longer ships still reads as *something*. */
export function matchFontStyle(styles: readonly FontStyle[], weight: number, italic: boolean, face?: string): string {
  const exact = face && styles.find((style) => style.face === face);
  if (exact) return exact.value;
  let best: FontStyle | undefined;
  let bestCost = Infinity;
  for (const style of styles) {
    const cost = Math.abs(style.weight - weight) + (style.italic === italic ? 0 : 1000);
    if (cost < bestCost) { best = style; bestCost = cost; }
  }
  return best ? best.value : "";
}

export interface StylePatch { weight: number; italic: boolean; bold: boolean; face?: string }

/** The run patch for one (weight, slope) pair — what the named Style dropdown
 *  writes. The legacy `bold` flag moves with the numeric weight
 *  (they must agree: an explicit weight outranks the flag in resolveStyle, so a
 *  B button that wrote only the flag would look dead once a style was picked).
 *  Faux bold/italic are deliberately NOT here: they are the user's own Faux
 *  checkboxes, and a style pick must leave whatever they set alone. */
export function stylePatch(weight: number, italic: boolean): StylePatch {
  return { weight, italic, bold: weight >= 600 };
}

/** The patch behind picking a named style. Null when the value is not one of
 *  this family's styles. */
export function fontStylePatch(font: string, value: string): StylePatch | null {
  const style = fontStyles(font).find((s) => s.value === value);
  return style ? { ...stylePatch(style.weight, style.italic), face: style.face } : null;
}

/** The notice for a value fontStylePatch refused (a pick gone stale after a
 *  font rescan, a scripted value). */
export const unknownFontStyleMessage = (font: string): string =>
  `That font style is not available for ${font.split(",")[0].replace(/['"]/g, "").trim()}. Choose one from the Font style list.`;
