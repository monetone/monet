// CollectionsPanel — the Library left rail (Phase 1 DAM). Lists the catalog's
// collections + smart collections, switches the grid source on click, and
// creates collections, sets, or smart collections. Smart collections get a
// compact rule builder that emits
// the same field/op/value AST the catalog compiles to SQL (catalog.rs).

import { Button, Input, Select } from "@monet-ui/monet-react";
import { useState } from "react";
import type { DragEvent } from "react";

import type { CollectionRow, SmartCriterion, SmartNode, SmartRule } from "../catalog/types";
import { PHOTO_DRAG_TYPE, readPhotoDrag } from "../lib/photoDrag";
import { isPublishService } from "../lib/publishService";
import { QUICK_COLLECTION_NAME, findQuickCollection, resolveTargetId } from "../lib/quickCollection";
import { OUTPUT_ICON, OUTPUT_LABEL, savedOutputModule } from "../lib/savedOutput";
import {
  PREVIOUS_IMPORT_NAME,
  findPreviousImport,
  store,
  useCatalog,
} from "../state/store";

// Whitelisted fields/ops — must stay in sync with compile_criterion in catalog.rs.
const FIELDS: { id: string; label: string }[] = [
  { id: "rating", label: "Rating" },
  { id: "flag", label: "Flag" },
  { id: "colorLabel", label: "Color Label" },
  { id: "keyword", label: "Keyword" },
  { id: "camera", label: "Camera" },
  { id: "make", label: "Make" },
  { id: "lens", label: "Lens" },
  { id: "iso", label: "ISO" },
  { id: "fNumber", label: "Aperture" },
  { id: "focalLength", label: "Focal Length" },
  { id: "exposureTime", label: "Shutter Speed (s)" },
  { id: "filename", label: "Filename" },
  { id: "folder", label: "Folder" },
  { id: "format", label: "Format" },
  { id: "copyName", label: "Copy Name" },
  { id: "byteSize", label: "File Size (bytes)" },
  { id: "width", label: "Width (px)" },
  { id: "height", label: "Height (px)" },
  { id: "longEdge", label: "Long Edge (px)" },
  { id: "megapixels", label: "Megapixels" },
  { id: "aspectRatio", label: "Aspect Ratio" },
  { id: "captureDate", label: "Capture Date" },
  { id: "edited", label: "Edited" },
  { id: "isVirtualCopy", label: "Is Virtual Copy" },
  { id: "hasSnapshot", label: "Has Snapshots" },
  { id: "hasGps", label: "Has GPS" },
  { id: "gpsLat", label: "GPS Latitude" },
  { id: "gpsLon", label: "GPS Longitude" },
  { id: "city", label: "City" },
  { id: "state", label: "State / Province" },
  { id: "country", label: "Country" },
  { id: "title", label: "Title" },
  { id: "caption", label: "Caption" },
  { id: "creator", label: "Creator" },
  { id: "copyright", label: "Copyright" },
];

const OPS: { id: string; label: string }[] = [
  { id: "eq", label: "is" },
  { id: "ne", label: "is not" },
  { id: "gte", label: "≥" },
  { id: "lte", label: "≤" },
  { id: "gt", label: ">" },
  { id: "lt", label: "<" },
  { id: "contains", label: "contains" },
  { id: "notContains", label: "doesn't contain" },
  { id: "startsWith", label: "starts with" },
  { id: "endsWith", label: "ends with" },
  { id: "before", label: "before (YYYY-MM-DD)" },
  { id: "after", label: "after (YYYY-MM-DD)" },
  { id: "inLast", label: "in last N days" },
  { id: "empty", label: "is empty" },
  { id: "notEmpty", label: "is not empty" },
];

const KIND_ICON: Record<string, string> = { collection: "▤", set: "▸", smart: "⚙" };

// Drop-highlight sentinel for the pinned Quick Collection row (its id may not
// exist yet — the reserved collection is created lazily on first drop).
const QUICK_DROP = -1;

function newCriterion(): SmartCriterion {
  return { field: "rating", op: "gte", value: "" };
}

function newGroup(): SmartRule {
  return { match: "any", rules: [newCriterion()] };
}

function newRootRule(): SmartRule {
  return { match: "all", rules: [newCriterion()] };
}

export function isGroup(node: SmartNode): node is SmartRule {
  return Array.isArray((node as SmartRule).rules);
}

// Criterion first, mirroring serde's untagged Node order in catalog.rs.
function isNode(node: unknown): node is SmartNode {
  if (typeof node !== "object" || node == null) return false;
  const c = node as SmartCriterion;
  if (typeof c.field === "string" && typeof c.op === "string" && "value" in c) return true;
  const g = node as SmartRule;
  return Array.isArray(g.rules) && g.rules.every(isNode);
}

/** Parse a stored smart-rule AST; null when malformed (same shapes the native
 *  compiler accepts, nested groups included). */
export function parseSmartRule(json: string | null): SmartRule | null {
  try {
    const parsed = JSON.parse(json ?? "") as Partial<SmartRule>;
    if (!Array.isArray(parsed.rules) || !parsed.rules.every(isNode)) return null;
    return { match: parsed.match === "any" ? "any" : "all", rules: parsed.rules };
  } catch {
    return null;
  }
}

/** One rule group's rows: criterion rows, nested groups (recursive), and the
 *  add-rule/add-group buttons. Indentation shows depth. */
function GroupRows({
  group,
  depth,
  onChange,
}: {
  group: SmartRule;
  depth: number;
  onChange: (g: SmartRule) => void;
}) {
  const indent = depth ? { marginLeft: depth * 14 } : undefined;
  const setNode = (i: number, node: SmartNode) =>
    onChange({ ...group, rules: group.rules.map((r, j) => (j === i ? node : r)) });
  const removeNode = (i: number) =>
    onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  // The last root row is not removable — an empty root matches every photo.
  const removable = group.rules.length > 1 || depth > 0;
  return (
    <>
      {group.rules.map((node, i) =>
        isGroup(node) ? (
          <div key={i} style={{ ...indent, borderLeft: "2px solid var(--border, #444)", paddingLeft: 6 }}>
            <div className="gal-col-match">
              Match
              <Select
                size="sm"
                value={node.match === "any" ? "any" : "all"}
                aria-label="Group match all or any"
                options={[
                  { value: "all", label: "all" },
                  { value: "any", label: "any" },
                ]}
                onChange={(v) => setNode(i, { ...node, match: v as "all" | "any" })}
              />
              of:
              <button className="gal-col-rule-x" onClick={() => removeNode(i)} aria-label="Remove group">
                ×
              </button>
            </div>
            <GroupRows group={node} depth={depth + 1} onChange={(g) => setNode(i, g)} />
          </div>
        ) : (
          <div key={i} className="gal-col-rule" style={indent}>
            <Select
              size="sm"
              value={node.field}
              aria-label="Rule field"
              options={FIELDS.map((f) => ({ value: f.id, label: f.label }))}
              onChange={(v) => setNode(i, { ...node, field: v })}
            />
            <Select
              size="sm"
              value={node.op}
              aria-label="Rule operator"
              options={OPS.map((o) => ({ value: o.id, label: o.label }))}
              onChange={(v) => setNode(i, { ...node, op: v })}
            />
            <Input
              size="sm"
              value={String(node.value ?? "")}
              onChange={(e) => setNode(i, { ...node, value: e.target.value })}
              placeholder="value"
            />
            {removable && (
              <button
                className="gal-col-rule-x"
                onClick={() => removeNode(i)}
                aria-label="Remove rule"
              >
                ×
              </button>
            )}
          </div>
        ),
      )}
      <div className="gal-col-rule" style={indent}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...group, rules: [...group.rules, newCriterion()] })}
        >
          + Add rule
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...group, rules: [...group.rules, newGroup()] })}
        >
          + Add group
        </Button>
      </div>
    </>
  );
}

export interface CollectionTreeEntry {
  row: CollectionRow;
  depth: number;
}

/** Stable depth-first sidebar order. Missing/cyclic parents remain visible at
 *  the root; the native layer prevents new invalid trees. */
export function collectionTree(
  rows: readonly CollectionRow[],
  collapsed: ReadonlySet<number> = new Set(),
): CollectionTreeEntry[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<number | null, CollectionRow[]>();
  const sort = (a: CollectionRow, b: CollectionRow) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id - b.id;
  for (const row of rows) {
    const parent = row.parentId != null && byId.has(row.parentId) ? row.parentId : null;
    const bucket = children.get(parent) ?? [];
    bucket.push(row);
    children.set(parent, bucket);
  }
  for (const bucket of children.values()) bucket.sort(sort);
  const out: CollectionTreeEntry[] = [];
  const seen = new Set<number>();
  const hide = (row: CollectionRow) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    for (const child of children.get(row.id) ?? []) hide(child);
  };
  const visit = (row: CollectionRow, depth: number) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push({ row, depth });
    if (!collapsed.has(row.id)) {
      for (const child of children.get(row.id) ?? []) visit(child, depth + 1);
    } else {
      for (const child of children.get(row.id) ?? []) hide(child);
    }
  };
  for (const row of children.get(null) ?? []) visit(row, 0);
  for (const row of [...rows].sort(sort)) visit(row, 0);
  return out;
}

function canParent(
  rows: readonly CollectionRow[],
  candidateId: number,
  editingId: number | null,
): boolean {
  if (editingId == null) return true;
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current: number | null = candidateId;
  const seen = new Set<number>();
  while (current != null && !seen.has(current)) {
    if (current === editingId) return false;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return true;
}

export function CollectionsPanel() {
  const st = useCatalog();
  const [mode, setMode] = useState<"list" | "collection" | "set" | "smart">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);
  const [root, setRoot] = useState<SmartRule>(newRootRule);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  // Row currently hovered by a photo drag (LR's drop highlight).
  const [dropId, setDropId] = useState<number | null>(null);

  // Drag-drop from the grid/filmstrip: hovering highlights the row, dropping
  // hands the dragged photo ids to `add`.
  const dropProps = (id: number, add: (ids: number[]) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropId(id);
    },
    onDragLeave: () => setDropId((cur) => (cur === id ? null : cur)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropId(null);
      const ids = readPhotoDrag(e.dataTransfer);
      if (ids.length) add(ids);
    },
  });

  const reset = () => {
    setMode("list");
    setEditingId(null);
    setName("");
    setParentId(null);
    setRoot(newRootRule());
  };

  const beginCreate = (kind: "collection" | "set" | "smart") => {
    reset();
    setMode(kind);
  };

  const beginEdit = (row: CollectionRow) => {
    if (!matchesKind(row.kind)) return;
    setEditingId(row.id);
    setMode(row.kind);
    setName(row.name);
    setParentId(row.parentId);
    if (row.kind !== "smart") return;
    const parsed = parseSmartRule(row.ruleAst);
    if (parsed == null) {
      store.notify("This smart collection uses rules the compact editor cannot edit.");
      reset();
      return;
    }
    setRoot(parsed.rules.length ? parsed : { ...parsed, rules: [newCriterion()] });
  };

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (n === QUICK_COLLECTION_NAME || n === PREVIOUS_IMPORT_NAME) {
      store.notify(`"${n}" is a reserved name`);
      return;
    }
    if (mode === "list") return;
    // A manual collection's rule field carries its system marker (saved output,
    // publish service), so renaming/reparenting must preserve it — passing null
    // here would silently drop a Saved Print's layout.
    const existing = editingId != null ? st.collections.find((c) => c.id === editingId) : undefined;
    const ast = mode === "smart" ? JSON.stringify(root) : (existing?.ruleAst ?? null);
    if (editingId != null) {
      if (await store.updateCollection(editingId, n, parentId, ast)) reset();
      return;
    }
    const id = await store.createCollection(n, mode, ast, parentId);
    if (id == null) return;
    reset();
    if (mode !== "set") {
      store.setModule("grid");
      void store.setActiveCollection(id);
    }
  };

  const quick = findQuickCollection(st.collections);
  const quickId = quick?.id ?? null;
  const previousImport = findPreviousImport(st.collections);
  // Publish services are manual collections too — they belong to the Publish panel.
  const visibleCollections = st.collections.filter(
    (c) => c.id !== quickId && c.id !== previousImport?.id && !isPublishService(c),
  );
  const parents = collectionTree(visibleCollections)
    .filter(({ row }) => row.kind === "set" && canParent(visibleCollections, row.id, editingId));

  function matchesKind(kind: string): kind is "collection" | "set" | "smart" {
    return kind === "collection" || kind === "set" || kind === "smart";
  }

  if (mode !== "list") {
    const smart = mode === "smart";
    return (
      <div className="gal-col-panel">
        <input
          className="gal-col-input"
          autoFocus
          placeholder={
            smart ? "Smart collection name…" : mode === "set" ? "Collection set name…" : "Collection name…"
          }
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !smart) void save();
            if (e.key === "Escape") reset();
          }}
        />
        <Select
          block
          style={{ marginBottom: 6 }}
          aria-label="Parent collection set"
          value={String(parentId ?? "")}
          options={[
            { value: "", label: "Top level" },
            ...parents.map(({ row, depth }) => ({ value: String(row.id), label: "\u00a0".repeat(depth * 2) + row.name })),
          ]}
          onChange={(v) => setParentId(v ? Number(v) : null)}
        />
        {smart && (
          <>
            <div className="gal-col-match">
              Match
              <Select
                size="sm"
                value={root.match}
                aria-label="Match all or any"
                options={[
                  { value: "all", label: "all" },
                  { value: "any", label: "any" },
                ]}
                onChange={(v) => setRoot((g) => ({ ...g, match: v as "all" | "any" }))}
              />
              of:
            </div>
            <GroupRows group={root} depth={0} onChange={setRoot} />
          </>
        )}
        <div className="gal-col-actions">
          <Button variant="primary" size="sm" onClick={() => void save()}>
            {editingId == null ? "Create" : "Save"}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const targetId = resolveTargetId(st.collections, st.targetCollectionId, quickId);
  const quickCount = st.quickMemberIds.length;
  const tree = collectionTree(visibleCollections, collapsed);

  const saveQuick = () => {
    const name = window.prompt("Save Quick Collection as:", "");
    if (name && name.trim()) void store.saveQuickCollection(name);
  };

  return (
    <div className="gal-col-panel">
      <button
        className={`gal-col-row${st.activeCollectionId == null && !st.duplicatesActive ? " is-active" : ""}`}
        onClick={() => void store.setActiveCollection(null)}
      >
        <span className="gal-col-icon">◇</span>
        <span className="gal-col-name">All Photos</span>
      </button>
      <button
        className={`gal-col-row${st.duplicatesActive ? " is-active" : ""}`}
        onClick={() => void store.showDuplicates()}
      >
        <span className="gal-col-icon">⧉</span>
        <span className="gal-col-name">Duplicates</span>
      </button>

      {previousImport && (
        <button
          className={`gal-col-row${st.activeCollectionId === previousImport.id ? " is-active" : ""}`}
          onClick={() => {
            store.setModule("grid");
            void store.setActiveCollection(previousImport.id);
          }}
        >
          <span className="gal-col-icon">↶</span>
          <span className="gal-col-name">{PREVIOUS_IMPORT_NAME}</span>
        </button>
      )}

      {/* Quick Collection — pinned; B key toggles the active photo's membership. */}
      <div
        className={`gal-col-row gal-col-quick${quickId != null && st.activeCollectionId === quickId ? " is-active" : ""}${dropId === QUICK_DROP ? " is-drop" : ""}`}
        {...dropProps(QUICK_DROP, (ids) =>
          // The reserved Quick Collection may not exist yet — create, then add.
          void store.ensureQuickCollection().then((qid) => {
            if (qid != null) void store.addToCollection(qid, ids);
          }),
        )}
      >
        <button className="gal-col-open" onClick={() => void store.openQuickCollection()}>
          <span className="gal-col-icon">❖</span>
          <span className="gal-col-name">Quick Collection</span>
          {targetId != null && targetId === quickId && (
            <span className="gal-col-target" title="Target Collection">+</span>
          )}
          <span className="gal-col-count">{quickCount}</span>
        </button>
        <button
          className="gal-col-del"
          onClick={saveQuick}
          disabled={quickCount === 0}
          aria-label="Save Quick Collection as a new collection"
          title="Save Quick Collection…"
        >
          ⤓
        </button>
        <button
          className="gal-col-del"
          onClick={() => void store.clearQuickCollection()}
          disabled={quickCount === 0}
          aria-label="Clear Quick Collection"
          title="Clear Quick Collection"
        >
          ×
        </button>
      </div>

      {tree.map(({ row: c, depth }) => {
        const isSet = c.kind === "set";
        const isCollapsed = collapsed.has(c.id);
        // Saved Print/Book/Slideshow/Web read as their own kind in LR's tree.
        const output = savedOutputModule(c);
        return (
          <div
            key={c.id}
            className={`gal-col-row${st.activeCollectionId === c.id ? " is-active" : ""}${dropId === c.id ? " is-drop" : ""}`}
            style={{ paddingInlineStart: depth * 14 }}
            // Only plain collections take drops — sets/smart have no manual membership.
            {...(c.kind === "collection" ? dropProps(c.id, (ids) => void store.addToCollection(c.id, ids)) : {})}
          >
            <button
              className="gal-col-open"
              onClick={() => {
                if (isSet) {
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                  return;
                }
                store.setModule("grid");
                void store.setActiveCollection(c.id);
              }}
              aria-expanded={isSet ? !isCollapsed : undefined}
              aria-label={output ? `${c.name} — ${OUTPUT_LABEL[output]}` : undefined}
              title={output ? OUTPUT_LABEL[output] : undefined}
            >
              <span className="gal-col-icon">
                {isSet
                  ? isCollapsed
                    ? "▸"
                    : "▾"
                  : output
                    ? OUTPUT_ICON[output]
                    : KIND_ICON[c.kind] ?? "▤"}
              </span>
              <span className="gal-col-name">{c.name}</span>
              {targetId === c.id && <span className="gal-col-target" title="Target Collection">+</span>}
            </button>
            {c.kind === "collection" && (
              <button
                className={`gal-col-tgt${st.targetCollectionId === c.id ? " is-on" : ""}`}
                onClick={() => store.setTargetCollection(c.id)}
                aria-pressed={st.targetCollectionId === c.id}
                aria-label={`Set ${c.name} as Target Collection`}
                title="Set as Target Collection"
              >
                ◎
              </button>
            )}
            <button
              className="gal-col-del"
              onClick={() => beginEdit(c)}
              aria-label={`Edit ${c.name}`}
              title={c.kind === "smart" ? "Edit Smart Collection…" : "Rename or move…"}
            >
              ✎
            </button>
            <button
              className="gal-col-del"
              onClick={() => void store.removeCollection(c.id)}
              aria-label={`Delete ${c.name}`}
            >
              ×
            </button>
          </div>
        );
      })}

      <div className="gal-col-new">
        <button onClick={() => beginCreate("collection")}>+ Collection</button>
        <button onClick={() => beginCreate("set")}>+ Set</button>
        <button onClick={() => beginCreate("smart")}>+ Smart</button>
      </div>
    </div>
  );
}
