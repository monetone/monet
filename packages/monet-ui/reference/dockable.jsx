// ─────────────────────────────────────────────────────────────
// Dockable workspace — data-driven, interactive panel manager
// ─────────────────────────────────────────────────────────────
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
//
// Interactions wired:
//   • Click tab          → activate
//   • Drag tab           → undocks; shows snap zones; drops into target
//   • Drag float header  → move; drops into snap zones
//   • Splitter drag      → resize dock or split between groups
//   • Close button       → removes tab / floating group (becomes ghost rail)

const { useState: dUseState, useEffect: dUseEffect, useRef: dUseRef, useCallback: dUseCallback, createContext: dCreateContext, useContext: dUseContext, useMemo: dUseMemo, useLayoutEffect: dUseLayoutEffect } = React;

const DockCtx = dCreateContext(null);
let _idCounter = 0;
function nid(prefix = "g") { return `${prefix}-${++_idCounter}`; }

// ─── normalize helper ───────────────────────────────────────
function normGroup(g) {
  return { id: g.id || nid("g"), tabs: g.tabs.slice(), active: g.active || g.tabs[0], flex: g.flex ?? 1 };
}
function normCols(rawCols) {
  return rawCols
    .map(c => {
      if (c.kind === "tb" || c.tbId) return { id: c.id || nid("c"), kind: "tb", tbId: c.tbId };
      return { id: c.id || nid("c"), kind: "panel", flex: c.flex ?? 1, stack: (c.stack || []).map(normGroup) };
    })
    .filter(c => c.kind === "tb" ? !!c.tbId : c.stack.length);
}
function normLayout(L) {
  const out = { left: null, right: null, top: null, bottom: null, floating: [] };
  for (const side of ["left", "right", "top", "bottom"]) {
    const d = L[side]; if (!d) continue;
    // Accept legacy `{ stack: [groups] }` and wrap it in a single column.
    const cols = normCols(d.cols || (d.stack ? [{ stack: d.stack }] : []));
    if (!cols.length) continue;
    out[side] = { size: d.size ?? sizeFor(side), cols };
  }
  // Floats are now full mini-docks: a column-set with the same shape as a side
  // dock, so the exact same split / stack / resize machinery works inside them.
  // Accept legacy `{ group }` or `{ stack }` and wrap into cols.
  out.floating = (L.floating || [])
    .map(f => {
      let cols;
      if (f.cols) cols = normCols(f.cols);
      else if (f.stack) cols = normCols([{ stack: f.stack }]);
      else if (f.group) cols = normCols([{ stack: [f.group] }]);
      else cols = [];
      return { id: f.id || nid("f"), x: f.x ?? 100, y: f.y ?? 100, w: f.w ?? 280, h: f.h ?? 220, cols };
    })
    .filter(f => f.cols.some(c => c.kind === "panel" && c.stack.length));
  return out;
}

// ─── container helpers (a "container" is a side dock or a float) ─────
// cont = { side: "left"|"right"|"bottom" }  OR  { floatId }
const sizeFor = (side) => side === "bottom" ? 240 : side === "top" ? 200 : 300;
function contOf(target) { return target.cont || (target.side ? { side: target.side } : null); }
function sameCont(a, b) { return !!a && !!b && a.side === b.side && a.floatId === b.floatId; }
function getCols(L, cont) {
  if (!cont) return null;
  if (cont.floatId != null) { const f = L.floating.find(x => x.id === cont.floatId); return f ? f.cols : null; }
  return L[cont.side] ? L[cont.side].cols : null;
}
function withCols(L, cont, cols) {
  if (cont.floatId != null) return { ...L, floating: L.floating.map(f => f.id === cont.floatId ? { ...f, cols } : f) };
  const d = L[cont.side] || { size: sizeFor(cont.side) };
  return { ...L, [cont.side]: { ...d, cols } };
}

// ─── locate a tab in the layout ─────────────────────────────
function findInCols(cols, tabId) {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]; if (col.kind !== "panel") continue;
    for (let gi = 0; gi < col.stack.length; gi++)
      if (col.stack[gi].tabs.includes(tabId)) return { colIdx: ci, groupIdx: gi };
  }
  return null;
}
function findTab(L, tabId) {
  for (const side of ["left", "right", "top", "bottom"]) {
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
function removeTabFromCols(cols, tabId) {
  return cols
    .map(col => {
      if (col.kind !== "panel") return col;
      const stack = col.stack
        .map(g => {
          if (!g.tabs.includes(tabId)) return g;
          const tabs = g.tabs.filter(t => t !== tabId);
          return tabs.length ? { ...g, tabs, active: g.active === tabId ? tabs[0] : g.active } : null;
        })
        .filter(Boolean);
      return stack.length ? { ...col, stack } : null;
    })
    .filter(Boolean);
}
function removeTabImmutable(L, tabId) {
  const next = { ...L, floating: L.floating.slice() };
  for (const side of ["left", "right", "top", "bottom"]) {
    if (!next[side]) continue;
    const cols = removeTabFromCols(next[side].cols, tabId);
    // Keep the dock if it still has panels OR docked toolbars; else drop it.
    const hasPanel = cols.some(c => c.kind === "panel");
    next[side] = (hasPanel || cols.some(c => c.kind === "tb")) ? { ...next[side], cols } : null;
  }
  next.floating = next.floating
    .map(f => {
      const cols = removeTabFromCols(f.cols, tabId);
      return cols.some(c => c.kind === "panel" && c.stack.length) ? { ...f, cols } : null;
    })
    .filter(Boolean);
  return next;
}

// ─── locate a group / col by its stable id (across docks + floats) ──
function findGroupInCols(cols, groupId) {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]; if (col.kind !== "panel") continue;
    for (let i = 0; i < col.stack.length; i++)
      if (col.stack[i].id === groupId) return { colIdx: ci, groupIdx: i, group: col.stack[i] };
  }
  return null;
}
function findGroupById(L, groupId) {
  if (!groupId) return null;
  for (const side of ["left", "right", "top", "bottom"]) {
    const d = L[side]; if (!d) continue;
    const r = findGroupInCols(d.cols, groupId);
    if (r) return { cont: { side }, side, ...r };
  }
  for (const f of L.floating) {
    const r = findGroupInCols(f.cols, groupId);
    if (r) return { cont: { floatId: f.id }, side: "float", ...r };
  }
  return null;
}

// Toolbars can also live inside a panel dock as a "tb col" wedged between
// panel columns. Strip a tb col with this id out of every dock — used both
// when starting to drag a docked toolbar and before re-placing it.
function removeTbColImmutable(L, tbId) {
  const next = { ...L };
  for (const side of ["left", "right", "top", "bottom"]) {
    if (!next[side]) continue;
    const cols = next[side].cols.filter(c => !(c.kind === "tb" && c.tbId === tbId));
    const hasAny = cols.length > 0;
    next[side] = hasAny ? { ...next[side], cols } : null;
  }
  return next;
}

// Insert a tb col at the requested position relative to an existing column.
function insertTbColImmutable(L, tbId, target) {
  const { side, colId, colIdx, position } = target;
  const next = { ...L };
  if (!next[side]) next[side] = { size: sizeFor(side), cols: [] };
  const cols = next[side].cols.slice();
  // Resolve insertion index by id (stable across removals) — fall back to the
  // positional colIdx if we can't find the id (e.g. last panel col deleted).
  let idx = colId ? cols.findIndex(c => c.id === colId) : -1;
  if (idx < 0) idx = Math.max(0, Math.min(cols.length, colIdx ?? cols.length));
  let at = position === "before" ? idx : idx + 1;
  at = Math.max(0, Math.min(cols.length, at));
  cols.splice(at, 0, { id: nid("c"), kind: "tb", tbId });
  next[side] = { ...next[side], cols };
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
function applyDrop(L, tabId, target, dragGeom) {
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
  const newGroup = (id) => ({ id: id || nid("g"), tabs: [tabId], active: tabId, flex: 1 });
  const newCol = (groups) => ({ id: nid("c"), kind: "panel", flex: 1, stack: groups });

  if (target.kind === "float") {
    next.floating = [
      ...next.floating,
      { id: nid("f"), x: target.x - 100, y: target.y - 14, w: dragGeom?.w || 280, h: dragGeom?.h || 220,
        cols: [newCol([newGroup()])] },
    ];
    return next;
  }
  if (target.kind === "new-dock") {
    next[target.side] = { size: sizeFor(target.side), cols: [newCol([newGroup()])] };
    return next;
  }

  const cont = contOf(target);
  if (!cont) return next;

  // Make sure the target container still exists after the remove (the dragged
  // tab may have been its last panel) — recreate an empty one if needed.
  const ensureCont = () => {
    let cols = getCols(next, cont);
    if (cols) return cols;
    if (cont.floatId != null) {
      const o = origin.floating.find(f => f.id === cont.floatId);
      next = { ...next, floating: [...next.floating, { id: cont.floatId, x: o?.x ?? 120, y: o?.y ?? 120, w: o?.w ?? 280, h: o?.h ?? 220, cols: [] }] };
    } else {
      next = { ...next, [cont.side]: { size: sizeFor(cont.side), cols: [] } };
    }
    return getCols(next, cont);
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
      gi = cols[ci].stack.length;
    }
    const stack = cols[ci].stack.slice();
    let at = target.beforeGroupId ? gi : target.afterGroupId ? gi + 1 : (target.beforeIdx ?? stack.length);
    at = Math.max(0, Math.min(stack.length, at));
    stack.splice(at, 0, newGroup());
    cols[ci] = { ...cols[ci], stack };
    return withCols(next, cont, cols);
  }

  if (target.kind === "tab-into-group") {
    let located = findGroupById(next, target.groupId);
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
          next = { ...next, [c2.side]: { size: sizeFor(c2.side), cols: [] } };
        }
      }
      const cols = getCols(next, c2).slice();
      let ci = Math.max(0, Math.min(cols.length, orig.colIdx));
      if (!cols[ci] || cols[ci].kind !== "panel") cols.splice(ci, 0, newCol([]));
      const stack = cols[ci].stack.slice();
      const at = Math.max(0, Math.min(stack.length, orig.groupIdx));
      stack.splice(at, 0, { id: target.groupId, tabs: [tabId], active: tabId, flex: orig.group.flex ?? 1 });
      cols[ci] = { ...cols[ci], stack };
      return withCols(next, c2, cols);
    }
    const c2 = located.cont;
    const cols = getCols(next, c2).slice();
    const stack = cols[located.colIdx].stack.slice();
    const g = stack[located.groupIdx];
    const tabs = g.tabs.slice();
    const at = target.tabIdx ?? tabs.length;
    tabs.splice(at, 0, tabId);
    stack[located.groupIdx] = { ...g, tabs, active: tabId };
    cols[located.colIdx] = { ...cols[located.colIdx], stack };
    return withCols(next, c2, cols);
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
function dirToTarget(dir, ctx) {
  const { cont, side, colIdx, colId, groupIdx, groupId, tabIdx = null } = ctx;
  const base = { cont, gid: groupId, side, dir };
  if (dir === "center" || !dir)
    return { kind: "tab-into-group", colIdx, groupIdx, groupId, tabIdx, ...base, dir: "center" };
  const newGroupBefore = { kind: "new-group", colIdx, beforeIdx: groupIdx,     beforeGroupId: groupId, ...base };
  const newGroupAfter  = { kind: "new-group", colIdx, beforeIdx: groupIdx + 1, afterGroupId:  groupId, ...base };
  const newColBefore   = { kind: "new-column", beforeColIdx: colIdx,     beforeColId: colId, ...base };
  const newColAfter    = { kind: "new-column", beforeColIdx: colIdx + 1, afterColId:  colId, ...base };
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

// Geometry of the 5-button dock widget for a group rect (screen px).
const DOCK_CELL = 38, DOCK_GAP = 7, DOCK_STRIP = 32;
function dockWidgetCells(r) {
  const cx = (r.left + r.right) / 2;
  const cy = r.top + DOCK_STRIP + (r.height - DOCK_STRIP) / 2;
  const off = DOCK_CELL + DOCK_GAP;
  const cell = (dir, dx, dy) => ({
    dir,
    x: cx + dx * off - DOCK_CELL / 2,
    y: cy + dy * off - DOCK_CELL / 2,
    w: DOCK_CELL, h: DOCK_CELL,
  });
  return { cx, cy, list: [cell("center", 0, 0), cell("n", 0, -1), cell("s", 0, 1), cell("w", -1, 0), cell("e", 1, 0)] };
}

// Resolve a drop target from the cursor's position over a single group element
// — shared by docks and floats. `cont` identifies the owning container.
function groupTarget(el, x, y, cont) {
  const r = el.getBoundingClientRect();
  const ctx = {
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
function hitTest(rootEl, x, y, excludeFloatId = null) {
  if (!rootEl) return null;
  const rootRect = rootEl.getBoundingClientRect();

  // Floating mini-docks first (they sit above docks in z-order). Iterate
  // reversed so the top-most float wins when several overlap. A float now
  // contains real groups, so we descend and reuse the exact same group logic
  // — splitting & stacking inside a float works identically to a side dock.
  const floats = Array.from(rootEl.querySelectorAll("[data-float-id]")).reverse();
  for (const el of floats) {
    if (excludeFloatId && el.dataset.floatId === excludeFloatId) continue;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const cont = { floatId: el.dataset.floatId };
    const inner = Array.from(el.querySelectorAll("[data-dock-group]"));
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
  const hasDock = (s) => !!rootEl.querySelector(`.ap-dock--${s}`);
  if (x - rootRect.left < edge && !hasDock("left"))   return { kind: "new-dock", side: "left" };
  if (rootRect.right - x < edge && !hasDock("right")) return { kind: "new-dock", side: "right" };
  if (y - rootRect.top < edge && !hasDock("top"))     return { kind: "new-dock", side: "top" };
  if (rootRect.bottom - y < edge && !hasDock("bottom")) return { kind: "new-dock", side: "bottom" };

  // Side-dock groups (exclude any group that lives inside a float).
  const groups = Array.from(rootEl.querySelectorAll("[data-dock-group]"))
    .filter(ge => !ge.closest("[data-float-id]"));
  for (const el of groups) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    return groupTarget(el, x, y, { side: el.dataset.side });
  }

  // Empty canvas → create a new float under the cursor (body-local coords).
  return { kind: "float", x: x - rootRect.left, y: y - rootRect.top };
}

// ─── compute snap-zone rects to draw during drag ────────────
function computeSnapRects(rootEl, target) {
  if (!rootEl || !target) return null;
  const rootR = rootEl.getBoundingClientRect();
  // rootEl may live inside a scaled parent (design-canvas zoom). getBoundingClientRect
  // returns post-transform screen pixels, but the rect we return is positioned as a
  // child of rootEl using its own (pre-transform) coordinate space. Divide screen-space
  // measurements by the effective scale so they line up after the parent re-scales us.
  const scale = (rootEl.offsetWidth > 0 ? rootR.width / rootEl.offsetWidth : 1) || 1;
  const toLocal = (sx, sy, w, h) => ({
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

function snapLabel(target) {
  if (!target) return "";
  if (target.kind === "float") return "Float";
  if (target.kind === "new-dock") return `Dock ${target.side}`;
  if (target.kind === "new-group" || target.kind === "new-column") {
    return { n: "Split top", s: "Split bottom", w: "Split left", e: "Split right" }[target.dir] || "Split";
  }
  if (target.kind === "tab-into-group") return "Stack as tab";
  return "";
}

// Locate the hovered group's widget center in body-local coords (compensating
// for design-canvas zoom), plus which direction is currently active.
function computeDockWidget(rootEl, target) {
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

// The 5-button directional dock widget — center=stack, n/s/e/w=split.
const DOCK_GLYPH = {
  center: "M5 5h8v8H5z",
  n: "M9 5l4 5H5z", s: "M9 13l-4-5h8z",
  w: "M5 9l5-4v8z", e: "M13 9l-5 4V5z",
};
function DockWidget({ wg, accent }) {
  if (!wg) return null;
  const off = DOCK_CELL + DOCK_GAP;
  const defs = [["center", 0, 0], ["n", 0, -1], ["s", 0, 1], ["w", -1, 0], ["e", 1, 0]];
  return (
    <div className="ap-dockwidget" style={{ left: wg.cx, top: wg.cy }}>
      {defs.map(([dir, dx, dy]) => {
        const active = wg.active === dir;
        return (
          <div key={dir}
               className={`ap-dw-cell ${active ? "is-active" : ""}`}
               style={{
                 left: dx * off - DOCK_CELL / 2,
                 top: dy * off - DOCK_CELL / 2,
                 width: DOCK_CELL, height: DOCK_CELL,
                 "--accent": accent,
               }}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d={DOCK_GLYPH[dir]} fill="currentColor"/>
            </svg>
          </div>
        );
      })}
    </div>
  );
}

// Always-on edge strips during a drag — show where whole-side docks land.
// Only render a strip for a side that has no dock yet (an occupied edge
// splits inside the existing dock instead of creating a new one).
function EdgeHints({ rootEl, target, accent }) {
  if (!rootEl) return null;
  const hasDock = (s) => !!rootEl.querySelector(`.ap-dock--${s}`);
  const isDock = (s) => target && target.kind === "new-dock" && target.side === s;
  const strip = (s, style) => hasDock(s) ? null : (
    <div key={s} className={`ap-edgehint ${isDock(s) ? "is-active" : ""}`}
         style={{ ...style, "--accent": accent }}/>
  );
  return (
    <>
      {strip("left",   { left: 3, top: 3, bottom: 3, width: 7 })}
      {strip("right",  { right: 3, top: 3, bottom: 3, width: 7 })}
      {strip("top",    { left: 3, right: 3, top: 3, height: 7 })}
      {strip("bottom", { left: 3, right: 3, bottom: 3, height: 7 })}
    </>
  );
}

// ─── tab strip ──────────────────────────────────────────────
function DTabStrip({ group, side, groupIdx, panels, onActivate, onClose, onDragTab, accent }) {
  return (
    <div className="ap-tabs">
      {group.tabs.map((tabId, i) => {
        const meta = panels[tabId];
        return (
          <span key={tabId}
                data-dock-tab
                data-tab-id={tabId}
                className={`ap-tab ${group.active === tabId ? "is-active" : ""}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // first activate on press, then arm drag
                  onActivate(tabId);
                  onDragTab(tabId, side, groupIdx, e);
                }}>
            {meta?.title || tabId}
          </span>
        );
      })}
      <div className="ap-tab-actions">
        <span className="btn" title="Close" onClick={() => onClose(group.active)}>
          <Icon d={I.close} size={11}/>
        </span>
      </div>
    </div>
  );
}

// ─── group renderer ─────────────────────────────────────────
function DGroup({ group, side, cont, colIdx, colId, groupIdx, panels, accent, height, onActivate, onClose, onDragTab }) {
  const meta = panels[group.active];
  return (
    <div className="ap-panel"
         data-dock-group
         data-side={side}
         data-col-idx={colIdx}
         data-col-id={colId}
         data-g-idx={groupIdx}
         data-g-id={group.id}
         style={{ height: height ?? undefined, minHeight: 0, flex: height ? "0 0 auto" : 1 }}>
      <DTabStrip
        group={group}
        side={side}
        groupIdx={groupIdx}
        panels={panels}
        accent={accent}
        onActivate={(t) => onActivate(cont, colIdx, groupIdx, t)}
        onClose={(t) => onClose(cont, colIdx, groupIdx, t)}
        onDragTab={onDragTab}
      />
      <div className={`ap-panel-body ${meta?.flush ? "is-flush" : ""}`}>
        {meta ? meta.render() : <div style={{color:"var(--text-3)", fontSize:11, padding:10}}>Empty panel</div>}
      </div>
    </div>
  );
}

// ─── stack of groups inside a single column ─────────────────
// For left/right/float, the stack is vertical; for bottom, horizontal.
function DStack({ side, cont, colIdx, col, panels, accent, onActivate, onClose, onDragTab, onResizeGroup }) {
  const isH = side === "bottom" || side === "top";
  const ref = dUseRef(null);
  const startResize = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const dim = isH ? rect.width : rect.height;
    const start = isH ? e.clientX : e.clientY;
    const a0 = col.stack[i].flex, b0 = col.stack[i+1].flex;
    const total = a0 + b0;
    const onMove = (ev) => {
      const d = (isH ? ev.clientX : ev.clientY) - start;
      const fracDelta = (d / dim) * col.stack.reduce((s,g)=>s+g.flex,0);
      let na = Math.max(0.15, a0 + fracDelta);
      let nb = total - na;
      if (nb < 0.15) { nb = 0.15; na = total - nb; }
      onResizeGroup(cont, colIdx, i, na, nb);
    };
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = isH ? "col-resize" : "row-resize";
  };
  return (
    <div ref={ref}
         data-dock-col
         data-side={side}
         data-col-idx={colIdx}
         data-col-id={col.id}
         style={{ display:"flex", flexDirection: isH ? "row" : "column", flex:1, minHeight:0, minWidth:0 }}>
      {col.stack.map((g, i) => (
        <React.Fragment key={g.id}>
          <div style={{ flex: g.flex, minWidth:0, minHeight:0, display:"flex", flexDirection:"column" }}>
            <DGroup group={g} side={side} cont={cont} colIdx={colIdx} colId={col.id} groupIdx={i} panels={panels} accent={accent}
                    onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}/>
          </div>
          {i < col.stack.length - 1 && (
            <div className={`ap-split ${isH ? "" : "is-h"}`} onPointerDown={startResize(i)} style={{"--accent": accent}}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── columns layout — places columns across the cross-axis of a container ───
function DColumns({ side, cont, cols, panels, accent, onActivate, onClose, onDragTab, onResizeGroup, onResizeCol, renderTbCol }) {
  // Bottom & top docks: cols stack vertically (cross-axis is vertical).
  // Left/right docks + floats: cols stack horizontally.
  const colsVertical = side === "bottom" || side === "top";
  const ref = dUseRef(null);
  const startResize = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    // Only resize between two flexible (panel) cols.
    if (cols[i].kind !== "panel" || cols[i+1].kind !== "panel") return;
    const rect = ref.current.getBoundingClientRect();
    const dim = colsVertical ? rect.height : rect.width;
    const start = colsVertical ? e.clientY : e.clientX;
    const a0 = cols[i].flex, b0 = cols[i+1].flex;
    const total = a0 + b0;
    const panelSum = cols.filter(c => c.kind === "panel").reduce((s,c)=>s+c.flex,0);
    const onMove = (ev) => {
      const d = (colsVertical ? ev.clientY : ev.clientX) - start;
      const fracDelta = (d / dim) * panelSum;
      let na = Math.max(0.15, a0 + fracDelta);
      let nb = total - na;
      if (nb < 0.15) { nb = 0.15; na = total - nb; }
      onResizeCol(cont, i, na, nb);
    };
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = colsVertical ? "row-resize" : "col-resize";
  };
  const tbOrient = colsVertical ? "h" : "v";
  return (
    <div ref={ref} style={{
      display:"flex",
      flexDirection: colsVertical ? "column" : "row",
      flex:1, minHeight:0, minWidth:0,
    }}>
      {cols.map((col, i) => (
        <React.Fragment key={col.id}>
          {col.kind === "tb" ? (
            <div data-dock-col data-dock-col-kind="tb" data-side={side} data-col-idx={i} data-col-id={col.id}
                 style={{ flex:"0 0 auto", display:"flex", flexDirection:"column", minHeight:0, minWidth:0 }}>
              {renderTbCol ? renderTbCol(col.tbId, tbOrient) : null}
            </div>
          ) : (
            <div style={{ flex: col.flex, minWidth:0, minHeight:0, display:"flex", flexDirection:"column" }}>
              <DStack side={side} cont={cont} colIdx={i} col={col} panels={panels} accent={accent}
                      onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}
                      onResizeGroup={onResizeGroup}/>
            </div>
          )}
          {i < cols.length - 1 && (
            <div className={`ap-split ${colsVertical ? "is-h" : ""} ${(cols[i].kind !== "panel" || cols[i+1].kind !== "panel") ? "is-fixed" : ""}`}
                 onPointerDown={startResize(i)}
                 style={{"--accent": accent}}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── dock wrapper (handles outer size + outer splitter) ─────
function DDock({ side, dock, panels, accent, onActivate, onClose, onDragTab, onResizeDock, onResizeGroup, onResizeCol, renderTbCol }) {
  const isV = side === "bottom" || side === "top";
  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const start = isV ? e.clientY : e.clientX;
    const s0 = dock.size;
    const move = (ev) => {
      const d = (isV ? ev.clientY : ev.clientX) - start;
      // The splitter sits on the dock's inner edge: left & top docks grow as it
      // moves toward the far edge (s0 + d); right & bottom grow as it moves back.
      const next = (side === "left" || side === "top") ? s0 + d : s0 - d;
      onResizeDock(side, Math.max(140, Math.min(900, next)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = isV ? "row-resize" : "col-resize";
  };
  const style = isV ? { height: dock.size, flex:`0 0 ${dock.size}px` }
                    : { width: dock.size, flex:`0 0 ${dock.size}px` };
  return (
    <>
      {(side === "right" || side === "bottom") &&
        <div className={`ap-split ${isV ? "is-h" : ""}`} onPointerDown={onDown} style={{"--accent": accent}}/>}
      <div className={`ap-dock ap-dock--${side}`} style={style}>
        <DColumns side={side} cont={{ side }} cols={dock.cols} panels={panels} accent={accent}
                  onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}
                  onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                  renderTbCol={renderTbCol}/>
      </div>
      {(side === "left" || side === "top") &&
        <div className={`ap-split ${isV ? "is-h" : ""}`} onPointerDown={onDown} style={{"--accent": accent}}/>}
    </>
  );
}

// ─── floating panel — a free-positioned mini-dock ──────────
function DFloat({ f, panels, accent, onActivate, onClose, onDragTab, onDragHeader, onCloseFloat, onResize, onResizeGroup, onResizeCol }) {
  const headerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("[data-float-close]")) return;
    onDragHeader(f.id, e);
  };
  const resizeDown = (corner) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const { x, y, w, h } = f;
    // Floats live inside .ap-body which may be scaled by the design-canvas zoom.
    // Convert screen-pixel pointer deltas to body-local pixels so resize tracks
    // the cursor at every zoom level.
    const floatEl = e.currentTarget.closest("[data-float-id]");
    const rootEl = floatEl?.parentElement;
    const scale = (rootEl && rootEl.offsetWidth > 0
      ? rootEl.getBoundingClientRect().width / rootEl.offsetWidth : 1) || 1;
    const move = (ev) => {
      let nx = x, ny = y, nw = w, nh = h;
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (corner.includes("e")) nw = Math.max(200, w + dx);
      if (corner.includes("s")) nh = Math.max(140, h + dy);
      if (corner.includes("w")) { nw = Math.max(200, w - dx); nx = x + (w - nw); }
      if (corner.includes("n")) { nh = Math.max(140, h - dy); ny = y + (h - nh); }
      onResize(f.id, { x: nx, y: ny, w: nw, h: nh });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="ap-float" data-float-id={f.id} style={{ left:f.x, top:f.y, width:f.w, height:f.h, "--accent": accent }}>
      <div className="ap-float-bar" onPointerDown={headerDown} title="Drag to move">
        <span className="ap-float-grip"><Icon d="M3 5h12 M3 8h12 M3 11h12" size={12}/></span>
        <span style={{flex:1}}/>
        <span data-float-close className="ap-iconbtn" style={{width:18, height:18}} onClick={() => onCloseFloat(f.id)}>
          <Icon d={I.close} size={10}/>
        </span>
      </div>
      <div className="ap-float-cols" style={{flex:1, minHeight:0, minWidth:0, display:"flex"}}>
        <DColumns side="float" cont={{ floatId: f.id }} cols={f.cols} panels={panels} accent={accent}
                  onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}
                  onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}/>
      </div>
      {/* resize grips */}
      <div style={{position:"absolute", right:0, bottom:0, width:14, height:14, cursor:"se-resize"}} onPointerDown={resizeDown("se")}/>
      <div style={{position:"absolute", right:0, top:8, bottom:14, width:5, cursor:"e-resize"}} onPointerDown={resizeDown("e")}/>
      <div style={{position:"absolute", left:8, right:14, bottom:0, height:5, cursor:"s-resize"}} onPointerDown={resizeDown("s")}/>
      <div style={{position:"absolute", left:0, top:8, bottom:14, width:5, cursor:"w-resize"}} onPointerDown={resizeDown("w")}/>
    </div>
  );
}

// ─── drag ghost ─────────────────────────────────────────────
function DragGhost({ drag, panels, originRect, scale = 1 }) {
  if (!drag) return null;
  const meta = panels[drag.tabId];
  const ox = originRect ? originRect.left : 0;
  const oy = originRect ? originRect.top : 0;
  return (
    <div style={{
      position:"absolute",
      left: (drag.x - ox) / scale - 40,
      top: (drag.y - oy) / scale - 12,
      pointerEvents:"none", zIndex: 100,
      padding:"5px 12px", borderRadius:6,
      background:"var(--glass-3)",
      backdropFilter:"var(--blur-strong)",
      boxShadow:"0 12px 32px rgba(0,0,0,0.5), inset 0 0 0 0.5px var(--stroke-strong), 0 0 0 1.5px var(--accent)",
      fontSize:11, fontWeight:600,
      color:"var(--text-1)",
      transform:"rotate(-2deg)",
    }}>{meta?.title || drag.tabId}</div>
  );
}

// ─── snap zone overlay ──────────────────────────────────────
function DragSnap({ rect, label, accent, bounds }) {
  if (!rect) return null;
  // Pill is a fixed-size box centered on the snap rect. When the rect is a thin
  // strip at an edge (e.g. "Dock left" / "New column"), a naive centered pill
  // spills past the workspace and gets clipped — clamp it to stay fully visible.
  const PAD = 6, LW = 100, LH = 20;
  let lx = rect.x + rect.w/2 - LW/2;
  let ly = rect.y + rect.h/2 - LH/2;
  if (bounds) {
    lx = Math.max(PAD, Math.min(lx, bounds.w - LW - PAD));
    ly = Math.max(PAD, Math.min(ly, bounds.h - LH - PAD));
  }
  return (
    <>
      <div style={{
        position:"absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        background: `color-mix(in oklch, ${accent} 20%, transparent)`,
        boxShadow: `inset 0 0 0 1.5px ${accent}, 0 0 24px color-mix(in oklch, ${accent} 40%, transparent)`,
        pointerEvents:"none", zIndex: 90,
        borderRadius: 4,
        backdropFilter: "blur(8px)",
        transition: "left .09s ease, top .09s ease, width .09s ease, height .09s ease",
      }}/>
      {label && <div style={{
        position:"absolute",
        left: lx, top: ly,
        padding:"3px 10px",
        background: accent,
        color:"#0b0e14",
        fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
        borderRadius:4,
        textAlign:"center",
        width: LW, boxSizing:"border-box",
        whiteSpace:"nowrap",
        pointerEvents:"none", zIndex: 91,
        boxShadow:"0 2px 8px rgba(0,0,0,0.4)",
      }}>{label}</div>}
    </>
  );
}

// ─── Toolbar primitive + edge-slot management ───────────────
// Toolbars are relocatable strips. They live in one of: top, left, right, float.
// Each has a small grip handle the user drags to move/dock.

// ── Toolbar edge model ──────────────────────────────────────
// Each edge (top/bottom/left/right) is a list of LANES; each lane is a
// list of toolbar ids. On top/bottom a lane is a horizontal row and lanes
// stack vertically; on left/right a lane is a vertical column and lanes sit
// side by side. So toolbars on one edge can stack along EITHER axis.
// Legacy flat arrays (["a","b"]) are read as a single lane ([["a","b"]]).
function normLane(arr) {
  if (!arr || arr.length === 0) return [];
  if (Array.isArray(arr[0])) return arr.map(l => l.slice()).filter(l => l.length);
  return [arr.slice()];
}
function normTBL(L = {}) {
  return {
    top: normLane(L.top),
    bottom: normLane(L.bottom),
    left: normLane(L.left),
    right: normLane(L.right),
    float: (L.float || []).map(f => ({ id: f.id, x: f.x ?? 80, y: f.y ?? 80 })),
  };
}
// Remove a toolbar id from every lane on every edge, dropping lanes left empty.
function stripTbId(L, id) {
  const s = side => L[side].map(lane => lane.filter(x => x !== id)).filter(l => l.length);
  return { top: s("top"), bottom: s("bottom"), left: s("left"), right: s("right"),
           float: L.float.filter(f => f.id !== id) };
}
// Same, but KEEP now-empty lanes so lane indices still match the live DOM
// while we splice the toolbar into its new home.
function stripTbIdKeepEmpty(L, id) {
  const s = side => L[side].map(lane => lane.filter(x => x !== id));
  return { top: s("top"), bottom: s("bottom"), left: s("left"), right: s("right"),
           float: L.float.filter(f => f.id !== id) };
}
function dropEmptyLanes(L) {
  const d = side => L[side].filter(l => l.length);
  return { top: d("top"), bottom: d("bottom"), left: d("left"), right: d("right"), float: L.float };
}

function tbHitTest(rootEl, x, y, draggedId = null) {
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
  const resolveEdge = (side) => {
    const isH = side === "top" || side === "bottom";       // lanes are rows (cross axis = Y)
    const crossIsY = isH;
    const cursorCross = crossIsY ? y : x;
    const cursorMain  = crossIsY ? x : y;
    const laneEls = Array.from(rootEl.querySelectorAll(`.ap-tb-strip[data-tb-side="${side}"]`));

    // within-lane insertion index among non-dragging toolbars
    const mainIndex = (laneEl) => {
      const tbs = Array.from(laneEl.querySelectorAll(`.ap-toolbar:not(.is-dragging)`));
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
    const laneCount = (laneEl) =>
      laneEl.querySelectorAll(`.ap-toolbar:not(.is-dragging)`).length;

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
  for (const strip of Array.from(rootEl.querySelectorAll(`.ap-tb-strip[data-tb-side]`))) {
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
  const cols = Array.from(rootEl.querySelectorAll(`[data-dock-col]`));
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
  // Body-local coords — floating toolbars are absolute inside .ap-body. Divide
  // by the body's effective scale (design-canvas zoom) so the stored float
  // position matches the cursor at any zoom level.
  return { side: "float", x: (x - r.left) / scale, y: (y - r.top) / scale };
}

function tbSnapRect(rootEl, target) {
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
  const laneEls = Array.from(rootEl.querySelectorAll(`.ap-tb-strip[data-tb-side="${target.side}"]`));
  const lx = px => (px - r.left) / scale;
  const ly = px => (px - r.top) / scale;

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
  const laneEl = laneEls[target.lane] || laneEls[laneEls.length - 1];
  const lr = laneEl.getBoundingClientRect();
  const tbs = Array.from(laneEl.querySelectorAll(`.ap-toolbar:not(.is-dragging)`));
  let along;
  if (tbs[target.index]) {
    const tr = tbs[target.index].getBoundingClientRect();
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

function tbMoveImmutable(L, id, target) {
  // Strip the toolbar from every lane but keep empty lanes for now so the
  // target's lane index still lines up with the live DOM during the splice.
  const next = stripTbIdKeepEmpty(L, id);
  if (target.side === "float") {
    next.float.push({ id, x: target.x - 80, y: target.y - 14 });
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

function Toolbar({ id, orientation, accent, isDragging, isFloat, x, y, onGripDown, children }) {
  return (
    <div className={`ap-toolbar ap-toolbar--${orientation} ${isDragging ? "is-dragging" : ""} ${isFloat ? "is-float" : ""}`}
         data-toolbar-id={id}
         style={{ "--accent": accent, ...(isFloat ? { left: x, top: y } : {}) }}>
      <div className="ap-toolbar-grip" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onGripDown(id, e); }}>
        <Icon d={orientation === "h" ? "M5 4L5 12 M8 4L8 12 M11 4L11 12" : "M4 5L12 5 M4 8L12 8 M4 11L12 11"} size={10}/>
      </div>
      <div className="ap-toolbar-body">{children}</div>
    </div>
  );
}

// ─── titlebar + menus reused from panels.jsx primitives ────

// ─── main workspace component ───────────────────────────────
function DockableWorkspace({
  accent, app, title, docs, activeDoc,
  menus, canvas, statusBar, iconRail, iconRailLeft,
  toolbarDefs = {}, initialToolbarLayout = {},
  panels, initialLayout, platform = "win",
}) {
  const [layout, setLayout] = dUseState(() => normLayout(initialLayout));
  const [tbLayout, setTbLayout] = dUseState(() => normTBL(initialToolbarLayout));
  const [drag, setDrag] = dUseState(null);  // panel tab/header drag
  const [tbDrag, setTbDrag] = dUseState(null);  // toolbar drag
  const hostRef = dUseRef(null);
  const bodyRef = dUseRef(null);

  // resolve cursor → drop target; only consider hits within body
  const computeTarget = (x, y) => hitTest(bodyRef.current, x, y);

  // drag a tab off
  const onDragTab = dUseCallback((tabId, fromSide, fromGroupIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 5) return;
      started = true;
      const target = computeTarget(ev.clientX, ev.clientY);
      setDrag({ kind: "tab", tabId, x: ev.clientX, y: ev.clientY, target });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) {
        const target = computeTarget(ev.clientX, ev.clientY);
        // if dropping back on the same group's tab strip (no change), skip
        setLayout(L => applyDrop(L, tabId, target));
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  // drag a floating panel header (move + dock)
  const onDragHeader = dUseCallback((floatId, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const float = layout.floating.find(f => f.id === floatId);
    if (!float) return;
    const startFx = float.x, startFy = float.y;
    const body = bodyRef.current;
    const bodyScale = (body && body.offsetWidth > 0
      ? body.getBoundingClientRect().width / body.offsetWidth : 1) || 1;
    // Self-drops aren't dock targets. The dragged float is excluded from
    // hit-testing, but guard anyway.
    const isSelfDrop = (t) => t && t.cont && t.cont.floatId === floatId;
    // Exclude the dragged float from hit-testing — the float follows the cursor
    // and would otherwise always be the topmost hit, blocking docks underneath.
    const hit = (x, y) => hitTest(bodyRef.current, x, y, floatId);
    const firstTab = (() => {
      for (const c of float.cols) if (c.kind === "panel" && c.stack.length) return c.stack[0].active;
      return null;
    })();
    const move = (ev) => {
      const dx = (ev.clientX - startX) / bodyScale, dy = (ev.clientY - startY) / bodyScale;
      const target = hit(ev.clientX, ev.clientY);
      const docking = target && target.kind !== "float" && !isSelfDrop(target);
      setLayout(L => ({
        ...L,
        floating: L.floating.map(f => f.id === floatId
          ? { ...f, x: startFx + dx, y: startFy + dy } : f),
      }));
      if (docking) {
        setDrag({ kind: "float-dock", floatId, x: ev.clientX, y: ev.clientY, target, tabId: firstTab });
      } else {
        setDrag(null);
      }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const target = hit(ev.clientX, ev.clientY);
      if (target && target.kind !== "float" && !isSelfDrop(target)) {
        // dock every tab in this float into the target
        setLayout(L => {
          const fl = L.floating.find(f => f.id === floatId);
          if (!fl) return L;
          const allTabs = fl.cols.flatMap(c => c.kind === "panel" ? c.stack : []).flatMap(g => g.tabs);
          let next = L;
          for (const tabId of allTabs) next = applyDrop(next, tabId, target);
          return next;
        });
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [layout]);

  const onActivate = (cont, colIdx, groupIdx, tabId) => {
    setLayout(L => {
      const cols = getCols(L, cont); if (!cols) return L;
      const ncols = cols.slice();
      const stack = ncols[colIdx].stack.slice();
      stack[groupIdx] = { ...stack[groupIdx], active: tabId };
      ncols[colIdx] = { ...ncols[colIdx], stack };
      return withCols(L, cont, ncols);
    });
  };

  const onCloseTab = (cont, colIdx, groupIdx, tabId) => {
    setLayout(L => removeTabImmutable(L, tabId));
  };
  const onCloseFloat = (id) => {
    setLayout(L => ({ ...L, floating: L.floating.filter(f => f.id !== id) }));
  };
  const onResizeFloat = (id, geom) => {
    setLayout(L => ({ ...L, floating: L.floating.map(f => f.id === id ? { ...f, ...geom } : f) }));
  };

  const onResizeDock = (side, size) => {
    setLayout(L => ({ ...L, [side]: { ...L[side], size } }));
  };
  const onResizeGroup = (cont, colIdx, i, na, nb) => {
    setLayout(L => {
      const cols = getCols(L, cont); if (!cols) return L;
      const ncols = cols.slice();
      const stack = ncols[colIdx].stack.slice();
      stack[i] = { ...stack[i], flex: na };
      stack[i+1] = { ...stack[i+1], flex: nb };
      ncols[colIdx] = { ...ncols[colIdx], stack };
      return withCols(L, cont, ncols);
    });
  };
  const onResizeCol = (cont, i, na, nb) => {
    setLayout(L => {
      const cols = getCols(L, cont); if (!cols) return L;
      const ncols = cols.slice();
      ncols[i] = { ...ncols[i], flex: na };
      ncols[i+1] = { ...ncols[i+1], flex: nb };
      return withCols(L, cont, ncols);
    });
  };

  // snap rect to draw
  const snapRect = drag && drag.target && drag.target.kind !== "float"
    ? computeSnapRects(bodyRef.current, drag.target) : null;
  // Hide the floating text label whenever the directional widget is on screen
  // (the widget already communicates intent) — keep it for edge/float docks.
  const snapText = drag?.target?.gid ? "" : snapLabel(drag?.target);

  // ─── toolbar drag ─────────────────────────────────────────
  const onTbGripDown = dUseCallback((id, e) => {
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    const body = bodyRef.current;
    const bodyScale = (body && body.offsetWidth > 0
      ? body.getBoundingClientRect().width / body.offsetWidth : 1) || 1;
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 4) return;
      started = true;
      const target = tbHitTest(bodyRef.current, ev.clientX, ev.clientY, id);
      setTbDrag({ id, x: ev.clientX, y: ev.clientY, target });
      // Live-detach the toolbar to a floating position so it follows the
      // cursor — same UX as the floating panel header drag. If the cursor is
      // back in an edge zone, the toolbar still floats during the drag and
      // only commits to that dock on pointerup.
      if (target.side === "float") {
        // If the toolbar was previously a docked col, peel it out so it can
        // float freely.
        setLayout(L => removeTbColImmutable(L, id));
        setTbLayout(L => {
          const next = stripTbId(L, id);
          next.float.push({ id, x: target.x - 80, y: target.y - 14 });
          return next;
        });
      }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) {
        const target = tbHitTest(bodyRef.current, ev.clientX, ev.clientY, id);
        // Toolbar may currently live in either tbLayout (edge/float) or
        // inside layout.cols (docked between panel cols). Strip it from both
        // before placing it in its final position.
        setLayout(L => removeTbColImmutable(L, id));
        if (target.kind === "in-dock") {
          setLayout(L => insertTbColImmutable(L, id, target));
          // Make sure tbLayout doesn't keep a stale ghost copy.
          setTbLayout(L => stripTbId(L, id));
        } else {
          setTbLayout(L => tbMoveImmutable(L, id, target));
        }
      }
      setTbDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const tbSnap = tbDrag && tbDrag.target.side !== "float"
    ? tbSnapRect(bodyRef.current, tbDrag.target) : null;

  // helper to render one toolbar by id
  const renderTB = (id, orientation, opts = {}) => {
    const def = toolbarDefs[id];
    if (!def) return null;
    // Some toolbars (e.g. the options bar) only make sense laid out horizontally.
    // Keep them horizontal in any slot; the vertical slot sizes to fit the row.
    const orient = def.horizontalOnly ? "h" : orientation;
    const isDragging = tbDrag?.id === id;
    return (
      <Toolbar key={id} id={id} orientation={orient} accent={accent}
               isDragging={isDragging} isFloat={opts.isFloat} x={opts.x} y={opts.y}
               onGripDown={onTbGripDown}>
        {def.render(orient)}
      </Toolbar>
    );
  };

  // Render one edge's toolbar lanes. Top/bottom: lanes are horizontal rows
  // stacked vertically. Left/right: lanes are vertical columns side by side.
  const renderTbEdge = (side) => {
    const lanes = tbLayout[side];
    if (!lanes.length) return null;
    const isH = side === "top" || side === "bottom";
    return (
      <div className={`ap-tb-lanes ap-tb-lanes--${isH ? "h" : "v"}`} data-tb-side={side}>
        {lanes.map((lane, li) => (
          <div key={li} className={`ap-tb-strip ap-tb-strip--${isH ? "h" : "v"}`}
               data-tb-side={side} data-tb-lane={li}>
            {lane.map(id => renderTB(id, isH ? "h" : "v"))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`ap-window ap-window--${platform}`} ref={hostRef} style={{ "--accent": accent }}>
        <Titlebar title={title} app={app} docs={docs} activeDoc={activeDoc} accent={accent} platform={platform} menus={menus}/>
        <div className="ap-body" ref={bodyRef}>
        {iconRailLeft}
        {renderTbEdge("left")}
        {layout.left && <DDock side="left" dock={layout.left} panels={panels} accent={accent}
                                onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                renderTbCol={renderTB}/>}
        <div style={{flex:1, display:"flex", flexDirection:"column", minWidth:0, minHeight:0}}>
          {renderTbEdge("top")}
          {layout.top && <DDock side="top" dock={layout.top} panels={panels} accent={accent}
                                onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                renderTbCol={renderTB}/>}
          {canvas}
          {layout.bottom && <DDock side="bottom" dock={layout.bottom} panels={panels} accent={accent}
                                    onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                    onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                    renderTbCol={renderTB}/>}
          {renderTbEdge("bottom")}
        </div>
        {layout.right && <DDock side="right" dock={layout.right} panels={panels} accent={accent}
                                  onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                  onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                  renderTbCol={renderTB}/>}
        {renderTbEdge("right")}
        {iconRail}

        {/* floating mini-docks */}
        {layout.floating.map(f => (
          <DFloat key={f.id} f={f} panels={panels} accent={accent}
                  onActivate={onActivate}
                  onClose={onCloseTab}
                  onDragTab={onDragTab}
                  onResizeGroup={onResizeGroup}
                  onResizeCol={onResizeCol}
                  onDragHeader={onDragHeader}
                  onCloseFloat={onCloseFloat}
                  onResize={onResizeFloat}/>
        ))}

        {/* floating toolbars */}
        {tbLayout.float.map(f => renderTB(f.id, "h", { isFloat: true, x: f.x, y: f.y }))}

        {/* panel snap visualization */}
        {drag && <EdgeHints rootEl={bodyRef.current} target={drag.target} accent={accent}/>}
        {drag && <DragSnap rect={snapRect} label={snapText} accent={accent} bounds={bodyRef.current ? {w: bodyRef.current.offsetWidth, h: bodyRef.current.offsetHeight} : null}/>}
        {drag && <DockWidget wg={computeDockWidget(bodyRef.current, drag.target)} accent={accent}/>}
        {drag && drag.kind === "tab" && <DragGhost drag={drag} panels={panels} originRect={bodyRef.current?.getBoundingClientRect()} scale={(bodyRef.current ? (bodyRef.current.getBoundingClientRect().width / bodyRef.current.offsetWidth) : 1) || 1}/>}

        {/* toolbar snap visualization */}
        {tbDrag && <DragSnap rect={tbSnap} bounds={bodyRef.current ? {w: bodyRef.current.offsetWidth, h: bodyRef.current.offsetHeight} : null} label={
          tbDrag.target.side === "float" ? "Float"
            : typeof tbDrag.target.newLane === "number"
              ? ((tbDrag.target.side === "top" || tbDrag.target.side === "bottom") ? "New row" : "New column")
              : `Dock ${tbDrag.target.side}`
        } accent={accent}/>}
      </div>
      {statusBar}
    </div>
  );
}

Object.assign(window, {
  DockableWorkspace, Toolbar,
  normLayout, hitTest, applyDrop, computeSnapRects, snapLabel,
  dirToTarget, dockWidgetCells, computeDockWidget, DockWidget, EdgeHints,
  normTBL, tbHitTest, tbSnapRect, tbMoveImmutable,
  findGroupById,
});
