// Unit tests for the pure dockable layout algebra (dockable-core.ts).
// Run from the repo root with:  node --test packages/monet-react/test/
// Node 24 strips the TS types; the module under test is imported with an
// explicit .ts extension. Zero-dep tooling only (node:test + node:assert).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normLayout, normCols, normGroup, normTBL, normLane,
  applyDrop, dockFloatImmutable, removeTabImmutable, removeTabFromCols, openTabImmutable, setDockCollapsedImmutable,
  dirToTarget, dockWidgetCells, snapLabel,
  findGroupById, findTab, findInCols,
  getCols, withCols, contOf, sameCont, sameStruct, sizeFor,
  stripTbId, tbMoveImmutable, tbHitTest,
  nid,
} from "../src/dockable-core.ts";

// ── helpers ─────────────────────────────────────────────────
// Deep clone via JSON so we can assert an input wasn't mutated.
const snap = (x: any) => JSON.parse(JSON.stringify(x));
// A minimal normalized layout with one tab `a` in a single left-dock group.
function baseLayout() {
  return normLayout({ left: { size: 280, cols: [{ stack: [{ tabs: ["a", "b"] }] }] } });
}
// All tab ids that currently live in a layout (across docks + floats).
function allTabs(L: any): string[] {
  const out: string[] = [];
  const walkCols = (cols: any[]) => {
    for (const c of cols) if (c.kind === "panel") for (const g of c.stack) out.push(...g.tabs);
  };
  for (const side of ["left", "right", "top", "bottom"]) if (L[side]) walkCols(L[side].cols);
  for (const f of L.floating) walkCols(f.cols);
  return out;
}

// ─── normLayout / normCols / normGroup ──────────────────────
test("normLayout wraps a legacy `{ stack }` side into a single column", () => {
  const L = normLayout({ left: { stack: [{ tabs: ["a"] }, { tabs: ["b"] }] } });
  assert.ok(L.left, "left dock exists");
  assert.equal(L.left.cols.length, 1, "single wrapping column");
  assert.equal(L.left.cols[0].kind, "panel");
  assert.equal(L.left.cols[0].stack.length, 2, "both groups kept");
  assert.deepEqual(L.left.cols[0].stack.map((g: any) => g.tabs), [["a"], ["b"]]);
});

test("collapsed docks round-trip without changing panel structure or expanded size (#479)", () => {
  const original = baseLayout();
  const before = snap(original);
  assert.equal(original.left.collapsed, false, "legacy layouts remain expanded");
  const collapsed = setDockCollapsedImmutable(original, "left", true);
  assert.deepEqual(original, before, "does not mutate the workspace seed");
  assert.equal(collapsed.left.size, 280);
  assert.equal(collapsed.left.cols, original.left.cols, "panel tree retained");
  assert.deepEqual(normLayout(snap(collapsed)), collapsed, "saved workspace/reload keeps collapse");
  assert.deepEqual(setDockCollapsedImmutable(collapsed, "left", false), original);
  assert.equal(setDockCollapsedImmutable(collapsed, "left", true), collapsed, "idempotent");
  assert.equal(setDockCollapsedImmutable(collapsed, "right", true), collapsed, "absent side stays absent");
  assert.equal(removeTabImmutable(collapsed, "a").left.collapsed, true, "edits preserve collapsed state");
  assert.equal(openTabImmutable(collapsed, "b").left.collapsed, true, "Open Panel leaves an iconified panel on its rail (the view springs it out)");
  const right = normLayout({ right: { collapsed: true, stack: [{ tabs: ["a"] }] } });
  assert.equal(openTabImmutable(right, "new").right.collapsed, false, "newly reopened panels are visible");
  assert.equal(normLayout({ left: { collapsed: "true" as any, stack: [{ tabs: ["a"] }] } }).left.collapsed, false);
  assert.throws(() => setDockCollapsedImmutable(original, "float" as any, true), /dock side/);
  assert.throws(() => setDockCollapsedImmutable(original, "left", "false" as any), /boolean/);
  assert.deepEqual(original, before, "invalid requests leave state intact");
});

test("normLayout defaults size per side and gives floats default geometry", () => {
  const L = normLayout({
    bottom: { cols: [{ stack: [{ tabs: ["x"] }] }] },
    top: { cols: [{ stack: [{ tabs: ["y"] }] }] },
    right: { cols: [{ stack: [{ tabs: ["z"] }] }] },
    floating: [{ group: { tabs: ["f"] } }],
  });
  assert.equal(L.bottom.size, sizeFor("bottom"));
  assert.equal(L.top.size, sizeFor("top"));
  assert.equal(L.right.size, sizeFor("right"));
  assert.equal(L.floating.length, 1);
  const f = L.floating[0];
  assert.equal(f.x, 100); assert.equal(f.y, 100);
  assert.equal(f.w, 280); assert.equal(f.h, 220);
  assert.equal(f.cols[0].stack[0].tabs[0], "f");
});

test("normLayout accepts legacy float `{ stack }` and `{ group }` shapes", () => {
  const fromStack = normLayout({ floating: [{ stack: [{ tabs: ["a"] }, { tabs: ["b"] }] }] });
  assert.equal(fromStack.floating[0].cols[0].stack.length, 2);
  const fromGroup = normLayout({ floating: [{ group: { tabs: ["a", "b"] } }] });
  assert.deepEqual(fromGroup.floating[0].cols[0].stack[0].tabs, ["a", "b"]);
});

test("normGroup backfills active + flex and copies the tabs array", () => {
  const tabs = ["a", "b"];
  const g = normGroup({ tabs });
  assert.equal(g.active, "a", "active defaults to first tab");
  assert.equal(g.flex, 1, "flex defaults to 1");
  assert.ok(typeof g.id === "string" && g.id.length, "id backfilled");
  assert.notEqual(g.tabs, tabs, "tabs array is copied, not aliased");
  // preserves an explicit active/flex/id
  const g2 = normGroup({ id: "keep", tabs: ["a", "b"], active: "b", flex: 2 });
  assert.deepEqual([g2.id, g2.active, g2.flex], ["keep", "b", 2]);
});

test("normCols drops empty panel columns and tb cols without a tbId", () => {
  const cols = normCols([
    { stack: [] },                 // empty panel → dropped
    { stack: [{ tabs: ["a"] }] },  // kept
    { kind: "tb" },                // no tbId → dropped
    { kind: "tb", tbId: "tools" }, // kept
  ]);
  assert.equal(cols.length, 2);
  assert.equal(cols[0].kind, "panel");
  assert.equal(cols[1].kind, "tb");
  assert.equal(cols[1].tbId, "tools");
});

// #180 — normLayout is the reconciliation boundary for loose/legacy/persisted
// seeds, so a group whose `active` is not in `tabs` (or with no tabs at all)
// must not survive it: both render an unclosable "Empty panel" with a
// keyboard-dead tab strip.
test("normGroup clamps a stale active and normCols drops empty groups (#180)", () => {
  const L = normLayout({ left: { cols: [{ stack: [
    { id: "g1", tabs: ["a", "b"], active: "gone" },
    { id: "g2", tabs: [] },
  ] }] } });
  const stack = L.left.cols[0].stack;
  assert.equal(stack.length, 1, "the tab-less group is dropped");
  assert.equal(stack[0].id, "g1");
  assert.equal(stack[0].active, "a", "stale active clamped to a real tab");
  // A column left holding only empty groups is empty → the whole dock goes.
  assert.equal(normLayout({ right: { cols: [{ stack: [{ tabs: [] }] }] } }).right, null);
});

test("normLayout backfills stable ids and is idempotent (re-normalizing preserves ids)", () => {
  const once = normLayout({ left: { cols: [{ stack: [{ tabs: ["a"] }, { tabs: ["b"] }] }] } });
  const colId = once.left.cols[0].id;
  const gIds = once.left.cols[0].stack.map((g: any) => g.id);
  assert.ok(colId && gIds.every(Boolean), "ids present after first normalize");
  // Feeding the normalized tree back in must keep the same ids (id || nid()).
  const twice = normLayout(once);
  assert.equal(twice.left.cols[0].id, colId, "column id stable across re-normalize");
  assert.deepEqual(twice.left.cols[0].stack.map((g: any) => g.id), gIds, "group ids stable");
  // And the structure is unchanged.
  assert.ok(sameStruct(once, twice), "idempotent structure");
});

test("normLayout drops a float that has no panel content", () => {
  const L = normLayout({ floating: [{ id: "f1", cols: [{ kind: "tb", tbId: "t" }] }] });
  assert.equal(L.floating.length, 0, "tb-only float is dropped");
});

// ─── dirToTarget ────────────────────────────────────────────
test("dirToTarget center yields a tab-into-group target with the group id", () => {
  const t = dirToTarget("center", { cont: { side: "left" }, side: "left", colIdx: 0, colId: "c1", groupIdx: 0, groupId: "g1", tabIdx: 2 });
  assert.equal(t.kind, "tab-into-group");
  assert.equal(t.groupId, "g1");
  assert.equal(t.gid, "g1");
  assert.equal(t.tabIdx, 2);
  assert.equal(t.dir, "center");
});

test("dirToTarget orients groups/columns differently for side vs bottom docks", () => {
  const ctxLeft = { cont: { side: "left" }, side: "left", colIdx: 1, colId: "c1", groupIdx: 0, groupId: "g1" };
  // Left dock: n/s split groups, w/e split columns.
  assert.equal(dirToTarget("n", ctxLeft).kind, "new-group");
  assert.equal(dirToTarget("s", ctxLeft).kind, "new-group");
  assert.equal(dirToTarget("w", ctxLeft).kind, "new-column");
  assert.equal(dirToTarget("e", ctxLeft).kind, "new-column");
  assert.equal(dirToTarget("n", ctxLeft).beforeGroupId, "g1");
  assert.equal(dirToTarget("s", ctxLeft).afterGroupId, "g1");

  const ctxBottom = { ...ctxLeft, cont: { side: "bottom" }, side: "bottom" };
  // Bottom dock: w/e split groups, n/s split columns (axes swapped).
  assert.equal(dirToTarget("w", ctxBottom).kind, "new-group");
  assert.equal(dirToTarget("e", ctxBottom).kind, "new-group");
  assert.equal(dirToTarget("n", ctxBottom).kind, "new-column");
  assert.equal(dirToTarget("s", ctxBottom).kind, "new-column");
});

// ─── snapLabel / dockWidgetCells ────────────────────────────
test("snapLabel describes each target kind", () => {
  assert.equal(snapLabel(null), "");
  assert.equal(snapLabel({ kind: "float" }), "Float");
  assert.equal(snapLabel({ kind: "new-dock", side: "left" }), "Dock left");
  assert.equal(snapLabel({ kind: "new-group", dir: "n" }), "Split top");
  assert.equal(snapLabel({ kind: "new-column", dir: "e" }), "Split right");
  assert.equal(snapLabel({ kind: "tab-into-group" }), "Stack as tab");
});

test("dockWidgetCells lays out 5 cells centered under the tab strip", () => {
  const wg = dockWidgetCells({ left: 0, right: 100, top: 0, height: 100 });
  assert.equal(wg.list.length, 5);
  assert.equal(wg.cx, 50);
  assert.deepEqual(wg.list.map((c: any) => c.dir), ["center", "n", "s", "w", "e"]);
  const center = wg.list[0];
  // center cell is centered on (cx, cy)
  assert.equal(center.x + center.w / 2, wg.cx);
  assert.equal(center.y + center.h / 2, wg.cy);
});

// ─── findGroupById / findTab / findInCols ───────────────────
test("findGroupById locates a group across docks and floats", () => {
  const L = normLayout({
    left: { cols: [{ stack: [{ tabs: ["a"] }] }] },
    floating: [{ group: { tabs: ["b"] } }],
  });
  const gLeft = L.left.cols[0].stack[0];
  const located = findGroupById(L, gLeft.id);
  assert.ok(located);
  assert.equal(located.side, "left");
  assert.deepEqual(located.cont, { side: "left" });
  const gFloat = L.floating[0].cols[0].stack[0];
  const locFloat = findGroupById(L, gFloat.id);
  assert.equal(locFloat.side, "float");
  assert.equal(locFloat.cont.floatId, L.floating[0].id);
  assert.equal(findGroupById(L, "nope"), null);
  assert.equal(findGroupById(L, null), null);
});

test("findTab + findInCols report the column/group index of a tab", () => {
  const L = baseLayout();
  const r = findTab(L, "b");
  assert.equal(r.kind, "dock");
  assert.deepEqual(r.cont, { side: "left" });
  assert.equal(r.colIdx, 0);
  assert.equal(r.groupIdx, 0);
  assert.equal(findTab(L, "missing"), null);
  assert.equal(findInCols(L.left.cols, "missing"), null);
});

// ─── getCols / withCols / contOf / sameCont ─────────────────
test("getCols + withCols round-trip a dock and a float immutably", () => {
  const L = normLayout({ left: { cols: [{ stack: [{ tabs: ["a"] }] }] }, floating: [{ group: { tabs: ["b"] } }] });
  const before = snap(L);
  const cols = getCols(L, { side: "left" });
  assert.ok(Array.isArray(cols));
  const next = withCols(L, { side: "left" }, []);
  assert.deepEqual(next.left.cols, [], "withCols replaces the dock's columns");
  assert.deepEqual(snap(L), before, "withCols does not mutate the original");
  // float path
  const fid = L.floating[0].id;
  const next2 = withCols(L, { floatId: fid }, []);
  assert.deepEqual(next2.floating[0].cols, []);
  assert.deepEqual(snap(L), before, "float withCols does not mutate original");
});

test("contOf + sameCont normalize and compare container descriptors", () => {
  assert.deepEqual(contOf({ side: "left" }), { side: "left" });
  assert.deepEqual(contOf({ cont: { floatId: "f1" } }), { floatId: "f1" });
  assert.equal(contOf({}), null);
  assert.ok(sameCont({ side: "left" }, { side: "left" }));
  assert.ok(!sameCont({ side: "left" }, { side: "right" }));
  assert.ok(sameCont({ floatId: "f1" }, { floatId: "f1" }));
  assert.ok(!sameCont(null, { side: "left" }));
});

// ─── removeTabImmutable / removeTabFromCols ─────────────────
test("removeTabImmutable removes a tab without mutating the input", () => {
  const L = baseLayout();
  const before = snap(L);
  const next = removeTabImmutable(L, "a");
  assert.deepEqual(snap(L), before, "input not mutated");
  assert.deepEqual(allTabs(next), ["b"], "only `a` removed");
  // the surviving group's active falls back to the remaining tab
  assert.equal(next.left.cols[0].stack[0].active, "b");
});

test("removeTabImmutable collapses the group and drops the dock when its last tab leaves", () => {
  const L = normLayout({ left: { cols: [{ stack: [{ tabs: ["solo"] }] }] } });
  const next = removeTabImmutable(L, "solo");
  assert.equal(next.left, null, "empty dock is dropped");
});

test("removeTabImmutable keeps a dock that still has a docked toolbar col", () => {
  const L = normLayout({ left: { cols: [{ stack: [{ tabs: ["solo"] }] }, { kind: "tb", tbId: "tools" }] } });
  const next = removeTabImmutable(L, "solo");
  assert.ok(next.left, "dock retained for the tb col");
  assert.equal(next.left.cols.length, 1);
  assert.equal(next.left.cols[0].kind, "tb");
});

test("removeTabImmutable drops a float once its last panel tab leaves", () => {
  const L = normLayout({ floating: [{ group: { tabs: ["only"] } }] });
  const next = removeTabImmutable(L, "only");
  assert.equal(next.floating.length, 0);
});

test("removeTabFromCols collapses an empty group but keeps siblings", () => {
  const cols = normCols([{ stack: [{ tabs: ["a"] }, { tabs: ["b", "c"] }] }]);
  const next = removeTabFromCols(cols, "a");
  assert.equal(next[0].stack.length, 1, "the a-only group collapsed");
  assert.deepEqual(next[0].stack[0].tabs, ["b", "c"]);
});

test("openTabImmutable reopens a panel missing from a persisted layout", () => {
  const withSibling = normLayout({ right: { cols: [{ stack: [{ tabs: ["layers"] }] }] } });
  const stacked = openTabImmutable(withSibling, "history");
  assert.deepEqual(allTabs(stacked), ["layers", "history"]);
  assert.equal(stacked.right.cols[0].stack[0].active, "history");
  assert.deepEqual(allTabs(openTabImmutable(stacked, "history")), ["layers", "history"], "an open panel is not duplicated");

  const closedLastPanel = removeTabImmutable(normLayout({ right: { cols: [{ stack: [{ tabs: ["history"] }] }] } }), "history");
  const reopened = openTabImmutable(closedLastPanel, "history");
  assert.deepEqual(allTabs(reopened), ["history"]);
  assert.ok(reopened.right, "the right dock is recreated after its last panel was closed");
});

test("openTabImmutable reveals a panel that is already in the layout", () => {
  // Window ▸ <panel> and Window ▸ Arrange are "show me this", not "add this".
  // Short-circuiting on an open panel meant every one of them silently did
  // nothing the moment the panel sat behind another tab (#498).
  const behind = normLayout({ right: { cols: [{ stack: [{ tabs: ["layers", "history"], active: "layers" }] }] } });
  const revealed = openTabImmutable(behind, "history");
  assert.equal(revealed.right.cols[0].stack[0].active, "history", "the buried tab is brought to the front");
  assert.deepEqual(allTabs(revealed), ["layers", "history"], "and nothing is duplicated");

  // A panel in a float behind another float is just as unreachable, so the
  // float is raised too (last renders on top).
  const floats = normLayout({
    floating: [
      { id: "f1", cols: [{ stack: [{ tabs: ["history", "info"], active: "info" }] }] },
      { id: "f2", cols: [{ stack: [{ tabs: ["layers"] }] }] },
    ],
  });
  const raised = openTabImmutable(floats, "history");
  assert.equal(raised.floating[raised.floating.length - 1].id, "f1", "its float is raised to the front");
  assert.equal(raised.floating[raised.floating.length - 1].cols[0].stack[0].active, "history");
  assert.deepEqual(allTabs(raised).sort(), ["history", "info", "layers"], "and nothing is duplicated");
});

// ─── applyDrop ──────────────────────────────────────────────
test("applyDrop no-ops on a null target and is immutable on the input", () => {
  const L = baseLayout();
  const before = snap(L);
  const same = applyDrop(L, "a", null);
  assert.equal(same, L, "null target returns the same reference");
  assert.deepEqual(snap(L), before);
});

test("applyDrop self-drop of a single-tab group onto itself is a no-op", () => {
  const L = normLayout({ left: { cols: [{ stack: [{ tabs: ["solo"] }] }] } });
  const gid = L.left.cols[0].stack[0].id;
  const out = applyDrop(L, "solo", { kind: "tab-into-group", groupId: gid });
  assert.equal(out, L, "returns the same layout untouched");
});

test("applyDrop float creates a new floating mini-dock with the dragged tab", () => {
  const L = baseLayout();
  const before = snap(L);
  const next = applyDrop(L, "a", { kind: "float", x: 300, y: 200 });
  assert.deepEqual(snap(L), before, "input not mutated");
  assert.equal(next.floating.length, 1);
  const f = next.floating[0];
  assert.deepEqual(f.cols[0].stack[0].tabs, ["a"]);
  assert.equal(f.x, 200, "x offset by -100");
  assert.equal(f.y, 186, "y offset by -14");
  // `a` left the left dock, `b` stays
  assert.deepEqual(next.left.cols[0].stack[0].tabs, ["b"]);
});

test("applyDrop float honors dragGeom size, falling back to defaults", () => {
  const L = baseLayout();
  const withGeom = applyDrop(L, "a", { kind: "float", x: 0, y: 0 }, { w: 400, h: 333 });
  assert.equal(withGeom.floating[0].w, 400);
  assert.equal(withGeom.floating[0].h, 333);
  const noGeom = applyDrop(L, "a", { kind: "float", x: 0, y: 0 });
  assert.equal(noGeom.floating[0].w, 280);
  assert.equal(noGeom.floating[0].h, 220);
});

test("applyDrop new-dock creates a whole-side dock containing the tab", () => {
  const L = baseLayout();
  const next = applyDrop(L, "a", { kind: "new-dock", side: "right" });
  assert.ok(next.right, "right dock created");
  assert.equal(next.right.size, sizeFor("right"));
  assert.deepEqual(next.right.cols[0].stack[0].tabs, ["a"]);
  assert.deepEqual(next.left.cols[0].stack[0].tabs, ["b"], "a left the left dock");
});

test("applyDrop tab-into-group stacks the tab into the target group at tabIdx", () => {
  // two separate groups in the left dock; move `c` into the `a/b` group at index 1
  const L = normLayout({ left: { cols: [
    { stack: [{ tabs: ["a", "b"] }] },
    { stack: [{ tabs: ["c"] }] },
  ] } });
  const targetGid = L.left.cols[0].stack[0].id;
  const before = snap(L);
  // Targets always carry their owning container (`cont`), exactly as dirToTarget builds them.
  const next = applyDrop(L, "c", { kind: "tab-into-group", cont: { side: "left" }, groupId: targetGid, tabIdx: 1 });
  assert.deepEqual(snap(L), before, "immutable");
  const stacked = findGroupById(next, targetGid);
  assert.deepEqual(stacked.group.tabs, ["a", "c", "b"], "inserted at tabIdx 1");
  assert.equal(stacked.group.active, "c", "dropped tab becomes active");
});

// #174 — restoring a persisted layout must advance the id generator past the ids
// it just adopted, or the first split of the session re-mints a live id.
test("normLayout seeds the id generator past restored ids (#174)", () => {
  // Probe the generator so the persisted ids are exactly the ones it would mint
  // next — makes the collision deterministic regardless of test order.
  const n = Number(nid("g").split("-")[1]);
  const L = normLayout({ left: { size: 300, cols: [
    { id: `c-${n + 2}`, stack: [{ id: `g-${n + 1}`, tabs: ["layers", "channels"] }] },
  ] } });
  assert.equal(L.left.cols[0].stack[0].id, `g-${n + 1}`, "restored ids are preserved");
  const next = applyDrop(L, "channels", {
    kind: "new-group", cont: { side: "left" }, colIdx: 0, afterGroupId: `g-${n + 1}`,
  });
  const gids = next.left.cols.flatMap((c: any) => c.stack.map((g: any) => g.id));
  assert.equal(new Set(gids).size, gids.length, `duplicate group ids: ${gids.join(", ")}`);
  assert.deepEqual(findGroupById(next, `g-${n + 1}`).group.tabs, ["layers"], "the old group still resolves by id");
});

// #176 — tabIdx is measured against the live strip (which still renders the
// dragged tab), but applyDrop splices into the array *after* removing it.
test("applyDrop tab-into-group reorders inside its own group without overshooting (#176)", () => {
  const L = normLayout({ left: { cols: [{ stack: [{ tabs: ["a", "b", "c"] }] }] } });
  const gid = L.left.cols[0].stack[0].id;
  const drop = (tab: string, tabIdx: number) =>
    findGroupById(applyDrop(L, tab, { kind: "tab-into-group", cont: { side: "left" }, groupId: gid, tabIdx }), gid)
      .group.tabs;
  assert.deepEqual(drop("a", 1), ["a", "b", "c"], "left half of b → no-op");
  assert.deepEqual(drop("a", 2), ["b", "a", "c"], "right half of b");
  assert.deepEqual(drop("a", 3), ["b", "c", "a"], "past the end of the strip");
  assert.deepEqual(drop("c", 1), ["a", "c", "b"], "leftward was already correct");
});

test("applyDrop tab-into-group merges a tab from another group, collapsing the emptied source", () => {
  const L = normLayout({ left: { cols: [
    { stack: [{ tabs: ["x"] }] },
    { stack: [{ tabs: ["y"] }] },
  ] } });
  const targetGid = L.left.cols[0].stack[0].id;
  const L2 = applyDrop(L, "y", { kind: "tab-into-group", cont: { side: "left" }, groupId: targetGid });
  // `x` and `y` now share one group; the source column collapsed away.
  const merged = findGroupById(L2, targetGid);
  assert.deepEqual([...merged.group.tabs].sort(), ["x", "y"]);
  assert.equal(L2.left.cols.length, 1, "emptied source column dropped");
  assert.equal(merged.group.active, "y", "the moved tab becomes active");
});

test("applyDrop new-group inserts a sibling group next to the reference (by id)", () => {
  const L = normLayout({ left: { cols: [{ stack: [{ tabs: ["a"] }, { tabs: ["b"] }] }] } });
  const refGid = L.left.cols[0].stack[1].id;  // the `b` group
  const next = applyDrop(L, "a", { kind: "new-group", cont: { side: "left" }, afterGroupId: refGid });
  // `a` removed from its old group; a fresh group with `a` lands after `b`
  const stack = next.left.cols[0].stack;
  assert.equal(stack[stack.length - 1].tabs[0], "a", "new `a` group is last (after b)");
  assert.deepEqual(allTabs(next).sort(), ["a", "b"]);
});

test("applyDrop new-column inserts a fresh column before/after a reference column", () => {
  const L = normLayout({ left: { cols: [
    { stack: [{ tabs: ["a", "b"] }] },
  ] } });
  const refColId = L.left.cols[0].id;
  const next = applyDrop(L, "b", { kind: "new-column", cont: { side: "left" }, afterColId: refColId });
  assert.equal(next.left.cols.length, 2, "new column added");
  assert.deepEqual(next.left.cols[1].stack[0].tabs, ["b"], "b is in the new trailing column");
  assert.deepEqual(next.left.cols[0].stack[0].tabs, ["a"], "a stays in the original column");
});

// #177 — a float docks as ONE group. Replaying a split target once per tab used
// to mint a column per tab, in reverse order (the afterColId reference resolves
// to the same column every pass, so each insert lands before the previous one).
test("dockFloatImmutable moves a multi-tab float into a single new column (#177)", () => {
  const L = normLayout({
    left: { cols: [{ id: "c1", stack: [{ tabs: ["x"] }] }] },
    floating: [{ id: "f1", group: { tabs: ["a", "b", "c"] } }],
  });
  const next = dockFloatImmutable(L, "f1", {
    kind: "new-column", cont: { side: "left" }, side: "left", dir: "e", afterColId: "c1",
  });
  assert.equal(next.left.cols.length, 2, "one new column, not one per tab");
  assert.deepEqual(next.left.cols[0].stack[0].tabs, ["x"]);
  assert.deepEqual(next.left.cols[1].stack.map((g: any) => g.tabs), [["a", "b", "c"]],
    "the whole float lands in one group, in its original order");
  assert.equal(next.floating.length, 0, "the emptied float is gone");
});

test("dockFloatImmutable keeps tab order when stacking into an existing group (#177)", () => {
  const L = normLayout({
    left: { cols: [{ stack: [{ tabs: ["x"] }] }] },
    floating: [{ id: "f1", group: { tabs: ["a", "b", "c"] } }],
  });
  const gid = L.left.cols[0].stack[0].id;
  const next = dockFloatImmutable(L, "f1", {
    kind: "tab-into-group", cont: { side: "left" }, groupId: gid, tabIdx: 0,
  });
  assert.deepEqual(findGroupById(next, gid).group.tabs, ["a", "b", "c", "x"], "dropped before x, in order");
});

// ─── toolbar layout: normTBL / normLane / stripTbId / tbMoveImmutable ──
test("normLane reads a flat array as a single lane and nested arrays as lanes", () => {
  assert.deepEqual(normLane(["a", "b"]), [["a", "b"]], "flat → one lane");
  assert.deepEqual(normLane([["a"], ["b"]]), [["a"], ["b"]], "nested → lanes");
  assert.deepEqual(normLane([]), []);
  assert.deepEqual(normLane(undefined), []);
});

test("normTBL normalizes every edge + floats with default coords", () => {
  const T = normTBL({ top: ["a"], left: [["b"], ["c"]], float: [{ id: "f" }] });
  assert.deepEqual(T.top, [["a"]]);
  assert.deepEqual(T.left, [["b"], ["c"]]);
  assert.deepEqual(T.bottom, []);
  assert.deepEqual(T.right, []);
  assert.deepEqual(T.float, [{ id: "f", x: 80, y: 80 }]);
});

test("stripTbId removes a toolbar from every lane and float, dropping empty lanes", () => {
  const T = normTBL({ top: [["a", "b"], ["b"]], float: [{ id: "b" }] });
  const next = stripTbId(T, "b");
  assert.deepEqual(next.top, [["a"]], "the b-only lane is dropped, the shared lane keeps a");
  assert.deepEqual(next.float, [], "floating b removed");
});

test("tbMoveImmutable moves a toolbar to a new lane and is immutable on the input", () => {
  const T = normTBL({ top: [["a"]] });
  const before = snap(T);
  const next = tbMoveImmutable(T, "a", { side: "left", newLane: 0 });
  assert.deepEqual(snap(T), before, "input not mutated");
  assert.deepEqual(next.top, [], "removed from top");
  assert.deepEqual(next.left, [["a"]], "added as a new left lane");
});

test("tbMoveImmutable inserts into an existing lane at the given index", () => {
  const T = normTBL({ top: [["a", "c"]] });
  const next = tbMoveImmutable(T, "b", { side: "top", lane: 0, index: 1 });
  assert.deepEqual(next.top, [["a", "b", "c"]]);
});

test("tbMoveImmutable to float records a position offset and clears lanes", () => {
  const T = normTBL({ top: [["a"]] });
  const next = tbMoveImmutable(T, "a", { side: "float", x: 200, y: 100 });
  assert.deepEqual(next.top, []);
  assert.deepEqual(next.float, [{ id: "a", x: 120, y: 86 }]);
});

// ─── tbHitTest (DOM-measurement over a fake element tree) ───
// A tiny element fake exposing only what tbHitTest reads. `rect` is the bounding
// box; `matches` maps a selector string to the descendant fakes it returns.
function fakeEl(rect: any, opts: any = {}) {
  const el: any = {
    dataset: opts.dataset || {},
    offsetWidth: opts.offsetWidth ?? rect.width,
    offsetHeight: opts.offsetHeight ?? rect.height,
    getBoundingClientRect: () => rect,
    querySelectorAll: (sel: string) => (opts.matches?.[sel] ?? []),
    querySelector: (sel: string) => (opts.matches?.[sel]?.[0] ?? null),
  };
  return el;
}

test("tbHitTest returns a float target when there is no root element", () => {
  const t = tbHitTest(null, 10, 20);
  assert.deepEqual(t, { side: "float", x: 10, y: 20 });
});

test("tbHitTest near the window perimeter docks to the nearest side as a new lane", () => {
  const root = fakeEl({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }, {
    matches: { ".monet-tb-strip[data-tb-side]": [], "[data-dock-col]": [] },
  });
  // cursor near the left edge (within the 18px perimeter band)
  const t = tbHitTest(root, 5, 400);
  assert.equal(t.side, "left");
  assert.equal(t.newLane, 0, "no existing lanes → new lane 0");
});

test("tbHitTest over an interior dock column near its edge yields an in-dock slot", () => {
  const colRect = { left: 100, top: 50, right: 300, bottom: 750, width: 200, height: 700 };
  const col = fakeEl(colRect, { dataset: { side: "left", colIdx: "1", colId: "c1" } });
  const root = fakeEl({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }, {
    matches: {
      ".monet-tb-strip[data-tb-side]": [],
      "[data-dock-col]": [col],
    },
  });
  // cursor inside the column but away from the window perimeter, near its left edge
  const t = tbHitTest(root, 110, 400);
  assert.equal(t.kind, "in-dock");
  assert.equal(t.side, "left");
  assert.equal(t.colId, "c1");
  assert.equal(t.position, "before", "near the left edge → insert before");
});

test("tbHitTest in open space (no edges, no cols) falls through to a float position", () => {
  const root = fakeEl({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }, {
    matches: { ".monet-tb-strip[data-tb-side]": [], "[data-dock-col]": [] },
  });
  const t = tbHitTest(root, 500, 400);  // dead center, far from every edge
  assert.equal(t.side, "float");
  assert.equal(t.x, 500);
  assert.equal(t.y, 400);
});

// ─── sameStruct ─────────────────────────────────────────────
test("sameStruct compares JSON-serializable trees structurally", () => {
  assert.ok(sameStruct({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }));
  assert.ok(!sameStruct({ a: 1 }, { a: 2 }));
  const x = { n: 1 };
  assert.ok(sameStruct(x, x), "identity short-circuit");
  // a circular structure can't be stringified → falls back to false
  const circ: any = {}; circ.self = circ;
  assert.ok(!sameStruct(circ, {}));
});
