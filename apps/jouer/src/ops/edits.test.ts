// Dedicated unit tests for src/ops/edits.ts — the pure structural & keyframe
// operations the store runs inside `mutate`. model.test.ts smoke-tests a couple
// of the happy paths; this file pins the edge cases (index clamping, nested
// detach/insert, ancestor-of-self, insert fall-backs, keyframe eps + removal)
// so a regression in scene-tree manipulation surfaces here, not in the editor.

import { describe, expect, it } from "vitest";
import { createGameObject, createKeyframe, createProject, createScene, createTrack } from "../model/factory";
import { findObject, findParent } from "../model/query";
import type { GameObject, Scene } from "../model/types";
import {
  cloneWithNewIds,
  detachObject,
  insertObject,
  isAncestor,
  mutObject,
  mutScene,
  pasteKeyframeOnto,
  removeKeyframe,
  reorderObject,
  reparentObject,
  sortKeyframes,
  topLevelIds,
  upsertKeyframe,
} from "./edits";

// A small, stable tree:  root → [a, grp → [c, d], b]
function tree(): { scene: Scene; a: GameObject; b: GameObject; grp: GameObject; c: GameObject; d: GameObject } {
  const a = createGameObject("sprite", { name: "a" });
  const b = createGameObject("sprite", { name: "b" });
  const c = createGameObject("sprite", { name: "c" });
  const d = createGameObject("sprite", { name: "d" });
  const grp = createGameObject("container", { name: "grp", children: [c, d] });
  const scene = createScene("S", { objects: [a, grp, b] });
  return { scene, a, b, grp, c, d };
}

describe("finders", () => {
  it("mutScene returns the live scene by id, undefined when absent", () => {
    const p = createProject("G");
    expect(mutScene(p, p.scenes[0].id)).toBe(p.scenes[0]);
    expect(mutScene(p, "nope")).toBeUndefined();
  });

  it("mutObject finds nested objects and returns undefined for misses", () => {
    const { scene, c } = tree();
    expect(mutObject(scene, c.id)?.name).toBe("c");
    expect(mutObject(scene, "nope")).toBeUndefined();
  });
});

describe("detachObject", () => {
  it("removes a top-level object and returns it", () => {
    const { scene, a } = tree();
    const got = detachObject(scene, a.id);
    expect(got?.id).toBe(a.id);
    expect(scene.objects.map((o) => o.name)).toEqual(["grp", "b"]);
  });

  it("removes a deeply nested child, leaving siblings intact", () => {
    const { scene, grp, c } = tree();
    const got = detachObject(scene, c.id);
    expect(got?.name).toBe("c");
    expect(grp.children?.map((o) => o.name)).toEqual(["d"]);
    expect(findObject(scene, c.id)).toBeUndefined();
  });

  it("returns null and mutates nothing when the id is unknown", () => {
    const { scene } = tree();
    const before = JSON.stringify(scene.objects);
    expect(detachObject(scene, "ghost")).toBeNull();
    expect(JSON.stringify(scene.objects)).toBe(before);
  });
});

describe("insertObject", () => {
  it("appends to the scene root when parentId is null", () => {
    const { scene } = tree();
    const x = createGameObject("sprite", { name: "x" });
    insertObject(scene, x, null);
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "grp", "b", "x"]);
  });

  it("inserts at an explicit index", () => {
    const { scene } = tree();
    const x = createGameObject("sprite", { name: "x" });
    insertObject(scene, x, null, 1);
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "x", "grp", "b"]);
  });

  it("inserts into a container by id", () => {
    const { scene, grp } = tree();
    const x = createGameObject("sprite", { name: "x" });
    insertObject(scene, x, grp.id, 0);
    expect(grp.children?.map((o) => o.name)).toEqual(["x", "c", "d"]);
  });

  it("pushes when the index is out of range (negative or > length)", () => {
    const { scene } = tree();
    const lo = createGameObject("sprite", { name: "lo" });
    const hi = createGameObject("sprite", { name: "hi" });
    insertObject(scene, lo, null, -3);
    insertObject(scene, hi, null, 99);
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "grp", "b", "lo", "hi"]);
  });

  it("falls back to the scene root when the parent has no child list", () => {
    const { scene, a } = tree(); // `a` is a sprite — no children array
    const x = createGameObject("sprite", { name: "x" });
    insertObject(scene, x, a.id);
    expect((a as GameObject).children).toBeUndefined();
    expect(scene.objects.map((o) => o.name)).toContain("x");
  });
});

describe("reorderObject", () => {
  it("moves up and down by direction", () => {
    const { scene, b, a } = tree();
    reorderObject(scene, b.id, { dir: -1 });
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "b", "grp"]);
    reorderObject(scene, a.id, { dir: 1 });
    expect(scene.objects.map((o) => o.name)).toEqual(["b", "a", "grp"]);
  });

  it("honours an absolute toIndex and clamps to the list bounds", () => {
    const { scene, a } = tree();
    reorderObject(scene, a.id, { toIndex: 99 });
    expect(scene.objects.map((o) => o.name)).toEqual(["grp", "b", "a"]);
    reorderObject(scene, a.id, { toIndex: -5 });
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "grp", "b"]);
  });

  it("is a no-op when the target index equals the current one", () => {
    const { scene } = tree();
    const before = scene.objects.map((o) => o.name);
    reorderObject(scene, scene.objects[1].id, { dir: 0 as unknown as 1 });
    expect(scene.objects.map((o) => o.name)).toEqual(before);
  });

  it("reorders within a nested child list, not the root", () => {
    const { scene, grp, d } = tree();
    reorderObject(scene, d.id, { dir: -1 });
    expect(grp.children?.map((o) => o.name)).toEqual(["d", "c"]);
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "grp", "b"]);
  });

  it("ignores unknown ids", () => {
    const { scene } = tree();
    const before = scene.objects.map((o) => o.name);
    reorderObject(scene, "ghost", { dir: -1 });
    expect(scene.objects.map((o) => o.name)).toEqual(before);
  });
});

describe("reparentObject", () => {
  it("moves a root object into a container at an index", () => {
    const { scene, a, grp } = tree();
    expect(reparentObject(scene, a.id, grp.id, 1)).toBe(true);
    expect(findParent(scene, a.id)?.id).toBe(grp.id);
    expect(grp.children?.map((o) => o.name)).toEqual(["c", "a", "d"]);
    expect(scene.objects.map((o) => o.name)).toEqual(["grp", "b"]);
  });

  it("promotes a nested child back to the scene root", () => {
    const { scene, c } = tree();
    expect(reparentObject(scene, c.id, null)).toBe(true);
    expect(findParent(scene, c.id)).toBeNull();
  });

  it("refuses to parent an object to itself", () => {
    const { scene, grp } = tree();
    expect(reparentObject(scene, grp.id, grp.id)).toBe(false);
  });

  it("refuses to nest a container inside its own descendant", () => {
    const { scene, grp, c } = tree();
    expect(reparentObject(scene, grp.id, c.id)).toBe(false);
    expect(findParent(scene, grp.id)).toBeNull();
  });

  it("returns false for an unknown object id", () => {
    const { scene, grp } = tree();
    expect(reparentObject(scene, "ghost", grp.id)).toBe(false);
  });
});

describe("isAncestor", () => {
  it("treats an object as its own ancestor (equal id)", () => {
    const { scene, grp } = tree();
    expect(isAncestor(scene, grp.id, grp.id)).toBe(true);
  });

  it("detects direct and transitive descendants", () => {
    const a = createGameObject("sprite", { name: "a" });
    const deep = createGameObject("container", { name: "deep", children: [a] });
    const grp = createGameObject("container", { name: "grp", children: [deep] });
    const scene = createScene("S", { objects: [grp] });
    expect(isAncestor(scene, grp.id, deep.id)).toBe(true);
    expect(isAncestor(scene, grp.id, a.id)).toBe(true);
    expect(isAncestor(scene, deep.id, grp.id)).toBe(false);
  });

  it("is false for unrelated objects and missing ancestors", () => {
    const { scene, a, b } = tree();
    expect(isAncestor(scene, a.id, b.id)).toBe(false);
    expect(isAncestor(scene, "ghost", a.id)).toBe(false);
  });
});

describe("cloneWithNewIds", () => {
  it("assigns fresh ids to every node yet preserves structure + props", () => {
    const { grp, c, d } = tree();
    const copy = cloneWithNewIds(grp);
    expect(copy.id).not.toBe(grp.id);
    expect(copy.name).toBe("grp");
    expect(copy.children?.map((o) => o.name)).toEqual(["c", "d"]);
    // every child id is regenerated too
    expect(copy.children?.[0].id).not.toBe(c.id);
    expect(copy.children?.[1].id).not.toBe(d.id);
    // ids are unique across the whole clone
    const ids = [copy.id, ...(copy.children ?? []).map((o) => o.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deep-copies so editing the clone never touches the original", () => {
    const a = createGameObject("rectangle", { name: "a", transform: { x: 5, y: 6, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 } });
    const copy = cloneWithNewIds(a);
    copy.transform.x = 999;
    expect(a.transform.x).toBe(5);
  });
});

describe("topLevelIds", () => {
  it("drops a child when its container is also selected", () => {
    const { scene, grp, c } = tree();
    expect(topLevelIds(scene, [grp.id, c.id])).toEqual([grp.id]);
  });

  it("keeps independent siblings, in document order", () => {
    const { scene, a, b } = tree();
    expect(topLevelIds(scene, [b.id, a.id])).toEqual([a.id, b.id]);
  });

  it("keeps both children when their container is NOT selected", () => {
    const { scene, c, d } = tree();
    expect(topLevelIds(scene, [c.id, d.id])).toEqual([c.id, d.id]);
  });

  it("collapses a fully-selected subtree to its single root", () => {
    const { scene, a, grp, c, d } = tree();
    expect(topLevelIds(scene, [a.id, grp.id, c.id, d.id])).toEqual([a.id, grp.id]);
  });

  it("returns nothing for an empty selection", () => {
    const { scene } = tree();
    expect(topLevelIds(scene, [])).toEqual([]);
  });
});

describe("keyframe ops", () => {
  it("sortKeyframes orders by time in place", () => {
    const trk = createTrack("o1", "x", [createKeyframe(2, 20), createKeyframe(0, 0), createKeyframe(1, 10)]);
    sortKeyframes(trk);
    expect(trk.keyframes.map((k) => k.time)).toEqual([0, 1, 2]);
  });

  it("upsertKeyframe replaces within eps and keeps value+ease", () => {
    const trk = createTrack("o1", "x", [createKeyframe(1, 100, { ease: "linear" })]);
    upsertKeyframe(trk, createKeyframe(1.00005, 250, { ease: "quadIn" })); // within default eps 1e-4
    expect(trk.keyframes).toHaveLength(1);
    expect(trk.keyframes[0].value).toBe(250);
    expect(trk.keyframes[0].ease).toBe("quadIn");
  });

  it("upsertKeyframe adds a distinct keyframe outside eps, staying sorted", () => {
    const trk = createTrack("o1", "x", [createKeyframe(0, 0)]);
    upsertKeyframe(trk, createKeyframe(2, 20));
    upsertKeyframe(trk, createKeyframe(1, 10));
    expect(trk.keyframes.map((k) => k.time)).toEqual([0, 1, 2]);
  });

  it("upsertKeyframe honours a custom eps window", () => {
    const trk = createTrack("o1", "x", [createKeyframe(1, 100)]);
    upsertKeyframe(trk, createKeyframe(1.2, 200), 0.5); // 0.2 <= 0.5 → replace
    expect(trk.keyframes).toHaveLength(1);
    expect(trk.keyframes[0].value).toBe(200);
  });

  it("pasteKeyframeOnto adds a keyframe with the clip's value+ease at a new time, sorted", () => {
    const trk = createTrack("o1", "x", [createKeyframe(0, 0, { ease: "linear" })]);
    pasteKeyframeOnto(trk, { value: 50, ease: "bounceOut" }, 1);
    expect(trk.keyframes.map((k) => k.time)).toEqual([0, 1]);
    const pasted = trk.keyframes.find((k) => k.time === 1)!;
    expect({ value: pasted.value, ease: pasted.ease }).toEqual({ value: 50, ease: "bounceOut" });
  });

  it("pasteKeyframeOnto overwrites the keyframe already at that time (upsert)", () => {
    const trk = createTrack("o1", "x", [createKeyframe(1, 100, { ease: "linear" })]);
    pasteKeyframeOnto(trk, { value: 250, ease: "quadIn" }, 1);
    expect(trk.keyframes).toHaveLength(1);
    expect({ value: trk.keyframes[0].value, ease: trk.keyframes[0].ease }).toEqual({ value: 250, ease: "quadIn" });
  });

  it("removeKeyframe deletes by id and no-ops on unknown ids", () => {
    const k0 = createKeyframe(0, 0);
    const k1 = createKeyframe(1, 10);
    const trk = createTrack("o1", "x", [k0, k1]);
    removeKeyframe(trk, k0.id);
    expect(trk.keyframes.map((k) => k.id)).toEqual([k1.id]);
    removeKeyframe(trk, "ghost");
    expect(trk.keyframes.map((k) => k.id)).toEqual([k1.id]);
  });
});
