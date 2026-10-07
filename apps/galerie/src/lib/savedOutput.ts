// savedOutput — Lightroom Classic's Saved Print / Book / Slideshow / Web
// collections. Saving a layout in an output module makes a normal manual
// collection holding its photos, with the layout parked in the collection's
// otherwise-unused rule field (the PREVIOUS_IMPORT_MARKER / publishService
// trick), so membership, drag-drop and "browse it in the grid" come for free
// with no schema change — and the layout travels with the catalog instead of a
// localStorage side table.
//
// ponytail: reopening is "pick the saved layout in the module's own browser",
// not LR's click-the-collection-to-enter-the-module. Route the Collections
// panel click through the module router once App owns a per-module source.

import type { CollectionRow } from "../catalog/types";
import { store } from "../state/store";

/** The output modules that can be saved as a collection (LR's Output group). */
export type OutputModule = "print" | "book" | "slideshow" | "web";

/** Marker that makes a manual collection an output collection (mirrors
 *  PREVIOUS_IMPORT_MARKER's `monetSystemCollection` convention). */
export const SAVED_OUTPUT_MARKER = "saved-output";

/** Panel label per module — LR names the collection kind, not the layout. */
export const OUTPUT_LABEL: Record<OutputModule, string> = {
  print: "Saved Print",
  book: "Saved Book",
  slideshow: "Saved Slideshow",
  web: "Saved Web Gallery",
};

/** Collections-panel glyph per module (same plain-glyph vocabulary as KIND_ICON). */
export const OUTPUT_ICON: Record<OutputModule, string> = {
  print: "⎙",
  book: "◫",
  slideshow: "▷",
  web: "◍",
};

function isModule(v: unknown): v is OutputModule {
  return v === "print" || v === "book" || v === "slideshow" || v === "web";
}

/** A saved output collection: the backing row, its module, and the raw layout
 *  blob. `config` is persisted user data — sanitize it in the module that
 *  owns the shape before feeding it to a renderer. */
export interface SavedOutput {
  row: CollectionRow;
  module: OutputModule;
  config: unknown;
}

/** Serialize a layout into the collection's rule field. */
export function savedOutputMarker(module: OutputModule, config: unknown): string {
  return JSON.stringify({ monetSystemCollection: SAVED_OUTPUT_MARKER, output: module, config });
}

/** Parse a collection's rule field as a saved output; null when it is not one
 *  (a smart rule, a publish service, or a plain collection). */
export function parseSavedOutput(ruleAst: string | null): Omit<SavedOutput, "row"> | null {
  let parsed: { monetSystemCollection?: unknown; output?: unknown; config?: unknown };
  try {
    parsed = JSON.parse(ruleAst ?? "");
  } catch {
    return null;
  }
  if (parsed?.monetSystemCollection !== SAVED_OUTPUT_MARKER) return null;
  if (!isModule(parsed.output)) return null;
  return { module: parsed.output, config: parsed.config };
}

/** The module a collection was saved from, or null for a normal collection. */
export function savedOutputModule(row: CollectionRow): OutputModule | null {
  if (row.kind !== "collection") return null;
  return parseSavedOutput(row.ruleAst)?.module ?? null;
}

/** Every saved output of one module, in tree order — a module's reopen list. */
export function findSavedOutputs(
  rows: readonly CollectionRow[],
  module: OutputModule,
): SavedOutput[] {
  const out: SavedOutput[] = [];
  for (const row of rows) {
    if (row.kind !== "collection") continue;
    const parsed = parseSavedOutput(row.ruleAst);
    if (parsed?.module === module) out.push({ row, ...parsed });
  }
  return out;
}

/** Create Saved <module>: the photos become a manual collection carrying the
 *  layout, so picking it in that module's browser reproduces the output.
 *  Returns the new collection id, or null when it could not be created. */
export async function createSavedOutput(
  name: string,
  module: OutputModule,
  photoIds: readonly number[],
  config: unknown,
): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const id = await store.createCollection(trimmed, "collection", savedOutputMarker(module, config));
  if (id == null) return null; // store already surfaced the failure
  if (photoIds.length) await store.addToCollection(id, [...photoIds]);
  return id;
}
