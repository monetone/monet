// ─────────────────────────────────────────────────────────────
// io/svg-path-arc-flags.test — SVG arc flags are single characters
// ─────────────────────────────────────────────────────────────
// Per SVG 1.1/2 the large-arc-flag and sweep-flag of an elliptical arc are ONE
// character each and may abut the following coordinate with no separator:
//   "a25,25 -30 0130,50"  ⇒ large-arc=0, sweep=1, dx=30, dy=50
// A general number tokenizer reads "0130" as one number, swallows the next
// coordinate, and the arc lands on NaN. Real-world exporters emit this compact
// form, so an SVG import silently produces a broken path.

import { describe, it, expect } from "vitest";
import { parseSvgPathD } from "./svg-path";

const allFinite = (subs: ReturnType<typeof parseSvgPathD>) =>
  subs.every((s) => s.anchors.every((a) => Number.isFinite(a.point.x) && Number.isFinite(a.point.y)));
const last = (subs: ReturnType<typeof parseSvgPathD>) => {
  const anchors = subs[subs.length - 1].anchors;
  return anchors[anchors.length - 1].point;
};

describe("parseSvgPathD — elliptical arc flags", () => {
  it("parses the spaced form", () => {
    const subs = parseSvgPathD("M 0 0 A 25 25 -30 0 1 50 -25");
    expect(allFinite(subs)).toBe(true);
    expect(last(subs).x).toBeCloseTo(50, 4);
    expect(last(subs).y).toBeCloseTo(-25, 4);
  });

  it("parses the COMPACT form, where the flags abut the coordinate", () => {
    const subs = parseSvgPathD("M 0 0 A 25 25 -30 0150 -25");
    expect(allFinite(subs)).toBe(true);
    expect(last(subs).x).toBeCloseTo(50, 4);
    expect(last(subs).y).toBeCloseTo(-25, 4);
  });

  it("compact and spaced forms produce identical geometry", () => {
    const spaced = parseSvgPathD("M 0 0 A 25 25 -30 0 1 50 -25");
    const compact = parseSvgPathD("M 0 0 A 25 25 -30 0150 -25");
    expect(JSON.stringify(compact)).toBe(JSON.stringify(spaced));
  });

  it("handles a repeated arc parameter group without a new command letter", () => {
    const subs = parseSvgPathD("M 0 0 a 25 25 0 0130 0 25 25 0 0130 0");
    expect(allFinite(subs)).toBe(true);
    expect(last(subs).x).toBeCloseTo(60, 4);
  });

  it("still treats a leading 0/1 as a normal number outside arc flag slots", () => {
    const subs = parseSvgPathD("M 0 0 L 10 20");
    expect(last(subs)).toMatchObject({ x: 10, y: 20 });
  });
});
