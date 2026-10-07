// ─────────────────────────────────────────────────────────────
// io/json — .artisan document serialization (round-trippable)
// ─────────────────────────────────────────────────────────────

import type { Document } from "../model/types";

export const ARTISAN_FORMAT = "monet-artisan";
export const ARTISAN_VERSION = 1;

export interface ArtisanFile {
  format: string;
  version: number;
  document: Document;
}

export const serializeDocument = (doc: Document, pretty = false): string =>
  JSON.stringify({ format: ARTISAN_FORMAT, version: ARTISAN_VERSION, document: doc }, null, pretty ? 2 : 0);

/** Defensive ceiling on document tree depth — the renderer and `eachItem` recurse
 *  the item tree, so a maliciously deep `.artisan` could otherwise blow the stack. */
const MAX_DOC_DEPTH = 1000;

/** In-place: clamp non-finite numbers (1e999 → Infinity slips through JSON.parse
 *  and corrupts geometry/bbox math) to 0, and reject pathological nesting. */
const sanitizeTree = (value: unknown, depth: number): void => {
  if (depth > MAX_DOC_DEPTH) throw new Error("Monet Artisan document nesting too deep");
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string | number, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) obj[key] = 0;
    } else if (v && typeof v === "object") {
      sanitizeTree(v, depth + 1);
    }
  }
};

export const deserializeDocument = (text: string): Document => {
  const data = JSON.parse(text);
  let doc: Document | null = null;
  if (data && typeof data === "object") {
    if (data.format === ARTISAN_FORMAT && data.document) doc = data.document as Document;
    // Tolerate a bare document object too.
    else if (Array.isArray(data.layers) && Array.isArray(data.artboards)) doc = data as Document;
  }
  if (!doc) throw new Error("Not a valid Monet Artisan document");
  sanitizeTree(doc, 0);
  return doc;
};
