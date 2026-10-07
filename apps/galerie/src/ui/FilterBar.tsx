// FilterBar — the Library filter (rating floor + flag + color label), shown in
// the options bar. Each control toggles; clicking the active one clears it. The
// catalog query applies rating/flag/label together (state/store → catalog.rs).

import { useEffect, useState } from "react";

import { Popover, Select, Slider } from "@monet-ui/monet-react";

import {
  META_COLUMNS,
  type MetaColumnId,
  type MetaSelection,
  type MetadataFilterPatch,
  SORT_KEYS,
  type SortKey,
} from "../catalog/types";
import { GRID_CELL_MAX, GRID_CELL_MIN, store, useCatalogSelector } from "../state/store";
import { labelName } from "../lib/labelSet";
import {
  BUILTIN_FILTER_PRESETS,
  deleteFilterPreset,
  listFilterPresets,
  saveFilterPreset,
  type FilterPreset,
} from "../lib/filterPresets";

/** Menu text per sort key. A `Record` (not a list) so adding a `SortKey` without
 *  a menu entry is a type error rather than a column the user can't reach. */
const SORT_LABELS: Record<SortKey, string> = {
  capture: "Capture Time",
  added: "Added Order",
  edittime: "Edit Time",
  editcount: "Edit Count",
  rating: "Rating",
  flag: "Pick Flag",
  label: "Label Text",
  filename: "File Name",
  filetype: "File Type",
  aspect: "Aspect Ratio",
  user: "User Order",
};

const FLAGS: { v: number; glyph: string; cls: string; title: string }[] = [
  { v: 1, glyph: "⚑", cls: "is-pick", title: "Picks" },
  { v: 0, glyph: "⚐", cls: "", title: "Unflagged" },
  { v: -1, glyph: "⚑", cls: "is-reject", title: "Rejects" },
];

// ── Metadata browser (LR's Library Filter ▸ Metadata tab) ──────────────
// N user-chosen columns, each a multi-select list of that column's distinct
// values with live counts. The chosen columns persist per machine; the values
// themselves live in the catalog filter.
const META_COLS_KEY = "galerie.filter.metaColumns";
/** LR's out-of-the-box four. */
const DEFAULT_META_COLS: MetaColumnId[] = ["year", "camera", "lens", "label"];
const META_COL_MIN = 1;
const META_COL_MAX = 8;
const META_COL_IDS = new Set<string>(META_COLUMNS.map((c) => c.id));

/** Read the persisted column choice, dropping ids this build no longer knows
 *  (localStorage is user-writable and survives a column being renamed). */
export function loadMetaCols(): MetaColumnId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(META_COLS_KEY) ?? "null");
    if (Array.isArray(raw)) {
      const ok = raw.filter((v): v is MetaColumnId => typeof v === "string" && META_COL_IDS.has(v));
      if (ok.length >= META_COL_MIN) return ok.slice(0, META_COL_MAX);
    }
  } catch {
    // corrupt entry — fall through to the default set
  }
  return DEFAULT_META_COLS;
}

/** The selection a column's list box change produces. The "" row is LR's
 *  "All": picking it (or picking nothing) drops the column's constraint. */
export function nextMetaSelection(
  meta: MetaSelection,
  id: MetaColumnId,
  picked: string[],
): MetaSelection {
  const next = { ...meta };
  const values = picked.filter((v) => v !== "");
  if (values.length && !picked.includes("")) next[id] = values;
  else delete next[id];
  return next;
}

function saveMetaCols(cols: MetaColumnId[]): void {
  try {
    localStorage.setItem(META_COLS_KEY, JSON.stringify(cols));
  } catch {
    // private mode / quota — the column choice just won't persist
  }
}

const LABELS: [string, string][] = [
  ["red", "#e5484d"],
  ["yellow", "#f5d90a"],
  ["green", "#46a758"],
  ["blue", "#3b82f6"],
  ["purple", "#8b5cf6"],
];

export function FilterBar() {
  const min = useCatalogSelector((s) => s.filterMinRating);
  const flag = useCatalogSelector((s) => s.filterFlag);
  const label = useCatalogSelector((s) => s.filterLabel);
  const sort = useCatalogSelector((s) => s.sort);
  const activeCollectionId = useCatalogSelector((s) => s.activeCollectionId);
  const collections = useCatalogSelector((s) => s.collections);
  const selectionCount = useCatalogSelector((s) => s.selection.length);
  const userOrderAvailable = collections.some(
    (c) => c.id === activeCollectionId && c.kind === "collection",
  );
  const cellSize = useCatalogSelector((s) => s.gridCellSize);
  const total = useCatalogSelector((s) => s.total);
  // Filename search: a responsive local input, debounced into the catalog query.
  const filterText = useCatalogSelector((s) => s.filterText);
  const [text, setText] = useState(filterText);
  const textTarget = useCatalogSelector((s) => s.filterTextTarget);
  const locked = useCatalogSelector((s) => s.filterLocked);
  const [saved, setSaved] = useState<FilterPreset[]>(() => listFilterPresets());
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const ratingOp = useCatalogSelector((s) => s.filterRatingOp);
  const options = useCatalogSelector((s) => s.filterOptions);
  const ready = useCatalogSelector((s) => s.ready);
  // Metadata browser: which columns are shown, and what is picked in each.
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaCols, setMetaCols] = useState<MetaColumnId[]>(loadMetaCols);
  const [meta, setMeta] = useState<MetaSelection>({});
  useEffect(() => {
    if (ready) void store.refreshFilterOptions();
  }, [ready]);
  /** Push a column selection into the catalog query, then re-read the option
   *  counts so the other columns narrow. */
  // ponytail: the counts request carries no filter, so they are catalog-wide
  // until the store forwards the active filter to `listFilterOptions` — the
  // backend already narrows each column by the others when it is given one.
  const applyMeta = (next: MetaSelection) => {
    setMeta(next);
    const patch: MetadataFilterPatch = { meta: next };
    void store.setMetadataFilter(patch).then(() => store.refreshFilterOptions());
  };
  const pickColumn = (index: number, id: MetaColumnId) => {
    const next = metaCols.slice();
    const dropped = next[index];
    next[index] = id;
    setMetaCols(next);
    saveMetaCols(next);
    // A column that leaves the browser must not keep filtering invisibly.
    if (dropped !== id && meta[dropped]?.length) {
      const cleared = { ...meta };
      delete cleared[dropped];
      applyMeta(cleared);
    }
  };
  const pickValues = (id: MetaColumnId, picked: string[]) =>
    applyMeta(nextMetaSelection(meta, id, picked));
  /** How many columns currently constrain the query (badge on the toggle). */
  const metaActive = Object.values(meta).filter((v) => v?.length).length;
  const setColumnCount = (n: number) => {
    const count = Math.min(META_COL_MAX, Math.max(META_COL_MIN, n));
    if (count === metaCols.length) return;
    if (count < metaCols.length) {
      const cleared = { ...meta };
      let changed = false;
      for (const id of metaCols.slice(count)) {
        if (cleared[id]?.length) {
          delete cleared[id];
          changed = true;
        }
      }
      const next = metaCols.slice(0, count);
      setMetaCols(next);
      saveMetaCols(next);
      if (changed) applyMeta(cleared);
      return;
    }
    // Grow with the first column not already on screen (else repeat the last).
    const unused = META_COLUMNS.find((c) => !metaCols.includes(c.id));
    const next = [...metaCols, unused?.id ?? metaCols[metaCols.length - 1]];
    setMetaCols(next);
    saveMetaCols(next);
  };
  useEffect(() => {
    setText(filterText);
  }, [filterText]);
  useEffect(() => {
    const t = setTimeout(() => void store.setTextFilter(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  // Metadata browser: a Monet popover (portalled, so the options toolbar can't
  // clip it). ponytail: inline styles; move into galerie.css once it settles.
  const metaBrowser = (
    <div
      className="gal-meta-browser"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: 6,
        maxWidth: "calc(100vw - 16px)",
        overflowX: "auto",
      }}
    >
      {metaCols.map((id, i) => {
        const opts = options?.columns?.[id] ?? [];
        const all = opts.reduce((n, o) => n + o.count, 0);
        const picked = meta[id] ?? [];
        const name = META_COLUMNS.find((c) => c.id === id)?.label ?? id;
        return (
          <div
            key={`${id}-${i}`}
            style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}
          >
            <Select
              size="sm"
              block
              aria-label={`Metadata column ${i + 1}`}
              value={id}
              options={META_COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(v) => pickColumn(i, v as MetaColumnId)}
            />
            <select
              className="gal-filter-sort"
              aria-label={`${name} values`}
              multiple
              size={6}
              style={{ cursor: "default" }}
              value={picked.length ? picked : [""]}
              onChange={(e) =>
                pickValues(
                  id,
                  Array.from(e.target.selectedOptions, (o) => o.value),
                )
              }
            >
              <option value="">All ({all})</option>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <button
          type="button"
          className="gal-filter-btn"
          title="Add a metadata column"
          aria-label="Add a metadata column"
          disabled={metaCols.length >= META_COL_MAX}
          onClick={() => setColumnCount(metaCols.length + 1)}
        >
          +
        </button>
        <button
          type="button"
          className="gal-filter-btn"
          title="Remove the last metadata column"
          aria-label="Remove the last metadata column"
          disabled={metaCols.length <= META_COL_MIN}
          onClick={() => setColumnCount(metaCols.length - 1)}
        >
          −
        </button>
        <button
          type="button"
          className="gal-filter-btn"
          title="Clear every metadata column"
          disabled={metaActive === 0}
          onClick={() => applyMeta({})}
        >
          Clear
        </button>
      </div>
    </div>
  );
  return (
    <div className="gal-filter">
      <Select
        size="sm"
        aria-label="Filter preset"
        title="Apply a filter preset"
        value=""
        placeholder="Preset…"
        options={[...BUILTIN_FILTER_PRESETS, ...saved].map((p) => ({ value: p.name }))}
        onChange={(name) => {
          const preset =
            BUILTIN_FILTER_PRESETS.find((p) => p.name === name) ??
            saved.find((p) => p.name === name);
          if (preset) {
            void store.applyFilterSnapshot(preset.snapshot);
            setLastApplied(saved.some((p) => p.name === name) ? name : null);
          }
        }}
      />
      <button
        type="button"
        className="gal-filter-btn"
        title="Save the current filter as a preset"
        onClick={() => {
          const name = window.prompt("Preset name");
          if (name?.trim()) setSaved(saveFilterPreset(name, store.captureFilterSnapshot()));
        }}
      >
        Save…
      </button>
      {lastApplied != null && (
        <button
          type="button"
          className="gal-filter-btn"
          title={`Delete preset "${lastApplied}"`}
          onClick={() => {
            setSaved(deleteFilterPreset(lastApplied));
            setLastApplied(null);
          }}
        >
          ✕
        </button>
      )}
      <button
        type="button"
        className={"gal-filter-btn" + (locked ? " is-sel" : "")}
        title="Filter lock — keep the filter when switching sources"
        onClick={() => store.setFilterLocked(!locked)}
      >
        {locked ? "🔒" : "🔓"}
      </button>
      <span className="gal-filter-sep" />
      <button
        type="button"
        className="gal-filter-label gal-filter-op"
        title="Rating comparison — click to cycle ≥ / = / ≤"
        onClick={() =>
          void store.setRatingOp(ratingOp === ">=" ? "=" : ratingOp === "=" ? "<=" : ">=")
        }
      >
        Rating {ratingOp === ">=" ? "≥" : ratingOp === "=" ? "=" : "≤"}
      </button>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={"gal-filter-btn" + (min === n ? " is-sel" : "")}
          onClick={() => void store.setFilter(n)}
        >
          {n === 0 ? "All" : "★".repeat(n)}
        </button>
      ))}

      <span className="gal-filter-sep" />
      {FLAGS.map((f) => (
        <button
          key={f.v}
          title={f.title}
          className={`gal-filter-flag ${f.cls}${flag === f.v ? " is-sel" : ""}`}
          onClick={() => void store.setFlagFilter(flag === f.v ? null : f.v)}
        >
          {f.glyph}
        </button>
      ))}

      <span className="gal-filter-sep" />
      {LABELS.map(([name, color]) => (
        <button
          key={name}
          title={labelName(name)}
          className={"gal-filter-swatch" + (label === name ? " is-sel" : "")}
          style={{ background: color }}
          onClick={() => void store.setLabelFilter(label === name ? null : name)}
        />
      ))}

      <span className="gal-filter-sep" />
      <input
        className="gal-filter-search"
        type="search"
        placeholder="Filename…"
        aria-label="Search by filename"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Select
        size="sm"
        aria-label="Search in"
        title="Where the text search looks"
        value={textTarget}
        options={[
          { value: "path", label: "Filename" },
          { value: "title", label: "Title" },
          { value: "caption", label: "Caption" },
          { value: "keywords", label: "Keywords" },
          { value: "copyName", label: "Copy Name" },
          { value: "any", label: "Any Field" },
        ]}
        onChange={(v) => void store.setTextTarget(v as typeof textTarget)}
      />

      <span className="gal-filter-sep" />
      <Popover
        open={metaOpen}
        onOpenChange={setMetaOpen}
        align="start"
        trapFocus={false}
        label="Metadata filter columns"
        content={metaBrowser}
      >
        <button
          type="button"
          className={"gal-filter-btn" + (metaOpen || metaActive > 0 ? " is-sel" : "")}
          title="Metadata browser — filter by any set of metadata columns"
          onClick={() => setMetaOpen(!metaOpen)}
        >
          Metadata{metaActive > 0 ? ` (${metaActive})` : ""} ▾
        </button>
      </Popover>
      <span className="gal-filter-sep" />
      <span className="gal-filter-label">Sort</span>
      <Select
        size="sm"
        aria-label="Sort by"
        value={sort.key}
        options={SORT_KEYS.filter((k) => k !== "user" || userOrderAvailable).map((k) => ({
          value: k,
          label: SORT_LABELS[k],
        }))}
        onChange={(v) => {
          const key = v as SortKey;
          void store.setSort({ key, ascending: key === "user" ? true : sort.ascending });
        }}
      />
      <button
        className="gal-filter-btn"
        title={sort.ascending ? "Ascending — click for descending" : "Descending — click for ascending"}
        aria-label={sort.ascending ? "Ascending" : "Descending"}
        disabled={sort.key === "user"}
        onClick={() => void store.setSort({ key: sort.key, ascending: !sort.ascending })}
      >
        {sort.ascending ? "↑" : "↓"}
      </button>
      {sort.key === "user" && userOrderAvailable && (
        <>
          <button
            className="gal-filter-btn"
            disabled={selectionCount === 0}
            title="Move selected photos earlier in User Order"
            onClick={() => void store.moveUserOrder(-1)}
          >
            Earlier
          </button>
          <button
            className="gal-filter-btn"
            disabled={selectionCount === 0}
            title="Move selected photos later in User Order"
            onClick={() => void store.moveUserOrder(1)}
          >
            Later
          </button>
        </>
      )}

      <span className="gal-filter-sep" />
      <span className="gal-filter-label" title="Thumbnail size">◱</span>
      <Slider
        className="gal-filter-thumbs"
        aria-label="Thumbnail size"
        min={GRID_CELL_MIN}
        max={GRID_CELL_MAX}
        step={8}
        accent="var(--accent-raster)"
        value={cellSize}
        onChange={(v) => store.setGridCellSize(v)}
      />

      <span className="gal-filter-count">{total} photos</span>
    </div>
  );
}
