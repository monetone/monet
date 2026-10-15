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
import { layoutHorizontal, layoutVertical, type Cell } from "./raster";
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
describe("scaled type keeps the ink that a downward baseline shift hangs below the line", () => {
  const scaled = (glyph: string): Cell => ({
    ...cell(glyph, 10),
    ascent: 12.8 * 3,
    descent: 3.2 * 3,
    baseShift: -40,
    vScale: 3,
  });

  it("grows a point-type block to the ink bottom", () => {
    const glyph = scaled("A");
    // size 16 keeps the nominal line at 19.2 so a line-height block would miss the
    // ink. defaultSpec's own 64px size would hide that by growing the em box.
    const layout = layoutHorizontal([glyph], defaultSpec("A", { size: 16 }));
    const placed = layout.placements[0];
    const ink = placed.y + Math.max(0, -glyph.baseShift) + glyph.descent;
    expect(ink).toBeCloseTo(88, 5);
    expect(layout.blockH).toBeGreaterThanOrEqual(ink);
    expect(layout.blockH).toBeGreaterThan(16 * 1.2);
  });

  it("keeps a fixed paragraph box", () => {
    const spec = { ...defaultSpec("A", { size: 16 }), kind: "paragraph" as const, boxW: 100, boxH: 40 };
    expect(layoutHorizontal([scaled("A")], spec).blockH).toBe(40);
  });

  it("grows a vertical column the same way", () => {
    const glyph = scaled("A");
    const layout = layoutVertical([glyph], defaultSpec("A", { size: 16, vertical: true }));
    const placed = layout.placements[0];
    const ink = placed.y + Math.max(0, -glyph.baseShift) + glyph.descent;
    expect(layout.blockH).toBeGreaterThanOrEqual(ink);
  });
});

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
