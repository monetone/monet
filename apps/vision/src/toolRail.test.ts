// The tool rail is the only click path to a tool. A tool that has a keyboard
// group but no rail slot is reachable only by ⇧-cycling, and while it is active
// the rail shows nothing selected (#502).
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { TOOLS, TOOL_SHORTCUT_GROUPS } from "./App";

function railTools(): string[] {
  const out: string[] = [];
  for (const entry of TOOLS) {
    if (entry === "div") continue;
    const node = entry as { id: string; children?: { id: string }[] };
    for (const leaf of node.children ?? [node]) out.push(leaf.id);
  }
  return out;
}

describe("the tool rail", () => {
  it("gives every keyboard-group tool a slot", () => {
    const rail = new Set(railTools());
    const missing = TOOL_SHORTCUT_GROUPS.flatMap((g) => g.tools).filter((t) => !rail.has(t));
    expect(missing).toEqual([]);
  });

  it("lists each tool exactly once", () => {
    const seen = railTools();
    const duplicated = seen.filter((id, i) => seen.indexOf(id) !== i);
    expect(duplicated).toEqual([]);
  });
});
