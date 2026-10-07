// Unit tests for Adaptive Wide Angle's pure geometry. Engine-free (node); the
// workspace + engine mesh_warp are exercised in the app.
import { describe, it, expect } from "vitest";
import {
  ADAPTIVE_WIDE_DEFAULTS,
  adaptiveWideGrid,
  adaptiveWideTransform,
  isAdaptiveWideIdentity,
  resolveAdaptiveWideModel,
  sanitizeAdaptiveWide,
  type AdaptiveWideOptions,
} from "./adaptiveWideAngle";

const W = 400;
const H = 300;
const opts = (over: Partial<AdaptiveWideOptions>): AdaptiveWideOptions => ({ ...ADAPTIVE_WIDE_DEFAULTS, ...over });

describe("sanitizeAdaptiveWide", () => {
  it("falls back to the defaults for non-finite or out-of-range numbers", () => {
    const o = sanitizeAdaptiveWide({ focalLength: NaN, cropFactor: 0, scale: 999 });
    expect(o.focalLength).toBe(ADAPTIVE_WIDE_DEFAULTS.focalLength);
    expect(o.cropFactor).toBe(0.1);
    expect(o.scale).toBe(5);
  });

  it("drops half-drawn constraints and clamps points into the frame", () => {
    const o = sanitizeAdaptiveWide({
      constraints: [
        { kind: "line", pts: [[0.1, 0.1]] },                                  // one point: incomplete
        { kind: "polygon", pts: [[0, 0], [1, 0], [1, 1]] },                    // three corners: incomplete
        { kind: "line", pts: [[-2, 0.5], [3, Number.NaN]] },
      ],
    });
    expect(o.constraints).toEqual([{ kind: "line", pts: [[0, 0.5], [1, 0]] }]);
  });

  it("rejects an unknown model", () => {
    expect(sanitizeAdaptiveWide({ model: "wobble" as never }).model).toBe(ADAPTIVE_WIDE_DEFAULTS.model);
  });
});

describe("resolveAdaptiveWideModel", () => {
  it("keeps an explicit model", () => {
    expect(resolveAdaptiveWideModel(opts({ model: "spherical" }))).toBe("spherical");
  });

  it("auto picks fisheye for wide 35mm-equivalent focals and perspective otherwise", () => {
    expect(resolveAdaptiveWideModel(opts({ model: "auto", focalLength: 14, cropFactor: 1 }))).toBe("fisheye");
    expect(resolveAdaptiveWideModel(opts({ model: "auto", focalLength: 50, cropFactor: 1 }))).toBe("perspective");
    // 16mm on a 1.6× crop body is a 25.6mm equivalent — not a fisheye.
    expect(resolveAdaptiveWideModel(opts({ model: "auto", focalLength: 16, cropFactor: 1.6 }))).toBe("perspective");
  });
});

describe("adaptiveWideTransform", () => {
  it("is the identity with no correction to make", () => {
    const { forward } = adaptiveWideTransform(opts({ model: "perspective" }), W, H);
    expect(forward(0, 0)).toEqual([0, 0]);
    expect(forward(137, 42)).toEqual([137, 42]);
  });

  it("fisheye pins the corners and pulls mid-radius pixels inward (barrel removal)", () => {
    const { forward } = adaptiveWideTransform(opts({ model: "fisheye", focalLength: 12 }), W, H);
    const [cornerX, cornerY] = forward(0, 0);
    expect(cornerX).toBeCloseTo(0, 3);
    expect(cornerY).toBeCloseTo(0, 3);
    // Halfway from centre to the top-left corner: must end up nearer the centre.
    const [mx, my] = forward(W / 4, H / 4);
    expect(Math.hypot(mx - W / 2, my - H / 2)).toBeLessThan(Math.hypot(W / 4, H / 4) * 0.95);
  });

  it("straightens a line constraint onto the nearest axis", () => {
    // A 12° tilt across the middle of the frame.
    const rad = (12 * Math.PI) / 180;
    const dx = 0.3;
    const dy = (dx * W * Math.tan(rad)) / H;
    const { forward } = adaptiveWideTransform(
      opts({ model: "perspective", constraints: [{ kind: "line", pts: [[0.5 - dx, 0.5 - dy], [0.5 + dx, 0.5 + dy]] }] }),
      W, H,
    );
    const a = forward((0.5 - dx) * W, (0.5 - dy) * H);
    const b = forward((0.5 + dx) * W, (0.5 + dy) * H);
    expect(b[1] - a[1]).toBeCloseTo(0, 6);
    expect(b[0] - a[0]).toBeGreaterThan(0);
  });

  it("rectifies a polygon constraint into an axis-aligned rectangle", () => {
    const quad: [number, number][] = [[0.15, 0.2], [0.65, 0.2], [0.6, 0.7], [0.05, 0.7]];
    const { forward } = adaptiveWideTransform(opts({ model: "perspective", constraints: [{ kind: "polygon", pts: quad }] }), W, H);
    const out = quad.map(([x, y]) => forward(x * W, y * H));
    expect(out[0][1]).toBeCloseTo(out[1][1], 4); // top edge level
    expect(out[3][1]).toBeCloseTo(out[2][1], 4); // bottom edge level
    expect(out[0][0]).toBeCloseTo(out[3][0], 4); // left edge plumb
    expect(out[1][0]).toBeCloseTo(out[2][0], 4); // right edge plumb
  });

  it("scale zooms about the frame centre", () => {
    const { forward } = adaptiveWideTransform(opts({ model: "perspective", scale: 1.5 }), W, H);
    expect(forward(W / 2, H / 2)).toEqual([W / 2, H / 2]);
    const [x, y] = forward(W / 2 + 40, H / 2 - 20);
    expect(x).toBeCloseTo(W / 2 + 60, 6);
    expect(y).toBeCloseTo(H / 2 - 30, 6);
  });

  it("inverse round-trips forward for every projection", () => {
    for (const model of ["fisheye", "perspective", "spherical"] as const) {
      const o = opts({
        model,
        focalLength: 14,
        scale: 1.2,
        constraints: [
          { kind: "polygon", pts: [[0.15, 0.2], [0.65, 0.2], [0.6, 0.7], [0.05, 0.7]] },
          { kind: "line", pts: [[0.1, 0.85], [0.9, 0.8]] },
        ],
      });
      const { forward, inverse } = adaptiveWideTransform(o, W, H);
      for (const [x, y] of [[10, 10], [W / 2, H / 2], [W - 5, 12], [123, 267]]) {
        const [bx, by] = inverse(...forward(x, y));
        expect(bx).toBeCloseTo(x, 3);
        expect(by).toBeCloseTo(y, 3);
      }
    }
  });

  it("never emits a non-finite coordinate from hostile options", () => {
    const { forward } = adaptiveWideTransform(
      { model: "spherical", focalLength: 0, cropFactor: NaN, scale: Infinity, constraints: [{ kind: "polygon", pts: [[0, 0], [0, 0], [0, 0], [0, 0]] }] },
      W, H,
    );
    for (const [x, y] of [[0, 0], [W, H], [W / 2, 0]]) {
      const [fx, fy] = forward(x, y);
      expect(Number.isFinite(fx) && Number.isFinite(fy)).toBe(true);
    }
  });
});

describe("adaptiveWideGrid", () => {
  it("returns the regular lattice when there is nothing to correct", () => {
    const { dstX, dstY } = adaptiveWideGrid(opts({ model: "perspective" }), 2, 2, W, H);
    expect(Array.from(dstX)).toEqual([0, 200, 400, 0, 200, 400, 0, 200, 400]);
    expect(Array.from(dstY)).toEqual([0, 0, 0, 150, 150, 150, 300, 300, 300]);
  });

  it("sizes the destination grid to (gw+1)×(gh+1) with finite vertices", () => {
    const { dstX, dstY } = adaptiveWideGrid(opts({ model: "fisheye", focalLength: 10 }), 8, 6, W, H);
    expect(dstX).toHaveLength(9 * 7);
    expect(dstY).toHaveLength(9 * 7);
    expect(dstX.every((n) => Number.isFinite(n))).toBe(true);
    expect(dstY.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("isAdaptiveWideIdentity", () => {
  it("is true only when no projection, constraint or scale would move a pixel", () => {
    expect(isAdaptiveWideIdentity(opts({ model: "perspective" }))).toBe(true);
    expect(isAdaptiveWideIdentity(opts({ model: "fisheye" }))).toBe(false);
    expect(isAdaptiveWideIdentity(opts({ model: "perspective", scale: 1.1 }))).toBe(false);
    expect(isAdaptiveWideIdentity(opts({ model: "perspective", constraints: [{ kind: "line", pts: [[0, 0], [1, 1]] }] }))).toBe(false);
    // Auto on a 16mm full-frame resolves to fisheye, so the default is not a no-op.
    expect(isAdaptiveWideIdentity(ADAPTIVE_WIDE_DEFAULTS)).toBe(false);
  });
});
