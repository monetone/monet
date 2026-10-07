import { describe, expect, it } from "vitest";
import { followTargetId } from "./follow";

describe("followTargetId", () => {
  it("returns null when following is off", () => {
    expect(followTargetId(false, ["a"])).toBeNull();
    expect(followTargetId(false, [])).toBeNull();
  });

  it("returns null when following is on but nothing is selected", () => {
    expect(followTargetId(true, [])).toBeNull();
  });

  it("follows the only selected object", () => {
    expect(followTargetId(true, ["hero"])).toBe("hero");
  });

  it("follows the first object of a multi-selection", () => {
    expect(followTargetId(true, ["a", "b", "c"])).toBe("a");
  });
});
