// ─────────────────────────────────────────────────────────────
// ops/text — edit TEXT-item character / paragraph properties
// ─────────────────────────────────────────────────────────────
// Mirrors Adobe Illustrator's Character + Paragraph panels: font family, size,
// weight, style (italic), leading (line height), tracking (letter spacing) and
// paragraph alignment. Each setter mutates a doc in place; callers wrap them in
// a store transaction so an edit is one undoable step. Setters are no-ops for
// non-text items, so passing a mixed selection is safe.

import { selectionLeaves } from "../model/query";
import { estimateTextBounds } from "../model/shapes";
import { inferFontFallbacks, invalidateTextLayout } from "../model/typography";
import type { Document, FontResolution, ID, OpenTypeFeatureSetting, TextAlign, TextItem, TextWritingMode } from "../model/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const eachText = (doc: Document, ids: Iterable<ID>, fn: (t: TextItem) => void): void => {
  for (const item of selectionLeaves(doc, ids)) if (item.type === "text") fn(item);
};

const textItems = (doc: Document, ids: Iterable<ID>): TextItem[] =>
  selectionLeaves(doc, ids).filter((item): item is TextItem => item.type === "text");

/**
 * Type ▸ Convert to Area / Point Type (Illustrator). Point text (no box) ↔ area
 * text (fixed box). point→area gives a box matching the current text extent;
 * area→point removes the box (auto-width). Type-on-a-path text (pathD) is skipped.
 * Returns the ids actually converted.
 */
export const convertText = (doc: Document, ids: Iterable<ID>, target: "area" | "point"): ID[] => {
  const changed: ID[] = [];
  eachText(doc, ids, (t) => {
    if (t.pathD != null) return; // type-on-a-path is neither plain point nor area
    const isArea = t.boxWidth != null || t.boxHeight != null;
    if (target === "area" && !isArea) {
      const b = estimateTextBounds(t);
      t.boxWidth = b.width;
      t.boxHeight = b.height;
      changed.push(t.id);
    } else if (target === "point" && isArea) {
      t.boxWidth = undefined;
      t.boxHeight = undefined;
      changed.push(t.id);
    }
  });
  return changed;
};

const setFontResolution = (doc: Document, ids: Iterable<ID>, resolution: FontResolution | undefined): void =>
  eachText(doc, ids, (t) => {
    t.fontResolution = resolution ? { ...resolution, fallbacks: resolution.fallbacks?.map((fallback) => ({ ...fallback })) } : undefined;
  });

/** Font family (a CSS font-family stack, e.g. `"Georgia, serif"`). */
export const setFontFamily = (doc: Document, ids: Iterable<ID>, family: string): void => {
  const selected = [...ids];
  eachText(doc, selected, (t) => {
    t.fontFamily = family;
    invalidateTextLayout(t);
  });
  setFontResolution(doc, selected, {
    requestedFamily: family,
    status: "unresolved",
    fallbacks: inferFontFallbacks(family),
  });
};

/** Font size in points. Illustrator's minimum is 0.1pt; there is no real max. */
export const setFontSize = (doc: Document, ids: Iterable<ID>, size: number): void =>
  eachText(doc, ids, (t) => {
    t.fontSize = clamp(size, 0.1, 100000);
    invalidateTextLayout(t);
  });

/** Numeric font weight (100..900). Clears per-run weight overrides so a
 *  whole-object weight change is visible across every run (Illustrator applies
 *  a panel change to the entire type object when no characters are sub-selected). */
export const setFontWeight = (doc: Document, ids: Iterable<ID>, weight: number): void =>
  eachText(doc, ids, (t) => {
    t.fontWeight = clamp(Math.round(weight), 1, 1000);
    t.runs?.forEach((r) => {
      r.fontWeight = undefined;
    });
    invalidateTextLayout(t);
  });

/** Flip italic on/off for the whole type object. */
export const toggleItalic = (doc: Document, ids: Iterable<ID>): void => {
  const items = textItems(doc, ids);
  const italic = !items.every((item) => item.fontStyle === "italic");
  items.forEach((t) => {
    t.fontStyle = italic ? "italic" : "normal";
    t.runs?.forEach((r) => {
      r.fontStyle = undefined;
    });
    invalidateTextLayout(t);
  });
};

/** Flip underline on/off for the whole type object (Illustrator's ⌘⇧U). */
export const toggleUnderline = (doc: Document, ids: Iterable<ID>): void => {
  const items = textItems(doc, ids);
  const underline = !items.every((item) => item.underline);
  items.forEach((t) => {
    t.underline = underline;
    invalidateTextLayout(t);
  });
};

/** Flip strikethrough on/off for the whole type object (Illustrator's ⌘⇧/). */
export const toggleStrikethrough = (doc: Document, ids: Iterable<ID>): void => {
  const items = textItems(doc, ids);
  const strikethrough = !items.every((item) => item.strikethrough);
  items.forEach((t) => {
    t.strikethrough = strikethrough;
    invalidateTextLayout(t);
  });
};

/** Toggle All Caps / Small Caps (Character panel). The two are mutually exclusive,
 *  and re-applying the active mode clears it. A reversible display style — it does
 *  not rewrite the characters (that's Type ▸ Change Case). */
export const toggleCaps = (doc: Document, ids: Iterable<ID>, mode: "all" | "small"): void => {
  const items = textItems(doc, ids);
  const caps = items.every((item) => item.caps === mode) ? undefined : mode;
  items.forEach((t) => {
    t.caps = caps;
    invalidateTextLayout(t);
  });
};

/** Paragraph alignment (left / center / right / justify). */
export const setAlign = (doc: Document, ids: Iterable<ID>, align: TextAlign): void =>
  eachText(doc, ids, (t) => {
    t.align = align;
    invalidateTextLayout(t);
  });

/** Leading as a line-height multiple of the font size. */
export const setLineHeight = (doc: Document, ids: Iterable<ID>, lineHeight: number): void =>
  eachText(doc, ids, (t) => {
    t.lineHeight = clamp(lineHeight, 0, 100);
    invalidateTextLayout(t);
  });

/** Leading in points, converted against each selected object's own font size. */
export const setLeading = (doc: Document, ids: Iterable<ID>, points: number): void =>
  eachText(doc, ids, (t) => {
    if (t.fontSize > 0) t.lineHeight = clamp(points / t.fontSize, 0, 100);
    invalidateTextLayout(t);
  });

/** Tracking / letter spacing in user units (may be negative). */
export const setLetterSpacing = (doc: Document, ids: Iterable<ID>, spacing: number): void =>
  eachText(doc, ids, (t) => {
    t.letterSpacing = spacing;
    invalidateTextLayout(t);
  });

export const setLanguage = (doc: Document, ids: Iterable<ID>, language: string | undefined): void =>
  eachText(doc, ids, (t) => {
    t.language = language || undefined;
    invalidateTextLayout(t);
  });

export const setWritingMode = (doc: Document, ids: Iterable<ID>, writingMode: TextWritingMode): void =>
  eachText(doc, ids, (t) => {
    t.writingMode = writingMode === "horizontal-tb" ? undefined : writingMode;
    invalidateTextLayout(t);
  });

export const setOpenTypeFeatures = (doc: Document, ids: Iterable<ID>, features: OpenTypeFeatureSetting[] | undefined): void =>
  eachText(doc, ids, (t) => {
    t.features = features?.length ? features.map((feature) => ({ ...feature })) : undefined;
    invalidateTextLayout(t);
  });

// ── Advanced Character ───────────────────────────────────────

/** Baseline shift in user units (positive raises). */
export const setBaselineShift = (doc: Document, ids: Iterable<ID>, shift: number): void =>
  eachText(doc, ids, (t) => {
    t.baselineShift = shift || undefined;
    invalidateTextLayout(t);
  });

/** Horizontal glyph scale, percent (clamped 1..1000). */
export const setHorizontalScale = (doc: Document, ids: Iterable<ID>, pct: number): void =>
  eachText(doc, ids, (t) => {
    const v = clamp(pct, 1, 1000);
    t.horizontalScale = v === 100 ? undefined : v;
    invalidateTextLayout(t);
  });

/** Vertical glyph scale, percent (clamped 1..1000). */
export const setVerticalScale = (doc: Document, ids: Iterable<ID>, pct: number): void =>
  eachText(doc, ids, (t) => {
    const v = clamp(pct, 1, 1000);
    t.verticalScale = v === 100 ? undefined : v;
    invalidateTextLayout(t);
  });

/** Pair kerning (auto / none). */
export const setKerning = (doc: Document, ids: Iterable<ID>, kerning: "auto" | "none"): void =>
  eachText(doc, ids, (t) => {
    t.kerning = kerning === "auto" ? undefined : "none";
    invalidateTextLayout(t);
  });

// ── Advanced Paragraph ───────────────────────────────────────

/** Space before each paragraph (user units). */
export const setSpaceBefore = (doc: Document, ids: Iterable<ID>, v: number): void =>
  eachText(doc, ids, (t) => {
    t.spaceBefore = v || undefined;
    invalidateTextLayout(t);
  });

/** Space after each paragraph (user units). */
export const setSpaceAfter = (doc: Document, ids: Iterable<ID>, v: number): void =>
  eachText(doc, ids, (t) => {
    t.spaceAfter = v || undefined;
    invalidateTextLayout(t);
  });

/** Left indent (user units). */
export const setIndentLeft = (doc: Document, ids: Iterable<ID>, v: number): void =>
  eachText(doc, ids, (t) => {
    t.indentLeft = v || undefined;
    invalidateTextLayout(t);
  });

/** Right indent — only affects wrapped area type (user units). */
export const setIndentRight = (doc: Document, ids: Iterable<ID>, v: number): void =>
  eachText(doc, ids, (t) => {
    t.indentRight = v || undefined;
    invalidateTextLayout(t);
  });

/** First-line indent (user units; may be negative for a hanging indent). */
export const setIndentFirst = (doc: Document, ids: Iterable<ID>, v: number): void =>
  eachText(doc, ids, (t) => {
    t.indentFirst = v || undefined;
    invalidateTextLayout(t);
  });

/** Replace the text content. Flattens rich runs to single-run text (matching the
 *  inline editor) and refreshes the auto-name. */
export const setText = (doc: Document, ids: Iterable<ID>, text: string): void =>
  eachText(doc, ids, (t) => {
    if (text === t.text) return; // no-op: keep rich runs intact
    t.text = text;
    t.runs = undefined;
    invalidateTextLayout(t);
    if (text.trim()) t.name = text.slice(0, 24);
  });
