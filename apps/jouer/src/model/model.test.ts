import { describe, expect, it } from "vitest";
import {
  createGameObject,
  createKeyframe,
  createProject,
  createScene,
  createTimeline,
  createTrack,
  slugKey,
} from "./factory";
import { capsulePoints, diamondPoints, hexagonPoints, hexagonFlatPoints } from "./shapes";
import { activeScene, bootSceneId, collapsibleContainerIds, findObject, findParent, flattenObjects, hierarchyOrder, rangeBetween, readProperty, sharedValue, sortForHierarchy } from "./query";
import { sampleTimeline, sampleTrack, timelineExtent, activeTracks } from "./sample";
import { EASES, easeFn } from "./ease";
import { detachObject, insertObject, reparentObject, reorderObject, upsertKeyframe } from "../ops/edits";

describe("factory", () => {
  it("creates a project with one scene and a main timeline", () => {
    const p = createProject("Game");
    expect(p.schema).toBe("monet-jouer/v1");
    expect(p.scenes).toHaveLength(1);
    expect(p.activeSceneId).toBe(p.scenes[0].id);
    expect(p.scenes[0].timelines).toHaveLength(1);
    expect(activeScene(p)).toBe(p.scenes[0]);
  });

  it("kind-specific defaults", () => {
    expect(createGameObject("rectangle").width).toBe(120);
    expect(createGameObject("text").text).toBe("Text");
    expect(createGameObject("container").children).toEqual([]);
    expect(createGameObject("sprite").assetId).toBeNull();
  });

  it("text style defaults wrapWidth + lineSpacing to 0 (no wrap)", () => {
    const s = createGameObject("text").style!;
    expect(s.wrapWidth).toBe(0);
    expect(s.lineSpacing).toBe(0);
  });

  it("new objects default to visible, active and unlocked", () => {
    const o = createGameObject("rectangle");
    expect(o.visible).toBe(true);
    expect(o.active).toBe(true);
    expect(o.locked).toBe(false);
  });

  it("sprite/image default flipX and flipY to false", () => {
    for (const k of ["sprite", "image"] as const) {
      const o = createGameObject(k);
      expect(o.flipX).toBe(false);
      expect(o.flipY).toBe(false);
    }
  });

  it("triangle defaults to a 100×100 pink shape named Triangle", () => {
    const tri = createGameObject("triangle");
    expect(tri.kind).toBe("triangle");
    expect(tri.name).toBe("Triangle");
    expect(tri.width).toBe(100);
    expect(tri.height).toBe(100);
    expect(tri.fill).toBe("#f472b6");
    expect(tri.strokeWidth).toBe(0);
  });

  it("hexagon defaults to a 100×100 amber shape named Hexagon", () => {
    const hex = createGameObject("hexagon");
    expect(hex.kind).toBe("hexagon");
    expect(hex.name).toBe("Hexagon");
    expect(hex.width).toBe(100);
    expect(hex.height).toBe(100);
    expect(hex.fill).toBe("#fbbf24");
    expect(hex.strokeWidth).toBe(0);
  });

  it("diamond defaults to a 100×100 violet shape named Diamond", () => {
    const dia = createGameObject("diamond");
    expect(dia.kind).toBe("diamond");
    expect(dia.name).toBe("Diamond");
    expect(dia.width).toBe(100);
    expect(dia.height).toBe(100);
    expect(dia.fill).toBe("#a78bfa");
    expect(dia.strokeWidth).toBe(0);
  });

  it("capsule defaults to a 100×100 teal shape named Capsule", () => {
    const cap = createGameObject("capsule");
    expect(cap.kind).toBe("capsule");
    expect(cap.name).toBe("Capsule");
    expect(cap.width).toBe(100);
    expect(cap.height).toBe(100);
    expect(cap.fill).toBe("#2dd4bf");
    expect(cap.strokeWidth).toBe(0);
  });

  it("slugKey sanitises", () => {
    expect(slugKey("Level 1: Start!")).toBe("Level_1_Start");
    expect(slugKey("   ")).toBe("Scene");
  });
});

describe("shape geometry", () => {
  it("hexagonPoints inscribes a point-top hexagon in the w×h box", () => {
    // top apex, upper-right, lower-right, bottom apex, lower-left, upper-left
    expect(hexagonPoints(100, 100)).toEqual([50, 0, 100, 25, 100, 75, 50, 100, 0, 75, 0, 25]);
  });

  it("hexagonPoints spans the full box (AABB == w×h) for any size", () => {
    const pts = hexagonPoints(140, 80);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(140);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(80);
  });

  it("hexagonFlatPoints inscribes a flat-top hexagon in the w×h box", () => {
    // upper-left, upper-right, right apex, lower-right, lower-left, left apex
    expect(hexagonFlatPoints(100, 100)).toEqual([25, 0, 75, 0, 100, 50, 75, 100, 25, 100, 0, 50]);
  });

  it("hexagonFlatPoints spans the full box (AABB == w×h) for any size", () => {
    const pts = hexagonFlatPoints(140, 80);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 140, 0, 80]);
  });

  it("createGameObject builds a hexagonFlat with shape defaults", () => {
    const h = createGameObject("hexagonFlat");
    expect(h.kind).toBe("hexagonFlat");
    expect({ w: h.width, hgt: h.height }).toEqual({ w: 100, hgt: 100 });
    expect(typeof h.fill).toBe("string");
  });

  it("diamondPoints inscribes a rhombus (edge midpoints) in the w×h box", () => {
    // top, right, bottom, left
    expect(diamondPoints(100, 100)).toEqual([50, 0, 100, 50, 50, 100, 0, 50]);
    expect(diamondPoints(100, 80)).toEqual([50, 0, 100, 40, 50, 80, 0, 40]);
  });

  it("diamondPoints spans the full box (AABB == w×h) for any size", () => {
    const pts = diamondPoints(140, 80);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(140);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(80);
  });

  const aabb = (pts: number[]) => {
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const hasPoint = (pts: number[], x: number, y: number) => {
    for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i] - x) < 1e-9 && Math.abs(pts[i + 1] - y) < 1e-9) return true;
    return false;
  };

  it("capsulePoints fills the box AABB for wide, tall and square boxes", () => {
    for (const [w, h] of [[100, 100], [140, 80], [80, 140]] as const) {
      expect(aabb(capsulePoints(w, h))).toEqual({ minX: 0, maxX: w, minY: 0, maxY: h });
    }
  });

  it("capsulePoints has 2*(seg+1) points and includes the box edge-midpoint extremes", () => {
    const pts = capsulePoints(100, 80); // seg=8 → 18 points → 36 numbers
    expect(pts.length).toBe(2 * (8 + 1) * 2);
    expect(hasPoint(pts, 100, 40)).toBe(true); // right cap apex
    expect(hasPoint(pts, 0, 40)).toBe(true);   // left cap apex
  });

  it("capsulePoints for a square box is a circle (every point at radius r from centre)", () => {
    const pts = capsulePoints(100, 100);
    for (let i = 0; i < pts.length; i += 2) {
      const d = Math.hypot(pts[i] - 50, pts[i + 1] - 50);
      expect(Math.abs(d - 50)).toBeLessThan(1e-9);
    }
  });
});

describe("sortForHierarchy", () => {
  const objs = () => [
    createGameObject("rectangle", { name: "Banana", depth: 1 }),
    createGameObject("rectangle", { name: "apple", depth: 2 }),
    createGameObject("rectangle", { name: "Cherry", depth: 3 }),
  ];

  it("transform mode orders by depth descending (front-most first)", () => {
    expect(sortForHierarchy(objs(), "transform").map((o) => o.name)).toEqual(["Cherry", "apple", "Banana"]);
  });

  it("name mode orders case-insensitively and naturally", () => {
    expect(sortForHierarchy(objs(), "name").map((o) => o.name)).toEqual(["apple", "Banana", "Cherry"]);
    const natural = [
      createGameObject("rectangle", { name: "Item10", depth: 1 }),
      createGameObject("rectangle", { name: "Item2", depth: 2 }),
    ];
    expect(sortForHierarchy(natural, "name").map((o) => o.name)).toEqual(["Item2", "Item10"]);
  });

  it("name mode breaks ties by depth descending", () => {
    const tied = [
      createGameObject("rectangle", { name: "Dup", depth: 1 }),
      createGameObject("rectangle", { name: "Dup", depth: 5 }),
    ];
    expect(sortForHierarchy(tied, "name").map((o) => o.depth)).toEqual([5, 1]);
  });

  it("does not mutate the input array", () => {
    const input = objs();
    const snapshot = input.map((o) => o.name);
    sortForHierarchy(input, "name");
    expect(input.map((o) => o.name)).toEqual(snapshot);
  });

  it("handles empty and single-element levels", () => {
    expect(sortForHierarchy([], "name")).toEqual([]);
    expect(sortForHierarchy([], "transform")).toEqual([]);
    const one = [createGameObject("rectangle", { name: "Solo" })];
    expect(sortForHierarchy(one, "name").map((o) => o.name)).toEqual(["Solo"]);
  });

  it("keeps insertion order for identical name + depth (stable)", () => {
    const a = createGameObject("rectangle", { id: "a", name: "Dup", depth: 2 });
    const b = createGameObject("rectangle", { id: "b", name: "Dup", depth: 2 });
    expect(sortForHierarchy([a, b], "name").map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("hierarchyOrder + rangeBetween", () => {
  // A tree: two top-level rects + a container with two children.
  const tree = () => [
    createGameObject("rectangle", { id: "a", name: "Apple", depth: 1 }),
    createGameObject("container", { id: "g", name: "Grp", depth: 2, children: [
      createGameObject("rectangle", { id: "g1", name: "Zed", depth: 1 }),
      createGameObject("rectangle", { id: "g2", name: "Ace", depth: 2 }),
    ] }),
    createGameObject("rectangle", { id: "c", name: "Cherry", depth: 3 }),
  ];

  it("hierarchyOrder is DFS in transform order (depth desc per level)", () => {
    // top level depth desc: c(3), g(2), a(1); g's kids depth desc: g2(2), g1(1)
    expect(hierarchyOrder(tree(), "transform")).toEqual(["c", "g", "g2", "g1", "a"]);
  });

  it("hierarchyOrder follows the alphabetical sort per level", () => {
    // top level by name: Apple(a), Cherry(c), Grp(g); g's kids: Ace(g2), Zed(g1)
    expect(hierarchyOrder(tree(), "name")).toEqual(["a", "c", "g", "g2", "g1"]);
  });

  it("rangeBetween returns the inclusive slice in either direction", () => {
    const order = ["c", "g", "g2", "g1", "a"];
    expect(rangeBetween(order, "g", "a")).toEqual(["g", "g2", "g1", "a"]);
    expect(rangeBetween(order, "a", "g")).toEqual(["g", "g2", "g1", "a"]); // direction-agnostic
    expect(rangeBetween(order, "c", "c")).toEqual(["c"]);
  });

  it("rangeBetween falls back to [b] when the anchor is gone, [] when b is gone", () => {
    const order = ["c", "g", "a"];
    expect(rangeBetween(order, "missing", "g")).toEqual(["g"]);
    expect(rangeBetween(order, "c", "missing")).toEqual([]);
  });
});

describe("sharedValue (Unity multi-edit mixed detection)", () => {
  it("returns the common value when every item agrees", () => {
    expect(sharedValue([{ v: 5 }, { v: 5 }, { v: 5 }], (o) => o.v)).toBe(5);
  });

  it("returns null when items differ (mixed)", () => {
    expect(sharedValue([{ v: 5 }, { v: 7 }], (o) => o.v)).toBeNull();
  });

  it("returns the value for a single item and null for an empty list", () => {
    expect(sharedValue([{ v: 3 }], (o) => o.v)).toBe(3);
    expect(sharedValue([] as { v: number }[], (o) => o.v)).toBeNull();
  });
});

describe("collapsibleContainerIds", () => {
  it("returns containers with children (nested), skipping leaf/childless containers and non-containers", () => {
    const inner = createGameObject("container", { id: "inner", children: [createGameObject("rectangle", { id: "leaf" })] });
    const outer = createGameObject("container", { id: "outer", children: [inner] });
    const emptyContainer = createGameObject("container", { id: "empty" });
    const rect = createGameObject("rectangle", { id: "r" });
    expect(collapsibleContainerIds([outer, emptyContainer, rect])).toEqual(["outer", "inner"]);
  });

  it("is empty when there are no containers with children", () => {
    expect(collapsibleContainerIds([createGameObject("rectangle"), createGameObject("container")])).toEqual([]);
  });
});

describe("query traversal", () => {
  it("flattens + finds nested objects and parents", () => {
    const child = createGameObject("sprite", { name: "kid" });
    const group = createGameObject("container", { name: "grp", children: [child] });
    const scene = createScene("S", { objects: [group] });
    expect(flattenObjects(scene)).toHaveLength(2);
    expect(findObject(scene, child.id)?.name).toBe("kid");
    expect(findParent(scene, child.id)?.id).toBe(group.id);
    expect(findParent(scene, group.id)).toBeNull();
  });

  it("reads animatable properties", () => {
    const o = createGameObject("rectangle", { transform: { x: 5, y: 6, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 0.5 } });
    expect(readProperty(o, "x")).toBe(5);
    expect(readProperty(o, "alpha")).toBe(0.5);
    expect(readProperty(o, "width")).toBe(120);
  });
});

describe("bootSceneId (Unity Scenes In Build start scene)", () => {
  const twoScenes = () => {
    const menu = createScene("Menu");
    const level = createScene("Level");
    return { proj: createProject("P", { scenes: [menu, level], activeSceneId: level.id }), menu, level };
  };

  it("falls back to the active scene when no start scene is set", () => {
    const { proj, level } = twoScenes();
    expect(bootSceneId(proj)).toBe(level.id);
  });

  it("returns the explicit start scene when it points at a real scene", () => {
    const { proj, menu } = twoScenes();
    expect(bootSceneId({ ...proj, startSceneId: menu.id })).toBe(menu.id);
  });

  it("falls back to the active scene when the start scene id is stale", () => {
    const { proj, level } = twoScenes();
    expect(bootSceneId({ ...proj, startSceneId: "ghost" })).toBe(level.id);
  });
});

describe("ops", () => {
  it("reparent refuses cycles and moves objects", () => {
    const a = createGameObject("container", { name: "a" });
    const b = createGameObject("container", { name: "b" });
    const scene = createScene("S", { objects: [a, b] });
    expect(reparentObject(scene, b.id, a.id)).toBe(true);
    expect(findParent(scene, b.id)?.id).toBe(a.id);
    // cycle: cannot move a under its descendant b
    expect(reparentObject(scene, a.id, b.id)).toBe(false);
  });

  it("reorder within a list", () => {
    const a = createGameObject("sprite", { name: "a" });
    const b = createGameObject("sprite", { name: "b" });
    const c = createGameObject("sprite", { name: "c" });
    const scene = createScene("S", { objects: [a, b, c] });
    reorderObject(scene, c.id, { dir: -1 });
    expect(scene.objects.map((o) => o.name)).toEqual(["a", "c", "b"]);
    reorderObject(scene, a.id, { toIndex: 2 });
    expect(scene.objects.map((o) => o.name)).toEqual(["c", "b", "a"]);
  });

  it("detach + insert round-trip", () => {
    const a = createGameObject("sprite", { name: "a" });
    const scene = createScene("S", { objects: [a] });
    const d = detachObject(scene, a.id);
    expect(scene.objects).toHaveLength(0);
    insertObject(scene, d!, null);
    expect(scene.objects).toHaveLength(1);
  });

  it("upsertKeyframe replaces at same time, keeps sorted", () => {
    const trk = createTrack("o1", "x", []);
    upsertKeyframe(trk, createKeyframe(1, 100));
    upsertKeyframe(trk, createKeyframe(0, 0));
    upsertKeyframe(trk, createKeyframe(1, 200)); // replace
    expect(trk.keyframes.map((k) => k.time)).toEqual([0, 1]);
    expect(trk.keyframes[1].value).toBe(200);
  });
});

describe("easing", () => {
  it("every easing pins its endpoints to 0 and 1", () => {
    for (const e of EASES) {
      expect(e.fn(0), `${e.id}(0)`).toBeCloseTo(0, 5);
      expect(e.fn(1), `${e.id}(1)`).toBeCloseTo(1, 5);
    }
  });

  it("common curves are numerically correct", () => {
    expect(easeFn("linear")(0.42)).toBeCloseTo(0.42, 6);
    expect(easeFn("quadIn")(0.5)).toBeCloseTo(0.25, 6);
    expect(easeFn("quadOut")(0.5)).toBeCloseTo(0.75, 6);
    expect(easeFn("sineInOut")(0.5)).toBeCloseTo(0.5, 6);
    expect(easeFn("hold")(0.99)).toBe(0);
    expect(easeFn("hold")(1)).toBe(1);
  });

  it("elasticOut matches Phaser's Elastic.easeOut defaults (preview == export)", () => {
    const f = easeFn("elasticOut");
    expect(f(0.05)).toBeCloseTo(1.70710678, 4);
    expect(f(0.1)).toBeCloseTo(0.5, 4);
    expect(f(0.2)).toBeCloseTo(0.75, 4);
  });
});

describe("sampling", () => {
  it("interpolates linearly", () => {
    const trk = createTrack("o1", "x", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 100, { ease: "linear" })]);
    expect(sampleTrack(trk, 0)).toBe(0);
    expect(sampleTrack(trk, 1)).toBeCloseTo(50);
    expect(sampleTrack(trk, 2)).toBe(100);
    // clamps outside range
    expect(sampleTrack(trk, 5)).toBe(100);
    expect(sampleTrack(trk, -5)).toBe(0);
  });

  it("hold ease steps", () => {
    const trk = createTrack("o1", "x", [createKeyframe(0, 0, { ease: "hold" }), createKeyframe(2, 100)]);
    expect(sampleTrack(trk, 1.9)).toBe(0);
    expect(sampleTrack(trk, 2)).toBe(100);
  });

  it("samples a whole timeline grouped by target", () => {
    const tl = createTimeline("t", {
      duration: 2,
      tracks: [
        createTrack("a", "x", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 10, { ease: "linear" })]),
        createTrack("a", "y", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 20, { ease: "linear" })]),
        createTrack("b", "alpha", [createKeyframe(0, 1, { ease: "linear" }), createKeyframe(2, 0, { ease: "linear" })]),
      ],
    });
    const at1 = sampleTimeline(tl, 1);
    expect(at1.get("a")).toEqual({ x: 5, y: 10 });
    expect(at1.get("b")?.alpha).toBeCloseTo(0.5);
    expect(timelineExtent(tl)).toBe(2);
  });

  it("skips muted tracks (Unity Timeline track mute)", () => {
    const tl = createTimeline("t", {
      duration: 2,
      tracks: [
        createTrack("a", "x", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 10, { ease: "linear" })]),
        { ...createTrack("a", "y", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 20, { ease: "linear" })]), muted: true },
      ],
    });
    expect(activeTracks(tl)).toHaveLength(1); // the muted y track is filtered out
    const at1 = sampleTimeline(tl, 1);
    expect(at1.get("a")).toEqual({ x: 5 }); // x applies, the muted y does not
  });

  it("timelineExtent still counts a muted track (it keeps its place on the ruler)", () => {
    const tl = createTimeline("t", {
      duration: 1,
      tracks: [
        createTrack("a", "x", [createKeyframe(0, 0), createKeyframe(1, 10)]),
        { ...createTrack("a", "y", [createKeyframe(0, 0), createKeyframe(3, 20)]), muted: true },
      ],
    });
    expect(timelineExtent(tl)).toBe(3); // muted ≠ removed: the 3s track still extends the timeline
  });

  it("plays only soloed tracks when any track is soloed (Unity Timeline solo)", () => {
    const tl = createTimeline("t", {
      duration: 2,
      tracks: [
        { ...createTrack("a", "x", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 10, { ease: "linear" })]), solo: true },
        createTrack("a", "y", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 20, { ease: "linear" })]),
      ],
    });
    expect(activeTracks(tl)).toHaveLength(1); // only the soloed x track
    expect(sampleTimeline(tl, 1).get("a")).toEqual({ x: 5 }); // y is silenced while x is soloed
  });

  it("silences a soloed track that is also muted (mute wins)", () => {
    const tl = createTimeline("t", {
      duration: 2,
      tracks: [
        { ...createTrack("a", "x", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 10, { ease: "linear" })]), solo: true, muted: true },
        { ...createTrack("a", "y", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(2, 20, { ease: "linear" })]), solo: true },
      ],
    });
    expect(activeTracks(tl)).toHaveLength(1); // x is solo+muted → out; y is solo → in
    expect(sampleTimeline(tl, 1).get("a")).toEqual({ y: 10 });
  });
});
