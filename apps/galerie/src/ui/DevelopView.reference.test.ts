// Reference View (GAL-DEV-23): the pinned reference must track the develop
// zoom, not sit at a fixed fit. Pins the sync math — same zoom factor relative
// to each pane's fit, same normalized focal point — so the two panes frame the
// matching region of their own frames at 1:1.

import { describe, expect, it } from "vitest";

import { referenceZoom } from "./DevelopView";

// Two equal half-stage panes (the normal Reference View layout).
const view = { w: 600, h: 600 };
const shown = { w: 4000, h: 3000 }; // the develop render
const nat = { w: 2000, h: 1500 }; // the reference's cached preview

/** Normalized image point at the centre of a pane under {scale, pan}. */
const focusOf = (z: { scale: number; pan: { x: number; y: number } }, img: { w: number; h: number }) => ({
  nx: (view.w / 2 - z.pan.x) / (img.w * z.scale),
  ny: (view.h / 2 - z.pan.y) / (img.h * z.scale),
});

describe("referenceZoom", () => {
  it("stays at fit while the develop canvas is at fit", () => {
    expect(referenceZoom(null, shown, view, nat, view)).toBeNull();
  });

  it("holds the same zoom factor relative to each pane's own fit", () => {
    // Active fit is 600/4000 = 0.15, so 1:1 is 6.667× fit. The reference's fit
    // is 600/2000 = 0.30, so it must land on 0.30 × 6.667 = 2.0.
    const rz = referenceZoom({ scale: 1, pan: { x: -1700, y: -1200 } }, shown, view, nat, view)!;
    expect(rz.scale).toBeCloseTo(2, 10);
  });

  it("centres both panes on the same normalized image point", () => {
    const zoom = { scale: 1, pan: { x: -1700, y: -1200 } };
    const rz = referenceZoom(zoom, shown, view, nat, view)!;
    const active = focusOf(zoom, shown);
    const ref = focusOf(rz, nat);
    expect(ref.nx).toBeCloseTo(active.nx, 10);
    expect(ref.ny).toBeCloseTo(active.ny, 10);
  });

  it("follows a pan — moving the develop view moves the reference with it", () => {
    const a = referenceZoom({ scale: 1, pan: { x: -1700, y: -1200 } }, shown, view, nat, view)!;
    const b = referenceZoom({ scale: 1, pan: { x: -2000, y: -1200 } }, shown, view, nat, view)!;
    // Panning the develop canvas left walks the reference the same way; the
    // vertical pan is untouched, so the reference must not drift on Y.
    expect(b.pan.x).toBeLessThan(a.pan.x);
    expect(b.pan.y).toBe(a.pan.y);
    expect(focusOf(b, nat).nx).toBeGreaterThan(focusOf(a, nat).nx);
  });

  it("keeps the reference covering its pane (no gutters at the edges)", () => {
    // A develop pan clamped hard to the top-left corner.
    const rz = referenceZoom({ scale: 1, pan: { x: 0, y: 0 } }, shown, view, nat, view)!;
    expect(rz.pan.x).toBeLessThanOrEqual(0);
    expect(rz.pan.y).toBeLessThanOrEqual(0);
    expect(rz.pan.x).toBeGreaterThanOrEqual(view.w - nat.w * rz.scale);
    expect(rz.pan.y).toBeGreaterThanOrEqual(view.h - nat.h * rz.scale);
  });

  it("handles a differently shaped reference (portrait against landscape)", () => {
    const portrait = { w: 1500, h: 2000 };
    const rz = referenceZoom({ scale: 1, pan: { x: -1700, y: -1200 } }, shown, view, portrait, view)!;
    // A 1500×2000 preview fits a 600×600 pane at 0.3; factor 6.667 → 2.0.
    expect(rz.scale).toBeCloseTo(2, 10);
    // Still centred on the same normalized point, despite the aspect mismatch.
    expect(focusOf(rz, portrait).nx).toBeCloseTo(0.5, 10);
    expect(focusOf(rz, portrait).ny).toBeCloseTo(0.5, 10);
  });

  it("refuses degenerate geometry (unmeasured pane, unloaded preview)", () => {
    const zoom = { scale: 1, pan: { x: 0, y: 0 } };
    expect(referenceZoom(zoom, { w: 0, h: 0 }, view, nat, view)).toBeNull();
    expect(referenceZoom(zoom, shown, { w: 0, h: 0 }, nat, view)).toBeNull();
    expect(referenceZoom(zoom, shown, view, { w: 0, h: 0 }, view)).toBeNull();
    expect(referenceZoom(zoom, shown, view, nat, { w: 0, h: 0 })).toBeNull();
  });
});
