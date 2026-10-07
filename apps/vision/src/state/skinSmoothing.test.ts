import { describe, expect, it } from "vitest";
import {
  SKIN_FUZZINESS,
  applySkinSmoothing,
  detailCutouts,
  faceHullPolygon,
  skinSmoothingParams,
  type SkinSmoothEngine,
} from "./skinSmoothing";

// A synthetic upright 68-point face in document pixels: jaw arc 0-16, brows
// 17-26, eyes 36-41 / 42-47, outer lips 48-59 (unused slots filled inert).
function syntheticFace(): [number, number][] {
  const P: [number, number][] = Array.from({ length: 68 }, () => [50, 50]);
  for (let i = 0; i <= 16; i++) P[i] = [20 + i * 5, 60 + Math.sin((i / 16) * Math.PI) * 40]; // jaw, chin at ~[60,100]
  for (let i = 17; i <= 26; i++) P[i] = [25 + (i - 17) * 6, 40]; // brows
  for (let i = 36; i <= 41; i++) P[i] = [35 + (i - 36), 50]; // left eye
  for (let i = 42; i <= 47; i++) P[i] = [70 + (i - 42), 50]; // right eye
  for (let i = 48; i <= 59; i++) P[i] = [45 + (i - 48), 80]; // outer lips
  P[8] = [60, 100]; // chin
  return P;
}

function recorder(hasSelection = false) {
  const calls: [string, ...unknown[]][] = [];
  const prevMask = Uint8Array.from([9, 8, 7]);
  const e: SkinSmoothEngine = {
    has_selection: () => hasSelection,
    get_selection_mask: () => prevMask,
    set_selection_mask: (m) => { calls.push(["set_selection_mask", m]); },
    select_none: () => calls.push(["select_none"]),
    select_polygon: (xs, ys, mode) => calls.push(["select_polygon", xs, ys, mode]),
    select_color_range_batch: (...a) => calls.push(["select_color_range_batch", ...a]),
    smart_blur: (...a) => calls.push(["smart_blur", ...a]),
  };
  return { e, calls, prevMask };
}

describe("VIS-FX-13 — Skin Smoothing", () => {
  it("maps the 0..100 sliders onto Smart Blur args, clamped", () => {
    expect(skinSmoothingParams(50, 50)).toEqual({ radius: 6, threshold: 66 });
    expect(skinSmoothingParams(100, 100)).toEqual({ radius: 13, threshold: 116 });
    expect(skinSmoothingParams(-5, 400)).toEqual({ radius: 0, threshold: 116 });
  });

  it("Blur ≈ 0 is a no-op that never touches the engine", () => {
    const { e, calls } = recorder();
    expect(applySkinSmoothing(e, null, 0, 50)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("without a face model: chroma gate (replace, all layers) → smart blur → deselect", () => {
    const { e, calls } = recorder();
    expect(applySkinSmoothing(e, null, 50, 50)).toBe(true);
    expect(calls.map((c) => c[0])).toEqual(["select_color_range_batch", "smart_blur", "select_none"]);
    const [, samples, subtract, fuzz, mode, invert, allLayers] = calls[0];
    expect((samples as Uint8Array).length).toBe(15); // 5 graded skin samples
    expect((subtract as Uint8Array).length).toBe(0);
    expect(fuzz).toBe(SKIN_FUZZINESS);
    expect([mode, invert, allLayers]).toEqual([0, false, true]); // Replace, from the composite
    expect(calls[1]).toEqual(["smart_blur", 6, 66, 0, 2]);
  });

  it("with faces: hulls ∩ chroma gate, minus eye/lip cutouts, then restores the user's selection", () => {
    const { e, calls, prevMask } = recorder(true);
    const faces = [syntheticFace(), syntheticFace()];
    expect(applySkinSmoothing(e, faces, 50, 50)).toBe(true);
    expect(calls.map((c) => c[0])).toEqual([
      "select_polygon", "select_polygon",         // hull replace + hull add
      "select_color_range_batch",                 // intersect chroma gate
      ...Array(6).fill("select_polygon"),         // 2 faces × (2 eyes + lips) subtracted
      "smart_blur",
      "set_selection_mask",                       // user's selection restored
    ]);
    expect(calls[0][3]).toBe(0); // first hull replaces
    expect(calls[1][3]).toBe(1); // second hull adds
    expect(calls[2][4]).toBe(3); // color range intersects the hulls
    for (const cut of calls.slice(3, 9)) expect(cut[3]).toBe(2); // cutouts subtract
    expect(calls[9]).toEqual(["smart_blur", 6, 66, 0, 2]);
    expect(calls[10][1]).toBe(prevMask);
  });

  it("face hull covers the forehead above the brows and closes jaw→brows", () => {
    const face = syntheticFace();
    const { xs, ys } = faceHullPolygon(face);
    expect(xs.length).toBe(27); // 17 jaw + 10 brow points
    const browMinY = 40;
    expect(Math.min(...ys)).toBeLessThan(browMinY); // raised past the brow line
    expect(Math.max(...ys)).toBe(100); // still reaches the chin
  });

  it("detail cutouts pad the eyes wider than the raw landmarks and keep lips tight", () => {
    const face = syntheticFace();
    const [leftEye, , lips] = detailCutouts(face);
    const rawEyeSpan = face[41][0] - face[36][0];
    const eyeSpan = Math.max(...leftEye.xs) - Math.min(...leftEye.xs);
    expect(eyeSpan).toBeGreaterThan(rawEyeSpan); // 1.5× pad past the lash line
    const rawLipSpan = face[59][0] - face[48][0];
    const lipSpan = Math.max(...lips.xs) - Math.min(...lips.xs);
    expect(lipSpan).toBeGreaterThan(rawLipSpan);
    expect(lipSpan).toBeLessThan(rawLipSpan * 1.3);
  });
});
