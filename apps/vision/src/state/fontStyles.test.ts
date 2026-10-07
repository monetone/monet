// #453: type styling was a pair of booleans, so a registered Semibold or a
// variable axis was unreachable — cssFont could only ever ask for 400 or 700.
// This file proves the model half: what the host's font scan makes pickable,
// what a pick writes into the run, and that a run's numeric weight and axis
// values survive the trip through the engine's text-spec JSON (the string
// layer_text_spec stores verbatim in the saved document).
import { beforeEach, describe, expect, it } from "vitest";
import {
  axisStep, fontAxes, fontStylePatch, fontStyles, matchFontStyle, setFontFaces,
} from "./fontStyles";
import {
  FONTS, addDiscoveredFonts, cssFont, defaultSpec, resolveStyle, variationSettings, applyRangeFormat, type TextSpec,
} from "../text/spec";
import type { VectorFontFaceInfo } from "../engine/vectorFonts";

const HELVETICA = "Helvetica, Arial, sans-serif";
const INTER = "Inter, system-ui, sans-serif";

const face = (patch: Partial<VectorFontFaceInfo> & { family: string }): VectorFontFaceInfo =>
  ({ faceIndex: 0, weight: 400, italic: false, ...patch });

/** A family the host really scanned: four static faces plus one italic. */
const HELVETICA_FACES: VectorFontFaceInfo[] = [
  face({ family: "Helvetica", fullName: "Helvetica", weight: 400 }),
  face({ family: "Helvetica", fullName: "Helvetica Light", weight: 300 }),
  face({ family: "Helvetica", fullName: "Helvetica Semibold", weight: 600 }),
  face({ family: "Helvetica", fullName: "Helvetica Oblique", weight: 400, italic: true }),
];

/** A variable family: one face spanning 100..900 weight and 75..125 width. */
const INTER_FACES: VectorFontFaceInfo[] = [
  face({
    family: "Inter", fullName: "Inter", weight: 400,
    axes: [{ tag: "wght", min: 100, def: 400, max: 900 }, { tag: "wdth", min: 75, def: 100, max: 125 }],
  }),
];

beforeEach(() => { setFontFaces([]); });

describe("the style dropdown's entries", () => {
  it("lists the family's real subfamilies, lightest first and romans before italics", () => {
    setFontFaces(HELVETICA_FACES);
    expect(fontStyles(HELVETICA).map((s) => s.label)).toEqual(["Light", "Regular", "Semibold", "Oblique"]);
    expect(fontStyles(HELVETICA).map((s) => s.weight)).toEqual([300, 400, 600, 400]);
  });

  it("falls back to the generic four for a family the host never scanned", () => {
    expect(fontStyles(HELVETICA).map((s) => s.label)).toEqual(["Regular", "Italic", "Bold", "Bold Italic"]);
  });

  it("shows the style the run is actually set to, or the nearest one", () => {
    setFontFaces(HELVETICA_FACES);
    const styles = fontStyles(HELVETICA);
    // One face per (weight, slope) here, so each option is its plain weight.
    expect(matchFontStyle(styles, 600, false)).toBe("600");
    // A document carrying a weight this family no longer ships still reads as
    // its nearest same-slope face rather than as nothing.
    expect(matchFontStyle(styles, 800, false)).toBe("600");
    expect(matchFontStyle(styles, 400, true)).toBe("400i");
  });

  it("reports a variable face's axes, and none for a static family", () => {
    setFontFaces([...HELVETICA_FACES, ...INTER_FACES]);
    expect(fontAxes(INTER)).toEqual([
      { tag: "wght", min: 100, def: 400, max: 900 },
      { tag: "wdth", min: 75, def: 100, max: 125 },
    ]);
    expect(fontAxes(HELVETICA)).toEqual([]);
  });

  it("keys a family the picker had to clean under the picker's own name", () => {
    // addDiscoveredFonts blanks control characters and caps the name before a
    // family reaches FONTS; the style registry must land under that same key,
    // or the family's Style dropdown silently degrades to the generic four.
    const raw = `Weird\x01Grotesk${"x".repeat(300)}`;
    setFontFaces([face({ family: raw, fullName: `${raw} Semibold`, weight: 600 })]);
    addDiscoveredFonts([raw]);
    const entry = FONTS.find((f) => f.includes("Weird Grotesk"))!;
    expect(fontStyles(entry).map((s) => s.label)).toEqual(["Semibold"]);
  });

  it("steps a slider at a round decimal that gives every axis a hundred-plus positions", () => {
    expect(axisStep({ tag: "wght", min: 100, def: 400, max: 900 })).toBe(1);
    expect(axisStep({ tag: "wdth", min: 62.5, def: 100, max: 100 })).toBe(0.1);
    expect(axisStep({ tag: "slnt", min: -10, def: 0, max: 0 })).toBe(0.1);
    expect(axisStep({ tag: "ital", min: 0, def: 0, max: 1 })).toBe(0.01);
    // Never coarser than 1, however wide the range.
    expect(axisStep({ tag: "opsz", min: 0, def: 0, max: 5000 })).toBe(1);
  });
});

describe("picking a style", () => {
  it("keeps same-weight faces distinct through selection, rendering, save/reload and formatting changes", () => {
    setFontFaces([
      face({ family: "Helvetica", fullName: "Helvetica Bold", postscriptName: "Helvetica-Bold", weight: 700 }),
      face({ family: "Helvetica", fullName: "Helvetica Condensed Bold", postscriptName: "Helvetica-CondensedBold", weight: 700 }),
    ]);
    const styles = fontStyles(HELVETICA);
    expect(new Set(styles.map((s) => s.value)).size).toBe(2);
    const spec = defaultSpec("AB", { font: HELVETICA });
    const patch = fontStylePatch(HELVETICA, "face:Helvetica-CondensedBold")!;
    const runs = applyRangeFormat(spec.runs, 0, 1, patch);
    const saved = JSON.parse(JSON.stringify({ ...spec, runs })) as TextSpec;
    const st = resolveStyle(saved, saved.runs[0]);
    expect(matchFontStyle(styles, st.weight, st.italic, st.face)).toBe("face:Helvetica-CondensedBold");
    expect(cssFont(st, 24)).toContain('"Monet face:Helvetica-CondensedBold"');
    expect(resolveStyle(saved, saved.runs[1]).face).toBeUndefined();
    expect(applyRangeFormat(saved.runs, 0, 1, { underline: true })[0].face).toBe(st.face);
    expect(applyRangeFormat(saved.runs, 0, 1, { font: "Inter" })[0].face).toBeUndefined();
    expect(applyRangeFormat(saved.runs, 0, 1, { bold: false, weight: 400 })[0].face).toBeUndefined();
  });

  it("uses only the selected face's variable axes and keeps its identity during a weight change", () => {
    setFontFaces([
      ...INTER_FACES,
      face({ family: "Inter", fullName: "Inter Static Bold", weight: 700 }),
    ]);
    expect(fontAxes(INTER, "Inter Static Bold")).toEqual([]);
    expect(fontAxes(INTER, "Inter")).toHaveLength(2);
    const spec = defaultSpec("A", { font: INTER });
    const runs = applyRangeFormat(spec.runs, 0, 1, { ...fontStylePatch(INTER, "400")!, weight: 500 });
    const adjusted = applyRangeFormat(runs, 0, 1, { weight: 800, bold: true, face: "Inter" });
    expect(adjusted[0].face).toBe("Inter");
    // The variable face's own option, whatever weight the run has been dragged to.
    expect(matchFontStyle(fontStyles(INTER), 800, false, "Inter")).toBe("400");
  });
  it("stores the real numeric weight, not a boolean, and renders with it", () => {
    setFontFaces(HELVETICA_FACES);
    const patch = fontStylePatch(HELVETICA, "600");
    expect(patch).toMatchObject({ weight: 600, italic: false, bold: true });

    const spec = defaultSpec("Semi", { font: HELVETICA });
    const styled: TextSpec = { ...spec, runs: applyRangeFormat(spec.runs, 0, 4, patch!) };
    const st = resolveStyle(styled, styled.runs[0]);
    expect(st.weight).toBe(600);
    expect(cssFont(st, 16)).toBe(`600 16px "Monet face:Helvetica Semibold", "Helvetica Semibold", ${HELVETICA}`);
  });

  it("never doubles wght into font-variation-settings — font-weight already carries it", () => {
    // A run carrying axes.wght (an MCP client, a hand-edited document) must not
    // outrank its own weight: font-variation-settings beats font-weight in CSS.
    const spec = defaultSpec("W", { font: INTER });
    const st = resolveStyle(spec, { text: "W", weight: 300, axes: { wght: 900, wdth: 80 } });
    expect(cssFont(st, 10)).toBe(`300 10px ${INTER}`);
    expect(variationSettings(st)).toBe('"wdth" 80');
  });
});

describe("documents", () => {
  it("keeps the weight and axis values across a save + reload", () => {
    setFontFaces(INTER_FACES);
    const spec = defaultSpec("Wide", { font: INTER });
    const saved: TextSpec = {
      ...spec,
      runs: applyRangeFormat(spec.runs, 0, 4, { ...fontStylePatch(INTER, "400")!, weight: 250, axes: { wdth: 125 } }),
    };
    // layer_text_spec keeps this JSON verbatim; MVSN saves the string as-is.
    const reloaded = JSON.parse(JSON.stringify(saved)) as TextSpec;
    const st = resolveStyle(reloaded, reloaded.runs[0]);
    expect(st.weight).toBe(250);
    expect(cssFont(st, 24)).toBe(`250 24px "Monet face:Inter", "Inter", ${INTER}`);
    expect(variationSettings(st)).toBe('"wdth" 125');
  });

  it("still renders a document saved before the picker existed", () => {
    // bold/italic booleans and no weight anywhere: Photoshop's 700 / 400.
    const legacy = JSON.parse(JSON.stringify({
      ...defaultSpec("Old", { font: HELVETICA, bold: true }),
      runs: [{ text: "Old" }, { text: " light", bold: false }],
    })) as TextSpec;
    expect(resolveStyle(legacy, legacy.runs[0]).weight).toBe(700);
    expect(cssFont(resolveStyle(legacy, legacy.runs[0]), 12)).toBe(`700 12px ${HELVETICA}`);
    // A run's own bold flag still wins over the layer default.
    expect(resolveStyle(legacy, legacy.runs[1]).weight).toBe(400);
    expect(variationSettings(resolveStyle(legacy, legacy.runs[0]))).toBe("");
  });
});
