// Unit tests for the pure color-space math (creative-color-graphics.tsx).
// Run from the repo root with:  node --test packages/monet-react/test/
// Node 24 strips the TS types; the module under test is imported with an
// explicit .tsx extension. Zero-dep tooling only (node:test + node:assert).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hsvToRgb,
  rgbToHsv,
  hsvToHex,
  hexToHsv,
  rgbToHex,
  hexToRgb,
  hsvToCss,
  toHsv,
  satValSquareBg,
  hueRainbowBg,
  gradientCss,
  sampleGradient,
} from "../src/creative-color-math.ts";

// ── helpers ─────────────────────────────────────────────────
const closeRgb = (a: any, b: any, tol = 1) => {
  assert.ok(Math.abs(a.r - b.r) <= tol, `r ${a.r} ≈ ${b.r}`);
  assert.ok(Math.abs(a.g - b.g) <= tol, `g ${a.g} ≈ ${b.g}`);
  assert.ok(Math.abs(a.b - b.b) <= tol, `b ${a.b} ≈ ${b.b}`);
};

// ─── hsvToRgb: known anchors ────────────────────────────────
test("hsvToRgb maps the primary/secondary anchors", () => {
  closeRgb(hsvToRgb({ h: 0, s: 1, v: 1 }), { r: 255, g: 0, b: 0 }); // red
  closeRgb(hsvToRgb({ h: 120, s: 1, v: 1 }), { r: 0, g: 255, b: 0 }); // green
  closeRgb(hsvToRgb({ h: 240, s: 1, v: 1 }), { r: 0, g: 0, b: 255 }); // blue
  closeRgb(hsvToRgb({ h: 60, s: 1, v: 1 }), { r: 255, g: 255, b: 0 }); // yellow
  closeRgb(hsvToRgb({ h: 180, s: 1, v: 1 }), { r: 0, g: 255, b: 255 }); // cyan
  closeRgb(hsvToRgb({ h: 300, s: 1, v: 1 }), { r: 255, g: 0, b: 255 }); // magenta
});

test("hsvToRgb maps white / black / mid-grey", () => {
  closeRgb(hsvToRgb({ h: 0, s: 0, v: 1 }), { r: 255, g: 255, b: 255 }); // white
  closeRgb(hsvToRgb({ h: 0, s: 0, v: 0 }), { r: 0, g: 0, b: 0 }); // black
  closeRgb(hsvToRgb({ h: 210, s: 0, v: 0.5 }), { r: 128, g: 128, b: 128 }); // grey (hue ignored at s=0)
});

test("hsvToRgb wraps the hue past 360 and clamps out-of-range s/v", () => {
  closeRgb(hsvToRgb({ h: 360, s: 1, v: 1 }), { r: 255, g: 0, b: 0 }); // 360 ≡ 0 → red
  closeRgb(hsvToRgb({ h: 480, s: 1, v: 1 }), { r: 0, g: 255, b: 0 }); // 480 ≡ 120 → green
  closeRgb(hsvToRgb({ h: 0, s: 2, v: 2 }), { r: 255, g: 0, b: 0 }); // clamped to s=1,v=1
});

test("hsvToRgb passes alpha through, clamped to 0..1", () => {
  assert.equal(hsvToRgb({ h: 0, s: 1, v: 1, a: 0.5 }).a, 0.5);
  assert.equal(hsvToRgb({ h: 0, s: 1, v: 1, a: 2 }).a, 1);
  assert.equal(hsvToRgb({ h: 0, s: 1, v: 1 }).a, undefined);
});

// ─── rgbToHsv: known anchors ────────────────────────────────
test("rgbToHsv recovers the primary anchors", () => {
  assert.deepEqual(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 255, b: 0 }), { h: 120, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 255 }), { h: 240, s: 1, v: 1 });
});

test("rgbToHsv reports s=0 for greys and v for white/black", () => {
  assert.deepEqual(rgbToHsv({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, v: 0 });
  const grey = rgbToHsv({ r: 128, g: 128, b: 128 });
  assert.equal(grey.h, 0);
  assert.equal(grey.s, 0);
  assert.ok(Math.abs(grey.v - 0.502) < 0.005);
});

// ─── HSV ↔ RGB round-trips ──────────────────────────────────
test("hsv → rgb → hsv round-trips chromatic colors", () => {
  const samples = [
    { h: 30, s: 1, v: 1 },
    { h: 200, s: 0.6, v: 0.8 },
    { h: 280, s: 0.4, v: 0.9 },
    { h: 95, s: 0.75, v: 0.55 },
  ];
  for (const hsv of samples) {
    const back = rgbToHsv(hsvToRgb(hsv));
    assert.ok(Math.abs(back.h - hsv.h) < 1.5, `h ${back.h} ≈ ${hsv.h}`);
    assert.ok(Math.abs(back.s - hsv.s) < 0.02, `s ${back.s} ≈ ${hsv.s}`);
    assert.ok(Math.abs(back.v - hsv.v) < 0.02, `v ${back.v} ≈ ${hsv.v}`);
  }
});

// ─── hex parsing + formatting ───────────────────────────────
test("rgbToHex formats 6-digit hex and 8-digit with alpha < 1", () => {
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0 }), "#ff0000");
  assert.equal(rgbToHex({ r: 0, g: 128, b: 255 }), "#0080ff");
  assert.equal(rgbToHex({ r: 255, g: 255, b: 255, a: 1 }), "#ffffff"); // a=1 dropped
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0, a: 0.5 }), "#00000080"); // 0.5*255≈128=0x80
});

test("hexToRgb parses #rgb, #rrggbb, #rrggbbaa and bare (no #) forms", () => {
  closeRgb(hexToRgb("#f00")!, { r: 255, g: 0, b: 0 });
  closeRgb(hexToRgb("#ff0000")!, { r: 255, g: 0, b: 0 });
  closeRgb(hexToRgb("0080ff")!, { r: 0, g: 128, b: 255 });
  const withA = hexToRgb("#00000080")!;
  closeRgb(withA, { r: 0, g: 0, b: 0 });
  assert.ok(Math.abs(withA.a! - 0.502) < 0.005);
  const short4 = hexToRgb("#f00f")!; // #rgba
  closeRgb(short4, { r: 255, g: 0, b: 0 });
  assert.equal(short4.a, 1);
});

test("hexToRgb returns null on unparseable input", () => {
  assert.equal(hexToRgb("#xyz"), null);
  assert.equal(hexToRgb("#12"), null);
  assert.equal(hexToRgb("nope"), null);
  assert.equal(hexToRgb("#12345"), null); // 5 digits = invalid length
});

test("hsvToHex drops alpha (always 6 digits) and hits known anchors", () => {
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), "#00ff00");
  assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), "#0000ff");
  assert.equal(hsvToHex({ h: 0, s: 0, v: 1 }), "#ffffff");
  assert.equal(hsvToHex({ h: 0, s: 0, v: 0 }), "#000000");
  assert.equal(hsvToHex({ h: 210, s: 0.5, v: 0.8, a: 0.3 }), hsvToHex({ h: 210, s: 0.5, v: 0.8 }));
});

test("hexToHsv parses to canonical HSV and round-trips through hex", () => {
  assert.deepEqual(hexToHsv("#ff0000"), { h: 0, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#00ff00"), { h: 120, s: 1, v: 1 });
  assert.equal(hexToHsv("#zzz"), null);
  // hex → hsv → hex is stable for a chromatic color
  const hex = "#3d8fc4";
  assert.equal(hsvToHex(hexToHsv(hex)!), hex);
});

test("hexToHsv carries alpha onto the result", () => {
  const hsv = hexToHsv("#ff000080")!;
  assert.equal(hsv.h, 0);
  assert.equal(hsv.s, 1);
  assert.equal(hsv.v, 1);
  assert.ok(Math.abs(hsv.a! - 0.502) < 0.005);
});

// ─── toHsv normalization ────────────────────────────────────
test("toHsv passes HSV through and parses hex strings (with a fallback)", () => {
  assert.deepEqual(toHsv({ h: 10, s: 0.5, v: 0.5 }), { h: 10, s: 0.5, v: 0.5 });
  assert.deepEqual(toHsv("#ff0000"), { h: 0, s: 1, v: 1 });
  // unparseable → fallback (default black)
  assert.deepEqual(toHsv("nope"), { h: 0, s: 0, v: 0 });
  assert.deepEqual(toHsv("nope", { h: 1, s: 1, v: 1 }), { h: 1, s: 1, v: 1 });
});

// ─── CSS paint strings ──────────────────────────────────────
test("hsvToCss emits rgb() at full alpha and rgba() below it", () => {
  assert.equal(hsvToCss({ h: 0, s: 1, v: 1 }), "rgb(255, 0, 0)");
  assert.equal(hsvToCss({ h: 0, s: 1, v: 1, a: 1 }), "rgb(255, 0, 0)");
  assert.equal(hsvToCss({ h: 0, s: 1, v: 1, a: 0.5 }), "rgba(255, 0, 0, 0.5)");
});

test("satValSquareBg + hueRainbowBg build gradient strings keyed by hue/axis", () => {
  const sq = satValSquareBg(120);
  assert.match(sq, /linear-gradient\(to top, #000, transparent\)/);
  assert.match(sq, /rgb\(0, 255, 0\)/); // the pure hue at the right edge
  assert.match(hueRainbowBg(true), /^linear-gradient\(to right,/);
  assert.match(hueRainbowBg(false), /^linear-gradient\(to top,/);
});

test("gradientCss sorts stops and honors type + angle", () => {
  const stops = [
    { offset: 1, color: "#ffffff" },
    { offset: 0, color: "#000000" },
  ];
  const lin = gradientCss(stops, "linear", 45);
  assert.match(lin, /^linear-gradient\(45deg,/);
  // sorted: black (0%) before white (100%)
  assert.ok(lin.indexOf("rgb(0, 0, 0) 0%") < lin.indexOf("rgb(255, 255, 255) 100%"));
  const rad = gradientCss(stops, "radial");
  assert.match(rad, /^radial-gradient\(circle at center,/);
  // a single stop is duplicated so the gradient is valid
  assert.match(gradientCss([{ offset: 0.5, color: "#ff0000" }]), /rgb\(255, 0, 0\) 50%.*rgb\(255, 0, 0\) 50%/);
  assert.equal(gradientCss([]), "transparent");
});

// ─── sampleGradient interpolation ───────────────────────────
test("sampleGradient interpolates RGBA between bracketing stops", () => {
  const stops = [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ];
  // midpoint of black→white is mid-grey
  const mid = hsvToRgb(sampleGradient(stops, 0.5));
  closeRgb(mid, { r: 128, g: 128, b: 128 }, 2);
  // clamps to the ends outside the range
  closeRgb(hsvToRgb(sampleGradient(stops, -1)), { r: 0, g: 0, b: 0 });
  closeRgb(hsvToRgb(sampleGradient(stops, 2)), { r: 255, g: 255, b: 255 });
});

test("sampleGradient picks the correct segment with 3+ stops", () => {
  const stops = [
    { offset: 0, color: "#ff0000" }, // red
    { offset: 0.5, color: "#00ff00" }, // green
    { offset: 1, color: "#0000ff" }, // blue
  ];
  // exactly on the middle stop → green
  closeRgb(hsvToRgb(sampleGradient(stops, 0.5)), { r: 0, g: 255, b: 0 }, 1);
  // 0.25 is halfway red→green
  const q = hsvToRgb(sampleGradient(stops, 0.25));
  closeRgb(q, { r: 128, g: 128, b: 0 }, 2);
  // empty list → black, no throw
  assert.deepEqual(sampleGradient([], 0.5), { h: 0, s: 0, v: 0 });
});
