// ─────────────────────────────────────────────────────────────
// effectsGradientOverlay.test — VIS-LS-09: the overlay is a full gradient, not
// a two-stop ramp. Guards the TS↔Rust slot contract (effects.rs
// `gradient_overlay` / `overlay_stops`) and the pack/unpack helpers the picker
// writes through. Engine-free, so it runs in node.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  FX, fxDef, fxGradientStops, withFxGradientStops,
  FX_GRAD_COUNT, FX_GRAD_STOPS, type FxField, type FxGradientStop,
} from "./effects";

const go = fxDef(FX.GRADIENT_OVERLAY);
const field = (i: number): FxField => {
  const f = go.fields.find((x) => x.i === i);
  if (!f) throw new Error(`no field at slot ${i}`);
  return f;
};
const stop = (pos: number, r: number, g: number, b: number, a = 1): FxGradientStop => ({ pos, r, g, b, a });

describe("Gradient Overlay field layout", () => {
  it("keeps the 13 legacy slots first, so saved documents render unchanged", () => {
    expect(go.def.slice(0, 13)).toEqual([1, 0, 1, 90, 1, 0, 0, 0.1, 0.2, 0.6, 0.9, 0.4, 0.1]);
  });

  it("offers all five Photoshop styles, Linear/Radial keeping their old codes", () => {
    const style = field(5);
    expect(style.k === "select" && style.options).toEqual(["Linear", "Radial", "Angle", "Reflected", "Diamond"]);
  });

  it("adds Dither, Align with Layer and a drag offset", () => {
    expect(field(13)).toMatchObject({ k: "toggle", label: "Dither" });
    expect(field(14)).toMatchObject({ k: "toggle", label: "Align with Layer" });
    expect(field(15)).toMatchObject({ k: "num", label: "Offset X", min: -1 });
    expect(field(16)).toMatchObject({ k: "num", label: "Offset Y", min: -1 });
    // Align defaults ON: that is what a vector without the slot decodes to.
    expect(go.def[14]).toBe(1);
    expect(go.def[13]).toBe(0);
  });

  it("does not take Global Light: the gradient angle is not an `angle` field", () => {
    // Layer ▸ Global Light rewrites the first `angle` field of every effect, and
    // it parks its flag at def.length — where the stop tail now lives.
    expect(go.fields.some((f) => f.k === "angle")).toBe(false);
    expect(field(3)).toMatchObject({ k: "num", label: "Angle" });
  });

  it("ends the default vector exactly where the stop tail starts", () => {
    expect(go.def).toHaveLength(FX_GRAD_STOPS);
    expect(go.def[FX_GRAD_COUNT]).toBe(0); // no ramp authored yet
    for (const f of go.fields) expect(f.i + (f.k === "color" ? 3 : 1)).toBeLessThanOrEqual(go.def.length);
  });
});

describe("gradient stop tail", () => {
  it("reads the two Start/End colours when no ramp is authored", () => {
    expect(fxGradientStops(go.def)).toEqual([
      { pos: 0, r: 0.1, g: 0.2, b: 0.6, a: 1 },
      { pos: 1, r: 0.9, g: 0.4, b: 0.1, a: 1 },
    ]);
  });

  it("round-trips a multi-stop ramp with opacity stops", () => {
    const ramp = [stop(0, 0, 0, 0), stop(0.5, 0, 1, 0, 0.5), stop(1, 1, 1, 1)];
    const p = withFxGradientStops(go.def, ramp);
    expect(p[FX_GRAD_COUNT]).toBe(3);
    expect(p).toHaveLength(FX_GRAD_STOPS + 15);
    expect(fxGradientStops(p)).toEqual(ramp);
  });

  it("sorts by position and clamps out-of-range values", () => {
    const p = withFxGradientStops(go.def, [stop(1, 2, 0, 0), stop(0, 0, 0, -1)]);
    expect(fxGradientStops(p)).toEqual([
      { pos: 0, r: 0, g: 0, b: 0, a: 1 },
      { pos: 1, r: 1, g: 0, b: 0, a: 1 },
    ]);
  });

  it("mirrors the ramp's ends into the Start/End colour slots", () => {
    // effects.rs folds slots 7..12 onto the first/last stop, so the dialog's two
    // colour rows stay live on a multi-stop gradient. Both sides must agree.
    const p = withFxGradientStops(go.def, [stop(0, 1, 0, 0), stop(0.5, 0, 1, 0), stop(1, 0, 0, 1)]);
    expect(p.slice(7, 13)).toEqual([1, 0, 0, 0, 0, 1]);
    p[7] = 0.25; // "Start" edited in the dialog
    expect(fxGradientStops(p)[0]).toEqual({ pos: 0, r: 0.25, g: 0, b: 0, a: 1 });
  });

  it("keeps the other params untouched when the ramp is replaced", () => {
    const base = go.def.slice();
    base[5] = 4; // Diamond
    base[13] = 1; // Dither
    const p = withFxGradientStops(withFxGradientStops(base, [stop(0, 0, 0, 0), stop(0.3, 1, 0, 0), stop(1, 1, 1, 1)]), [
      stop(0, 0, 0, 0), stop(1, 1, 1, 1),
    ]);
    expect(p.slice(0, 7)).toEqual(base.slice(0, 7));
    expect(p[13]).toBe(1);
    expect(p[FX_GRAD_COUNT]).toBe(2);
  });

  it("clears the tail when handed fewer than two stops", () => {
    const p = withFxGradientStops(withFxGradientStops(go.def, [stop(0, 0, 0, 0), stop(0.5, 1, 0, 0), stop(1, 1, 1, 1)]), [stop(0, 1, 0, 0)]);
    expect(p[FX_GRAD_COUNT]).toBe(0);
    expect(p).toHaveLength(FX_GRAD_STOPS);
    expect(fxGradientStops(p)).toHaveLength(2);
  });

  it("falls back to the two colours on a truncated tail", () => {
    const p = withFxGradientStops(go.def, [stop(0, 0, 0, 0), stop(0.5, 1, 0, 0), stop(1, 1, 1, 1)]).slice(0, FX_GRAD_STOPS + 7);
    expect(fxGradientStops(p)).toHaveLength(2);
  });

  it("floors a fractional stop count instead of throwing (#141)", () => {
    // Externally-authored params (a project/.asl payload) can carry a non-integral
    // slot 17. `Array.from({length: 2.5})` yields 2 entries, so the un-floored
    // `out[n - 1]` was a hole and `Object.assign` threw a TypeError mid-render.
    const p = withFxGradientStops(go.def, [stop(0, 1, 0, 0), stop(0.5, 0, 1, 0), stop(1, 0, 0, 1)]);
    p[FX_GRAD_COUNT] = 2.5;
    expect(() => fxGradientStops(p)).not.toThrow();
    expect(fxGradientStops(p)).toHaveLength(2); // floor(2.5) — the engine's `as usize`
    // slots 10..12 still win for the (now second) end stop
    expect(fxGradientStops(p)[1]).toMatchObject({ r: p[10], g: p[11], b: p[12] });
    // a fractional count below 2 still degrades to the two-colour fallback
    p[FX_GRAD_COUNT] = 1.5;
    expect(fxGradientStops(p)).toHaveLength(2);
    p[FX_GRAD_COUNT] = NaN;
    expect(fxGradientStops(p)).toHaveLength(2);
  });
});
