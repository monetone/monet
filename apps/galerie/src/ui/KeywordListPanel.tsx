// KeywordListPanel — Lightroom's Keyword List: the vocabulary as a nested tree
// with usage counts, plus the Create/Edit Keyword Tag dialog (finding 16):
// Put Inside (nesting), Synonyms, the three export flags, and Add To Selected
// Photos. Clicking a keyword browses its photos (click again for All Photos);
// ✕ deletes it — and its whole subtree — from every photo.

import { invoke } from "@tauri-apps/api/core";
import { Button, Checkbox, Dialog, Field, Input, Select } from "@monet-ui/monet-react";
import { useEffect, useState } from "react";
import type { DragEvent } from "react";

import { addKeyword } from "../catalog/catalog";
import type { KeywordCountRow } from "../catalog/types";
import { keywordTree } from "../lib/keywordFile";
import { PHOTO_DRAG_TYPE, readPhotoDrag } from "../lib/photoDrag";
import { queueXmpWrite } from "../lib/xmpAutoWrite";
import { store, useCatalog } from "../state/store";

/** A vocabulary row as `catalog_list_keywords` actually serializes it — the
 *  tree position + LR export flags ride along at runtime even though
 *  types.ts's KeywordCountRow does not declare them yet. */
export interface KwRow extends KeywordCountRow {
  parentId: number | null;
  synonyms: string;
  includeOnExport: boolean;
  exportContaining: boolean;
  exportSynonyms: boolean;
}

// The flatten lives in lib/keywordFile.ts — the keyword-file writer walks the
// vocabulary in exactly this order. Re-exported for the panel's own test.
export { keywordTree };

/** Filter-box match: case-insensitive substring over name or synonyms, keeping
 *  every ancestor of a match so the tree still reads as a tree (LR's behavior).
 *  Exported for the panel's test. */
export function filterKeywords(rows: KwRow[], query: string): KwRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keep = new Set<number>();
  for (const r of rows) {
    if (!r.name.toLowerCase().includes(q) && !r.synonyms.toLowerCase().includes(q)) continue;
    // Walk up so a matched child keeps its context; seen-guard for cycles.
    let cur: KwRow | undefined = r;
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    }
  }
  return rows.filter((r) => keep.has(r.id));
}

/** ids of `id` + every descendant — excluded from its own Put Inside options. */
function subtreeIds(rows: KwRow[], id: number): Set<number> {
  const kids = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parentId != null) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r.id]);
  }
  const out = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(kids.get(cur) ?? []));
  }
  return out;
}

/** "animal > dog" — a keyword's readable path for the Put Inside picker. */
function pathLabel(rows: KwRow[], id: number): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parts: string[] = [];
  let cur = byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" > ");
}

/** The Create/Edit Keyword Tag dialog. `editing` null = create mode. */
function KeywordTagDialog({
  rows,
  editing,
  onClose,
}: {
  rows: KwRow[];
  editing: KwRow | null;
  onClose: () => void;
}) {
  const selection = useCatalog().selection;
  const [name, setName] = useState(editing?.name ?? "");
  const [synonyms, setSynonyms] = useState(editing?.synonyms ?? "");
  const [parentId, setParentId] = useState<number | null>(editing?.parentId ?? null);
  const [includeOnExport, setIncludeOnExport] = useState(editing?.includeOnExport ?? true);
  const [exportContaining, setExportContaining] = useState(editing?.exportContaining ?? true);
  const [exportSynonyms, setExportSynonyms] = useState(editing?.exportSynonyms ?? true);
  const [addToSelected, setAddToSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A keyword cannot be put inside itself or its own subtree.
  const excluded = editing ? subtreeIds(rows, editing.id) : new Set<number>();
  const parentOpts = [
    { value: "", label: "(no parent)" },
    ...rows
      .filter((r) => !excluded.has(r.id))
      .map((r) => ({ value: String(r.id), label: pathLabel(rows, r.id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  const save = async () => {
    const args = {
      name: name.trim(),
      parentId,
      synonyms: synonyms.trim(),
      includeOnExport,
      exportContaining,
      exportSynonyms,
    };
    try {
      if (editing) {
        await invoke("plugin:catalog|catalog_update_keyword", { keywordId: editing.id, ...args });
      } else {
        await invoke("plugin:catalog|catalog_create_keyword", args);
        if (addToSelected) {
          // Names are vocabulary-unique, so tagging by leaf name hits the
          // keyword just created.
          for (const photoId of selection) await addKeyword(photoId, args.name);
        }
      }
      await store.refreshKeywordList();
      onClose();
    } catch (e) {
      setError(String(e)); // duplicate name, empty name, forbidden delimiter, cycle…
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? "Edit Keyword Tag" : "Create Keyword Tag"}
      width={380}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>
            {editing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <Field label="Keyword Name">
        {(p) => <Input {...p} block value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Synonyms" hint="Separate with commas">
        {(p) => (
          <Input {...p} block value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
        )}
      </Field>
      <Field label="Put Inside">
        {(p) => (
          <Select
            {...p}
            block
            options={parentOpts}
            value={parentId == null ? "" : String(parentId)}
            onChange={(v) => setParentId(v === "" ? null : Number(v))}
          />
        )}
      </Field>
      <Field label="Export">
        {(p) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Checkbox id={p.id} checked={includeOnExport} onChange={setIncludeOnExport}>
              Include on Export
            </Checkbox>
            <Checkbox
              checked={exportContaining}
              onChange={setExportContaining}
              disabled={!includeOnExport}
            >
              Export Containing Keywords
            </Checkbox>
            <Checkbox
              checked={exportSynonyms}
              onChange={setExportSynonyms}
              disabled={!includeOnExport}
            >
              Export Synonyms
            </Checkbox>
          </div>
        )}
      </Field>
      {!editing && selection.length > 0 && (
        <Field label="Apply">
          {(p) => (
            <Checkbox id={p.id} checked={addToSelected} onChange={setAddToSelected}>
              Add to {selection.length} Selected Photo{selection.length === 1 ? "" : "s"}
            </Checkbox>
          )}
        </Field>
      )}
      {error && (
        <div role="alert" style={{ color: "var(--accent-raster)", fontSize: 12, marginTop: 6 }}>
          {error}
        </div>
      )}
    </Dialog>
  );
}

export function KeywordListPanel() {
  const st = useCatalog();
  const [dialog, setDialog] = useState<{ editing: KwRow | null } | null>(null);
  const [filter, setFilter] = useState("");
  // Row currently hovered by a photo drag (LR's drop highlight).
  const [dropId, setDropId] = useState<number | null>(null);
  useEffect(() => {
    void store.refreshKeywordList();
  }, []);
  const rows = st.keywords as KwRow[];
  const tree = keywordTree(filterKeywords(rows, filter));

  // Drag-a-selection-onto-a-keyword tags every dragged photo (LR's drag-to-tag).
  const dropTag = async (ids: number[], name: string) => {
    for (const id of ids) {
      try {
        await addKeyword(id, name);
        // Keywords live in XMP — keep the sidecar in sync like KeywordsBar does.
        const r = store.getState().photos.find((p) => p.id === id);
        if (r) queueXmpWrite(r);
      } catch (e) {
        console.error("galerie keyword: drop tag failed", e);
      }
    }
    await store.refreshKeywordList();
  };
  const dropProps = (k: KwRow) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropId(k.id);
    },
    onDragLeave: () => setDropId((cur) => (cur === k.id ? null : cur)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropId(null);
      const ids = readPhotoDrag(e.dataTransfer);
      if (ids.length) void dropTag(ids, k.name);
    },
  });

  return (
    <div className="gal-kw-list">
      <div className="gal-kw-row" onClick={() => setDialog({ editing: null })}>
        <span className="gal-kw-name" style={{ opacity: 0.75 }}>
          + Create Keyword Tag…
        </span>
      </div>
      <input
        className="gal-kw-input"
        // ponytail: inline width override instead of a new CSS class — the shared
        // stylesheet is owned elsewhere; move to .gal-kw-filter if it grows.
        style={{ width: "auto", margin: "2px 8px 4px" }}
        value={filter}
        placeholder="Filter Keywords…"
        aria-label="Filter keywords"
        onChange={(e) => setFilter(e.target.value)}
      />
      {tree.length === 0 && (
        <div className="gal-kw-empty">{filter.trim() ? "No matching keywords" : "No keywords yet"}</div>
      )}
      {tree.map(({ row: k, depth }) => (
        <div
          key={k.id}
          className={
            "gal-kw-row" +
            (st.activeKeywordId === k.id ? " is-active" : "") +
            (dropId === k.id ? " is-drop" : "")
          }
          style={depth > 0 ? { paddingLeft: depth * 14 } : undefined}
          onClick={() => void store.setActiveKeyword(st.activeKeywordId === k.id ? null : k.id)}
          {...dropProps(k)}
        >
          <span
            className="gal-kw-name"
            style={k.includeOnExport ? undefined : { opacity: 0.55 }}
            title={k.synonyms ? `Synonyms: ${k.synonyms}` : undefined}
          >
            {k.name}
          </span>
          <span className="gal-kw-count">{k.count}</span>
          <button
            type="button"
            className="gal-kw-del"
            title="Edit keyword tag"
            onClick={(e) => {
              e.stopPropagation();
              setDialog({ editing: k });
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="gal-kw-del"
            title="Delete keyword (and any nested keywords) from all photos"
            onClick={(e) => {
              e.stopPropagation();
              void store.deleteKeyword(k.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {dialog && (
        <KeywordTagDialog rows={rows} editing={dialog.editing} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
