// ─────────────────────────────────────────────────────────────
// New Guide — pure helpers for Photoshop's View ▸ New Guide… dialog. The dialog
// adds a single horizontal or vertical guide at a document-space position; these
// supply the dialog's default position and clamp the typed value into the canvas.
// Engine-free so it unit-tests in node; the dialog calls store.addGuide(o, p).
// Vertical guides live at x∈[0,docW]; horizontal guides at y∈[0,docH].
// ─────────────────────────────────────────────────────────────

import { convertDocumentLength, type DocumentSizeUnit } from "./docPresets";

export type GuideOrientation = "h" | "v";

export interface Guide {
  o: GuideOrientation;
  p: number;
  color: string;
}

export const DEFAULT_GUIDE_COLOR = "#33aaff";
export const MAX_PERSISTED_GUIDES = 10_000;

const GUIDE_COLOR = /^#[0-9a-f]{6}$/i;
const GUIDE_POSITION = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(px|%|in|cm|mm|pt|pc)?\s*$/i;

/** The dialog's default position (doc px): the centre of the relevant axis. */
export function defaultGuidePos(o: GuideOrientation, docW: number, docH: number): number {
  return Math.round((o === "v" ? docW : docH) / 2);
}

/** Parse Photoshop-style position text into document pixels. A bare number is
 *  pixels; percentages use the selected orientation's axis; physical units use
 *  the document resolution. Validation is separate from the final edge clamp. */
export function parseGuidePosition(
  value: string,
  o: GuideOrientation,
  docW: number,
  docH: number,
  resolutionPpi: number,
): number | null {
  const match = GUIDE_POSITION.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "px").toLowerCase();
  const px = unit === "%"
    ? amount * (o === "v" ? docW : docH) / 100
    : convertDocumentLength(amount, unit as DocumentSizeUnit, "px", resolutionPpi);
  // Guard the *converted* value: a finite amount can still overflow to Infinity
  // once multiplied by the axis/resolution (e.g. a ~1e308 input).
  return Number.isFinite(px) ? px : null;
}

/** Clamp a typed New Guide position into the document bounds (out-of-range snaps
 *  to the nearest edge; non-finite → 0). Rounds to a whole pixel like addGuide. */
export function clampGuidePos(o: GuideOrientation, p: number, docW: number, docH: number): number {
  if (!Number.isFinite(p)) return 0;
  const max = Math.max(0, o === "v" ? docW : docH);
  return Math.max(0, Math.min(max, Math.round(p)));
}

/** Normalize untrusted/project guide payloads into bounded, immutable data.
 *  Runtime/project guides can lie outside the canvas after a geometry edit;
 *  explicit document bounds are only for entry that must stay on-canvas. */
export function normalizeGuides(
  value: unknown,
  docW?: number,
  docH?: number,
): Guide[] {
  if (!Array.isArray(value)) return [];
  const guides: Guide[] = [];
  for (const item of value.slice(0, MAX_PERSISTED_GUIDES)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<Guide>;
    if ((raw.o !== "h" && raw.o !== "v") || typeof raw.p !== "number" || !Number.isFinite(raw.p)) continue;
    guides.push({
      o: raw.o,
      p: docW !== undefined && docH !== undefined
        ? clampGuidePos(raw.o, raw.p, docW, docH)
        : Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.round(raw.p))),
      color: typeof raw.color === "string" && GUIDE_COLOR.test(raw.color)
        ? raw.color.toLowerCase()
        : DEFAULT_GUIDE_COLOR,
    });
  }
  return guides;
}

/** Clone trusted runtime guides through the same persistence bounds. */
export function cloneGuides(guides: readonly Guide[]): Guide[] {
  return normalizeGuides(guides);
}
