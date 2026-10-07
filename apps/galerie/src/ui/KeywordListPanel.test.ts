// keywordTree spec — the Keyword List panel's vocabulary flattening: depth-first
// nesting, name order preserved within siblings, orphans surfaced as roots —
// plus filterKeywords, the panel's filter box (matches keep their ancestors).

import { describe, expect, it } from "vitest";

import { filterKeywords, keywordTree, type KwRow } from "./KeywordListPanel";

const row = (id: number, name: string, parentId: number | null = null): KwRow => ({
  id,
  name,
  count: 0,
  parentId,
  synonyms: "",
  includeOnExport: true,
  exportContaining: true,
  exportSynonyms: true,
});

describe("keywordTree", () => {
  it("nests children under parents depth-first, keeping sibling order", () => {
    // Incoming rows are name-sorted, exactly as catalog_list_keywords returns.
    const rows = [row(1, "animal"), row(3, "cat", 1), row(2, "dog", 1), row(4, "sunset")];
    expect(keywordTree(rows).map((n) => [n.row.name, n.depth])).toEqual([
      ["animal", 0],
      ["cat", 1],
      ["dog", 1],
      ["sunset", 0],
    ]);
  });

  it("renders a row with a missing parent as a root instead of dropping it", () => {
    const rows = [row(2, "dog", 99)];
    expect(keywordTree(rows).map((n) => [n.row.name, n.depth])).toEqual([["dog", 0]]);
  });

  it("terminates on a corrupt parent cycle without losing rows", () => {
    const a = row(1, "a", 2);
    const b = row(2, "b", 1);
    const out = keywordTree([a, b]);
    expect(out.map((n) => n.row.name).sort()).toEqual(["a", "b"]);
  });

  it("handles an empty vocabulary", () => {
    expect(keywordTree([])).toEqual([]);
  });
});

describe("filterKeywords", () => {
  const rows = [
    row(1, "animal"),
    row(3, "cat", 1),
    { ...row(2, "dog", 1), synonyms: "puppy, hound" },
    row(4, "sunset"),
  ];

  it("returns everything for a blank query", () => {
    expect(filterKeywords(rows, "  ")).toEqual(rows);
  });

  it("matches case-insensitively and keeps ancestors of a matched child", () => {
    expect(filterKeywords(rows, "CAT").map((r) => r.name)).toEqual(["animal", "cat"]);
  });

  it("matches on synonyms", () => {
    expect(filterKeywords(rows, "puppy").map((r) => r.name)).toEqual(["animal", "dog"]);
  });

  it("drops non-matching siblings and roots", () => {
    expect(filterKeywords(rows, "sun").map((r) => r.name)).toEqual(["sunset"]);
  });

  it("terminates on a corrupt parent cycle", () => {
    const a = { ...row(1, "a", 2) };
    const b = { ...row(2, "b", 1) };
    expect(
      filterKeywords([a, b], "a")
        .map((r) => r.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});
