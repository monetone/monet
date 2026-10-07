import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Photoshop's Warp Text dialog puts a Horizontal/Vertical pair above Bend and
// the two distortions. The renderer has always honoured `warp.orient`
// (../text/warp.ts, covered by ../text/warp.test.ts) — this is the source-level
// wiring check that the Type dialog actually writes it (same idiom as
// ./transformPathWiring.test.ts).
const dialogsSource = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("Warp Text orientation wiring", () => {
  const warpSection = section(dialogsSource, "<SectionLabel>Warp</SectionLabel>", "// ── Type toolbar");

  it("offers both orientations and patches spec.warp.orient", () => {
    expect(warpSection).toContain('items={[{ value: "h", label: "Horizontal" }, { value: "v", label: "Vertical" }]}');
    expect(warpSection).toContain("value={spec.warp.orient}");
    expect(warpSection).toContain('onChange={(v) => patchWarp({ orient: v as TextSpec["warp"]["orient"] })}');
  });

  it("keeps the control labelled for screen readers", () => {
    expect(warpSection).toContain('aria-label="Warp orientation"');
  });
});
