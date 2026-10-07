// keywordFile — Lightroom Classic's Metadata ▸ Import/Export Keywords: the
// controlled vocabulary as a tab-indented .txt tree, the format photographers
// use to move a vocabulary between catalogs and machines.
//
//   animal
//   	[dog]
//   		{canine}
//   		puppy
//
// One tab per level of nesting; a `{synonym}` line is a synonym of the keyword
// it sits under; a name in `[brackets]` is one LR leaves out of exports
// (Include on Export off). Pure model + a create-callback applier — App.tsx owns
// the file dialogs and the catalog invokes.

import type { KeywordVocabRow } from "./xmpAutoWrite";

/** The minimum a row needs to be placed in the vocabulary tree. */
export interface KeywordTreeRow {
  id: number;
  parentId: number | null;
}

/** Flatten a vocabulary into render/serialize order: depth-first, siblings
 *  keeping the incoming (name-sorted) order. A row whose parent is missing
 *  renders as a root rather than vanishing. Shared by the Keyword List panel
 *  and the keyword-file writer. */
export function keywordTree<T extends KeywordTreeRow>(
  rows: readonly T[],
): { row: T; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<number | null, T[]>();
  for (const r of rows) {
    const key = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    const list = children.get(key);
    if (list) list.push(r);
    else children.set(key, [r]);
  }
  const out: { row: T; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const row of children.get(parent) ?? []) {
      if (seen.has(row.id)) continue; // corrupt cycle guard
      seen.add(row.id);
      out.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  // A corrupt parent cycle is unreachable from any root — never lose a row.
  for (const row of rows) if (!seen.has(row.id)) out.push({ row, depth: 0 });
  return out;
}

/** One parsed keyword and its subtree. */
export interface KeywordNode {
  name: string;
  synonyms: string[];
  includeOnExport: boolean;
  children: KeywordNode[];
}

/** Names the catalog refuses — these are the keyword-entry delimiters
 *  (keywordEntry.ts), so they can never live inside a single name. */
const FORBIDDEN = /[,;|<>]/;

/** Parse a tab-indented keyword file into roots. `skipped` counts lines dropped
 *  as unusable (empty or delimiter-carrying names, a stray synonym line) so the
 *  caller can say so instead of silently losing vocabulary. */
export function parseKeywordFile(text: string): { roots: KeywordNode[]; skipped: number } {
  const roots: KeywordNode[] = [];
  const stack: KeywordNode[] = []; // stack[d] === the node currently open at depth d
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const body = raw.trim();
    if (!body) continue;
    // ponytail: tabs only, LR's own indent unit. A space-indented file reads as
    // flat; count leading spaces too if a foreign exporter ever needs it.
    const tabs = raw.length - raw.replace(/^\t+/, "").length;
    const depth = Math.min(tabs, stack.length); // an over-indented line clamps

    if (body.startsWith("{") && body.endsWith("}")) {
      const syn = body.slice(1, -1).trim();
      const owner = stack[depth - 1];
      if (syn && owner) owner.synonyms.push(syn);
      else skipped++; // a synonym with no keyword above it has nowhere to go
      continue;
    }

    const bracketed = body.startsWith("[") && body.endsWith("]");
    const name = (bracketed ? body.slice(1, -1) : body).trim();
    if (!name || FORBIDDEN.test(name)) {
      skipped++;
      // Reopen the parent level so this line's children promote up rather than
      // nesting under a keyword that was never created.
      stack.length = depth;
      continue;
    }
    const node: KeywordNode = { name, synonyms: [], includeOnExport: !bracketed, children: [] };
    if (depth === 0) roots.push(node);
    else stack[depth - 1].children.push(node);
    stack.length = depth;
    stack.push(node);
  }
  return { roots, skipped };
}

/** The vocabulary as a tab-indented keyword file (trailing newline, like LR). */
export function serializeKeywordFile(rows: readonly KeywordVocabRow[]): string {
  const lines: string[] = [];
  for (const { row, depth } of keywordTree(rows)) {
    const pad = "\t".repeat(depth);
    lines.push(pad + (row.includeOnExport ? row.name : `[${row.name}]`));
    for (const s of row.synonyms.split(",")) {
      const syn = s.trim();
      if (syn) lines.push(`${pad}\t{${syn}}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** What [`importKeywordTree`] hands its create callback. */
export interface KeywordCreate {
  name: string;
  parentId: number | null;
  synonyms: string;
  includeOnExport: boolean;
}

/** Merge parsed keywords into an existing vocabulary, creating only what is
 *  missing — LR's import merges, so re-importing the same file is a no-op and
 *  an existing keyword keeps its own place and flags. Names are catalog-unique,
 *  so matching is by name (case-insensitively, to avoid dog/Dog twins).
 *  A create that fails takes its subtree with it and lands in `failed`. */
export async function importKeywordTree(
  roots: readonly KeywordNode[],
  existing: readonly { id: number; name: string }[],
  create: (kw: KeywordCreate) => Promise<number>,
): Promise<{ created: number; failed: number }> {
  const byName = new Map(existing.map((r) => [r.name.toLowerCase(), r.id]));
  let created = 0;
  let failed = 0;
  const walk = async (nodes: readonly KeywordNode[], parentId: number | null): Promise<void> => {
    for (const node of nodes) {
      let id = byName.get(node.name.toLowerCase());
      if (id == null) {
        try {
          id = await create({
            name: node.name,
            parentId,
            synonyms: node.synonyms.join(", "),
            includeOnExport: node.includeOnExport,
          });
          byName.set(node.name.toLowerCase(), id);
          created++;
        } catch {
          failed++;
          continue; // no id — its children have no parent to hang from
        }
      }
      await walk(node.children, id);
    }
  };
  await walk(roots, null);
  return { created, failed };
}
