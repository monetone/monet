import { describe, expect, it } from "vitest";
import { getTool } from "./registry";
import { shouldDispatchPointerMove } from "./types";

describe("tool pointer dispatch", () => {
  it("sends hover only to tools that explicitly use it", () => {
    expect(shouldDispatchPointerMove(getTool("rect"), 0)).toBe(false);
    expect(shouldDispatchPointerMove(getTool("rect"), 1)).toBe(true);
    for (const id of ["selection", "group-selection", "pen", "curvature"])
      expect(shouldDispatchPointerMove(getTool(id), 0), id).toBe(true);
  });
});
