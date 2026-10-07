// Unit tests for the Duplicate Layer default-name helper. Engine-free (node); the
// dialog + menu/ctx wiring are covered by e2e/duplicate-layer-dialog.spec.ts.
import { describe, it, expect } from "vitest";
import { defaultDuplicateName } from "./duplicateLayer";

describe("defaultDuplicateName", () => {
  it("appends ' copy' to a fresh name", () => {
    expect(defaultDuplicateName("Layer 1", [])).toBe("Layer 1 copy");
    expect(defaultDuplicateName("Sky", [])).toBe("Sky copy");
  });

  it("increments past existing copies", () => {
    expect(defaultDuplicateName("Layer 1", ["Layer 1 copy"])).toBe("Layer 1 copy 2");
    expect(defaultDuplicateName("Layer 1", ["Layer 1 copy", "Layer 1 copy 2"])).toBe("Layer 1 copy 3");
  });

  it("strips a trailing ' copy'/' copy N' from the stem", () => {
    expect(defaultDuplicateName("Layer 1 copy", ["Layer 1", "Layer 1 copy"])).toBe("Layer 1 copy 2");
    expect(defaultDuplicateName("Layer 1 copy 2", ["Layer 1 copy 2"])).toBe("Layer 1 copy"); // first free in the sequence
  });
});
