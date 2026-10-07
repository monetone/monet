// ─────────────────────────────────────────────────────────────
// model/mesh.test — live gradient mesh metadata and generated patch artwork
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  buildMeshChildren,
  makeGradientMeshGroupFromItem,
  makeGradientMeshObject,
  meshBaseColor,
  makeRect,
  rgba,
  solid,
  type PathItem,
} from "../index";

describe("mesh model", () => {
  it("stores mesh points on generated groups instead of only baking patch paths", () => {
    const rect = makeRect(0, 0, 100, 60, 0, 0, {
      fill: solid(rgba(120, 80, 200)),
    });

    const group = makeGradientMeshGroupFromItem(rect);

    expect(group.name).toBe("Gradient Mesh");
    expect(group.mesh).toMatchObject({
      id: group.id,
      rows: 5,
      columns: 5,
      bounds: { x: 0, y: 0, width: 100, height: 60 },
    });
    expect(group.mesh?.points).toHaveLength(36);
    expect(group.children).toHaveLength(25);
    expect(group.children.every((child): child is PathItem => child.type === "path")).toBe(true);
  });

  it("keeps regenerated mesh anchors finite for small or malformed dimensions", () => {
    const mesh = makeGradientMeshObject(
      { x: 10, y: 20, width: 0, height: Number.NaN },
      { rows: 2, columns: 3 },
    );
    const children = buildMeshChildren(mesh);

    expect(mesh.bounds).toMatchObject({ x: 10, y: 20, width: 1, height: 1 });
    expect(children).toHaveLength(6);
    expect(children.every((child) =>
      child.geometry.anchors.every((anchor) =>
        Number.isFinite(anchor.point.x) && Number.isFinite(anchor.point.y),
      ),
    )).toBe(true);
  });

  it("seeds mesh colors from the top visible appearance fill", () => {
    const redColor = rgba(220, 0, 0);
    const blueColor = rgba(0, 0, 220);
    const red = solid(redColor);
    const blue = solid(blueColor);
    const rect = makeRect(0, 0, 100, 60, 0, 0, { fill: red });
    rect.appearance = { entries: [
      { id: "hidden", kind: "fill", paint: red, visible: false },
      { id: "visible", kind: "fill", paint: blue },
    ] };

    const group = makeGradientMeshGroupFromItem(rect);

    expect(meshBaseColor(rect)).toEqual(blueColor);
    expect(group.mesh!.points.find((point) => point.row === 0 && point.column === 5)!.color).toEqual(blueColor);
  });
});
