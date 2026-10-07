// Unit tests for the Blur Gallery pin geometry — the pure pin model behind the
// Field / Iris / Tilt-Shift / Spin pin workspaces (the engine-side focus maps
// are covered by packages/engine filters.rs blur_pin_tests).
import { describe, it, expect } from "vitest";
import {
  defaultPin, flattenGalleryPins, flattenSpinPins, hitTestPins, legacyFocus,
  ringDrag, shapeDistance,
} from "./blurPins";

describe("blur gallery pins", () => {
  it("defaultPin drops a centred pin sized to the document", () => {
    const p = defaultPin(1, 400, 200);
    expect(p.x).toBe(200);
    expect(p.y).toBe(100);
    expect(p.focus).toBeCloseTo(70); // 0.35 · min(w, h)
    expect(p.amount).toBe(1);
    expect(p.aspect).toBe(1);
  });

  it("flattenGalleryPins packs 7-float records with rotation in radians", () => {
    const a = defaultPin(1, 100, 100, 10, 20);
    const b = { ...defaultPin(1, 100, 100, 30, 40), rotation: 90, aspect: 0.5 };
    const flat = flattenGalleryPins([a, b]);
    expect(flat.length).toBe(14);
    expect(flat[0]).toBe(10);
    expect(flat[1]).toBe(20);
    expect(flat[7 + 5]).toBeCloseTo(Math.PI / 2); // degrees → radians
    expect(flat[7 + 6]).toBeCloseTo(0.5);
  });

  it("flattenSpinPins packs 6-float records with ry = rx · aspect", () => {
    const p = { ...defaultPin(3, 100, 100), focus: 40, aspect: 0.5, rotation: 180 };
    const flat = flattenSpinPins([p]);
    expect(flat.length).toBe(6);
    expect(flat[2]).toBe(40); // rx
    expect(flat[3]).toBe(20); // ry
    expect(flat[4]).toBeCloseTo(Math.PI);
    expect(flat[5]).toBeCloseTo(0.25);
  });

  it("legacyFocus inverts the centred-pin wrapper mapping", () => {
    const iris = { ...defaultPin(1, 200, 100), focus: 80 };
    expect(legacyFocus(1, iris, 200, 100)).toBeCloseTo(0.4); // rx / w
    const tilt = { ...defaultPin(2, 200, 100), focus: 25 };
    expect(legacyFocus(2, tilt, 200, 100)).toBeCloseTo(0.5); // half-width / (h/2)
    expect(legacyFocus(1, undefined, 200, 100)).toBe(0.4);
  });

  it("hitTestPins prefers the topmost dot, then the selected pin's outline", () => {
    const pins = [defaultPin(1, 100, 100, 50, 50), defaultPin(1, 100, 100, 52, 50)];
    expect(hitTestPins(pins, 1, 0, 51, 50, 4)).toEqual({ index: 1, part: "move" });
    // On the selected pin's ellipse edge (focus px to the right of the pin).
    const edgeX = 50 + pins[0].focus;
    expect(hitTestPins(pins, 1, 0, edgeX, 50, 4)).toEqual({ index: 0, part: "ring" });
    expect(hitTestPins(pins, 1, 0, 5, 5, 4)).toBeNull();
  });

  it("shapeDistance is zero on the outline for ellipse and band", () => {
    const iris = { ...defaultPin(1, 100, 100, 50, 50), focus: 20, aspect: 0.5 };
    expect(shapeDistance(1, iris, 70, 50)).toBeCloseTo(0); // major axis edge
    expect(shapeDistance(1, iris, 50, 60)).toBeCloseTo(0); // minor axis edge
    const tilt = { ...defaultPin(2, 100, 100, 50, 50), focus: 10, rotation: 0 };
    expect(shapeDistance(2, tilt, 80, 60)).toBeCloseTo(0); // band edge at |dy| = 10
  });

  it("ringDrag sets size from distance and rotation from angle", () => {
    const iris = defaultPin(1, 100, 100, 50, 50);
    const dragged = ringDrag(1, iris, 50 + 30, 50 + 30);
    expect(dragged.focus).toBeCloseTo(Math.hypot(30, 30));
    expect(dragged.rotation).toBeCloseTo(45);
    // Tilt: dragging straight up from the pin keeps a horizontal band.
    const tilt = defaultPin(2, 100, 100, 50, 50);
    const up = ringDrag(2, tilt, 50, 20);
    expect(up.focus).toBeCloseTo(30);
    expect(up.rotation).toBeCloseTo(0);
    // Never collapses below the grabbable minimum.
    expect(ringDrag(1, iris, 50.5, 50).focus).toBe(4);
  });
});
