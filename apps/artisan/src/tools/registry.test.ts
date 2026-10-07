import { describe, expect, it } from "vitest";
import { TOOL_META, TOOL_RAIL_GROUPS, hasTool, shortcutToTool } from "./registry";

// The Illustrator-style rail collapses every tool into a flyout group. These
// guard the core invariant: one slot per group, and *every* tool reachable —
// nothing silently dropped or duplicated when groups are reshuffled.
describe("TOOL_RAIL_GROUPS", () => {
  const groups = TOOL_RAIL_GROUPS.filter((e): e is string[] => Array.isArray(e));
  const railIds = groups.flat();

  it("references only real, registered tools", () => {
    for (const id of railIds) {
      expect(TOOL_META.find((m) => m.id === id), `${id} missing from TOOL_META`).toBeTruthy();
      expect(hasTool(id), `${id} has no factory`).toBe(true);
    }
  });

  it("exposes every tool exactly once", () => {
    const railSet = new Set(railIds);
    expect(railSet.size, "duplicate tool id in the rail").toBe(railIds.length);
    const metaIds = TOOL_META.map((m) => m.id).sort();
    expect([...railSet].sort()).toEqual(metaIds);
  });

  it("assigns every tool shortcut to exactly one tool", () => {
    const withShortcut = TOOL_META.filter((m) => m.shortcut);
    const map = shortcutToTool();
    // No two tools claim the same key+shift combination.
    expect(Object.keys(map)).toHaveLength(withShortcut.length);
    // Shift variants are keyed apart from their plain letter (Illustrator pairs
    // Paintbrush/Blob Brush on B, Free Transform/Eraser on E, …).
    expect(map["b"]).toBe("paintbrush");
    expect(map["shift+b"]).toBe("blob-brush");
    expect(map["e"]).toBe("free-transform");
    expect(map["shift+e"]).toBe("eraser");
    expect(map["shift+m"]).toBe("shape-builder");
    expect(map["w"]).toBe("blend");
    expect(map["shift+r"]).toBe("warp");
  });

  it("has no empty groups and a sane slot count", () => {
    for (const g of groups) expect(g.length).toBeGreaterThan(0);
    // ~two dozen slots (Illustrator's default), far fewer than the tool count.
    expect(groups.length).toBeLessThan(TOOL_META.length);
    expect(groups.length).toBeLessThanOrEqual(30);
  });
});
