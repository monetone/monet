// model/dimensions.test - live dimension group construction

import { describe, expect, it } from "vitest";
import {
  buildDimensionChildren,
  dimensionLabel,
  makeDimensionGroup,
  makeDimensionObject,
  type TextItem,
} from "../index";

describe("dimension model", () => {
  it("normalizes distance, angle, and generated labels", () => {
    const dimension = makeDimensionObject({ x: 0, y: 0 }, { x: 30, y: 40 }, { units: "pt", precision: 2 });

    expect(dimension).toMatchObject({
      kind: "linear",
      length: 50,
      units: "pt",
      precision: 2,
    });
    expect(dimension.angle).toBeCloseTo(Math.atan2(40, 30));
    expect(dimensionLabel(dimension)).toBe("50 pt");
  });

  it("builds visible line, tick, and text artwork for a dimension group", () => {
    const group = makeDimensionGroup({ x: 10, y: 20 }, { x: 70, y: 20 }, { units: "px", precision: 1 });

    expect(group.dimension).toMatchObject({ id: group.id, length: 60 });
    expect(group.children.map((item) => item.name)).toEqual([
      "Dimension Line",
      "Dimension Start Tick",
      "Dimension End Tick",
      "Dimension Label",
    ]);
    expect(group.children.some((item) => item.type === "text" && item.text === "60 px")).toBe(true);
  });

  it("honors custom labels without losing geometry children", () => {
    const dimension = makeDimensionObject({ x: 0, y: 0 }, { x: 10, y: 0 }, { label: "width A" });
    const label = buildDimensionChildren(dimension).find((item): item is TextItem => item.type === "text");

    expect(label?.text).toBe("width A");
  });
});
