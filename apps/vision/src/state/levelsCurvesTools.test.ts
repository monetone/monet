// Guards #435 (eyedroppers) and #436 (Auto + options, numeric point entry,
// pencil, clipping preview, .alv/.acv presets) for the Levels and Curves
// dialogs. All pure: the dialogs feed these results to the same engine ops.
import { describe, expect, it } from "vitest";
import { applyLevelsMulti, defaultLevels } from "./levelsChannels";
import { buildCurveLuts } from "./toneCurve";
import {
  DEFAULT_AUTO_OPTIONS, DEFAULT_TARGETS, autoCurvePoints, autoLevelsParams, channelHistograms, clippingMask,
  curvesFromDropper, decodeAcv, decodeAlv, encodeAcv, encodeAlv, levelsFromDropper,
  levelsToCurvePoints, pencilPoints, setCurvePointValue, type CurvePt,
} from "./levelsCurvesTools";

const fourDefault = () => [defaultLevels(), defaultLevels(), defaultLevels(), defaultLevels()];
const diagonal = (): CurvePt[] => [{ id: "lo", x: 0, y: 0 }, { id: "mid", x: 0.5, y: 0.5 }, { id: "hi", x: 1, y: 1 }];
const fourDiagonal = () => [diagonal(), diagonal(), diagonal(), diagonal()];

describe("Levels eyedroppers (#435)", () => {
  it("black point: the sampled pixel becomes the target black, per channel", () => {
    const p = levelsFromDropper(fourDefault(), "black", { r: 20, g: 30, b: 40 }, DEFAULT_TARGETS.black);
    expect([p[1].ib, p[2].ib, p[3].ib]).toEqual([20, 30, 40]);
    expect(p[0]).toEqual(defaultLevels()); // composite untouched
    const out = applyLevelsMulti(p[0], p[1], p[2], p[3], 20, 30, 40);
    expect(out).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("white point: the sampled pixel becomes the target white", () => {
    const p = levelsFromDropper(fourDefault(), "white", { r: 200, g: 220, b: 240 }, DEFAULT_TARGETS.white);
    expect(applyLevelsMulti(p[0], p[1], p[2], p[3], 200, 220, 240)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("gray point neutralises a cast without changing brightness", () => {
    const sample = { r: 150, g: 120, b: 100 }; // warm cast
    const p = levelsFromDropper(fourDefault(), "gray", sample, DEFAULT_TARGETS.gray);
    const out = applyLevelsMulti(p[0], p[1], p[2], p[3], sample.r, sample.g, sample.b);
    const mean = Math.round((150 + 120 + 100) / 3);
    for (const v of [out.r, out.g, out.b]) expect(Math.abs(v - mean)).toBeLessThanOrEqual(2);
  });

  it("keeps the input range valid when a sample crosses the other point", () => {
    const start = fourDefault();
    start[1].iw = 50;
    const p = levelsFromDropper(start, "black", { r: 200, g: 0, b: 0 }, DEFAULT_TARGETS.black);
    expect(p[1].ib).toBe(49);
  });
});

describe("Curves eyedroppers (#435)", () => {
  it("black and white move the channel's end points to the sample", () => {
    const black = curvesFromDropper(fourDiagonal(), "black", { r: 25.5, g: 51, b: 76.5 }, DEFAULT_TARGETS.black);
    expect(black[1].find((p) => p.id === "lo")).toEqual({ id: "lo", x: 0.1, y: 0 });
    expect(black[2].find((p) => p.id === "lo")?.x).toBeCloseTo(0.2);
    expect(black[0]).toEqual(diagonal()); // master untouched
    const white = curvesFromDropper(fourDiagonal(), "white", { r: 204, g: 204, b: 204 }, DEFAULT_TARGETS.white);
    expect(white[3].find((p) => p.id === "hi")).toEqual({ id: "hi", x: 0.8, y: 1 });
  });

  it("drops inner points an end point would cross", () => {
    const black = curvesFromDropper(fourDiagonal(), "black", { r: 153, g: 0, b: 0 }, DEFAULT_TARGETS.black);
    expect(black[1].map((p) => p.id).sort()).toEqual(["hi", "lo"]);
  });

  it("gray adds one mid point at the sample that lands on the mean", () => {
    const gray = curvesFromDropper(fourDiagonal(), "gray", { r: 153, g: 102, b: 51 }, DEFAULT_TARGETS.gray);
    const luts = buildCurveLuts(gray);
    expect([luts.r[153], luts.g[102], luts.b[51]].every((v) => Math.abs(v - 102) <= 1)).toBe(true);
  });
});

describe("Auto with Color Correction Options (#436)", () => {
  it("histograms a snapshot per channel, ignoring alpha", () => {
    const h = channelHistograms(new Uint8ClampedArray([1, 2, 3, 0, 1, 2, 3, 255, 9, 9, 9, 255]));
    expect([h.r[1], h.g[2], h.b[3], h.r[9], h.r[0]]).toEqual([2, 2, 2, 1, 0]);
  });

  // A dull image: every channel lives in 40..200 with a green cast.
  const hist = (lo: number, hi: number) => { const h = new Array(256).fill(0); for (let v = lo; v <= hi; v++) h[v] = 10; return h; };
  const hists = { r: hist(40, 200), g: hist(60, 220), b: hist(40, 200) };

  it("per-channel contrast stretches each channel on its own histogram", () => {
    const p = autoLevelsParams(hists, { ...DEFAULT_AUTO_OPTIONS, algorithm: "perChannel", shadowClip: 0, highlightClip: 0 });
    expect([p[1].ib, p[1].iw]).toEqual([40, 200]);
    expect([p[2].ib, p[2].iw]).toEqual([60, 220]);
    expect(p[0]).toEqual(defaultLevels());
    expect(p[1].gamma).toBe(1); // no neutralisation outside Auto Color
  });

  it("monochromatic contrast uses one combined range on the composite", () => {
    const p = autoLevelsParams(hists, { ...DEFAULT_AUTO_OPTIONS, algorithm: "monochrome", shadowClip: 0, highlightClip: 0 });
    expect([p[0].ib, p[0].iw]).toEqual([40, 220]);
    expect(p[1]).toEqual(defaultLevels());
  });

  it("clip percentages actually move the bounds, independently at each end", () => {
    const flat = { r: hist(0, 255), g: hist(0, 255), b: hist(0, 255) };
    const p = autoLevelsParams(flat, { ...DEFAULT_AUTO_OPTIONS, algorithm: "perChannel", shadowClip: 5, highlightClip: 1 });
    expect(p[1].ib).toBe(12);  // floor(2560 × 0.05) = 128 samples → bin 12
    expect(p[1].iw).toBe(253); // floor(2560 × 0.01) = 25 samples → bin 253
  });

  it("Find Dark & Light Colors neutralises the cast through gamma when Snap Neutral is on", () => {
    const on = autoLevelsParams(hists, { ...DEFAULT_AUTO_OPTIONS, algorithm: "darkLight" });
    const off = autoLevelsParams(hists, { ...DEFAULT_AUTO_OPTIONS, algorithm: "darkLight", snapNeutral: false });
    expect(off.every((p) => p.gamma === 1)).toBe(true);
    // Uniform histograms all stretch to the same mean, so the neutral target
    // is met without a gamma; pile one channel toward its shadows and it appears.
    expect(on[1].gamma).toBe(1);
    const skewedG = new Array(256).fill(0);
    for (let v = 60; v <= 220; v++) skewedG[v] = 220 - v;
    const skewed = { ...hists, g: skewedG };
    const p = autoLevelsParams(skewed, { ...DEFAULT_AUTO_OPTIONS, algorithm: "darkLight" });
    expect(p[2].gamma).not.toBe(1);
  });

  it("targets set the output points", () => {
    const p = autoLevelsParams(hists, {
      ...DEFAULT_AUTO_OPTIONS, algorithm: "perChannel",
      targets: { ...DEFAULT_TARGETS, black: { r: 10, g: 10, b: 10 }, white: { r: 245, g: 245, b: 245 } },
    });
    expect([p[1].ob, p[1].ow]).toEqual([10, 245]);
  });

  it("speaks Curves too: the same correction as end points, identity channels kept diagonal", () => {
    const pts = autoCurvePoints(hists, { ...DEFAULT_AUTO_OPTIONS, algorithm: "perChannel", shadowClip: 0, highlightClip: 0 });
    expect(pts[0]).toEqual(diagonal());
    expect(pts[1].map((p) => [p.x, p.y])).toEqual([[40 / 255, 0], [200 / 255, 1]]);
  });

  it("levelsToCurvePoints carries a gamma as a mid point", () => {
    const pts = levelsToCurvePoints({ ib: 0, iw: 255, ob: 0, ow: 255, gamma: 2 });
    expect(pts).toHaveLength(3);
    expect(pts[1].y).toBeCloseTo(Math.pow(0.5, 0.5));
  });
});

describe("presets round-trip (#436)", () => {
  it(".alv keeps four channels of Levels exactly", () => {
    const params = fourDefault();
    params[0] = { ib: 12, iw: 240, ob: 5, ow: 250, gamma: 1.37 };
    params[2] = { ib: 0, iw: 200, ob: 0, ow: 255, gamma: 0.8 };
    const bytes = encodeAlv(params);
    expect(bytes.length).toBe(2 + 29 * 10);
    expect(decodeAlv(bytes)).toEqual(params);
  });

  it(".acv keeps every channel's points, output-before-input like Photoshop", () => {
    const pts = fourDiagonal();
    pts[1] = [{ id: "a", x: 0, y: 0.1 }, { id: "b", x: 0.25, y: 0.5 }, { id: "c", x: 1, y: 0.9 }];
    const bytes = encodeAcv(pts);
    // version 4, four curves, then R's first point stored as (output 25, input 0)
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 4, 0, 4]);
    const back = decodeAcv(bytes)!;
    expect(back[1].map((p) => [Math.round(p.x * 255), Math.round(p.y * 255)])).toEqual([[0, 26], [64, 128], [255, 230]]);
    // 0.5 lands on Photoshop's 0..255 grid as 128, so the mid point comes back one level off.
    expect(back[0].map((p) => [Math.round(p.x * 255), Math.round(p.y * 255)])).toEqual([[0, 0], [128, 128], [255, 255]]);
  });

  it("refuses files that are not what they claim", () => {
    expect(decodeAlv(new Uint8Array([0, 9, 0, 0]))).toBeNull();
    expect(decodeAlv(new Uint8Array([0, 2, 0, 1]))).toBeNull(); // truncated
    expect(decodeAcv(new Uint8Array([0, 1, 0, 1]))).toBeNull();
    expect(decodeAcv(encodeAlv(fourDefault()))).toBeNull();
  });
});

describe("Curves point entry, pencil and clipping (#436)", () => {
  it("numeric Input / Output move the selected point, held between its neighbours", () => {
    const pts = setCurvePointValue(diagonal(), "mid", "y", 200);
    expect(pts.find((p) => p.id === "mid")?.y).toBeCloseTo(200 / 255);
    const pushed = setCurvePointValue(diagonal(), "mid", "x", 255);
    expect(pushed.find((p) => p.id === "mid")?.x).toBeCloseTo(1 - 1 / 255);
    expect(setCurvePointValue(diagonal(), "nope", "x", 3)).toEqual(diagonal());
  });

  it("pencil samples a stroke into one point per column, last pass winning", () => {
    const pts = pencilPoints([{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[0, 0], [0.5, 0.7], [1, 1]]);
    expect(pencilPoints([])).toEqual([]);
  });

  it("clipping marks pixels a curve pushes to 0 or 255", () => {
    const crushed = fourDiagonal();
    crushed[0] = [{ id: "lo", x: 0.2, y: 0 }, { id: "hi", x: 0.8, y: 1 }];
    const luts = buildCurveLuts(crushed);
    const rgba = new Uint8ClampedArray([10, 10, 10, 255, 250, 250, 250, 255, 128, 128, 128, 255, 10, 250, 128, 255]);
    expect(Array.from(clippingMask(rgba, luts))).toEqual([1, 2, 0, 3]);
  });
});
