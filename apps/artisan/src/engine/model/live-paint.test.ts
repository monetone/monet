// ─────────────────────────────────────────────────────────────
// model/live-paint.test — baseline Live Paint group metadata
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  makeGroup,
  makeLivePaintObject,
  makeRect,
  defaultStroke,
  noPaint,
  normalizeLivePaintObject,
  rgba,
  solid,
} from "../index";

describe("live paint model", () => {
  it("creates face and edge records for direct child artwork", () => {
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    const b = makeRect(40, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
    const group = makeGroup([a, b], { name: "Live Paint Group" });

    const livePaint = makeLivePaintObject(group, {
      gapDetection: "small",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(livePaint).toMatchObject({
      id: group.id,
      gapDetection: "small",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    expect(livePaint.faces.map((face) => face.itemId)).toEqual([a.id, b.id]);
    expect(livePaint.edges.map((edge) => edge.itemId)).toEqual([a.id, b.id]);
  });

  it("normalizes records after child artwork changes", () => {
    const a = makeRect(0, 0, 40, 40);
    const b = makeRect(40, 0, 40, 40);
    const group = makeGroup([a], { name: "Live Paint Group" });
    group.livePaint = makeLivePaintObject(group);
    group.children.push(b);

    const normalized = normalizeLivePaintObject(group);

    expect(normalized.id).toBe(group.id);
    expect(normalized.faces.map((face) => face.itemId)).toEqual([a.id, b.id]);
    expect(normalized.edges.map((edge) => edge.itemId)).toEqual([a.id, b.id]);
  });

  it("captures face and edge paint from the visible appearance", () => {
    const red = solid(rgba(220, 0, 0));
    const blue = solid(rgba(0, 0, 220));
    const child = makeRect(0, 0, 40, 40, 0, 0, { fill: red, stroke: defaultStroke(noPaint()) });
    child.appearance = { entries: [
      { id: "hidden-fill", kind: "fill", paint: red, visible: false },
      { id: "visible-fill", kind: "fill", paint: blue },
      { id: "visible-stroke", kind: "stroke", stroke: { ...defaultStroke(red), width: 8 } },
    ] };

    const livePaint = makeLivePaintObject(makeGroup([child]));

    expect(livePaint.faces[0].fill).toEqual(blue);
    expect(livePaint.edges[0].stroke).toMatchObject({ paint: red, width: 8 });
  });
});
