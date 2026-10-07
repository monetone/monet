import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { createAsset, createGameObject, createProject, createScene } from "../model/factory";

/** A Store whose active scene holds rectangles with the given (known) ids. */
function storeWith(ids: string[]): Store {
  const objects = ids.map((id) => createGameObject("rectangle", { id, name: id }));
  const scene = createScene("S", { objects });
  return new Store(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
}

// Unity-parity "Save/Load Selection": named selection sets (slots 1–9) are
// editor-session state, restored filtered to objects that still exist.
describe("selection sets", () => {
  it("saves the current selection and restores it after it changes", () => {
    const store = storeWith(["a", "b", "c"]);
    store.select(["a", "b"]);
    store.saveSelectionSet("1");
    store.clearSelection();
    expect(store.selection).toEqual([]);
    store.loadSelectionSet("1");
    expect(store.selection).toEqual(["a", "b"]);
  });

  it("load drops objects that no longer exist in the active scene", () => {
    const store = storeWith(["a", "b", "c"]);
    store.select(["a", "b"]);
    store.saveSelectionSet("2");
    store.mutate("delete b", (d) => { d.scenes[0].objects = d.scenes[0].objects.filter((o) => o.id !== "b"); });
    store.loadSelectionSet("2");
    expect(store.selection).toEqual(["a"]);
  });

  it("keeps slots independent", () => {
    const store = storeWith(["a", "b", "c"]);
    store.select(["a"]); store.saveSelectionSet("1");
    store.select(["b", "c"]); store.saveSelectionSet("2");
    store.loadSelectionSet("1");
    expect(store.selection).toEqual(["a"]);
    store.loadSelectionSet("2");
    expect(store.selection).toEqual(["b", "c"]);
  });

  it("treats loading a never-saved slot as a no-op", () => {
    const store = storeWith(["a", "b"]);
    store.select(["a"]);
    store.loadSelectionSet("7");
    expect(store.selection).toEqual(["a"]);
  });

  it("treats saving an empty selection as a no-op", () => {
    const store = storeWith(["a", "b"]);
    store.clearSelection();
    store.saveSelectionSet("1");
    expect(store.hasSelectionSet("1")).toBe(false);
    expect(store.state.selectionSets["1"]).toBeUndefined();
  });

  it("loading a slot whose objects were all deleted keeps the current selection", () => {
    const store = storeWith(["a", "b", "c"]);
    store.select(["a", "b"]);
    store.saveSelectionSet("1");
    store.mutate("delete a + b", (d) => { d.scenes[0].objects = d.scenes[0].objects.filter((o) => o.id === "c"); });
    store.select(["c"]);
    store.loadSelectionSet("1"); // no survivors → no-op, not a clobber
    expect(store.selection).toEqual(["c"]);
  });

  it("exposes saved slots via hasSelectionSet + the snapshot", () => {
    const store = storeWith(["a"]);
    expect(store.hasSelectionSet("1")).toBe(false);
    store.select(["a"]);
    store.saveSelectionSet("1");
    expect(store.hasSelectionSet("1")).toBe(true);
    expect(store.state.selectionSets["1"]).toEqual(["a"]);
  });

  it("clears all selection sets when the document is replaced", () => {
    const store = storeWith(["a", "b"]);
    store.select(["a"]); store.saveSelectionSet("1");
    expect(store.hasSelectionSet("1")).toBe(true);
    store.replaceProject(createProject("Q"));
    expect(store.hasSelectionSet("1")).toBe(false);
    expect(store.state.selectionSets).toEqual({});
  });
});

// Unity-parity Hierarchy search query: editor-session view state (not in the
// .jouer document, not an undo step), exposed on the snapshot for the panel.
describe("hierarchy filter", () => {
  it("defaults to an empty query", () => {
    const store = storeWith(["a"]);
    expect(store.state.hierarchyFilter).toBe("");
  });

  it("stores the raw query verbatim and exposes it on the snapshot", () => {
    const store = storeWith(["a"]);
    store.setHierarchyFilter("t:rect ");
    expect(store.state.hierarchyFilter).toBe("t:rect ");
    store.setHierarchyFilter("");
    expect(store.state.hierarchyFilter).toBe("");
  });

  it("is not an undo step", () => {
    const store = storeWith(["a"]);
    expect(store.state.canUndo).toBe(false);
    store.setHierarchyFilter("enemy");
    expect(store.state.canUndo).toBe(false);
  });

  it("resets to empty when the document is replaced", () => {
    const store = storeWith(["a"]);
    store.setHierarchyFilter("enemy");
    expect(store.state.hierarchyFilter).toBe("enemy");
    store.replaceProject(createProject("Q"));
    expect(store.state.hierarchyFilter).toBe("");
  });
});

// Unity-parity Animation "Record" mode: editor-session view state (not in the
// document); when on, transform edits auto-key at the playhead.
describe("recording mode", () => {
  it("defaults to off and toggles via setRecording", () => {
    const store = storeWith(["a"]);
    expect(store.state.recording).toBe(false);
    store.setRecording(true);
    expect(store.state.recording).toBe(true);
    store.setRecording(false);
    expect(store.state.recording).toBe(false);
  });

  it("resets to off when the document is replaced", () => {
    const store = storeWith(["a"]);
    store.setRecording(true);
    store.replaceProject(createProject("Q"));
    expect(store.state.recording).toBe(false);
  });

  it("resets to off when the active scene changes", () => {
    const store = storeWith(["a"]);
    store.mutate("add scene", (d) => {
      d.scenes.push(createScene("S2", { key: "s2" }));
    });
    const second = store.getProject().scenes[1];
    store.setRecording(true);
    store.setActiveScene(second.id);
    expect(store.state.recording).toBe(false);
  });
});

// Unity-parity Hierarchy range-select anchor: the last single-clicked row, used
// to compute the Shift+click range. Editor-session state.
describe("selection anchor", () => {
  it("defaults to null and is settable", () => {
    const store = storeWith(["a", "b"]);
    expect(store.selectionAnchor).toBeNull();
    store.setSelectionAnchor("a");
    expect(store.selectionAnchor).toBe("a");
    store.setSelectionAnchor(null);
    expect(store.selectionAnchor).toBeNull();
  });

  it("resets to null when the document is replaced", () => {
    const store = storeWith(["a"]);
    store.setSelectionAnchor("a");
    store.replaceProject(createProject("Q"));
    expect(store.selectionAnchor).toBeNull();
  });

  it("resets to null when the active scene changes", () => {
    const store = storeWith(["a"]);
    store.mutate("add scene", (d) => { d.scenes.push(createScene("S2", { key: "s2" })); });
    const second = store.getProject().scenes[1];
    store.setSelectionAnchor("a");
    store.setActiveScene(second.id);
    expect(store.selectionAnchor).toBeNull();
  });
});

// Unity-parity Hierarchy sort mode: a persistent view preference (Transform vs
// Alphabetical), not part of the document.
describe("hierarchy sort", () => {
  it("defaults to transform order and toggles to name", () => {
    const store = storeWith(["a"]);
    expect(store.state.hierarchySort).toBe("transform");
    store.setHierarchySort("name");
    expect(store.state.hierarchySort).toBe("name");
  });

  it("persists across a document replace (it is a view preference)", () => {
    const store = storeWith(["a"]);
    store.setHierarchySort("name");
    store.replaceProject(createProject("Q"));
    expect(store.state.hierarchySort).toBe("name");
  });

  it("is not an undo step and no-ops on an unchanged value", () => {
    const store = storeWith(["a"]);
    expect(store.state.canUndo).toBe(false);
    store.setHierarchySort("name");
    expect(store.state.canUndo).toBe(false);
    const rev = store.state.rev;
    store.setHierarchySort("name"); // same value → no bump
    expect(store.state.rev).toBe(rev);
  });
});

// Unity-parity Hierarchy expand/collapse: which container rows are collapsed is
// editor view state (per scene, not in the document, not an undo step).
describe("hierarchy collapse", () => {
  it("defaults to nothing collapsed", () => {
    const store = storeWith(["a", "b"]);
    expect(store.state.collapsed.size).toBe(0);
  });

  it("toggles one container's collapsed state with a fresh Set identity", () => {
    const store = storeWith(["a", "b"]);
    const before = store.state.collapsed;
    store.toggleCollapsed("a");
    expect(store.state.collapsed).not.toBe(before); // new identity → re-render
    expect(store.isCollapsed("a")).toBe(true);
    expect(store.state.collapsed.has("a")).toBe(true);
    store.toggleCollapsed("a");
    expect(store.isCollapsed("a")).toBe(false);
  });

  it("collapseAll sets exactly the given ids; expandAll clears", () => {
    const store = storeWith(["a", "b", "c"]);
    store.collapseAll(["a", "c"]);
    expect([...store.state.collapsed].sort()).toEqual(["a", "c"]);
    store.expandAll();
    expect(store.state.collapsed.size).toBe(0);
  });

  it("is not an undo step, and expandAll no-ops (no bump) when already empty", () => {
    const store = storeWith(["a"]);
    store.toggleCollapsed("a");
    expect(store.state.canUndo).toBe(false);
    store.expandAll();
    const rev = store.state.rev;
    store.expandAll(); // already empty → no bump
    expect(store.state.rev).toBe(rev);
  });

  it("resets when the document is replaced", () => {
    const store = storeWith(["a"]);
    store.collapseAll(["a"]);
    store.replaceProject(createProject("Q"));
    expect(store.state.collapsed.size).toBe(0);
  });

  it("resets when the active scene changes", () => {
    const store = storeWith(["a"]);
    store.mutate("add scene", (d) => { d.scenes.push(createScene("S2", { key: "s2" })); });
    const second = store.getProject().scenes[1];
    store.collapseAll(["a"]);
    store.setActiveScene(second.id);
    expect(store.state.collapsed.size).toBe(0);
  });
});

// Unity-parity Inspector padlock: pin the Inspector to an object regardless of
// selection. Editor view state — not undoable, cleared when the object is gone.
describe("inspector lock", () => {
  it("defaults to null and toggles on/off for the same id", () => {
    const store = storeWith(["a", "b"]);
    expect(store.lockedInspectorId).toBeNull();
    store.toggleInspectorLock("a");
    expect(store.lockedInspectorId).toBe("a");
    expect(store.state.lockedInspectorId).toBe("a");
    store.toggleInspectorLock("a");
    expect(store.lockedInspectorId).toBeNull();
  });

  it("setInspectorLock pins an id and unpins with null; not an undo step", () => {
    const store = storeWith(["a", "b"]);
    store.setInspectorLock("b");
    expect(store.lockedInspectorId).toBe("b");
    expect(store.state.canUndo).toBe(false);
    store.setInspectorLock(null);
    expect(store.lockedInspectorId).toBeNull();
  });

  it("clears the lock when the locked object is deleted", () => {
    const store = storeWith(["a", "b"]);
    store.setInspectorLock("a");
    store.mutate("delete a", (d) => { d.scenes[0].objects = d.scenes[0].objects.filter((o) => o.id !== "a"); });
    expect(store.lockedInspectorId).toBeNull();
  });

  it("keeps the lock when an unrelated object is deleted", () => {
    const store = storeWith(["a", "b"]);
    store.setInspectorLock("a");
    store.mutate("delete b", (d) => { d.scenes[0].objects = d.scenes[0].objects.filter((o) => o.id !== "b"); });
    expect(store.lockedInspectorId).toBe("a");
  });

  it("resets on replaceProject and setActiveScene", () => {
    const store = storeWith(["a"]);
    store.setInspectorLock("a");
    store.replaceProject(createProject("Q"));
    expect(store.lockedInspectorId).toBeNull();

    const store2 = storeWith(["a"]);
    store2.mutate("add scene", (d) => { d.scenes.push(createScene("S2", { key: "s2" })); });
    const second = store2.getProject().scenes[1];
    store2.setInspectorLock("a");
    store2.setActiveScene(second.id);
    expect(store2.lockedInspectorId).toBeNull();
  });
});

// Unity-parity Constrain Proportions: a persistent view preference (like snap),
// not part of the document, not an undo step.
describe("constrain proportions", () => {
  it("defaults to false, sets, and toggles", () => {
    const store = storeWith(["a"]);
    expect(store.state.constrainProportions).toBe(false);
    store.setConstrainProportions(true);
    expect(store.state.constrainProportions).toBe(true);
    store.toggleConstrainProportions();
    expect(store.state.constrainProportions).toBe(false);
  });

  it("is not an undo step and no-ops (no bump) on an unchanged value", () => {
    const store = storeWith(["a"]);
    store.setConstrainProportions(true);
    expect(store.state.canUndo).toBe(false);
    const rev = store.state.rev;
    store.setConstrainProportions(true); // same value → no bump
    expect(store.state.rev).toBe(rev);
  });

  it("persists across a document replace (it is a view preference)", () => {
    const store = storeWith(["a"]);
    store.setConstrainProportions(true);
    store.replaceProject(createProject("Q"));
    expect(store.state.constrainProportions).toBe(true);
  });
});

// Unity-parity Hierarchy inline rename (F2 / double-click): renamingId is transient
// editor view state — cleared if the object is deleted, reset per scene/document.
describe("hierarchy inline rename (renamingId)", () => {
  it("sets and clears the renaming id", () => {
    const store = storeWith(["a", "b"]);
    expect(store.renamingId).toBeNull();
    store.setRenamingId("a");
    expect(store.renamingId).toBe("a");
    store.setRenamingId(null);
    expect(store.renamingId).toBeNull();
  });

  it("is not an undo step and no-ops (no bump) on an unchanged id", () => {
    const store = storeWith(["a"]);
    store.setRenamingId("a");
    expect(store.state.canUndo).toBe(false);
    const rev = store.state.rev;
    store.setRenamingId("a"); // same id → no bump
    expect(store.state.rev).toBe(rev);
  });

  it("clears when the renamed object is deleted", () => {
    const store = storeWith(["a", "b"]);
    store.setRenamingId("a");
    store.mutate("delete a", (d) => { d.scenes[0].objects = d.scenes[0].objects.filter((o) => o.id !== "a"); });
    expect(store.renamingId).toBeNull();
  });

  it("resets on replaceProject and setActiveScene", () => {
    const store = storeWith(["a"]);
    store.setRenamingId("a");
    store.replaceProject(createProject("Q"));
    expect(store.renamingId).toBeNull();

    const sceneA = createScene("A", { objects: [createGameObject("rectangle", { id: "a", name: "a" })] });
    const sceneB = createScene("B");
    const s2 = new Store(createProject("P", { scenes: [sceneA, sceneB], activeSceneId: sceneA.id }));
    s2.setRenamingId("a");
    s2.setActiveScene(sceneB.id);
    expect(s2.renamingId).toBeNull();
  });
});

// Unity-parity inline SCENE rename: renamingSceneId is transient editor view state —
// cleared if the scene is deleted, reset per document.
describe("scene inline rename (renamingSceneId)", () => {
  it("sets and clears the renaming scene id", () => {
    const store = storeWith(["a"]);
    const sid = store.state.project.activeSceneId!;
    expect(store.renamingSceneId).toBeNull();
    store.setRenamingSceneId(sid);
    expect(store.renamingSceneId).toBe(sid);
    store.setRenamingSceneId(null);
    expect(store.renamingSceneId).toBeNull();
  });

  it("is not an undo step and no-ops (no bump) on an unchanged id", () => {
    const store = storeWith(["a"]);
    const sid = store.state.project.activeSceneId!;
    store.setRenamingSceneId(sid);
    expect(store.state.canUndo).toBe(false);
    const rev = store.state.rev;
    store.setRenamingSceneId(sid);
    expect(store.state.rev).toBe(rev);
  });

  it("clears when the renamed scene is deleted", () => {
    const a = createScene("A");
    const b = createScene("B");
    const store = new Store(createProject("P", { scenes: [a, b], activeSceneId: a.id }));
    store.setRenamingSceneId(a.id);
    store.mutate("delete scene a", (d) => {
      d.scenes = d.scenes.filter((s) => s.id !== a.id);
      if (d.activeSceneId === a.id) d.activeSceneId = d.scenes[0]?.id ?? null;
    });
    expect(store.renamingSceneId).toBeNull();
  });

  it("resets on replaceProject", () => {
    const store = storeWith(["a"]);
    store.setRenamingSceneId(store.state.project.activeSceneId!);
    store.replaceProject(createProject("Q"));
    expect(store.renamingSceneId).toBeNull();
  });
});

// Unity-parity Grid and Snap "Grid Size": the move-snap + visible-grid increment.
describe("grid size (setGridSize)", () => {
  it("defaults to 16 and sets a new size", () => {
    const store = storeWith(["a"]);
    expect(store.state.gridSize).toBe(16);
    store.setGridSize(32);
    expect(store.state.gridSize).toBe(32);
  });

  it("rounds non-integers and clamps to a minimum of 1", () => {
    const store = storeWith(["a"]);
    store.setGridSize(15.6);
    expect(store.state.gridSize).toBe(16);
    store.setGridSize(0);
    expect(store.state.gridSize).toBe(1);
    store.setGridSize(-40);
    expect(store.state.gridSize).toBe(1);
  });

  it("bumps once per change", () => {
    const store = storeWith(["a"]);
    const rev = store.state.rev;
    store.setGridSize(48);
    expect(store.state.rev).toBe(rev + 1);
  });
});

// Unity-parity rotation snap (Grid and Snap → Rotate increment): a session view
// preference, defaulting to 15°, clamped to a minimum of 1° and rounded to whole degrees.
describe("rotation snap (setRotationSnap)", () => {
  it("defaults to 15 and sets a new increment", () => {
    const store = storeWith(["a"]);
    expect(store.state.rotationSnap).toBe(15);
    store.setRotationSnap(30);
    expect(store.state.rotationSnap).toBe(30);
  });

  it("rounds non-integers and clamps to a minimum of 1", () => {
    const store = storeWith(["a"]);
    store.setRotationSnap(14.6);
    expect(store.state.rotationSnap).toBe(15);
    store.setRotationSnap(0);
    expect(store.state.rotationSnap).toBe(1);
    store.setRotationSnap(-40);
    expect(store.state.rotationSnap).toBe(1);
  });

  it("bumps once per change", () => {
    const store = storeWith(["a"]);
    const rev = store.state.rev;
    store.setRotationSnap(45);
    expect(store.state.rev).toBe(rev + 1);
  });
});

// Unity-parity scale snap (Grid and Snap → Scale increment): a session view
// preference, defaulting to 0.25×, clamped to a small positive minimum and kept
// fractional (not rounded to whole numbers).
describe("scale snap (setScaleSnap)", () => {
  it("defaults to 0.25 and sets a new fractional increment", () => {
    const store = storeWith(["a"]);
    expect(store.state.scaleSnap).toBe(0.25);
    store.setScaleSnap(0.5);
    expect(store.state.scaleSnap).toBe(0.5);
  });

  it("clamps to a small positive minimum", () => {
    const store = storeWith(["a"]);
    store.setScaleSnap(0);
    expect(store.state.scaleSnap).toBe(0.01);
    store.setScaleSnap(-2);
    expect(store.state.scaleSnap).toBe(0.01);
  });

  it("bumps once per change", () => {
    const store = storeWith(["a"]);
    const rev = store.state.rev;
    store.setScaleSnap(0.5);
    expect(store.state.rev).toBe(rev + 1);
  });
});

// Unity-parity asset inline rename (Project-window double-click): renamingAssetId is
// transient editor view state — cleared if the asset is deleted, reset per document.
describe("asset inline rename (renamingAssetId)", () => {
  const withAsset = () => new Store(createProject("P", { assets: [createAsset("image", "img", "data:,x")] }));

  it("sets and clears the renaming asset id (no-op + no bump on unchanged)", () => {
    const store = withAsset();
    const aid = store.state.project.assets[0].id;
    expect(store.renamingAssetId).toBeNull();
    store.setRenamingAssetId(aid);
    expect(store.renamingAssetId).toBe(aid);
    const rev = store.state.rev;
    store.setRenamingAssetId(aid); // same id → no bump
    expect(store.state.rev).toBe(rev);
    store.setRenamingAssetId(null);
    expect(store.renamingAssetId).toBeNull();
  });

  it("clears when the renamed asset is deleted", () => {
    const store = withAsset();
    const aid = store.state.project.assets[0].id;
    store.setRenamingAssetId(aid);
    store.mutate("delete asset", (d) => { d.assets = d.assets.filter((a) => a.id !== aid); });
    expect(store.renamingAssetId).toBeNull();
  });

  it("resets on replaceProject", () => {
    const store = withAsset();
    store.setRenamingAssetId(store.state.project.assets[0].id);
    store.replaceProject(createProject("Q"));
    expect(store.renamingAssetId).toBeNull();
  });
});
