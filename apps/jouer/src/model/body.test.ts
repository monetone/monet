import { describe, expect, it } from "vitest";
import { bodyForPaste } from "./body";
import { createGameObject, defaultBody } from "./factory";

// Unity-parity Paste Component Values for the physics body: an independent clone
// for objects that can carry a body; null (skip) for containers.

describe("bodyForPaste", () => {
  it("returns an independent deep clone for a non-container target", () => {
    const body = defaultBody({ mass: 5, gravityY: 200, shape: "circle" });
    const out = bodyForPaste(createGameObject("rectangle"), body);
    expect(out).toEqual(body);
    expect(out).not.toBe(body); // distinct reference
    out!.mass = 99;
    expect(body.mass).toBe(5); // mutating the clone doesn't touch the source
  });

  it("returns null for a container (containers carry no physics body)", () => {
    expect(bodyForPaste(createGameObject("container"), defaultBody())).toBeNull();
  });

  it("clones for every non-container shape/sprite kind", () => {
    for (const k of ["sprite", "image", "text", "rectangle", "ellipse", "triangle", "hexagon", "hexagonFlat", "diamond", "capsule"] as const) {
      expect(bodyForPaste(createGameObject(k), defaultBody())).not.toBeNull();
    }
  });
});
