// Unit tests for the Lighting Effects param builder. Engine-free (node); the
// engine shading + dialog are covered by e2e/lighting-effects.spec.ts.
import { describe, it, expect } from "vitest";
import { lightingArgs, DEFAULT_LIGHTING, type LightingOptions } from "./lightingEffects";

describe("lightingArgs", () => {
  it("maps default options to centred, resolution-relative engine args", () => {
    const [lx, ly, lz, intensity, ambient, bump, r, g, b] = lightingArgs(DEFAULT_LIGHTING, 200, 100);
    expect(lx).toBe(100); // 50% of 200
    expect(ly).toBe(50); // 50% of 100
    expect(lz).toBeCloseTo(60); // 60% of min(200,100)=100
    expect(intensity).toBe(1.2);
    expect(ambient).toBe(0.25);
    expect(bump).toBe(1);
    expect([r, g, b]).toEqual([1, 1, 1]); // white → 1,1,1
  });

  it("scales position by canvas size and colour into 0..1", () => {
    const o: LightingOptions = { x: 25, y: 75, height: 50, intensity: 2, ambient: 0.1, bump: 3, color: { r: 255, g: 0, b: 128 }, lightType: 0 };
    const [lx, ly, lz, , , , r, g, b] = lightingArgs(o, 400, 200);
    expect(lx).toBe(100); // 25% of 400
    expect(ly).toBe(150); // 75% of 200
    expect(lz).toBeCloseTo(100); // 50% of min(400,200)=200
    expect(r).toBeCloseTo(1);
    expect(g).toBe(0);
    expect(b).toBeCloseTo(128 / 255);
  });

  it("passes the light type through as the final engine arg", () => {
    expect(lightingArgs(DEFAULT_LIGHTING, 100, 100)[9]).toBe(0); // Point by default
    expect(lightingArgs({ ...DEFAULT_LIGHTING, lightType: 2 }, 100, 100)[9]).toBe(2); // Infinite
  });

  it("floors light height at 1px so a zero height still gives a valid light vector", () => {
    const [, , lz] = lightingArgs({ ...DEFAULT_LIGHTING, height: 0 }, 300, 300);
    expect(lz).toBe(1);
  });
});
