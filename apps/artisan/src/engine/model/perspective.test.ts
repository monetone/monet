// ─────────────────────────────────────────────────────────────
// model/perspective.test — baseline Perspective metadata
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSPECTIVE_CORNERS,
  makeGroup,
  makePerspectiveObject,
  makeRect,
  normalizePerspectiveObject,
  perspectiveCornersForHorizontalAmount,
} from "../index";

describe("perspective model", () => {
  it("stores a source snapshot and normalized corners on a group", () => {
    const rect = makeRect(0, 0, 100, 80);
    const group = makeGroup([rect], { name: "Perspective Group" });

    const perspective = makePerspectiveObject(group, {
      corners: DEFAULT_PERSPECTIVE_CORNERS,
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    expect(perspective).toMatchObject({
      id: group.id,
      plane: "one-point",
      corners: DEFAULT_PERSPECTIVE_CORNERS,
      sourceIds: [rect.id],
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(perspective.sourceItems).toHaveLength(1);
    expect(perspective.sourceItems[0]).not.toBe(rect);
  });

  it("normalizes malformed corner values and derives drag corners", () => {
    const rect = makeRect(0, 0, 100, 80);
    const group = makeGroup([rect]);
    group.perspective = makePerspectiveObject(group, {
      corners: {
        topLeft: { x: Number.NaN, y: 0 },
        topRight: { x: 0.75, y: Number.POSITIVE_INFINITY },
        bottomRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 1 },
      },
    });

    expect(normalizePerspectiveObject(group).corners).toMatchObject({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.75, y: 0 },
    });
    expect(perspectiveCornersForHorizontalAmount(0.4)).toEqual(DEFAULT_PERSPECTIVE_CORNERS);
  });
});
