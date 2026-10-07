import { describe, expect, it } from "vitest";
import { createGameObject, createScene } from "./factory";
import type { GameObject, Scene } from "./types";
import { allObjectIds, invertedIds, descendantIds, isolationSet } from "./selection";

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

describe("allObjectIds", () => {
  it("lists every object (containers + descendants) in document order", () => {
    const { scene, a, grp, c, d, b } = tree();
    expect(allObjectIds(scene)).toEqual([a.id, grp.id, c.id, d.id, b.id]);
  });

  it("is empty for an empty scene", () => {
    expect(allObjectIds(createScene("Empty"))).toEqual([]);
  });
});

describe("invertedIds", () => {
  it("returns the complement of the selection in document order", () => {
    const { scene, a, grp, c, d, b } = tree();
    expect(invertedIds(scene, [grp.id, c.id])).toEqual([a.id, d.id, b.id]);
  });

  it("returns everything when nothing is selected", () => {
    const { scene, a, grp, c, d, b } = tree();
    expect(invertedIds(scene, [])).toEqual([a.id, grp.id, c.id, d.id, b.id]);
  });

  it("returns nothing when everything is selected", () => {
    const { scene, a, grp, c, d, b } = tree();
    expect(invertedIds(scene, [a.id, grp.id, c.id, d.id, b.id])).toEqual([]);
  });
});

describe("descendantIds", () => {
  it("returns the deep descendants of a container, excluding itself", () => {
    const { scene, grp, c, d } = tree();
    expect(descendantIds(scene, [grp.id])).toEqual([c.id, d.id]);
  });

  it("returns nothing for a childless object", () => {
    const { scene, a } = tree();
    expect(descendantIds(scene, [a.id])).toEqual([]);
  });

  it("de-duplicates when a container and one of its children are both passed", () => {
    const { scene, grp, c, d } = tree();
    expect(descendantIds(scene, [grp.id, c.id])).toEqual([c.id, d.id]);
  });

  it("walks nested containers (grandchildren included)", () => {
    const leaf = createGameObject("sprite", { name: "leaf" });
    const inner = createGameObject("container", { name: "inner", children: [leaf] });
    const outer = createGameObject("container", { name: "outer", children: [inner] });
    const scene = createScene("S", { objects: [outer] });
    expect(descendantIds(scene, [outer.id])).toEqual([inner.id, leaf.id]);
  });
});

describe("isolationSet", () => {
  it("isolates a leaf to just itself", () => {
    const { scene, a } = tree();
    expect(isolationSet(scene, [a.id])).toEqual([a.id]);
  });

  it("isolates a container together with its descendants (not its siblings)", () => {
    const { scene, grp, c, d } = tree();
    expect(isolationSet(scene, [grp.id])).toEqual([grp.id, c.id, d.id]);
  });

  it("isolates a nested child together with its ancestor chain", () => {
    const { scene, grp, c } = tree();
    // 'c' lives inside 'grp' → grp must stay visible so c renders
    expect(isolationSet(scene, [c.id])).toEqual([grp.id, c.id]);
  });

  it("unions multiple selections (with ancestors) in document order", () => {
    const { scene, a, grp, c } = tree();
    // isolate(c) pulls in its ancestor grp; isolate(a) adds a → doc order a, grp, c
    expect(isolationSet(scene, [c.id, a.id])).toEqual([a.id, grp.id, c.id]);
  });

  it("returns nothing for an empty selection", () => {
    const { scene } = tree();
    expect(isolationSet(scene, [])).toEqual([]);
  });
});
