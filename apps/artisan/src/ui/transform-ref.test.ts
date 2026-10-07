// ─────────────────────────────────────────────────────────────
// ui/transform-ref.test — the 9-point reference proxy geometry
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { refAnchor, REF_POINTS, type RefPoint } from "./transform-ref";

const b = { x: 10, y: 20, width: 100, height: 40 };

describe("ui.transform-ref.refAnchor", () => {
  it("maps each of the 9 reference points to the right bounds corner/edge/centre", () => {
    const expected: Record<RefPoint, { x: number; y: number }> = {
      tl: { x: 10, y: 20 }, tc: { x: 60, y: 20 }, tr: { x: 110, y: 20 },
      ml: { x: 10, y: 40 }, mc: { x: 60, y: 40 }, mr: { x: 110, y: 40 },
      bl: { x: 10, y: 60 }, bc: { x: 60, y: 60 }, br: { x: 110, y: 60 },
    };
    for (const rp of REF_POINTS) expect(refAnchor(b, rp)).toEqual(expected[rp]);
  });

  it("lists all nine points once, row-major", () => {
    expect(REF_POINTS).toEqual(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]);
    expect(new Set(REF_POINTS).size).toBe(9);
  });
});
