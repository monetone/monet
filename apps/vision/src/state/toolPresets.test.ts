import { describe, expect, it } from "vitest";
import {
  addToolPresetTo,
  removeToolPresetAt,
  defaultToolPresetName,
  parseToolPresets,
  DEFAULT_TOOL_PRESETS,
  type ToolPreset,
} from "./toolPresets";

const mk = (name: string): ToolPreset => ({ name, tool: "brush", brush: { size: 10 }, fg: { h: 0, s: 0, v: 0, a: 1 } });

describe("toolPresets", () => {
  it("ships default presets that carry a tool + brush", () => {
    expect(DEFAULT_TOOL_PRESETS.length).toBeGreaterThan(0);
    for (const p of DEFAULT_TOOL_PRESETS) {
      expect(p.tool).toBeTruthy();
      expect(typeof p.brush.size).toBe("number");
    }
  });

  it("auto-names one past the highest existing 'Tool N'", () => {
    expect(defaultToolPresetName([])).toBe("Tool 1");
    expect(defaultToolPresetName(["Tool 1", "Tool 3", "Custom"])).toBe("Tool 4");
  });

  it("appends a preset and ignores a duplicate name (same ref)", () => {
    const a = addToolPresetTo([], mk("A"));
    expect(a).toHaveLength(1);
    expect(addToolPresetTo(a, mk("A"))).toBe(a);
    expect(addToolPresetTo(a, mk("B"))).toHaveLength(2);
  });

  it("removes by index; out-of-range is a same-ref no-op", () => {
    const list = [mk("A"), mk("B")];
    expect(removeToolPresetAt(list, 0).map((p) => p.name)).toEqual(["B"]);
    expect(removeToolPresetAt(list, 5)).toBe(list);
  });

  describe("parseToolPresets", () => {
    it("round-trips a serialized library", () => {
      const list = [mk("A"), mk("B")];
      expect(parseToolPresets(JSON.stringify(list))).toEqual(list);
    });
    it("accepts an explicitly empty library but rejects missing or malformed payloads", () => {
      expect(parseToolPresets(null)).toBeNull();
      expect(parseToolPresets("")).toBeNull();
      expect(parseToolPresets("[]")).toEqual([]);
      expect(parseToolPresets("not json")).toBeNull();          // parse error
      expect(parseToolPresets('{"name":"x"}')).toBeNull();      // not an array
      expect(parseToolPresets('[{"name":"x","tool":"brush"}]')).toBeNull(); // missing brush/fg
      expect(parseToolPresets('[{"tool":"brush","brush":{},"fg":{}}]')).toBeNull(); // missing name
    });
  });
});
