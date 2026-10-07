// Patterns are a real preset library here — Edit ▸ Define Pattern fills it, and
// Fill ▸ Pattern, the Pattern Stamp and Pattern Overlay all read it — but the
// Preset Manager did not carry them, so there was no way to rename or reorder one.
// The picker was pick-and-delete only, and its own comment named this as the fix.
//
// store.ts and Dialogs.tsx pull the WASM engine, so the wiring is asserted from
// source (the house idiom — see channelPlates.test / spotChannels.test).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRESET_CATEGORIES } from "./presetManager";

const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const dialogs = readFileSync(new URL("../ui/Dialogs.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

describe("Patterns is a managed preset category", () => {
  it("is in the Preset Manager's category list", () => {
    expect([...PRESET_CATEGORIES]).toContain("patterns");
  });

  it("has the reorder / rename / delete the manager rows call", () => {
    for (const method of ["reorderPatternPreset(", "renamePatternPreset(", "removePatternPreset("])
      expect(store, `store is missing ${method}`).toContain(method);
  });

  it("reorder follows the ACTIVE pattern, which is an index", () => {
    const from = store.indexOf("reorderPatternPreset(");
    const body = store.slice(from, store.indexOf("\n  /**", from));
    // activePattern indexes the list, so a plain moveItem would silently change
    // which tile Fill and the Pattern Stamp use.
    expect(body).toContain("next.indexOf(list[active])");
    expect(body).toContain("activePattern: stillActive");
  });

  it("appends on import instead of dropping name collisions", () => {
    const from = store.indexOf("importPatternPresets(");
    const body = store.slice(from, store.indexOf("\n  /**", from));
    expect(body).toContain("mergeNamed(this.snap.patternPresets");
  });

  it("the Preset Manager renders a patterns list", () => {
    expect(dialogs).toContain('cat === "patterns" && patternPresets.map');
    expect(dialogs).toContain("store.reorderPatternPreset(i, -1)");
    expect(dialogs).toContain("store.renamePatternPreset(i, e.target.value)");
    expect(dialogs).toContain('patterns: "Patterns"');
  });

  it("routes a patterns set file into the library", () => {
    expect(app).toContain('case "patterns": return store.importPatternPresets(parsePatterns(items)');
    // No Adobe .pat codec here, so the .mvpresets set is the interchange.
    expect(app).toContain("patterns: null");
  });
});
