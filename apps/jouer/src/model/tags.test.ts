import { describe, expect, it } from "vitest";
import { DEFAULT_TAG, projectTags, tagOf } from "./tags";

describe("projectTags", () => {
  it("defaults to a single Untagged when missing or empty", () => {
    expect(projectTags({})).toEqual(["Untagged"]);
    expect(projectTags({ tags: [] })).toEqual(["Untagged"]);
  });

  it("keeps the configured tags and guarantees Untagged is present", () => {
    expect(projectTags({ tags: ["Untagged", "Player"] })).toEqual(["Untagged", "Player"]);
    expect(projectTags({ tags: ["Player", "Enemy"] })).toEqual(["Untagged", "Player", "Enemy"]);
  });
});

describe("tagOf", () => {
  it("returns the object's tag", () => {
    expect(tagOf({ tag: "Enemy" })).toBe("Enemy");
  });

  it("defaults to Untagged when unset", () => {
    expect(tagOf({})).toBe(DEFAULT_TAG);
    expect(tagOf({ tag: undefined })).toBe("Untagged");
  });
});
