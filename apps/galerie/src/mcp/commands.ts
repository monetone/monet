// Monet Galerie — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a
// command changes without regenerating. To add a tool, add a typed, `@mcp`-
// tagged exported function that delegates to the catalog store — MCP automation
// and the UI stay in lockstep because both call the same store actions.
//
// These operate on the *currently active* photo where relevant, so an MCP
// client can cull without juggling ids (select, then rate/flag/label).

import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import type { PhotoRow } from "../catalog/types";
import { importPaths } from "../import";
import { importKeywordTree, parseKeywordFile, serializeKeywordFile } from "../lib/keywordFile";
import type { KeywordVocabRow } from "../lib/xmpAutoWrite";
import { store, type Module } from "../state/store";

function base(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** The active photo (or the first selected), or throw a client-actionable error. */
function activePhoto(): PhotoRow {
  const s = store.getState();
  const id = s.activeId ?? s.selection[0];
  const p = id != null ? s.photos.find((x) => x.id === id) : undefined;
  if (!p) throw new Error("No photo selected — select a photo first");
  return p;
}

const clampRating = (n: number) => Math.max(0, Math.min(5, Math.round(n)));

// ── Library ─────────────────────────────────────────────────────────────────

/**
 * Set the Library rating filter (show only photos rated at least minRating).
 * @mcp library.setFilter
 * @param minRating Minimum star rating 0–5 (0 shows all).
 */
export async function setFilter(minRating: number): Promise<string> {
  await store.setFilter(clampRating(minRating));
  return `Filter: rating ≥ ${store.getState().filterMinRating}`;
}

/**
 * Switch the active module.
 * @mcp library.setModule
 * @param module Module to show.
 */
export function setModule(module: Module): string {
  store.setModule(module);
  return `Module: ${module}`;
}

/**
 * Import a photo file into the catalog by absolute path.
 * @mcp library.import
 * @param path Absolute file path to import.
 */
export async function importFile(path: string): Promise<string> {
  const n = await importPaths([path]);
  return n > 0 ? `Imported ${base(path)}` : `Could not import ${base(path)}`;
}

/**
 * Make the next photo in the grid active (for sequential culling).
 * @mcp library.selectNext
 */
export function selectNext(): string {
  return moveSelection(1);
}

/**
 * Make the previous photo in the grid active.
 * @mcp library.selectPrevious
 */
export function selectPrevious(): string {
  return moveSelection(-1);
}

function moveSelection(delta: number): string {
  if (store.getState().photos.length === 0) return "No photos loaded";
  store.moveActive(delta);
  const s = store.getState();
  const p = s.activeId != null ? s.photos.find((x) => x.id === s.activeId) : undefined;
  return p ? `Active: ${base(p.path)}` : "No photos loaded";
}

/**
 * Summarize the current Library state (counts + active photo).
 * @mcp library.summary
 */
export function summary(): string {
  const s = store.getState();
  const active = s.activeId != null ? s.photos.find((p) => p.id === s.activeId) : undefined;
  const parts = [
    `${s.total} photos (filter ≥ ${s.filterMinRating}★)`,
    `${s.selection.length} selected`,
    `module: ${s.module}`,
  ];
  if (active) {
    const f = active.flag === 1 ? " pick" : active.flag === -1 ? " reject" : "";
    parts.push(`active: ${base(active.path)} — ${active.rating}★${f}`);
  }
  return parts.join(" · ");
}

// ── Culling the active photo ──────────────────────────────────────────────────

/**
 * Set the star rating of the active photo.
 * @mcp photo.rate
 * @param rating Star rating 0–5.
 */
export async function rate(rating: number): Promise<string> {
  const p = activePhoto();
  const r = clampRating(rating);
  await store.cull(p.id, r, p.flag, p.colorLabel);
  return `Rated ${base(p.path)} ${r}★`;
}

/**
 * Set the pick/reject flag of the active photo.
 * @mcp photo.flag
 * @param flag Flag value: 1 pick, 0 none, -1 reject.
 */
export async function setFlag(flag: number): Promise<string> {
  const p = activePhoto();
  const f = flag > 0 ? 1 : flag < 0 ? -1 : 0;
  await store.cull(p.id, p.rating, f, p.colorLabel);
  return `${base(p.path)}: ${f === 1 ? "pick" : f === -1 ? "reject" : "unflagged"}`;
}

/**
 * Set the color label of the active photo.
 * @mcp photo.label
 * @param color Color label (red, yellow, green, blue, purple), or empty to clear.
 */
export async function setLabel(color: string): Promise<string> {
  const p = activePhoto();
  const c = color.trim() || null;
  await store.cull(p.id, p.rating, p.flag, c);
  return `${base(p.path)}: label ${c ?? "none"}`;
}

// ── Photo ──────────────────────────────────────────────────────────────────

/**
 * Make Master Photo — promote the active virtual copy to master, demoting the
 * current master to a copy.
 * @mcp photo.makeMasterPhoto
 */
export async function makeMasterPhoto(): Promise<string> {
  const p = activePhoto();
  await store.makeMasterPhoto(p.id);
  return `Made master photo: ${base(p.path)}`;
}

// ── Develop ──────────────────────────────────────────────────────────────────

/**
 * Sync Settings — push the active photo's develop recipe to the rest of the
 * current selection.
 * @mcp develop.sync
 * @param scope Panels to push (e.g. basic, tone, color); omit to push the whole recipe.
 */
export async function syncDevelop(scope?: string[]): Promise<string> {
  const p = activePhoto();
  const ids = store.getState().selection;
  await store.syncDevelop(p.id, ids, { scope });
  const n = ids.filter((id) => id !== p.id).length;
  return `Synced settings from ${base(p.path)} to ${n} photo${n === 1 ? "" : "s"}`;
}

/**
 * Auto Sync — while on, mirror every develop edit to the active photo onto
 * the rest of the selection as you make it.
 * @mcp develop.setAutoSync
 * @param on True to enable Auto Sync, false to disable.
 */
export function setAutoSync(on: boolean): string {
  store.setAutoSync(on);
  return on ? "Auto Sync: on" : "Auto Sync: off";
}

/**
 * Match Total Exposures — set each selected photo's Exposure so its rendered
 * brightness matches the active photo.
 * @mcp develop.matchTotalExposures
 */
export async function matchTotalExposures(): Promise<string> {
  const p = activePhoto();
  const ids = store.getState().selection;
  await store.matchTotalExposures(p.id, ids);
  return `Matched total exposure from ${base(p.path)} across the selection`;
}

// ── Keywords ───────────────────────────────────────────────────────────────

/**
 * Import Keywords — merge a tab-indented keyword file into the catalog
 * vocabulary. Existing names are reused, so a re-import is a no-op.
 * @mcp keywords.import
 * @param path Absolute path to a tab-indented keyword list (.txt).
 */
export async function importKeywords(path: string): Promise<string> {
  const { roots, skipped } = parseKeywordFile(await readTextFile(path));
  const { created, failed } = await importKeywordTree(roots, await store.keywordVocab(), (kw) =>
    invoke<number>("plugin:catalog|catalog_create_keyword", {
      name: kw.name,
      parentId: kw.parentId,
      synonyms: kw.synonyms,
      includeOnExport: kw.includeOnExport,
      // The file format carries neither flag; LR's own defaults apply.
      exportContaining: true,
      exportSynonyms: true,
    }),
  );
  await store.refreshKeywordList();
  const lost = skipped + failed;
  return `Imported ${created} keyword${created === 1 ? "" : "s"}${lost ? ` — ${lost} skipped` : ""}`;
}

/**
 * Export Keywords — write the whole vocabulary as a tab-indented keyword file.
 * @mcp keywords.export
 * @param path Absolute destination path (.txt).
 */
export async function exportKeywords(path: string): Promise<string> {
  const vocab = await store.keywordVocab();
  await writeTextFile(path, serializeKeywordFile(vocab));
  return `Exported ${vocab.length} keyword${vocab.length === 1 ? "" : "s"}`;
}
