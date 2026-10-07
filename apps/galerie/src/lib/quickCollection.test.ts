// quickCollection spec — the pure decisions behind Quick / Target Collection.

import { describe, expect, it } from "vitest";

import type { CollectionRow } from "../catalog/types";
import {
  QUICK_COLLECTION_NAME,
  findQuickCollection,
  membershipToggle,
  resolveTargetId,
} from "./quickCollection";

const col = (id: number, name: string, kind = "collection"): CollectionRow => ({
  id,
  name,
  kind,
  parentId: null,
  ruleAst: null,
  sortOrder: 0,
  createdAt: 0,
});

describe("findQuickCollection", () => {
  it("matches the reserved name with kind 'collection'", () => {
    const cols = [col(1, "Trip"), col(2, QUICK_COLLECTION_NAME), col(3, "Portfolio")];
    expect(findQuickCollection(cols)?.id).toBe(2);
  });
  it("ignores same-named smart collections / sets", () => {
    const cols = [col(1, QUICK_COLLECTION_NAME, "smart"), col(2, QUICK_COLLECTION_NAME, "set")];
    expect(findQuickCollection(cols)).toBeUndefined();
  });
  it("is undefined when absent", () => {
    expect(findQuickCollection([col(1, "Trip")])).toBeUndefined();
  });
});

describe("resolveTargetId", () => {
  const cols = [col(1, "Trip"), col(9, QUICK_COLLECTION_NAME)];
  it("uses the explicit target when it still exists", () => {
    expect(resolveTargetId(cols, 1, 9)).toBe(1);
  });
  it("falls back to the Quick Collection when the target was deleted", () => {
    expect(resolveTargetId(cols, 42, 9)).toBe(9);
  });
  it("falls back to Quick when no explicit target is set", () => {
    expect(resolveTargetId(cols, null, 9)).toBe(9);
  });
  it("is null when neither a valid target nor a Quick Collection exists", () => {
    expect(resolveTargetId(cols, null, null)).toBeNull();
  });
});

describe("membershipToggle", () => {
  it("adds all when none are members", () => {
    expect(membershipToggle([], [1, 2, 3])).toEqual({ action: "add", ids: [1, 2, 3] });
  });
  it("adds only the missing ones when partially member", () => {
    expect(membershipToggle([2], [1, 2, 3])).toEqual({ action: "add", ids: [1, 3] });
  });
  it("removes all when every selected photo is already a member", () => {
    expect(membershipToggle([1, 2, 3, 9], [1, 2, 3])).toEqual({ action: "remove", ids: [1, 2, 3] });
  });
  it("dedups the selection", () => {
    expect(membershipToggle([], [1, 1, 2])).toEqual({ action: "add", ids: [1, 2] });
  });
  it("no-ops on an empty selection", () => {
    expect(membershipToggle([1, 2], [])).toEqual({ action: "add", ids: [] });
  });
});
