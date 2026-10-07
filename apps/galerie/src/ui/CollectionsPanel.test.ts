import { describe, expect, it } from "vitest";

import type { CollectionRow, SmartRule } from "../catalog/types";
import { collectionTree, isGroup, parseSmartRule } from "./CollectionsPanel";

const row = (
  id: number,
  name: string,
  kind: CollectionRow["kind"] = "collection",
  parentId: number | null = null,
): CollectionRow => ({
  id,
  name,
  kind,
  parentId,
  ruleAst: null,
  sortOrder: 0,
  createdAt: id,
});

describe("collectionTree", () => {
  it("flattens nested sets and fully hides a collapsed subtree", () => {
    const rows = [
      row(4, "Loose"),
      row(3, "Shoot", "collection", 2),
      row(2, "Clients", "set", 1),
      row(1, "Portfolio", "set"),
    ];
    expect(collectionTree(rows).map(({ row: item, depth }) => [item.name, depth])).toEqual([
      ["Loose", 0],
      ["Portfolio", 0],
      ["Clients", 1],
      ["Shoot", 2],
    ]);
    expect(collectionTree(rows, new Set([1])).map(({ row: item }) => item.name)).toEqual([
      "Loose",
      "Portfolio",
    ]);
  });

  it("keeps malformed orphan/cycle nodes visible once", () => {
    const orphan = row(1, "Orphan", "collection", 99);
    const a = row(2, "A", "set", 3);
    const b = row(3, "B", "set", 2);
    expect(collectionTree([orphan, a, b]).map(({ row: item }) => item.id).sort()).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("parseSmartRule", () => {
  it("accepts nested groups and defaults the match mode", () => {
    // rating≥3 AND (Nikon OR Canon) — the shape a flat rule list can't express.
    const ast = JSON.stringify({
      rules: [
        { field: "rating", op: "gte", value: 3 },
        {
          match: "any",
          rules: [
            { field: "make", op: "eq", value: "Nikon" },
            { field: "make", op: "eq", value: "Canon" },
          ],
        },
      ],
    });
    const parsed = parseSmartRule(ast);
    expect(parsed).not.toBeNull();
    expect(parsed?.match).toBe("all");
    const [crit, group] = parsed!.rules;
    expect(isGroup(crit)).toBe(false);
    expect(isGroup(group)).toBe(true);
    expect((group as SmartRule).rules).toHaveLength(2);
    // Round-trips unchanged, so saving an edited collection preserves nesting.
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({
      match: "all",
      ...JSON.parse(ast),
    });
  });

  it("rejects malformed ASTs instead of guessing", () => {
    expect(parseSmartRule(null)).toBeNull();
    expect(parseSmartRule("not json")).toBeNull();
    expect(parseSmartRule('{"match":"all"}')).toBeNull();
    // Criterion missing `value` — the native compiler rejects it too.
    expect(parseSmartRule('{"rules":[{"field":"rating","op":"gte"}]}')).toBeNull();
    // Nested garbage inside an otherwise valid group.
    expect(parseSmartRule('{"rules":[{"rules":[{"op":"eq","value":1}]}]}')).toBeNull();
  });
});
