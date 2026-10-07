// Unit tests for the New Document Background Contents resolver. Engine-free (node);
// the newDocument wiring is covered by e2e/new-document-bg.spec.ts.
import { describe, it, expect } from "vitest";
import { bgFill, BG_CONTENTS } from "./bgContents";

describe("BG_CONTENTS", () => {
  it("lists White / Background Color / Transparent with White first", () => {
    expect(BG_CONTENTS[0]).toEqual({ key: "white", label: "White" });
    expect(BG_CONTENTS.map((o) => o.key)).toEqual(["white", "bg", "transparent"]);
  });
});

describe("bgFill", () => {
  it("returns opaque white for 'white' (ignoring the bg colour)", () => {
    expect(bgFill("white", 10, 20, 30)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
  it("returns the background colour (alpha 255) for 'bg'", () => {
    expect(bgFill("bg", 10, 20, 30)).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });
  it("returns null (clear to transparent) for 'transparent'", () => {
    expect(bgFill("transparent", 10, 20, 30)).toBeNull();
  });
});
