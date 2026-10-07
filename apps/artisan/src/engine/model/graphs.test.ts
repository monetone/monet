// ─────────────────────────────────────────────────────────────
// model/graphs.test — data-backed graph artwork generation
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  buildGraphChildren,
  formatGraphDataText,
  makeGraphGroup,
  makeGraphObject,
  parseGraphDataText,
  type GroupItem,
  type PathItem,
  type RectItem,
} from "../index";

const rectChildren = (group: GroupItem): RectItem[] =>
  group.children.filter((child): child is RectItem => child.type === "rect");

const pathChildren = (group: GroupItem): PathItem[] =>
  group.children.filter((child): child is PathItem => child.type === "path");

describe("graph model", () => {
  it("stores graph data on generated column groups instead of hard-coding six bars", () => {
    const group = makeGraphGroup("column", { x: 10, y: 20 }, { x: 130, y: 100 }, {
      data: [
        { label: "North", value: 10 },
        { label: "South", value: 5 },
        { label: "West", value: 1 },
      ],
    });

    expect(group.name).toBe("Column Graph");
    expect(group.graph).toMatchObject({ id: group.id, kind: "column", width: 120, height: 80 });
    expect(group.graph?.data.map((datum) => datum.label)).toEqual(["North", "South", "West"]);
    expect(group.transform).toMatchObject({ e: 10, f: 20 });
    expect(rectChildren(group)).toHaveLength(3);
  });

  it("builds one pie wedge per datum and stores radial bounds on the parent", () => {
    const group = makeGraphGroup("pie", { x: 50, y: 50 }, { x: 90, y: 50 }, {
      data: [
        { label: "A", value: 2 },
        { label: "B", value: 3 },
      ],
    });

    expect(group.graph).toMatchObject({ kind: "pie", width: 80, height: 80, showAxes: false });
    expect(group.transform).toMatchObject({ e: 10, f: 10 });
    expect(pathChildren(group)).toHaveLength(2);
  });

  it("keeps single-point line graphs finite", () => {
    const graph = makeGraphObject("line", 120, 80, { data: [{ label: "Only", value: 42 }] });
    const children = buildGraphChildren(graph);
    const line = children.find((child): child is PathItem => child.type === "path" && !child.geometry.closed);

    expect(line).toBeTruthy();
    expect(line!.geometry.anchors.every((anchor) => Number.isFinite(anchor.point.x) && Number.isFinite(anchor.point.y))).toBe(true);
  });

  it("parses and formats editable graph data rows", () => {
    const parsed = parseGraphDataText(["Label,Value,X", "North,12,1", "South,8", "Bad,nope", "Loss,-2", "42"].join("\n"));

    expect(parsed.errors).toEqual(["Line 4: value is not a number", "Line 5: negative values are not supported"]);
    expect(parsed.data).toEqual([
      { label: "North", value: 12, x: 1 },
      { label: "South", value: 8 },
      { label: "Row 3", value: 42 },
    ]);
    expect(formatGraphDataText(parsed.data)).toBe(["Label,Value,X", "North,12,1", "South,8,", "Row 3,42,"].join("\n"));
  });

  it("normalizes graph geometry by the dataset maximum at every magnitude", () => {
    const heights = (values: number[]) => buildGraphChildren(makeGraphObject("column", 100, 100, {
      data: values.map((value, i) => ({ label: String(i), value })),
      showAxes: false,
    })).filter((child): child is RectItem => child.type === "rect").map((bar) => bar.height);
    expect(heights([2, 4, 8])).toEqual([25, 50, 100]);
    expect(heights([0.2, 0.4, 0.8])).toEqual([25, 50, 100]);
  });
});
