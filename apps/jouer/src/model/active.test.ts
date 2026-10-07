import { describe, expect, it } from "vitest";
import { collectInactiveIds, isSelfActive } from "./active";
import { createGameObject } from "./factory";
import type { GameObject } from "./types";

// Unity-parity GameObject active state: `active` is activeSelf; an object is
// inactive *in hierarchy* if it or any ancestor is inactive (the cascade).

const obj = (over: Partial<GameObject> & { kind: GameObject["kind"] }): GameObject =>
  createGameObject(over.kind, over);

describe("isSelfActive", () => {
  it("defaults to active and reads the flag", () => {
    expect(isSelfActive(obj({ id: "a", kind: "rectangle" }))).toBe(true);
    expect(isSelfActive(obj({ id: "a", kind: "rectangle", active: true }))).toBe(true);
    expect(isSelfActive(obj({ id: "a", kind: "rectangle", active: false }))).toBe(false);
  });
});

describe("collectInactiveIds", () => {
  it("includes self-inactive objects", () => {
    const tree = [
      obj({ id: "a", kind: "rectangle", active: true }),
      obj({ id: "b", kind: "rectangle", active: false }),
    ];
    expect([...collectInactiveIds(tree)]).toEqual(["b"]);
  });

  it("cascades to descendants of an inactive container (activeInHierarchy)", () => {
    const tree = [
      obj({
        id: "g",
        kind: "container",
        active: false,
        children: [
          obj({ id: "c1", kind: "text", active: true }),
          obj({ id: "c2", kind: "rectangle", active: false }),
        ],
      }),
      obj({ id: "a", kind: "rectangle", active: true }),
    ];
    // g inactive → g + both children (even c1, whose own active is true)
    expect([...collectInactiveIds(tree)].sort()).toEqual(["c1", "c2", "g"]);
  });

  it("keeps children of an active container active unless self-inactive", () => {
    const tree = [
      obj({
        id: "g",
        kind: "container",
        active: true,
        children: [
          obj({ id: "c1", kind: "text", active: true }),
          obj({ id: "c2", kind: "rectangle", active: false }),
        ],
      }),
    ];
    expect([...collectInactiveIds(tree)]).toEqual(["c2"]);
  });

  it("is empty when everything is active", () => {
    const tree = [
      obj({ id: "a", kind: "rectangle" }),
      obj({ id: "g", kind: "container", children: [obj({ id: "c", kind: "text" })] }),
    ];
    expect(collectInactiveIds(tree).size).toBe(0);
  });
});
