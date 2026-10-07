// Guards VIS-SEL-09 (partial): Calculations must be able to *write* an alpha
// channel, not just replace the selection. The blend itself is the engine's
// (packages/engine `calculations`); what this asserts is the dialog wiring —
// Dialogs.tsx pulls the WASM engine through state/app, so, as in
// channelPlates.test.ts and typePanels.test.ts, the wiring is asserted from
// source rather than by rendering React in a Node test env.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogsSource = readFileSync(new URL("./Dialogs.tsx", import.meta.url), "utf8");
const calculations = dialogsSource.slice(
  dialogsSource.indexOf("function Calculations()"),
  dialogsSource.indexOf("function Defringe()"),
);

describe("Calculations result", () => {
  it("offers a Result dropdown instead of announcing a fixed selection", () => {
    expect(calculations).toContain("function Calculations()");
    // The old ceiling: the result was hardcoded, with a static caption.
    expect(calculations).not.toContain("Result: a new selection.");
    expect(calculations).toContain('{ value: "channel", label: "New Channel" }');
    expect(calculations).toContain('{ value: "selection", label: "Selection" }');
  });

  it("writes a new alpha channel by saving the blend the engine put in the selection", () => {
    // Order matters: calculations() must run first — saveSelection captures the
    // live selection, which is where the engine writes the blend.
    expect(calculations).toMatch(
      /store\.calculations\(s1, \+ch1, inv1, s2, \+ch2, inv2, blend, opacity\);[\s\S]*?if \(result === "channel"\) store\.saveSelection\(/,
    );
    expect(calculations).toContain('store.saveSelection(chanName.trim() || nextAlphaName)');
    // OK must go through the dispatcher, not the bare engine call it replaced.
    expect(calculations).toContain("onClick={apply}");
  });

  it("defaults the channel name to the next free Alpha slot", () => {
    expect(calculations).toContain("const saved = store.savedSelectionNames();");
    expect(calculations).toContain('for (let i = 2; saved.includes(name); i++) name = `Alpha ${i}`;');
    // Named + labelled, or the field is unreachable by keyboard/screen reader.
    expect(calculations).toContain('htmlFor="mv-calc-channel"');
    expect(calculations).toContain('aria-label="New channel name"');
  });
});
