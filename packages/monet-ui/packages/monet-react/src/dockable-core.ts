// ─────────────────────────────────────────────────────────────
// Dockable workspace — pure layout algebra (no React / no DOM)
// ─────────────────────────────────────────────────────────────
// This module holds the side-effect-free core of the dockable engine: the
// layout-tree normalization, the immutable drop / move / remove edits, the
// directional drop model and the pure geometry helpers. Everything here
// operates only on plain JSON-serializable data passed in by the caller — it
// never touches the DOM or React — so it is straightforward to unit test.
//
// The interactive React component (dockable.tsx) imports these and wires them
// to live pointer/keyboard events; the DOM-reading hit-testing + snap-rect
// helpers stay there because they measure the rendered layout.
//
// State shape:
//   layout = {
//     left:   { size: 280, cols: [Column, ...] } | null,
//     right:  { size: 320, cols: [Column, ...] } | null,
//     bottom: { size: 240, cols: [Column, ...] } | null,
//     floating: [{ id, x, y, w, h, cols: [Column, ...] }],   // a free mini-dock
//   }
//   Column = { id, flex, stack: [Group, ...] }
//   Group  = { id, tabs: [tabId], active: tabId, flex }
// (Legacy `{ stack: [...] }` per side is accepted by normLayout and wrapped
//  into a single column.)
//
// panels = { [tabId]: { title, render: () => JSX } }

// ─── public layout types ────────────────────────────────────
// The layout tree is JSON-serializable (see the state-shape banner above).
// These types describe its public surface for the controlled / imperative API.
// They intentionally mirror what normLayout / normTBL accept & produce — a host
// may hand back either a normalized tree (e.g. one captured from getLayout())
// or a looser/legacy seed; normLayout reconciles both.

/** A stacked group of tabs within a column. */
export interface DockGroup {
  id?: string;
  tabs: string[];
  active?: string;
  flex?: number;
}
/** A column inside a container: either a panel column (groups) or a docked toolbar. */
export interface DockColumn {
  id?: string;
  kind?: "panel" | "tb";
  flex?: number;
  stack?: DockGroup[];
  /** present when kind === "tb" */
  tbId?: string;
}
/** One side dock (left/right/top/bottom). */
export interface DockSide {
  size?: number;
  /** Keep this side as an icon rail; size retains its expanded dimension. */
  collapsed?: boolean;
  cols?: DockColumn[];
  /** legacy single-column form accepted by normLayout */
  stack?: DockGroup[];
}
/** A free-floating mini-dock. */
export interface DockFloat {
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cols?: DockColumn[];
  /** legacy forms accepted by normLayout */
  stack?: DockGroup[];
  group?: DockGroup;
}
/** The full dockable layout tree (panels + floats). JSON-serializable. */
export interface DockLayout {
  left?: DockSide | null;
  right?: DockSide | null;
  top?: DockSide | null;
  bottom?: DockSide | null;
  floating?: DockFloat[];
}
/** A free-floating toolbar position. */
export interface ToolbarFloat {
  id: string;
  x?: number;
  y?: number;
}
/** Per-edge toolbar lanes. A lane is a list of toolbar ids; legacy flat arrays
 *  are read as a single lane. Each edge is a list of lanes. */
export interface ToolbarLayout {
  top?: string[] | string[][];
  bottom?: string[] | string[][];
  left?: string[] | string[][];
  right?: string[] | string[][];
  float?: ToolbarFloat[];
}

// One of the four window edges a dock or toolbar can attach to.
export type DockSideName = "left" | "right" | "top" | "bottom";

// ─── normalized (internal) layout types ─────────────────────
// The public Dock* interfaces above describe the *loose seed* the host may hand
// in (everything optional / legacy forms accepted). normLayout / normTBL turn a
// seed into these strict normalized shapes — every required field present — and
// every internal edit operates on them. They are the runtime source of truth.
type Cont = { side?: DockSideName; floatId?: string };
interface NGroup { id: string; tabs: string[]; active: string; flex: number; }
interface NPanelCol { id: string; kind: "panel"; flex: number; stack: NGroup[]; }
interface NTbCol { id: string; kind: "tb"; tbId: string; }
type NCol = NPanelCol | NTbCol;
interface NSide { size: number; collapsed?: boolean; cols: NCol[]; }
interface NFloat { id: string; x: number; y: number; w: number; h: number; cols: NCol[]; }
interface NLayout {
  left: NSide | null;
  right: NSide | null;
  top: NSide | null;
  bottom: NSide | null;
  floating: NFloat[];
}
export type { NLayout, NCol, NPanelCol, NGroup, NSide, NFloat, Cont };

// Normalized toolbar layout: each edge is a list of lanes (lane = toolbar ids);
// `float` is a list of free-floating toolbar positions.
interface NTBL {
  top: string[][];
  bottom: string[][];
  left: string[][];
  right: string[][];
  float: ToolbarFloat[];
}
export type { NTBL };

// A resolved drop target produced by the hit-testers / dirToTarget. The union
// is wide (different `kind`s carry different fields) so the consuming code reads
// optional members off it; keep it permissive but typed.
export interface DropTarget {
  kind?: "tab-into-group" | "new-group" | "new-column" | "new-dock" | "float";
  cont?: Cont;
  side?: DockSideName;
  dir?: string;
  gid?: string;
  colIdx?: number;
  colId?: string;
  groupIdx?: number;
  groupId?: string;
  tabIdx?: number | null;
  beforeIdx?: number;
  beforeGroupId?: string;
  afterGroupId?: string;
  beforeColIdx?: number;
  beforeColId?: string;
  afterColId?: string;
  x?: number;
  y?: number;
  /** Dropped on a collapsed dock's icon rail: the panel joins it as an icon. */
  rail?: boolean;
}

// A resolved toolbar drop target produced by tbHitTest.
export interface TbTarget {
  side: DockSideName | "float";
  kind?: "in-dock";
  x?: number;
  y?: number;
  lane?: number;
  index?: number;
  newLane?: number;
  colIdx?: number;
  colId?: string;
  position?: "before" | "after";
}

// Geometry of a single dock-widget cell / snap rect (body-local pixels).
interface DragGeom { x?: number; y?: number; w?: number; h?: number; }

// ─── stable id generator ────────────────────────────────────
let _idCounter = 0;
export function nid(prefix = "g") { return `${prefix}-${++_idCounter}`; }
// (#174) Ids in a persisted layout were minted by this same counter in an
// earlier session, but restoring one never advanced it — so the first split of
// a restored session re-minted an id already in the tree (duplicate React keys,
// findGroupById resolving the wrong group, snap rects highlighting the wrong
// panel). Seed the counter past every id we keep.
function keepId(id: string | undefined, prefix: string): string {
  if (!id) return nid(prefix);
  const m = /^[a-z]+-(\d+)$/.exec(id);
  if (m) _idCounter = Math.max(_idCounter, Number(m[1]));
  return id;
}

// ─── normalize helper ───────────────────────────────────────
export function normGroup(g: DockGroup): NGroup {
  // (#180) A loose/legacy/persisted seed may name an `active` tab that is not in
  // `tabs`. Taking it verbatim left a group whose body renders "Empty panel",
  // whose tab strip gives EVERY tab tabIndex={-1} (roving tabindex dead, and
  // aria-controls pointing at a tabpanel id that is never rendered) and whose
  // close button calls onClose(active) — a no-op. Clamp to a real member.
  const tabs = g.tabs.slice();
  return { id: keepId(g.id, "g"), tabs, active: g.active && tabs.includes(g.active) ? g.active : tabs[0], flex: g.flex ?? 1 };
}
export function normCols(rawCols: DockColumn[]): NCol[] {
  return rawCols
    .map((c): NCol => {
      if (c.kind === "tb" || c.tbId) return { id: keepId(c.id, "c"), kind: "tb", tbId: c.tbId! };
      // (#180) …and a group with no tabs at all is an unclosable empty panel:
      // drop it here, the same way empty columns are dropped below.
      return { id: keepId(c.id, "c"), kind: "panel", flex: c.flex ?? 1, stack: (c.stack || []).map(normGroup).filter(g => g.tabs.length > 0) };
    })
    .filter((c): c is NCol => c.kind === "tb" ? !!c.tbId : c.stack.length > 0);
}
export function normLayout(L: DockLayout): NLayout {
  const out: NLayout = { left: null, right: null, top: null, bottom: null, floating: [] };
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const d = L[side]; if (!d) continue;
    // Accept legacy `{ stack: [groups] }` and wrap it in a single column.
    const cols = normCols(d.cols || (d.stack ? [{ stack: d.stack }] : []));
    if (!cols.length) continue;
    out[side] = { size: d.size ?? sizeFor(side), collapsed: d.collapsed === true, cols };
  }
  // Floats are now full mini-docks: a column-set with the same shape as a side
  // dock, so the exact same split / stack / resize machinery works inside them.
  // Accept legacy `{ group }` or `{ stack }` and wrap into cols.
  out.floating = (L.floating || [])
    .map((f): NFloat => {
      let cols: NCol[];
      if (f.cols) cols = normCols(f.cols);
      else if (f.stack) cols = normCols([{ stack: f.stack }]);
      else if (f.group) cols = normCols([{ stack: [f.group] }]);
      else cols = [];
      return { id: keepId(f.id, "f"), x: f.x ?? 100, y: f.y ?? 100, w: f.w ?? 280, h: f.h ?? 220, cols };
    })
    .filter(f => f.cols.some(c => c.kind === "panel" && c.stack.length > 0));
  return out;
}

// ─── container helpers (a "container" is a side dock or a float) ─────
// cont = { side: "left"|"right"|"bottom" }  OR  { floatId }
export const sizeFor = (side: DockSideName) => side === "bottom" ? 240 : side === "top" ? 200 : 300;
export function contOf(target: DropTarget): Cont | null { return target.cont || (target.side ? { side: target.side } : null); }
export function sameCont(a: Cont, b: Cont) { return !!a && !!b && a.side === b.side && a.floatId === b.floatId; }
export function getCols(L: NLayout, cont: Cont | null): NCol[] | null {
  if (!cont) return null;
  if (cont.floatId != null) { const f = L.floating.find(x => x.id === cont.floatId); return f ? f.cols : null; }
  const d = cont.side ? L[cont.side] : null;
  return d ? d.cols : null;
}
export function withCols(L: NLayout, cont: Cont, cols: NCol[]): NLayout {
  if (cont.floatId != null) return { ...L, floating: L.floating.map(f => f.id === cont.floatId ? { ...f, cols } : f) };
  const side = cont.side!;
  const d = L[side] || { size: sizeFor(side) };
  return { ...L, [side]: { ...d, cols } };
}

/** Collapse chrome without removing panels or losing the expanded size. */
export function setDockCollapsedImmutable(L: NLayout, side: DockSideName, collapsed: boolean): NLayout {
  if (!["left", "right", "top", "bottom"].includes(side) || typeof collapsed !== "boolean") {
    throw new Error("Choose a dock side (left, right, top, bottom) and a boolean collapsed value.");
  }
  const dock = L[side];
  return !dock || !!dock.collapsed === collapsed ? L : { ...L, [side]: { ...dock, collapsed } };
}

// ─── locate a tab in the layout ─────────────────────────────
export function findInCols(cols: NCol[], tabId: string) {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]; if (col.kind !== "panel") continue;
    for (let gi = 0; gi < col.stack.length; gi++)
      if (col.stack[gi].tabs.includes(tabId)) return { colIdx: ci, groupIdx: gi };
  }
  return null;
}
export function findTab(L: NLayout, tabId: string) {
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const d = L[side]; if (!d) continue;
    const r = findInCols(d.cols, tabId);
    if (r) return { kind: "dock", cont: { side }, ...r };
  }
  for (const f of L.floating) {
    const r = findInCols(f.cols, tabId);
    if (r) return { kind: "float", cont: { floatId: f.id }, ...r };
  }
  return null;
}

// ─── remove a tab; clean up empty groups + empty cols + empty containers ──
export function removeTabFromCols(cols: NCol[], tabId: string): NCol[] {
  return cols
    .map((col): NCol | null => {
      if (col.kind !== "panel") return col;
      const stack = col.stack
        .map((g): NGroup | null => {
          if (!g.tabs.includes(tabId)) return g;
          const tabs = g.tabs.filter(t => t !== tabId);
          return tabs.length ? { ...g, tabs, active: g.active === tabId ? tabs[0] : g.active } : null;
        })
        .filter((g): g is NGroup => !!g);
      return stack.length ? { ...col, stack } : null;
    })
    .filter((c): c is NCol => !!c);
}
export function removeTabImmutable(L: NLayout, tabId: string): NLayout {
  const next: NLayout = { ...L, floating: L.floating.slice() };
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const d = next[side]; if (!d) continue;
    const cols = removeTabFromCols(d.cols, tabId);
    // Keep the dock if it still has panels OR docked toolbars; else drop it.
    const hasPanel = cols.some(c => c.kind === "panel");
    next[side] = (hasPanel || cols.some(c => c.kind === "tb")) ? { ...d, cols } : null;
  }
  next.floating = next.floating
    .map((f): NFloat | null => {
      const cols = removeTabFromCols(f.cols, tabId);
      return cols.some(c => c.kind === "panel" && c.stack.length) ? { ...f, cols } : null;
    })
    .filter((f): f is NFloat => !!f);
  return next;
}

// Bring the tab's group to the front of its column, without touching anything
// else in the layout.
function revealInCols(cols: NCol[], colIdx: number, groupIdx: number, tabId: string): NCol[] {
  return cols.map((col, ci) =>
    ci !== colIdx || col.kind !== "panel"
      ? col
      : { ...col, stack: col.stack.map((g, gi) => (gi === groupIdx ? { ...g, active: tabId } : g)) });
}

// Open a panel: reveal it where it already is, or reopen it if a persisted
// layout dropped it. Existing right-side panels are the natural tab target for
// the reopen; if none remain, recreate a right-side panel dock. A panel
// iconified in a collapsed dock stays there: the dock view springs it out as
// the rail's flyout rather than expanding the whole dock.
//
// Returning the layout untouched for an already-present tab made every caller
// — Window ▸ <panel>, and all four working Window ▸ Arrange entries — silently
// do nothing as soon as the panel sat behind another tab or under another
// float, which is the normal state of a populated workspace (#498).
export function openTabImmutable(L: NLayout, tabId: string): NLayout {
  const found = findTab(L, tabId);
  if (found?.kind === "dock") {
    const { side } = found.cont as { side: DockSideName };
    const dock = L[side];
    if (!dock) return L;
    return { ...L, [side]: { ...dock, cols: revealInCols(dock.cols, found.colIdx, found.groupIdx, tabId) } };
  }
  if (found) {
    const { floatId } = found.cont as { floatId: string };
    const idx = L.floating.findIndex((f) => f.id === floatId);
    if (idx < 0) return L;
    const raised: NFloat = {
      ...L.floating[idx],
      cols: revealInCols(L.floating[idx].cols, found.colIdx, found.groupIdx, tabId),
    };
    // Last renders on top, so a buried float comes forward with its tab.
    return { ...L, floating: [...L.floating.slice(0, idx), ...L.floating.slice(idx + 1), raised] };
  }
  const col = L.right?.cols.find((c): c is NPanelCol => c.kind === "panel");
  const group = col?.stack[0];
  if (group) return setDockCollapsedImmutable(applyDrop(L, tabId, { kind: "tab-into-group", cont: { side: "right" }, groupId: group.id }), "right", false);
  return setDockCollapsedImmutable(applyDrop(L, tabId, L.right
    ? { kind: "new-column", cont: { side: "right" }, beforeColIdx: L.right.cols.length }
    : { kind: "new-dock", side: "right" }), "right", false);
}

// ─── locate a group / col by its stable id (across docks + floats) ──
export function findGroupInCols(cols: NCol[], groupId: string) {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]; if (col.kind !== "panel") continue;
    for (let i = 0; i < col.stack.length; i++)
      if (col.stack[i].id === groupId) return { colIdx: ci, groupIdx: i, group: col.stack[i] };
  }
  return null;
}
export function findGroupById(L: NLayout, groupId: string | undefined) {
  if (!groupId) return null;
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const d = L[side]; if (!d) continue;
    const r = findGroupInCols(d.cols, groupId);
    if (r) return { cont: { side } as Cont, side: side as DockSideName | "float", ...r };
  }
  for (const f of L.floating) {
    const r = findGroupInCols(f.cols, groupId);
    if (r) return { cont: { floatId: f.id } as Cont, side: "float" as DockSideName | "float", ...r };
  }
  return null;
}

// Toolbars can also live inside a panel dock as a "tb col" wedged between
// panel columns. Strip a tb col with this id out of every dock — used both
// when starting to drag a docked toolbar and before re-placing it.
export function removeTbColImmutable(L: NLayout, tbId: string): NLayout {
  const next: NLayout = { ...L };
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const d = next[side]; if (!d) continue;
    const cols = d.cols.filter(c => !(c.kind === "tb" && c.tbId === tbId));
    const hasAny = cols.length > 0;
    next[side] = hasAny ? { ...d, cols } : null;
  }
  return next;
}

// Insert a tb col at the requested position relative to an existing column.
export function insertTbColImmutable(L: NLayout, tbId: string, target: TbTarget): NLayout {
  const { colId, colIdx, position } = target;
  const side = target.side as DockSideName;
  const next: NLayout = { ...L };
  let d = next[side];
  if (!d) { d = { size: sizeFor(side), cols: [] }; next[side] = d; }
  const cols = d.cols.slice();
  // Resolve insertion index by id (stable across removals) — fall back to the
  // positional colIdx if we can't find the id (e.g. last panel col deleted).
  let idx = colId ? cols.findIndex(c => c.id === colId) : -1;
  if (idx < 0) idx = Math.max(0, Math.min(cols.length, colIdx ?? cols.length));
  let at = position === "before" ? idx : idx + 1;
  at = Math.max(0, Math.min(cols.length, at));
  cols.splice(at, 0, { id: nid("c"), kind: "tb", tbId });
  next[side] = { ...d, cols };
  return next;
}

// target kinds:
//   { kind: "tab-into-group", cont, colIdx, groupIdx, groupId, tabIdx }
// | { kind: "new-group",  cont, colIdx, beforeIdx, beforeGroupId?, afterGroupId? }
// | { kind: "new-column", cont, beforeColIdx, beforeColId?, afterColId? }
// | { kind: "new-dock", side }
// | { kind: "float", x, y }
// `cont` is { side } for a dock or { floatId } for a floating mini-dock —
// every in-container edit routes through getCols / withCols so docks and
// floats share one implementation.
export function applyDrop(L: NLayout, tabId: string, target: DropTarget | null, dragGeom: DragGeom | null = null): NLayout {
  if (!target) return L;

  // Self-drop short-circuit: dropping a group's only tab back onto that same
  // group (center / tab strip) is a no-op — skip so we don't destroy + fail to
  // rebuild it.
  if (target.kind === "tab-into-group") {
    const g = findGroupById(L, target.groupId);
    if (g && g.group.tabs.length === 1 && g.group.tabs[0] === tabId) return L;
  }

  const origin = L;                       // pre-remove snapshot for fallbacks
  let next = removeTabImmutable(L, tabId);
  const newGroup = (id: string | null = null): NGroup => ({ id: id || nid("g"), tabs: [tabId], active: tabId, flex: 1 });
  const newCol = (groups: NGroup[]): NPanelCol => ({ id: nid("c"), kind: "panel", flex: 1, stack: groups });

  if (target.kind === "float") {
    next.floating = [
      ...next.floating,
      { id: nid("f"), x: (target.x ?? 0) - 100, y: (target.y ?? 0) - 14, w: dragGeom?.w || 280, h: dragGeom?.h || 220,
        cols: [newCol([newGroup()])] },
    ];
    return next;
  }
  if (target.kind === "new-dock" && target.side) {
    next[target.side] = { size: sizeFor(target.side), cols: [newCol([newGroup()])] };
    return next;
  }

  const cont = contOf(target);
  if (!cont) return next;

  // Make sure the target container still exists after the remove (the dragged
  // tab may have been its last panel) — recreate an empty one if needed.
  const ensureCont = (): NCol[] => {
    const cols = getCols(next, cont);
    if (cols) return cols;
    if (cont.floatId != null) {
      const o = origin.floating.find(f => f.id === cont.floatId);
      next = { ...next, floating: [...next.floating, { id: cont.floatId, x: o?.x ?? 120, y: o?.y ?? 120, w: o?.w ?? 280, h: o?.h ?? 220, cols: [] }] };
    } else {
      next = { ...next, [cont.side!]: { size: sizeFor(cont.side!), cols: [] } };
    }
    // The branch above always (re)creates the container, so getCols is non-null.
    return getCols(next, cont)!;
  };

  if (target.kind === "new-column") {
    const cols = ensureCont().slice();
    let at = target.beforeColIdx ?? cols.length;
    if (target.beforeColId) { const i = cols.findIndex(c => c.id === target.beforeColId); if (i >= 0) at = i; }
    else if (target.afterColId) { const i = cols.findIndex(c => c.id === target.afterColId); if (i >= 0) at = i + 1; }
    at = Math.max(0, Math.min(cols.length, at));
    cols.splice(at, 0, newCol([newGroup()]));
    return withCols(next, cont, cols);
  }

  if (target.kind === "new-group") {
    const cols = ensureCont().slice();
    // Locate the reference group's column by stable id; fall back to colIdx.
    const refId = target.beforeGroupId || target.afterGroupId;
    let ci = -1, gi = -1;
    if (refId) { const r = findGroupInCols(cols, refId); if (r) { ci = r.colIdx; gi = r.groupIdx; } }
    if (ci < 0) {
      ci = Math.max(0, Math.min(cols.length, target.colIdx ?? cols.length));
      if (!cols[ci] || cols[ci].kind !== "panel") cols.splice(ci, 0, newCol([]));
      gi = (cols[ci] as NPanelCol).stack.length;
    }
    const panelCol = cols[ci] as NPanelCol;
    const stack = panelCol.stack.slice();
    let at = target.beforeGroupId ? gi : target.afterGroupId ? gi + 1 : (target.beforeIdx ?? stack.length);
    at = Math.max(0, Math.min(stack.length, at));
    stack.splice(at, 0, newGroup());
    cols[ci] = { ...panelCol, stack };
    return withCols(next, cont, cols);
  }

  if (target.kind === "tab-into-group") {
    const located = findGroupById(next, target.groupId);
    if (!located) {
      // Group was emptied by the remove — recreate it at its original spot.
      const orig = findGroupById(origin, target.groupId);
      if (!orig) return next;
      const c2 = orig.cont;
      // ensure container
      if (!getCols(next, c2)) {
        if (c2.floatId != null) {
          const o = origin.floating.find(f => f.id === c2.floatId);
          next = { ...next, floating: [...next.floating, { id: c2.floatId, x: o?.x ?? 120, y: o?.y ?? 120, w: o?.w ?? 280, h: o?.h ?? 220, cols: [] }] };
        } else {
          next = { ...next, [c2.side!]: { size: sizeFor(c2.side!), cols: [] } };
        }
      }
      // Container was just ensured above, so getCols is non-null.
      const cols = getCols(next, c2)!.slice();
      const ci = Math.max(0, Math.min(cols.length, orig.colIdx));
      if (!cols[ci] || cols[ci].kind !== "panel") cols.splice(ci, 0, newCol([]));
      const panelCol = cols[ci] as NPanelCol;
      const stack = panelCol.stack.slice();
      const at = Math.max(0, Math.min(stack.length, orig.groupIdx));
      stack.splice(at, 0, { id: target.groupId || nid("g"), tabs: [tabId], active: tabId, flex: orig.group.flex ?? 1 });
      cols[ci] = { ...panelCol, stack };
      return withCols(next, c2, cols);
    }
    const c2 = located.cont;
    // located came from findGroupById(next, …), so its container exists.
    const cols = getCols(next, c2)!.slice();
    const panelCol = cols[located.colIdx] as NPanelCol;
    const stack = panelCol.stack.slice();
    const g = stack[located.groupIdx];
    const tabs = g.tabs.slice();
    let at = target.tabIdx ?? tabs.length;
    // (#176) `target.tabIdx` was measured against the LIVE tab strip, which still
    // renders the tab being dragged; removeTabImmutable already took it out, so
    // every slot right of its old position shifted left by one. Without this the
    // tab overshoots by exactly one on every rightward reorder within its group.
    const from = findGroupById(origin, target.groupId)?.group.tabs.indexOf(tabId) ?? -1;
    if (from >= 0 && at > from) at -= 1;
    tabs.splice(at, 0, tabId);
    stack[located.groupIdx] = { ...g, tabs, active: tabId };
    cols[located.colIdx] = { ...panelCol, stack };
    return withCols(next, c2, cols);
  }

  return next;
}

// ─── dock a whole float (every tab moves as ONE group) ──────
// (#177) Docking a multi-tab float used to replay the SAME drop target once per
// tab. That is only right for a tab-into-group target; for the new-group /
// new-column targets a split produces it minted a fresh group/column per tab —
// and because `afterColId`/`afterGroupId` re-resolve to the same reference every
// pass, each insert landed *before* the previous one, reversing the tab order.
// Apply the target once, then stack the rest into the group that just received
// the first tab.
export function dockFloatImmutable(L: NLayout, floatId: string, target: DropTarget | null): NLayout {
  const fl = L.floating.find(f => f.id === floatId);
  if (!fl || !target) return L;
  const tabs = fl.cols.flatMap(c => c.kind === "panel" ? c.stack : []).flatMap(g => g.tabs);
  if (!tabs.length) return L;
  let next = applyDrop(L, tabs[0], target);
  const at = findTab(next, tabs[0]);
  const col = at ? getCols(next, at.cont)?.[at.colIdx] : null;
  const landed = col && col.kind === "panel" ? col.stack[at!.groupIdx] : null;
  // No landing group (the target resolved to no container): leave the rest put.
  if (!landed) return next;
  let tabIdx = landed.tabs.indexOf(tabs[0]) + 1;
  for (const tabId of tabs.slice(1)) {
    next = applyDrop(next, tabId, { kind: "tab-into-group", cont: at!.cont, groupId: landed.id, tabIdx: tabIdx++ });
  }
  return next;
}

// ─── directional drop model ─────────────────────────────────
// Every in-group drop resolves to a compass direction:
//   center → stack as a tab in this group
//   n/s/e/w → split: insert a new group or column on that side
// `dirToTarget` maps a direction to the concrete layout edit, accounting for
// how a dock's groups & columns are oriented (left/right stack groups
// vertically; the bottom dock stacks them horizontally). Every target carries
// `dir` + the hovered group's id (`gid`) so the overlay can render against it.
interface DirCtx {
  cont?: Cont;
  side?: DockSideName;
  colIdx: number;
  colId?: string;
  groupIdx: number;
  groupId?: string;
  tabIdx?: number | null;
}
export function dirToTarget(dir: string, ctx: DirCtx): DropTarget {
  const { cont, side, colIdx, colId, groupIdx, groupId, tabIdx = null } = ctx;
  const base = { cont, gid: groupId, side, dir };
  if (dir === "center" || !dir)
    return { kind: "tab-into-group", colIdx, groupIdx, groupId, tabIdx, ...base, dir: "center" };
  const newGroupBefore: DropTarget = { kind: "new-group", colIdx, beforeIdx: groupIdx,     beforeGroupId: groupId, ...base };
  const newGroupAfter:  DropTarget = { kind: "new-group", colIdx, beforeIdx: groupIdx + 1, afterGroupId:  groupId, ...base };
  const newColBefore:   DropTarget = { kind: "new-column", beforeColIdx: colIdx,     beforeColId: colId, ...base };
  const newColAfter:    DropTarget = { kind: "new-column", beforeColIdx: colIdx + 1, afterColId:  colId, ...base };
  // Bottom & top docks stack groups horizontally (w/e) & columns vertically (n/s);
  // every other container (side docks + floats) stacks groups vertically.
  if (side === "bottom" || side === "top") {
    if (dir === "w") return newGroupBefore;
    if (dir === "e") return newGroupAfter;
    if (dir === "n") return newColBefore;
    if (dir === "s") return newColAfter;
  } else {
    if (dir === "n") return newGroupBefore;
    if (dir === "s") return newGroupAfter;
    if (dir === "w") return newColBefore;
    if (dir === "e") return newColAfter;
  }
  return { kind: "tab-into-group", colIdx, groupIdx, groupId, tabIdx: null, ...base, dir: "center" };
}

// Geometry of the 5-button dock widget for a group rect (screen px). Shared by
// the DOM hit-tester (groupTarget) and the overlay renderer in dockable.tsx.
export const DOCK_CELL = 38, DOCK_GAP = 7, DOCK_STRIP = 32;
export function dockWidgetCells(r: { left: number; right: number; top: number; height: number }) {
  const cx = (r.left + r.right) / 2;
  const cy = r.top + DOCK_STRIP + (r.height - DOCK_STRIP) / 2;
  const off = DOCK_CELL + DOCK_GAP;
  const cell = (dir: string, dx: number, dy: number) => ({
    dir,
    x: cx + dx * off - DOCK_CELL / 2,
    y: cy + dy * off - DOCK_CELL / 2,
    w: DOCK_CELL, h: DOCK_CELL,
  });
  return { cx, cy, list: [cell("center", 0, 0), cell("n", 0, -1), cell("s", 0, 1), cell("w", -1, 0), cell("e", 1, 0)] };
}

export function snapLabel(target: DropTarget | null | undefined) {
  if (!target) return "";
  if (target.kind === "float") return "Float";
  if (target.rail) return "Add to icons";
  if (target.kind === "new-dock") return `Dock ${target.side}`;
  if (target.kind === "new-group" || target.kind === "new-column") {
    const labels: Record<string, string> = { n: "Split top", s: "Split bottom", w: "Split left", e: "Split right" };
    return (target.dir ? labels[target.dir] : undefined) || "Split";
  }
  if (target.kind === "tab-into-group") return "Stack as tab";
  return "";
}

// ─── DOM-measurement layer ──────────────────────────────────
// The functions below resolve drop targets and snap-zone rects from the live
// layout. They are kept here (not in dockable.tsx) only for file-size reasons;
// importantly they import NOTHING — they take element-like objects (with
// getBoundingClientRect / querySelectorAll / dataset, plus offsetWidth/Height
// on the root) as parameters and never touch the `document`/`window` globals,
// so they stay testable with lightweight element fakes and SSR-safe.

// Resolve a drop target from the cursor's position over a single group element
// — shared by docks and floats. `cont` identifies the owning container.
export function groupTarget(el: any, x: number, y: number, cont: Cont): DropTarget {
  const r = el.getBoundingClientRect();
  const ctx: DirCtx = {
    cont,
    side: el.dataset.side,
    colIdx: Number(el.dataset.colIdx),
    colId: el.dataset.colId,
    groupIdx: Number(el.dataset.gIdx),
    groupId: el.dataset.gId,
  };
  // tab strip → stack as a tab at a specific slot
  if (y < r.top + DOCK_STRIP) {
    const tabEls = el.querySelectorAll("[data-dock-tab]");
    let tabIdx = tabEls.length;
    for (let i = 0; i < tabEls.length; i++) {
      const tr = tabEls[i].getBoundingClientRect();
      if (x < tr.left + tr.width / 2) { tabIdx = i; break; }
    }
    return dirToTarget("center", { ...ctx, tabIdx });
  }
  // precise aim: cursor over one of the widget buttons wins outright
  const wg = dockWidgetCells(r);
  for (const c of wg.list)
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return dirToTarget(c.dir, ctx);
  // broad bands: nearest edge within the outer band → split; else center
  const inX = (x - r.left) / r.width;
  const inY = (y - r.top - DOCK_STRIP) / Math.max(1, r.height - DOCK_STRIP);
  const E = 0.24;
  const dl = inX, dr = 1 - inX, dt = inY, db = 1 - inY;
  const m = Math.min(dl, dr, dt, db);
  let dir = "center";
  if (m < E) dir = m === dl ? "w" : m === dr ? "e" : m === dt ? "n" : "s";
  return dirToTarget(dir, ctx);
}

// ─── hit-testing for drop targets ───────────────────────────
// Reads measured rects from the layout DOM via data attrs.
export function hitTest(rootEl: any, x: number, y: number, excludeFloatId: string | null = null): DropTarget | null {
  if (!rootEl) return null;
  const rootRect = rootEl.getBoundingClientRect();

  // Floating mini-docks first (they sit above docks in z-order). Iterate
  // reversed so the top-most float wins when several overlap. A float now
  // contains real groups, so we descend and reuse the exact same group logic
  // — splitting & stacking inside a float works identically to a side dock.
  const floats = Array.from<any>(rootEl.querySelectorAll("[data-float-id]")).reverse();
  for (const el of floats) {
    if (excludeFloatId && el.dataset.floatId === excludeFloatId) continue;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const cont = { floatId: el.dataset.floatId };
    const inner = Array.from<any>(el.querySelectorAll("[data-dock-group]"));
    let g = inner.find(ge => {
      const gr = ge.getBoundingClientRect();
      return x >= gr.left && x <= gr.right && y >= gr.top && y <= gr.bottom;
    });
    if (!g && inner.length) g = inner[0];   // over the move-bar → first group
    if (g) return groupTarget(g, x, y, cont);
    return null;
  }

  // Window-edge dock zones: dragging to the very edge creates a whole-side
  // dock — but ONLY on a side that has no dock yet. If a dock already occupies
  // that edge, fall through to the group logic so the drop splits / stacks
  // inside it (never overwrites it).
  const edge = 26;
  const hasDock = (s: string) => !!rootEl.querySelector(`.monet-dock--${s}`);
  if (x - rootRect.left < edge && !hasDock("left"))   return { kind: "new-dock", side: "left" };
  if (rootRect.right - x < edge && !hasDock("right")) return { kind: "new-dock", side: "right" };
  if (y - rootRect.top < edge && !hasDock("top"))     return { kind: "new-dock", side: "top" };
  if (rootRect.bottom - y < edge && !hasDock("bottom")) return { kind: "new-dock", side: "bottom" };

  // Side-dock groups (exclude any group that lives inside a float).
  const groups = Array.from<any>(rootEl.querySelectorAll("[data-dock-group]"))
    .filter(ge => !ge.closest("[data-float-id]"));
  for (const el of groups) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    return groupTarget(el, x, y, { side: el.dataset.side });
  }

  // A collapsed dock's icon rail has no groups to aim at: the tab joins its
  // last icon group (or a new one, on a rail of toolbars only) as an icon.
  for (const el of Array.from<any>(rootEl.querySelectorAll(".monet-dock.is-collapsed"))) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const side = ["left", "right", "top", "bottom"].find(s => el.classList.contains(`monet-dock--${s}`)) as DockSideName;
    const icons = el.querySelectorAll("[data-rail-tab]");
    const groupId = icons.length ? icons[icons.length - 1].dataset.gId : undefined;
    return groupId
      ? { kind: "tab-into-group", cont: { side }, side, groupId, tabIdx: null, rail: true }
      : { kind: "new-column", cont: { side }, side, rail: true };
  }

  // Empty canvas → create a new float under the cursor (body-local coords).
  return { kind: "float", x: x - rootRect.left, y: y - rootRect.top };
}

// A body-local rect (post-zoom) used to draw drag/snap overlays.
export interface SnapRect { x: number; y: number; w: number; h: number; }

// ─── compute snap-zone rects to draw during drag ────────────
export function computeSnapRects(rootEl: any, target: DropTarget | null): SnapRect | null {
  if (!rootEl || !target) return null;
  const rootR = rootEl.getBoundingClientRect();
  // rootEl may live inside a scaled parent (design-canvas zoom). getBoundingClientRect
  // returns post-transform screen pixels, but the rect we return is positioned as a
  // child of rootEl using its own (pre-transform) coordinate space. Divide screen-space
  // measurements by the effective scale so they line up after the parent re-scales us.
  const scale = (rootEl.offsetWidth > 0 ? rootR.width / rootEl.offsetWidth : 1) || 1;
  const toLocal = (sx: number, sy: number, w: number, h: number): SnapRect => ({
    x: (sx - rootR.left) / scale,
    y: (sy - rootR.top) / scale,
    w: w / scale,
    h: h / scale,
  });
  if (target.kind === "new-dock") {
    const w = rootEl.offsetWidth, h = rootEl.offsetHeight;
    if (target.side === "left")   return { x: 0,        y: 0,         w: 200, h };
    if (target.side === "right")  return { x: w - 200,  y: 0,         w: 200, h };
    if (target.side === "top")    return { x: 0,        y: 0,         w,     h: 160 };
    if (target.side === "bottom") return { x: 0,        y: h - 160,   w,     h: 160 };
  }
  if (target.kind === "float") return null;
  if (target.rail) {
    const el = rootEl.querySelector(`.monet-dock--${target.side}.is-collapsed`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return toLocal(r.left, r.top, r.width, r.height);
  }
  // group-relative drops — locate by stable group id so float-internal groups
  // resolve the same way as side-dock groups.
  if (target.kind === "tab-into-group") {
    const el = rootEl.querySelector(`[data-dock-group][data-g-id="${target.groupId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return toLocal(r.left, r.top, r.width, r.height);
  }
  if (target.kind === "new-group") {
    // new-group's reference group is identified by id (beforeGroupId/afterGroupId)
    // rather than groupIdx — locate via [data-g-id].
    const refId = target.beforeGroupId || target.afterGroupId;
    const ref = refId
      ? rootEl.querySelector(`[data-dock-group][data-g-id="${refId}"]`)
      : null;
    if (!ref) return null;
    const r = ref.getBoundingClientRect();
    const isBefore = !!target.beforeGroupId;
    // bottom & top dock columns stack groups horizontally; left/right stack them vertically.
    if (target.side === "bottom" || target.side === "top") {
      const left = isBefore ? r.left : r.left + r.width / 2;
      return toLocal(left, r.top, r.width / 2, r.height);
    }
    const top = isBefore ? r.top : r.top + r.height / 2;
    return toLocal(r.left, top, r.width, r.height / 2);
  }
  if (target.kind === "new-column") {
    // Highlight a thin strip on the new-column side of the current column.
    const colEl = rootEl.querySelector(`[data-dock-col][data-side="${target.side}"][data-col-id="${target.beforeColId || target.afterColId}"]`);
    if (!colEl) return null;
    const r = colEl.getBoundingClientRect();
    const thick = 80;
    if (target.side === "bottom" || target.side === "top") {
      // cols stack vertically inside the bottom/top dock
      const isBefore = !!target.beforeColId;
      return toLocal(r.left, isBefore ? r.top : r.bottom - thick, r.width, thick);
    }
    const isBefore = !!target.beforeColId;
    return toLocal(isBefore ? r.left : r.right - thick, r.top, thick, r.height);
  }
  return null;
}

// Locate the hovered group's widget center in body-local coords (compensating
// for design-canvas zoom), plus which direction is currently active.
export function computeDockWidget(rootEl: any, target: DropTarget | null) {
  if (!rootEl || !target || !target.gid) return null;
  const el = rootEl.querySelector(`[data-dock-group][data-g-id="${target.gid}"]`);
  if (!el) return null;
  const rootR = rootEl.getBoundingClientRect();
  const scale = (rootEl.offsetWidth > 0 ? rootR.width / rootEl.offsetWidth : 1) || 1;
  const r = el.getBoundingClientRect();
  return {
    cx: ((r.left + r.right) / 2 - rootR.left) / scale,
    cy: (r.top + DOCK_STRIP + (r.height - DOCK_STRIP) / 2 - rootR.top) / scale,
    active: target.dir || "center",
  };
}

// ─── stable id helpers for the tab / panel DOM ──────────────
// Each tab id is stable, so its tabpanel can target it via `monet-tabpanel-<id>`.
export const tabId2El = (id: string) => `monet-tab-${id}`;
export const panelId2El = (id: string) => `monet-tabpanel-${id}`;

// ── Toolbar edge model ──────────────────────────────────────
// Each edge (top/bottom/left/right) is a list of LANES; each lane is a
// list of toolbar ids. On top/bottom a lane is a horizontal row and lanes
// stack vertically; on left/right a lane is a vertical column and lanes sit
// side by side. So toolbars on one edge can stack along EITHER axis.
// Legacy flat arrays (["a","b"]) are read as a single lane ([["a","b"]]).
export function normLane(arr: string[] | string[][] | undefined): string[][] {
  if (!arr || arr.length === 0) return [];
  if (Array.isArray(arr[0])) return (arr as string[][]).map(l => l.slice()).filter(l => l.length > 0);
  return [(arr as string[]).slice()];
}
export function normTBL(L: ToolbarLayout = {}): NTBL {
  return {
    top: normLane(L.top),
    bottom: normLane(L.bottom),
    left: normLane(L.left),
    right: normLane(L.right),
    float: (L.float || []).map(f => ({ id: f.id, x: f.x ?? 80, y: f.y ?? 80 })),
  };
}
// The four toolbar edges of an NTBL (excludes `float`).
type TbEdge = "top" | "bottom" | "left" | "right";
// Remove a toolbar id from every lane on every edge, dropping lanes left empty.
export function stripTbId(L: NTBL, id: string): NTBL {
  const s = (side: TbEdge) => L[side].map(lane => lane.filter(x => x !== id)).filter(l => l.length > 0);
  return { top: s("top"), bottom: s("bottom"), left: s("left"), right: s("right"),
           float: L.float.filter(f => f.id !== id) };
}
// Same, but KEEP now-empty lanes so lane indices still match the live DOM
// while we splice the toolbar into its new home.
export function stripTbIdKeepEmpty(L: NTBL, id: string): NTBL {
  const s = (side: TbEdge) => L[side].map(lane => lane.filter(x => x !== id));
  return { top: s("top"), bottom: s("bottom"), left: s("left"), right: s("right"),
           float: L.float.filter(f => f.id !== id) };
}
export function dropEmptyLanes(L: NTBL): NTBL {
  const d = (side: TbEdge) => L[side].filter(l => l.length > 0);
  return { top: d("top"), bottom: d("bottom"), left: d("left"), right: d("right"), float: L.float };
}

// ── DOM-measurement layer for toolbar drags ─────────────────
// Like the panel hit-tester above: parameterized over element-like objects, no
// global DOM/`document`/`window` access, so it stays here purely for file size.
export function tbHitTest(rootEl: any, x: number, y: number, _draggedId: string | null = null): TbTarget {
  if (!rootEl) return { side: "float", x, y };
  const r = rootEl.getBoundingClientRect();
  const scale = (rootEl.offsetWidth > 0 ? r.width / rootEl.offsetWidth : 1) || 1;

  const dTop    = y - r.top;
  const dLeft   = x - r.left;
  const dRight  = r.right - x;
  const dBottom = r.bottom - y;

  // Resolve a body-edge dock target on `side`. Returns either a parallel
  // insert into an existing lane ({ side, lane, index }) or a perpendicular
  // new lane ({ side, newLane }).
  const resolveEdge = (side: TbEdge): TbTarget => {
    const isH = side === "top" || side === "bottom";       // lanes are rows (cross axis = Y)
    const crossIsY = isH;
    const cursorCross = crossIsY ? y : x;
    const cursorMain  = crossIsY ? x : y;
    const laneEls = Array.from<any>(rootEl.querySelectorAll(`.monet-tb-strip[data-tb-side="${side}"]`));

    // within-lane insertion index among non-dragging toolbars
    const mainIndex = (laneEl: any) => {
      const tbs = Array.from<any>(laneEl.querySelectorAll(`.monet-toolbar:not(.is-dragging)`));
      let idx = tbs.length;
      for (let i = 0; i < tbs.length; i++) {
        const tr = tbs[i].getBoundingClientRect();
        const mid = crossIsY ? tr.left + tr.width / 2 : tr.top + tr.height / 2;
        if (cursorMain < mid) { idx = i; break; }
      }
      return idx;
    };
    // Count toolbars in a lane excluding the one currently being dragged — a
    // lane with none of these is effectively empty, so joining it is identical
    // to starting a new lane and we shouldn't offer the redundant parallel drop.
    const laneCount = (laneEl: any) =>
      laneEl.querySelectorAll(`.monet-toolbar:not(.is-dragging)`).length;

    if (laneEls.length === 0) return { side, newLane: 0 };

    for (let i = 0; i < laneEls.length; i++) {
      const lr = laneEls[i].getBoundingClientRect();
      const lo = crossIsY ? lr.top : lr.left;
      const hi = crossIsY ? lr.bottom : lr.right;
      if (cursorCross >= lo && cursorCross <= hi) {
        const frac = (cursorCross - lo) / Math.max(1, hi - lo);
        if (frac < 0.28) return { side, newLane: i };       // near leading edge → new lane before
        if (frac > 0.72) return { side, newLane: i + 1 };   // near trailing edge → new lane after
        // Only offer a parallel "Dock <side>" join when the lane has another
        // toolbar to stack with; otherwise it's indistinguishable from a new lane.
        if (laneCount(laneEls[i]) === 0) return { side, newLane: i };
        return { side, lane: i, index: mainIndex(laneEls[i]) };
      }
    }
    // Outside every lane along the cross axis → new lane at the nearest end.
    const firstLo = crossIsY ? laneEls[0].getBoundingClientRect().top
                             : laneEls[0].getBoundingClientRect().left;
    return cursorCross < firstLo ? { side, newLane: 0 } : { side, newLane: laneEls.length };
  };
  const nearestSide = () => {
    const m = Math.min(dTop, dLeft, dRight, dBottom);
    if (m === dTop) return "top";
    if (m === dLeft) return "left";
    if (m === dRight) return "right";
    return "bottom";
  };

  // 0) Hovering directly over an existing toolbar lane resolves within that
  // side immediately — stacked lanes can extend past the edge bands below.
  for (const strip of Array.from<any>(rootEl.querySelectorAll(`.monet-tb-strip[data-tb-side]`))) {
    const sr = strip.getBoundingClientRect();
    if (x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom) {
      return resolveEdge(strip.dataset.tbSide);
    }
  }

  // 1) Window perimeter wins: within a tight band of the actual workspace edge,
  // always dock to that whole side. This keeps top/left/right/bottom edge
  // docking reachable even when a wide side dock sits right under the edge
  // (whose column borders would otherwise claim the spot as an in-dock slot).
  const PERIM = 18;
  if (Math.min(dTop, dLeft, dRight, dBottom) < PERIM) return resolveEdge(nearestSide());

  // 2) Dock-interior drops: cursor over a panel-dock column, near one of its
  // edges → slot the toolbar in as a sibling column.
  const cols = Array.from<any>(rootEl.querySelectorAll(`[data-dock-col]`));
  for (const el of cols) {
    const cr = el.getBoundingClientRect();
    if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) continue;
    const dockSide = el.dataset.side;
    const colIdx = Number(el.dataset.colIdx);
    const colId = el.dataset.colId;
    if (dockSide === "bottom" || dockSide === "top") {
      // bottom/top dock cols stack vertically (rows). Toolbar slots between rows.
      const aboveDist = y - cr.top;
      const belowDist = cr.bottom - y;
      if (aboveDist < 24)  return { kind: "in-dock", side: dockSide, colIdx, colId, position: "before" };
      if (belowDist < 24)  return { kind: "in-dock", side: dockSide, colIdx, colId, position: "after" };
    } else {
      const leftDist  = x - cr.left;
      const rightDist = cr.right - x;
      if (leftDist  < 24)  return { kind: "in-dock", side: dockSide, colIdx, colId, position: "before" };
      if (rightDist < 24)  return { kind: "in-dock", side: dockSide, colIdx, colId, position: "after" };
    }
  }

  // 3) Broader edge band as a fallback (easier targeting away from the very edge).
  const edge = 56;
  if (Math.min(dTop, dLeft, dRight, dBottom) < edge) return resolveEdge(nearestSide());
  // Body-local coords — floating toolbars are absolute inside .monet-body. Divide
  // by the body's effective scale (design-canvas zoom) so the stored float
  // position matches the cursor at any zoom level.
  return { side: "float", x: (x - r.left) / scale, y: (y - r.top) / scale };
}

export function tbSnapRect(rootEl: any, target: TbTarget | null): SnapRect | null {
  if (!rootEl || !target || target.side === "float") return null;
  const w = rootEl.offsetWidth, h = rootEl.offsetHeight;
  const r = rootEl.getBoundingClientRect();
  const scale = (rootEl.offsetWidth > 0 ? r.width / rootEl.offsetWidth : 1) || 1;

  // Toolbar dropping between/beside columns inside a panel dock.
  if (target.kind === "in-dock") {
    const col = rootEl.querySelector(`[data-dock-col][data-side="${target.side}"][data-col-idx="${target.colIdx}"]`);
    if (!col) return null;
    const cr = col.getBoundingClientRect();
    const slot = 6;
    const isV = target.side !== "bottom" && target.side !== "top";
    if (isV) {
      // Insertion bar runs vertically (full col height) between cols of a side dock.
      const xC = target.position === "before" ? cr.left : cr.right;
      return {
        x: (xC - r.left) / scale - slot/2,
        y: (cr.top - r.top) / scale,
        w: slot,
        h: cr.height / scale,
      };
    }
    // Bottom dock: insertion bar runs horizontally between vertical cols.
    const yC = target.position === "before" ? cr.top : cr.bottom;
    return {
      x: (cr.left - r.left) / scale,
      y: (yC - r.top) / scale - slot/2,
      w: cr.width / scale,
      h: slot,
    };
  }

  // ── Edge targets: lane-aware insertion preview ──────────────
  const isH = target.side === "top" || target.side === "bottom";
  const slot = 6;
  const laneEls = Array.from<any>(rootEl.querySelectorAll(`.monet-tb-strip[data-tb-side="${target.side}"]`));
  const lx = (px: number) => (px - r.left) / scale;
  const ly = (px: number) => (px - r.top) / scale;

  // No lanes yet on this side → highlight the whole insertion band.
  if (laneEls.length === 0) {
    if (isH) { const bh = 44; return { x: 0, y: target.side === "top" ? 0 : h - bh, w, h: bh }; }
    const bw = 48; return { x: target.side === "left" ? 0 : w - bw, y: 0, w: bw, h };
  }

  // New lane → a bar at the lane boundary, sized to the reference lane's
  // span along the main axis (not the whole window edge).
  if (typeof target.newLane === "number") {
    const atEnd = target.newLane >= laneEls.length;
    const ref = atEnd ? laneEls[laneEls.length - 1] : laneEls[target.newLane];
    const rr = ref.getBoundingClientRect();
    if (isH) {
      const yC = atEnd ? ly(rr.bottom) : ly(rr.top);
      return { x: lx(rr.left), y: yC - slot / 2, w: rr.width / scale, h: slot };
    }
    const xC = atEnd ? lx(rr.right) : lx(rr.left);
    return { x: xC - slot / 2, y: ly(rr.top), w: slot, h: rr.height / scale };
  }

  // Insert into an existing lane → bar along the main axis, sized to that lane.
  const laneEl = laneEls[target.lane ?? laneEls.length - 1] || laneEls[laneEls.length - 1];
  const lr = laneEl.getBoundingClientRect();
  const tbs = Array.from<any>(laneEl.querySelectorAll(`.monet-toolbar:not(.is-dragging)`));
  let along: number;
  if (tbs[target.index!]) {
    const tr = tbs[target.index!].getBoundingClientRect();
    along = isH ? lx(tr.left) : ly(tr.top);
  } else if (tbs.length) {
    const last = tbs[tbs.length - 1].getBoundingClientRect();
    along = isH ? lx(last.right) : ly(last.bottom);
  } else {
    along = isH ? lx(lr.left) : ly(lr.top);
  }
  if (isH) return { x: along - slot / 2, y: ly(lr.top), w: slot, h: lr.height / scale };
  return { x: lx(lr.left), y: along - slot / 2, w: lr.width / scale, h: slot };
}

export function tbMoveImmutable(L: NTBL, id: string, target: TbTarget): NTBL {
  // Strip the toolbar from every lane but keep empty lanes for now so the
  // target's lane index still lines up with the live DOM during the splice.
  const next = stripTbIdKeepEmpty(L, id);
  if (target.side === "float") {
    next.float.push({ id, x: (target.x ?? 0) - 80, y: (target.y ?? 0) - 14 });
    return dropEmptyLanes(next);
  }
  const lanes = next[target.side];
  if (typeof target.newLane === "number") {
    const p = Math.max(0, Math.min(lanes.length, target.newLane));
    lanes.splice(p, 0, [id]);
  } else {
    const li = Math.max(0, Math.min(lanes.length - 1, target.lane ?? 0));
    if (!lanes[li]) lanes[li] = [];
    const at = Math.max(0, Math.min(lanes[li].length, target.index ?? lanes[li].length));
    lanes[li].splice(at, 0, id);
  }
  return dropEmptyLanes(next);
}

// Structural equality over the JSON-serializable layout trees. Used to guard
// the controlled-reconcile and onChange effects against feedback loops: we only
// push a prop into state (or fire a callback) when the tree actually differs.
export function sameStruct(a: any, b: any): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}
