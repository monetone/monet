// Unit tests for the dust-spot detector. Engine-free (node); the Detect Spots
// button + heal-spot seeding are covered by the camera-raw-workspace e2e.
import { describe, it, expect } from "vitest";
import { detectDustSpots, healSourceFor, pickHealSource } from "./detectDustSpots";

/** A w×h opaque grey field. */
function field(w: number, h: number, base: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = base; px[i + 1] = base; px[i + 2] = base; px[i + 3] = 255; }
  return px;
}
/** Stamp a (2r+1)² blob of `val` centred at (cx,cy). */
function blob(px: Uint8ClampedArray, w: number, cx: number, cy: number, r: number, val: number): void {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const i = ((cy + dy) * w + (cx + dx)) * 4;
    px[i] = val; px[i + 1] = val; px[i + 2] = val; px[i + 3] = 255;
  }
}

describe("detectDustSpots", () => {
  it("finds nothing on a smooth field", () => {
    expect(detectDustSpots(field(40, 40, 150), 40, 40)).toEqual([]);
  });

  it("finds planted spots near their locations", () => {
    const w = 48, h = 48;
    const px = field(w, h, 160);
    blob(px, w, 12, 12, 1, 20); // a small dark speck
    blob(px, w, 34, 30, 1, 20);
    const spots = detectDustSpots(px, w, h, { sensitivity: 0.7 });
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const near = (nx: number, ny: number) => spots.some((s) => Math.abs(s.x * w - nx) < 4 && Math.abs(s.y * h - ny) < 4);
    expect(near(12, 12)).toBe(true);
    expect(near(34, 30)).toBe(true);
  });

  it("higher sensitivity finds at least as many spots", () => {
    const w = 48, h = 48;
    const px = field(w, h, 160);
    blob(px, w, 12, 12, 1, 110); // faint
    blob(px, w, 34, 30, 1, 20); // strong
    const low = detectDustSpots(px, w, h, { sensitivity: 0.1 }).length;
    const high = detectDustSpots(px, w, h, { sensitivity: 0.95 }).length;
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("respects maxSpots", () => {
    const w = 60, h = 60;
    const px = field(w, h, 160);
    for (let i = 0; i < 20; i++) blob(px, w, 5 + (i % 5) * 11, 5 + Math.floor(i / 5) * 13, 1, 20);
    expect(detectDustSpots(px, w, h, { sensitivity: 0.9, maxSpots: 4 }).length).toBeLessThanOrEqual(4);
  });

  it("healSourceFor offsets toward the centre and stays in bounds", () => {
    const s = healSourceFor({ x: 0.2, y: 0.8, radius: 0.02 });
    expect(s.sourceX).toBeGreaterThan(0.2); // pulled right (toward centre)
    expect(s.sourceY).toBeLessThan(0.8); // pulled up (toward centre)
    expect(s.sourceX).toBeLessThanOrEqual(1);
    expect(s.sourceY).toBeGreaterThanOrEqual(0);
  });
});

describe("pickHealSource", () => {
  const W = 96, H = 96;
  /** Left half flat, right half 8px vertical stripes — two textures to match. */
  function split(): Uint8ClampedArray {
    const px = field(W, H, 150);
    for (let y = 0; y < H; y++) for (let x = W / 2; x < W; x++) {
      const v = Math.floor(x / 4) % 2 === 0 ? 40 : 220;
      const i = (y * W + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v;
    }
    return px;
  }
  const RADIUS = 4 / 96; // 4 px

  it("keeps the source in the region whose texture matches the target", () => {
    const px = split();
    const flat = pickHealSource(px, W, H, { x: 0.25, y: 0.5, radius: RADIUS });
    expect(flat.sourceX * W).toBeLessThan(W / 2); // stayed on the flat side
    const busy = pickHealSource(px, W, H, { x: 0.75, y: 0.5, radius: RADIUS });
    expect(busy.sourceX * W).toBeGreaterThanOrEqual(W / 2); // stayed in the stripes
  });

  it("never lands inside the target disc, and is deterministic", () => {
    const px = split();
    const spot = { x: 0.25, y: 0.5, radius: RADIUS };
    const a = pickHealSource(px, W, H, spot);
    const b = pickHealSource(px, W, H, spot);
    expect(a).toEqual(b);
    expect(Math.hypot(a.sourceX * W - 0.25 * W, a.sourceY * H - 0.5 * H)).toBeGreaterThan(4);
  });

  it("stays in bounds near a corner", () => {
    const px = split();
    const s = pickHealSource(px, W, H, { x: 0.01, y: 0.99, radius: RADIUS });
    expect(s.sourceX).toBeGreaterThanOrEqual(0);
    expect(s.sourceY).toBeLessThanOrEqual(1);
    // The whole source disc must fit: its centre clears the frame edge by r.
    expect(s.sourceX * W).toBeGreaterThanOrEqual(4);
    expect(s.sourceY * H).toBeLessThanOrEqual(H - 4);
  });

  it("skips sources overlapping another spot", () => {
    const px = split();
    const spot = { x: 0.25, y: 0.5, radius: RADIUS };
    const near = pickHealSource(px, W, H, spot);
    const away = pickHealSource(px, W, H, spot, {
      avoid: [{ x: near.sourceX, y: near.sourceY, radius: RADIUS }],
    });
    expect(Math.hypot((away.sourceX - near.sourceX) * W, (away.sourceY - near.sourceY) * H)).toBeGreaterThanOrEqual(8);
  });

  it("rank walks to a different source and wraps in bounds", () => {
    const px = split();
    const spot = { x: 0.25, y: 0.5, radius: RADIUS };
    const first = pickHealSource(px, W, H, spot, { rank: 0 });
    const second = pickHealSource(px, W, H, spot, { rank: 1 });
    expect(second).not.toEqual(first);
    const wrapped = pickHealSource(px, W, H, spot, { rank: 10_000 });
    expect(wrapped.sourceX).toBeGreaterThanOrEqual(0);
    expect(wrapped.sourceX).toBeLessThanOrEqual(1);
  });

  it("falls back to the geometric source on a degenerate image", () => {
    const spot = { x: 0.2, y: 0.8, radius: 0.02 };
    expect(pickHealSource(new Uint8ClampedArray(4), 1, 1, spot)).toEqual(healSourceFor(spot));
  });
});
