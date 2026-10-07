// ─────────────────────────────────────────────────────────────
// Roman Hanging Punctuation — Paragraph panel. The renderer implemented it
// (raster.ts `hangOn`), but nothing ever set the flag: there was no control
// anywhere in the app, and no test, while noBreak.test's header claimed the
// feature was covered. These pin the layout behaviour that the new Paragraph
// panel checkbox now switches on. Pure Cell-level checks, no DOM — same shape
// as noBreak.test.
// ─────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { layoutHorizontal, type Cell } from "./raster";
import { defaultSpec, type TextSpec } from "./spec";

/** A minimal Cell: letters advance 10px, spaces 5px, drawSize 16. */
const cell = (glyph: string, advance: number): Cell => ({
  glyph, baseGlyph: glyph, markGlyph: "", bidi: "ltr", diacriticX: 0, diacriticY: 0,
  font: "16px sans-serif", drawSize: 16, baseShift: 0, advance, wRaw: advance,
  ascent: 12.8, descent: 3.2, nominalSize: 16, isSpace: /^\s$/.test(glyph), isBreak: false,
  color: [0, 0, 0, 255], underline: false, strike: false, kerning: "none", tracking: 0,
  hScale: 1, vScale: 1, fauxBold: false, fauxItalic: false, features: "", noBreak: false,
});
const cellsOf = (text: string): Cell[] =>
  Array.from(text).map((ch) => cell(ch, ch === " " ? 5 : 10));

const para = (extra: Partial<TextSpec> = {}): TextSpec =>
  ({ ...defaultSpec(""), kind: "paragraph", boxW: 200, ...extra });

/** x of the first placed glyph. */
const firstX = (text: string, spec: TextSpec) => layoutHorizontal(cellsOf(text), spec).placements[0].x;

describe("Roman Hanging Punctuation", () => {
  it("hangs a leading quote outside the left margin", () => {
    const off = firstX('"Hello', para({ hangingPunctuation: false }));
    const on = firstX('"Hello', para({ hangingPunctuation: true }));
    expect(off, "without the setting the quote sits on the margin").toBe(0);
    expect(on, "with it, the quote hangs into the margin").toBe(-10);
  });

  it("leaves a line that starts with a letter alone", () => {
    // Sensitivity control the other way: the flag must not shift ordinary text,
    // or the test above would pass for a trivially-broken implementation.
    expect(firstX("Hello", para({ hangingPunctuation: true }))).toBe(0);
  });

  // For the two cases where the feature is deliberately inert, assert that the
  // flag changes NOTHING rather than pinning an absolute x — RTL and point type
  // have their own origins, so a literal 0 would be testing the wrong thing.
  it("is inert for point type, which has no margins to hang from", () => {
    const p = (on: boolean) => firstX('"Hello', para({ kind: "point", hangingPunctuation: on }));
    expect(p(true)).toBe(p(false));
  });

  it("is inert for right-to-left text (it is a roman-script feature)", () => {
    const p = (on: boolean) => firstX('"Hello', para({ hangingPunctuation: on, direction: "rtl" }));
    expect(p(true)).toBe(p(false));
  });
});

// The renderer half worked all along; what was missing was any way to reach it.
// Panels.tsx pulls the WASM engine, so the wiring is asserted from source (the
// house idiom — see channelPlates.test / spotChannels.test).
describe("the Paragraph panel exposes it", () => {
  const panels = readFileSync(new URL("../ui/Panels.tsx", import.meta.url), "utf8");

  it("has a control that writes spec.hangingPunctuation", () => {
    expect(panels, "no control = the renderer stays unreachable").toContain(
      "patch({ hangingPunctuation: v })",
    );
    expect(panels, "and it must reflect the current value").toContain(
      "checked={!!spec.hangingPunctuation}",
    );
  });
});
