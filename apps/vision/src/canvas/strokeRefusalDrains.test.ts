import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `stroke_begin` reports WHY it refused through `last_edit_error`, not through
// its return value — it just returns false. The three brush entry points
// (paint/erase, clone, heal) each bail on false, and if they bail without
// draining, the message sits in the engine until the user's NEXT commit picks
// it up and blames an unrelated action. Every bail must consume it, which is
// also what turns "the brush silently did nothing" into a real explanation.
const source = readFileSync(fileURLToPath(new URL("./CanvasView.tsx", import.meta.url)), "utf8");

describe("a refused stroke drains its own error", () => {
  it("has every stroke_begin bail-out consume the edit error", () => {
    const bails = [...source.matchAll(/if \(!E\.stroke_begin\(\)\) \{/g)];
    expect(bails.length, "expected the paint, clone and heal entry points").toBe(3);
    for (const m of bails) {
      // The bail block runs to its `break;` — the drain must be inside it.
      const from = m.index!;
      const block = source.slice(from, source.indexOf("break;", from));
      expect(
        block,
        "a stroke_begin bail-out that skips consumeEditError() leaks its refusal onto the next commit",
      ).toContain("engine.consumeEditError()");
    }
  });
});
