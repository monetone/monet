// Unit tests for the pure timecode math (creative-time.ts).
// Run from the repo root with:  node --test packages/monet-react/test/
// Node 24 strips the TS types; the module under test is imported with an
// explicit .ts extension. Zero-dep tooling only (node:test + node:assert).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatTimecode,
  parseTimecode,
  frameDuration,
  snapToFrame,
} from "../src/creative-time.ts";

// ─── formatTimecode: smpte anchors ──────────────────────────
test("formatTimecode renders HH:MM:SS:FF anchors at 24fps", () => {
  assert.equal(formatTimecode(0), "00:00:00:00");
  assert.equal(formatTimecode(1), "00:00:01:00");
  assert.equal(formatTimecode(61), "00:01:01:00");
  assert.equal(formatTimecode(3661), "01:01:01:00");
  // 0.5s at 24fps → frame 12
  assert.equal(formatTimecode(0.5), "00:00:00:12");
  // a single frame
  assert.equal(formatTimecode(1 / 24), "00:00:00:01");
});

test("formatTimecode honors a custom fps and carries a rounded-up frame", () => {
  assert.equal(formatTimecode(0.5, { fps: 30 }), "00:00:00:15");
  assert.equal(formatTimecode(1 / 30, { fps: 30 }), "00:00:00:01");
  // 0.999s at 24fps rounds to 24 frames → carries into the next whole second
  assert.equal(formatTimecode(0.999, { fps: 24 }), "00:00:01:00");
});

test("formatTimecode clamps negative input to zero", () => {
  assert.equal(formatTimecode(-5), "00:00:00:00");
  assert.equal(formatTimecode(-0.5, { format: "ms" }), "00:00:00.000");
});

// ─── formatTimecode: ms anchors ─────────────────────────────
test("formatTimecode renders HH:MM:SS.mmm in ms format", () => {
  assert.equal(formatTimecode(0, { format: "ms" }), "00:00:00.000");
  assert.equal(formatTimecode(1.5, { format: "ms" }), "00:00:01.500");
  assert.equal(formatTimecode(0.05, { format: "ms" }), "00:00:00.050");
  assert.equal(formatTimecode(3661.25, { format: "ms" }), "01:01:01.250");
  // a 999.6ms remainder rounds to 1000 → carries into the next second
  assert.equal(formatTimecode(0.9996, { format: "ms" }), "00:00:01.000");
});

// ─── parseTimecode: smpte ───────────────────────────────────
test("parseTimecode reads HH:MM:SS:FF back to seconds", () => {
  assert.equal(parseTimecode("00:00:00:00"), 0);
  assert.equal(parseTimecode("00:00:01:00"), 1);
  assert.equal(parseTimecode("00:01:01:00"), 61);
  assert.equal(parseTimecode("01:01:01:00"), 3661);
  assert.ok(Math.abs(parseTimecode("00:00:00:12") - 0.5) < 1e-9);
  assert.ok(Math.abs(parseTimecode("00:00:00:01") - 1 / 24) < 1e-9);
});

test("parseTimecode is lenient about omitted leading fields", () => {
  // SS:FF and MM:SS:FF both resolve (the last group is always frames)
  assert.ok(Math.abs(parseTimecode("01:12") - (1 + 0.5)) < 1e-9);
  assert.equal(parseTimecode("01:30:00", { fps: 30 }), 90); // MM:SS:FF → 1m30s, 0 frames
  // a lone frame group
  assert.ok(Math.abs(parseTimecode("12") - 0.5) < 1e-9);
});

test("parseTimecode honors fps for the frame field", () => {
  assert.ok(Math.abs(parseTimecode("00:00:01:15", { fps: 30 }) - 1.5) < 1e-9);
  assert.ok(Math.abs(parseTimecode("00:00:00:15", { fps: 30 }) - 0.5) < 1e-9);
});

test("parseTimecode returns NaN on garbage / out-of-shape input", () => {
  assert.ok(Number.isNaN(parseTimecode("")));
  assert.ok(Number.isNaN(parseTimecode("abc")));
  assert.ok(Number.isNaN(parseTimecode("1:2:3:4:5"))); // too many fields
  assert.ok(Number.isNaN(parseTimecode("00:00:0a:00"))); // non-numeric field
});

// ─── parseTimecode: ms ──────────────────────────────────────
test("parseTimecode reads HH:MM:SS.mmm back to seconds", () => {
  assert.equal(parseTimecode("00:00:00.000", { format: "ms" }), 0);
  assert.ok(Math.abs(parseTimecode("00:00:01.500", { format: "ms" }) - 1.5) < 1e-9);
  assert.ok(Math.abs(parseTimecode("00:00:00.050", { format: "ms" }) - 0.05) < 1e-9);
  assert.ok(Math.abs(parseTimecode("01:01:01.250", { format: "ms" }) - 3661.25) < 1e-9);
  // a comma decimal + omitted leading fields
  assert.ok(Math.abs(parseTimecode("1.5", { format: "ms" }) - 1.5) < 1e-9);
  assert.ok(Math.abs(parseTimecode("01:01,5", { format: "ms" }) - 61.5) < 1e-9);
});

test("parseTimecode (ms) returns NaN on garbage", () => {
  assert.ok(Number.isNaN(parseTimecode("", { format: "ms" })));
  assert.ok(Number.isNaN(parseTimecode("nope", { format: "ms" })));
  assert.ok(Number.isNaN(parseTimecode("1:2:3:4.5", { format: "ms" }))); // too many groups
});

// ─── round-trips (format → parse → same seconds) ────────────
test("smpte format → parse round-trips at frame resolution", () => {
  const fps = 24;
  for (const s of [0, 0.5, 1, 1 / 24, 12.75, 61.125, 3661.5]) {
    const snapped = snapToFrame(s, fps); // formatter quantizes to frames
    const back = parseTimecode(formatTimecode(snapped, { fps }), { fps });
    assert.ok(Math.abs(back - snapped) < 1e-6, `${s} → ${back} ≈ ${snapped}`);
  }
});

test("ms format → parse round-trips at millisecond resolution", () => {
  for (const s of [0, 0.5, 1.234, 61.05, 3661.999]) {
    const ms = Math.round(s * 1000) / 1000; // formatter quantizes to ms
    const back = parseTimecode(formatTimecode(ms, { format: "ms" }), { format: "ms" });
    assert.ok(Math.abs(back - ms) < 1e-6, `${s} → ${back} ≈ ${ms}`);
  }
});

test("smpte round-trip holds across non-default fps", () => {
  const fps = 30;
  for (const s of [0.5, 2.4, 90.7, 600.1]) {
    const snapped = snapToFrame(s, fps);
    const back = parseTimecode(formatTimecode(snapped, { fps }), { fps });
    assert.ok(Math.abs(back - snapped) < 1e-6, `${s} → ${back} ≈ ${snapped}`);
  }
});

// ─── frame helpers ──────────────────────────────────────────
test("frameDuration is 1/fps and defaults to 24", () => {
  assert.ok(Math.abs(frameDuration(24) - 1 / 24) < 1e-12);
  assert.ok(Math.abs(frameDuration(30) - 1 / 30) < 1e-12);
  assert.ok(Math.abs(frameDuration(undefined) - 1 / 24) < 1e-12);
  // a non-positive fps falls back to 24
  assert.ok(Math.abs(frameDuration(0) - 1 / 24) < 1e-12);
});

// (#205) Fractional NTSC rates ROUND to their SMPTE frame count (29.97 → 30
// slots per timecode-second), matching @monet-ui/monet-timeline's
// framesToTimecode. Flooring gave 29 slots and disagreed with the model layer.
test("fractional NTSC rates round to the SMPTE frame count", () => {
  assert.equal(formatTimecode(0.9, { fps: 29.97 }), "00:00:00:27"); // floor gave :26
  assert.equal(formatTimecode(0.9, { fps: 23.976 }), "00:00:00:22"); // floor gave :21
  assert.equal(formatTimecode(0.99, { fps: 59.94 }), "00:00:00:59"); // floor gave :58
  assert.ok(Math.abs(frameDuration(29.97) - 1 / 30) < 1e-12);
  assert.ok(Math.abs(frameDuration(59.94) - 1 / 60) < 1e-12);
  assert.ok(Math.abs(snapToFrame(0.05, 29.97) - 2 / 30) < 1e-9);
  // still defaults to 24 when the rate rounds below one frame
  assert.ok(Math.abs(frameDuration(0.4) - 1 / 24) < 1e-12);
});

test("snapToFrame quantizes seconds to the nearest whole frame", () => {
  assert.ok(Math.abs(snapToFrame(0.51, 24) - 12 / 24) < 1e-9); // ≈ 0.5
  assert.equal(snapToFrame(1, 24), 1);
  assert.ok(Math.abs(snapToFrame(0.04, 30) - 1 / 30) < 1e-9); // ≈ 0.0333
});
