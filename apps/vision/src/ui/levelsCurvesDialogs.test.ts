// Guards #435 / #436 at the dialog layer. The math is covered for real in
// state/levelsCurvesTools.test.ts; Dialogs.tsx cannot mount under node (see
// appCommands.test.ts), so the wiring — that each control reaches that math and
// the same engine ops as before — is asserted against the source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./Dialogs.tsx", import.meta.url), "utf8");
const between = (from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, from).toBeGreaterThanOrEqual(0);
  return src.slice(a, src.indexOf(to, a));
};
const levels = between("function Levels() {", "const diagonalPoints = ");
const curves = between("function Curves() {", "export function HueSaturationControls(");

describe("Levels dialog tools (#435, #436)", () => {
  it("arms three droppers that sample the opening snapshot into the channel params", () => {
    expect(src).toContain('data-mv-tone-dropper={d.kind}');
    expect(levels).toContain("levelsFromDropper(prev, armed, px, targets[armed])");
    expect(levels).toContain("useDocSnapshot()");
  });

  it("runs Auto from the options and reads the snapshot, not the live preview", () => {
    expect(levels).toContain("autoLevelsParams(channelHistograms(snapshot.data), { ...auto, targets })");
    expect(levels).toContain("<AutoOptionsPanel opts={auto} setOpts={setAuto} />");
  });

  it("loads and saves .alv through the codec, and still commits through adj.levelsMulti", () => {
    expect(levels).toContain('extensions: ["alv"]');
    expect(levels).toContain("decodeAlv(bytes)");
    expect(levels).toContain('downloadBytes("levels.alv", encodeAlv(params)');
    expect(levels).toContain("adj.levelsMulti(packLevels(params[0])");
  });
});

describe("Curves dialog tools (#435, #436)", () => {
  it("arms droppers, Auto and .acv presets the same way, committing through adj.curves", () => {
    expect(curves).toContain("curvesFromDropper(prev, armed!, px, targets[armed!])");
    expect(curves).toContain("autoCurvePoints(channelHistograms(snapshot.data), { ...auto, targets })");
    expect(curves).toContain("decodeAcv(bytes)");
    expect(curves).toContain('downloadBytes("curves.acv", encodeAcv(ptsByCh)');
    expect(curves).toContain("adj.curves(l.master, l.r, l.g, l.b)");
  });

  it("edits the selected point numerically and walks the points", () => {
    expect(curves).toContain('setCurvePointValue(pts, sel.id, "x", Number(e.currentTarget.value))');
    expect(curves).toContain('setCurvePointValue(pts, sel.id, "y", Number(e.currentTarget.value))');
    expect(curves).toContain('aria-label="Previous point"');
    expect(curves).toContain('aria-label="Next point"');
    // A drag in the editor selects what it moved.
    expect(curves).toContain("const id = changedPointId(pts, next); if (id) setSelId(id);");
  });

  it("offers Show Clipping over the snapshot and a pencil that replaces the channel's points", () => {
    expect(curves).toContain("clippingMask(snapshot.data, buildCurveLuts(ptsByCh))");
    expect(curves).toContain('aria-label="Show Clipping"');
    expect(curves).toContain("pencilPoints(stroke, `pen${ch}`)");
    expect(curves).toContain("data-mv-curves-pencil-surface");
  });
});

describe("preset files bypass the document-state guard on purpose", () => {
  it("uses downloadBytes, which does not assert a settled history, inside the preview", () => {
    const app = readFileSync(new URL("../state/app.ts", import.meta.url), "utf8");
    const body = app.slice(app.indexOf("export function downloadBytes("), app.indexOf("\n}\n", app.indexOf("export function downloadBytes(")));
    expect(body).not.toContain("assertHistorySettled");
    expect(app).toContain("assertHistorySettled(engine.engine);\n  downloadBytes(filename, bytes, mime);");
  });
});

// ── Layer Style pattern picker (#420) ───────────────────────────────────────
// Same constraint: Dialogs.tsx cannot mount under node, so the wiring between
// the pattern slot and the library picker is asserted here; the id math is
// covered in state/stylePatterns.test.ts and the render in packages/engine.
describe("Layer Style pattern picker (#420)", () => {
  const row = between("function PatternRow(", "function LayerStyle()");

  it("routes the pattern field kind to its own picker row", () => {
    expect(src).toContain('case "pattern":');
    expect(src).toContain("<PatternRow label={field.label} value={params[i]} onChange={(v) => set({ [i]: v })} />");
  });

  it("offers the library inline and writes the picked tile's id into the effect", () => {
    expect(row).toContain("useStore((s) => s.patternPresets)");
    expect(row).toContain("onClick={() => onChange(patternLibraryId(preset.name))}");
    expect(row).toContain("data-mv-style-pattern-picker");
    expect(row).toContain("<PatternSwatch preset={preset} size={26} />");
  });

  it("says so when a style names a pattern the library no longer has", () => {
    expect(row).toContain("const orphan = isLibraryPattern(value) && picked < 0;");
    expect(row).toContain("(missing pattern)");
  });

  it("refuses a tile too large for a style rather than pushing it", () => {
    expect(row).toContain("const tooBig = !fitsStylePattern(preset);");
    expect(row).toContain("disabled={tooBig}");
  });
});

// ── Advanced Blending ▸ Channels (#421) ─────────────────────────────────────
describe("Blending Options channel restriction (#421)", () => {
  it("offers R, G and B beside Knockout, driven by the layer's own mask", () => {
    expect(src).toContain("const BLEND_CHANNEL_BITS = [");
    expect(src).toContain('{ bit: 1, label: "R" }');
    expect(src).toContain("store.layerBlendChannels(id)");
    expect(src).toContain("mutate(() => store.setLayerBlendChannels(id, next))");
    expect(src).toContain("const next = v ? blendChans | bit : blendChans & ~bit;");
  });

  it("carries the mask into the state OK commits, so it is one undoable step", () => {
    expect(src).toContain("blendChannels: blendChans,");
  });
});
