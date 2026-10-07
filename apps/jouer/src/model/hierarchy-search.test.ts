import { describe, expect, it } from "vitest";
import {
  collectHierarchy,
  isHierarchyQueryEmpty,
  objectMatchesQuery,
  parseHierarchyQuery,
} from "./hierarchy-search";
import { createGameObject } from "./factory";
import type { GameObject } from "./types";

// Unity-parity Hierarchy search: filter the scene tree by name (case-insensitive
// substring) and by type via the `t:` prefix (e.g. t:rectangle). These are pure
// functions over plain GameObject[] — no React/Phaser/store needed.

const obj = (over: Partial<GameObject> & { kind: GameObject["kind"] }): GameObject =>
  createGameObject(over.kind, over);

/** A small tree: two top-level shapes + a container with nested objects. */
function tree(): GameObject[] {
  return [
    obj({ id: "player", kind: "rectangle", name: "Player" }),
    obj({ id: "enemyA", kind: "ellipse", name: "Enemy A" }),
    obj({
      id: "group",
      kind: "container",
      name: "Spawner",
      children: [
        obj({ id: "enemyLabel", kind: "text", name: "Enemy Label" }),
        obj({ id: "coin", kind: "sprite", name: "Coin" }),
      ],
    }),
  ];
}

describe("parseHierarchyQuery", () => {
  it("splits plain words into lowercased name fragments", () => {
    expect(parseHierarchyQuery("Enemy")).toEqual({ names: ["enemy"], kinds: [] });
    expect(parseHierarchyQuery("  big   Boss ")).toEqual({ names: ["big", "boss"], kinds: [] });
  });

  it("reads `t:` terms as kinds, with Unity-ish synonyms/abbreviations", () => {
    expect(parseHierarchyQuery("t:rect").kinds).toEqual(["rectangle"]);
    expect(parseHierarchyQuery("t:circle").kinds).toEqual(["ellipse"]);
    expect(parseHierarchyQuery("t:img").kinds).toEqual(["image"]);
    expect(parseHierarchyQuery("t:group").kinds).toEqual(["container"]);
    expect(parseHierarchyQuery("t:sprite").kinds).toEqual(["sprite"]);
    expect(parseHierarchyQuery("t:diamond").kinds).toEqual(["diamond"]);
    expect(parseHierarchyQuery("t:dia").kinds).toEqual(["diamond"]);
    expect(parseHierarchyQuery("t:capsule").kinds).toEqual(["capsule"]);
    expect(parseHierarchyQuery("t:cap").kinds).toEqual(["capsule"]);
    expect(parseHierarchyQuery("t:pill").kinds).toEqual(["capsule"]);
    // Flat-top hexagon resolves via its aliases (the camelCase kind isn't a
    // lowercase prefix), while t:hexagon still resolves to the pointed hexagon.
    expect(parseHierarchyQuery("t:hexflat").kinds).toEqual(["hexagonFlat"]);
    expect(parseHierarchyQuery("t:hexagonflat").kinds).toEqual(["hexagonFlat"]);
    expect(parseHierarchyQuery("t:hexagon").kinds).toEqual(["hexagon"]);
  });

  it("dedupes kinds and keeps multiple distinct ones (OR set)", () => {
    expect(parseHierarchyQuery("t:rect t:rectangle").kinds).toEqual(["rectangle"]);
    expect(parseHierarchyQuery("t:rect t:circle").kinds).toEqual(["rectangle", "ellipse"]);
  });

  it("mixes a name fragment with a type filter", () => {
    expect(parseHierarchyQuery("enemy t:ellipse")).toEqual({ names: ["enemy"], kinds: ["ellipse"] });
  });

  it("ignores a bare `t:` and keeps unknown types verbatim (so they match nothing)", () => {
    expect(parseHierarchyQuery("t:")).toEqual({ names: [], kinds: [] });
    expect(parseHierarchyQuery("t:bogus").kinds).toEqual(["bogus"]);
  });

  it("treats empty / whitespace queries as empty", () => {
    expect(parseHierarchyQuery("")).toEqual({ names: [], kinds: [] });
    expect(isHierarchyQueryEmpty("")).toBe(true);
    expect(isHierarchyQueryEmpty("   ")).toBe(true);
    expect(isHierarchyQueryEmpty("x")).toBe(false);
  });
});

describe("objectMatchesQuery", () => {
  const player = obj({ id: "p", kind: "rectangle", name: "Player One" });

  it("matches a case-insensitive name substring", () => {
    expect(objectMatchesQuery(player, parseHierarchyQuery("play"))).toBe(true);
    expect(objectMatchesQuery(player, parseHierarchyQuery("PLAYER"))).toBe(true);
    expect(objectMatchesQuery(player, parseHierarchyQuery("enemy"))).toBe(false);
  });

  it("requires ALL name fragments (AND)", () => {
    expect(objectMatchesQuery(player, parseHierarchyQuery("player one"))).toBe(true);
    expect(objectMatchesQuery(player, parseHierarchyQuery("player two"))).toBe(false);
  });

  it("matches by kind via t:", () => {
    expect(objectMatchesQuery(player, parseHierarchyQuery("t:rectangle"))).toBe(true);
    expect(objectMatchesQuery(player, parseHierarchyQuery("t:ellipse"))).toBe(false);
  });

  it("combines name AND type", () => {
    expect(objectMatchesQuery(player, parseHierarchyQuery("player t:rect"))).toBe(true);
    expect(objectMatchesQuery(player, parseHierarchyQuery("player t:ellipse"))).toBe(false);
  });

  it("never matches the empty query (caller shows the full tree instead)", () => {
    expect(objectMatchesQuery(player, parseHierarchyQuery(""))).toBe(false);
  });

  it("matches nothing for an unknown type", () => {
    expect(objectMatchesQuery(player, parseHierarchyQuery("t:bogus"))).toBe(false);
  });
});

describe("collectHierarchy", () => {
  it("returns empty sets for an empty query", () => {
    const { matches, visible } = collectHierarchy(tree(), parseHierarchyQuery(""));
    expect(matches.size).toBe(0);
    expect(visible.size).toBe(0);
  });

  it("collects name matches and includes their container as an ancestor", () => {
    const { matches, visible } = collectHierarchy(tree(), parseHierarchyQuery("enemy"));
    // "Enemy A" (top-level) + "Enemy Label" (nested in the container) match.
    expect([...matches].sort()).toEqual(["enemyA", "enemyLabel"]);
    // The nested match drags its container in as a visible ancestor.
    expect([...visible].sort()).toEqual(["enemyA", "enemyLabel", "group"]);
    expect(visible.has("group")).toBe(true);
    expect(matches.has("group")).toBe(false);
  });

  it("filters by type across the whole tree (including nested)", () => {
    const { matches } = collectHierarchy(tree(), parseHierarchyQuery("t:text"));
    expect([...matches]).toEqual(["enemyLabel"]);
  });

  it("ORs multiple type filters", () => {
    const { matches } = collectHierarchy(tree(), parseHierarchyQuery("t:rect t:sprite"));
    expect([...matches].sort()).toEqual(["coin", "player"]);
  });

  it("yields no matches (and no visible rows) for an unknown type", () => {
    const { matches, visible } = collectHierarchy(tree(), parseHierarchyQuery("t:bogus"));
    expect(matches.size).toBe(0);
    expect(visible.size).toBe(0);
  });

  it("shows a matching container as the path WITHOUT pulling in its children", () => {
    // A container that matches by type/name is the only visible row — searching
    // shows the path to matches, not the whole matched subtree (deliberate).
    const { matches, visible } = collectHierarchy(tree(), parseHierarchyQuery("t:container"));
    expect([...matches]).toEqual(["group"]);
    expect([...visible]).toEqual(["group"]);
    expect(visible.has("enemyLabel")).toBe(false);
    expect(visible.has("coin")).toBe(false);
  });
});

describe("single-character t: prefix resolution (order-dependent — pinned)", () => {
  // A `t:` token with no exact alias resolves to the first kind whose name
  // starts with it (kind order: sprite, image, text, rectangle, ellipse,
  // triangle, hexagon, diamond, capsule, container). Pinned so the order can't
  // change silently.
  it("resolves the first kind by name prefix", () => {
    expect(parseHierarchyQuery("t:s").kinds).toEqual(["sprite"]);
    expect(parseHierarchyQuery("t:t").kinds).toEqual(["text"]); // text precedes triangle
    expect(parseHierarchyQuery("t:h").kinds).toEqual(["hexagon"]);
    expect(parseHierarchyQuery("t:c").kinds).toEqual(["capsule"]); // capsule precedes container
    expect(parseHierarchyQuery("t:con").kinds).toEqual(["container"]); // longer prefix for container
    expect(parseHierarchyQuery("t:d").kinds).toEqual(["diamond"]); // diamond is the only d* kind
  });
});
