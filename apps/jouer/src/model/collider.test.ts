import { describe, expect, it } from "vitest";
import { colliderCircle } from "./collider";
import { defaultBody } from "./factory";

describe("colliderCircle", () => {
  it("centres a circle in a square box (no offset)", () => {
    expect(colliderCircle({ width: 80, height: 80 })).toEqual({ radius: 40, offsetX: 0, offsetY: 0 });
  });

  it("fits the smaller dimension and offsets to centre in a wide box", () => {
    // 120×80 → radius 40, centred → offsetX 20, offsetY 0
    expect(colliderCircle({ width: 120, height: 80 })).toEqual({ radius: 40, offsetX: 20, offsetY: 0 });
  });

  it("offsets vertically for a tall box", () => {
    // 80×120 → radius 40 → offsetX 0, offsetY 20
    expect(colliderCircle({ width: 80, height: 120 })).toEqual({ radius: 40, offsetX: 0, offsetY: 20 });
  });

  it("defaults to a 64px box when size is unset", () => {
    expect(colliderCircle({})).toEqual({ radius: 32, offsetX: 0, offsetY: 0 });
  });

  it("uses an explicit radius override (Unity CircleCollider2D.radius), staying centred", () => {
    // 80×80 box, override radius 30 → centred offsets w/2 - r = 10,10
    expect(colliderCircle({ width: 80, height: 80 }, 30)).toEqual({ radius: 30, offsetX: 10, offsetY: 10 });
    // override can exceed the auto-fit (a larger hitbox than the visual) → negative offset
    expect(colliderCircle({ width: 80, height: 80 }, 50)).toEqual({ radius: 50, offsetX: -10, offsetY: -10 });
  });

  it("ignores a 0/undefined radius override and falls back to the auto-fit", () => {
    expect(colliderCircle({ width: 120, height: 80 }, 0)).toEqual({ radius: 40, offsetX: 20, offsetY: 0 });
    expect(colliderCircle({ width: 120, height: 80 }, undefined)).toEqual({ radius: 40, offsetX: 20, offsetY: 0 });
  });
});

describe("defaultBody", () => {
  it("defaults the collider shape to box", () => {
    expect(defaultBody().shape).toBe("box");
  });

  it("honours an explicit circle shape", () => {
    expect(defaultBody({ shape: "circle" }).shape).toBe("circle");
  });

  it("defaults mass to 1 and drag to 0 (Unity Rigidbody2D parity)", () => {
    const b = defaultBody();
    expect(b.mass).toBe(1);
    expect(b.drag).toBe(0);
  });

  it("honours explicit mass + drag", () => {
    const b = defaultBody({ mass: 5, drag: 2 });
    expect(b.mass).toBe(5);
    expect(b.drag).toBe(2);
  });
});
