// Unit tests for the Styles panel's Adobe .asl interop and its swatch preview.
// Engine-free (node); the panel wiring is covered by e2e/styles-panel.spec.ts.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STYLE_PRESETS,
  buildAsl,
  parseAsl,
  mergeStylePresets,
  uniqueStylePresetName,
  stylePreviewCss,
  MAX_ASL_IMPORT_BYTES,
  type StylePreset,
  type StyleEffect,
} from "./stylePresets";
import { FX, defaultBlendIf } from "./effects";

const byName = (name: string): StylePreset => DEFAULT_STYLE_PRESETS.find((p) => p.name === name)!;
const at = (effects: StyleEffect[], fx: number): number[] | undefined => effects.find((e) => e.fx === fx)?.params;

describe("buildAsl", () => {
  it("writes a Photoshop-readable header: version 2, 8BSL, patterns v3, style count", () => {
    const bytes = buildAsl([byName("Drop Shadow"), byName("Stroke")]);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint16(0)).toBe(2);
    expect(String.fromCharCode(...bytes.slice(2, 6))).toBe("8BSL");
    expect(v.getUint16(6)).toBe(3);
    expect(v.getUint32(8)).toBe(0); // no embedded pattern tiles
    expect(v.getUint32(12)).toBe(2);
    expect(v.getUint32(16)).toBe(16); // first descriptor's version prefix
  });
});

describe("parseAsl round trip", () => {
  it("preserves names and every mapped effect parameter", () => {
    const source = DEFAULT_STYLE_PRESETS;
    const back = parseAsl(buildAsl(source));
    expect(back.map((p) => p.name)).toEqual(source.map((p) => p.name));
    for (const [i, preset] of source.entries()) {
      expect(back[i].style.effects).toHaveLength(preset.style.effects.length);
      for (const from of preset.style.effects) {
        const to = at(back[i].style.effects, from.fx);
        expect(to).toBeDefined();
        // Only the fields the Lefx mapping covers survive; contours/pattern ids
        // fall back to the engine default, which is what they were here anyway.
        expect(to!.length).toBe(from.params.length);
        for (let k = 0; k < from.params.length; k++) expect(to![k]).toBeCloseTo(from.params[k], 4);
      }
      expect(back[i].style.fillOpacity).toBe(preset.style.fillOpacity);
      expect(back[i].style.blendIf).toEqual(defaultBlendIf());
    }
  });

  it("round-trips a hand-built style through colours, blend modes and enums", () => {
    const stroke = [1, 3 /* multiply */, 0.5, 0.2, 0.4, 0.8, 7, 1 /* inside */];
    const grad = [1, 7 /* screen */, 0.9, 45, 1.5, 1 /* radial */, 1 /* reverse */, 1, 0, 0, 0, 0, 1];
    const effects: StyleEffect[] = [{ fx: FX.STROKE, params: stroke }, { fx: FX.GRADIENT_OVERLAY, params: grad }];
    const back = parseAsl(buildAsl([{ name: "Neon", style: { effects, blendIf: defaultBlendIf(), fillOpacity: 42 } }]));
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe("Neon");
    expect(back[0].style.fillOpacity).toBeCloseTo(42, 4);
    // Slots past the source vector keep the engine default (older, shorter
    // param vectors stay valid), so compare the fields the source actually set.
    const backStroke = at(back[0].style.effects, FX.STROKE)!;
    const backGrad = at(back[0].style.effects, FX.GRADIENT_OVERLAY)!;
    stroke.forEach((v, i) => expect(backStroke[i]).toBeCloseTo(v, 3));
    grad.forEach((v, i) => expect(backGrad[i]).toBeCloseTo(v, 3));
  });

  it("round-trips non-default Blend If through Photoshop blend-range descriptors (#307)", () => {
    const blendIf = defaultBlendIf();
    blendIf[0] = 64 / 255;
    blendIf[5] = 153 / 255;
    blendIf[10] = 204 / 255;
    blendIf[31] = 230 / 255;
    const bytes = buildAsl([{ name: "Blend If", style: { effects: [], blendIf, fillOpacity: 42 } }]);

    expect(parseAsl(bytes)[0].style.blendIf).toEqual(blendIf);
    const raw = String.fromCharCode(...bytes);
    expect(raw).toContain("blendOptions");
    expect(raw).toContain("Blnd");
    expect(raw).toContain("obj \0\0\0\x01Enmr");
    for (const key of ["SrcB", "Srcl", "SrcW", "Srcm", "DstB", "Dstl", "DstW", "Dstt"]) {
      expect(raw).toContain(key);
    }
    for (const channel of ["Gry ", "Rd  ", "Grn ", "Bl  "]) expect(raw).toContain(channel);
  });

  it("round-trips every gradient kind under Photoshop's own enum typeID (#142)", () => {
    // 0 linear · 1 radial · 2 angle · 3 reflected · 4 diamond (engine
    // gradient_overlay slot 5). The short opts list used to export 2/3/4 as
    // Linear, and an enum written with the wrong typeID misreads in Photoshop.
    const codes = ["Lnr ", "Rdl ", "Angl", "Rflc", "Dmnd"];
    for (let kind = 0; kind < codes.length; kind++) {
      const grad = [1, 0, 1, 30, 1, kind, 0, 0, 0, 0, 1, 1, 1];
      const effects: StyleEffect[] = [{ fx: FX.GRADIENT_OVERLAY, params: grad }];
      const bytes = buildAsl([{ name: "G", style: { effects, blendIf: defaultBlendIf(), fillOpacity: 100 } }]);
      expect(at(parseAsl(bytes)[0].style.effects, FX.GRADIENT_OVERLAY)![5]).toBe(kind);
      // key() writes a 4-char code as u32(0) + ascii, so the typeID sits
      // directly in front of the value in the byte stream.
      const raw = String.fromCharCode(...bytes);
      expect(raw).toContain(`GrdT\0\0\0\0${codes[kind]}`);
    }
  });

  it("keeps a disabled effect slot disabled rather than dropping it", () => {
    const off = [...at(byName("Drop Shadow").style.effects, FX.DROP_SHADOW)!];
    off[0] = 0;
    const effects: StyleEffect[] = [{ fx: FX.DROP_SHADOW, params: off }];
    const back = parseAsl(buildAsl([{ name: "Off", style: { effects, blendIf: defaultBlendIf(), fillOpacity: 100 } }]));
    expect(at(back[0].style.effects, FX.DROP_SHADOW)![0]).toBe(0);
  });

  it("round-trips a stacked style — two strokes survive as two instances", () => {
    const inner = [1, 0, 1, 1, 0, 0, 3, 2 /* center */];
    const outer = [1, 0, 1, 0.5, 0, 0, 8, 0 /* outside */];
    const effects: StyleEffect[] = [{ fx: FX.STROKE, params: inner }, { fx: FX.STROKE, params: outer }];
    const back = parseAsl(buildAsl([{ name: "Double Stroke", style: { effects, blendIf: defaultBlendIf(), fillOpacity: 100 } }]));
    const strokes = back[0].style.effects.filter((e) => e.fx === FX.STROKE);
    expect(strokes).toHaveLength(2);
    inner.forEach((v, i) => expect(strokes[0].params[i]).toBeCloseTo(v, 3));
    outer.forEach((v, i) => expect(strokes[1].params[i]).toBeCloseTo(v, 3));
  });
});

describe("parseAsl input validation", () => {
  it("rejects a file that is not .asl", () => {
    expect(() => parseAsl(new Uint8Array([0, 2, 65, 66, 67, 68, 0, 3]))).toThrow(/Adobe .asl/);
  });

  it("rejects an oversized file before decoding it", () => {
    expect(() => parseAsl(new Uint8Array(MAX_ASL_IMPORT_BYTES + 1))).toThrow(/too large/);
  });

  it("rejects a truncated file", () => {
    const bytes = buildAsl([byName("Stroke")]);
    expect(() => parseAsl(bytes.slice(0, bytes.length - 8))).toThrow(/truncated/);
  });

  it("keeps the styles read before a corrupt one instead of losing the library", () => {
    const good = buildAsl([byName("Stroke"), byName("Outer Glow")]);
    const truncated = good.slice(0, good.length - 6);
    const stats = { dropped: 0 };
    const out = parseAsl(truncated, stats);
    expect(out.map((p) => p.name)).toEqual(["Stroke"]);
    expect(stats.dropped).toBe(1);
  });

  it("reports styles refused by the import cap", () => {
    const stats = { dropped: 0 };
    const styles = Array.from({ length: 513 }, (_, i) => ({ ...byName("Stroke"), name: `Style ${i}` }));
    expect(parseAsl(buildAsl(styles), stats)).toHaveLength(512);
    expect(stats.dropped).toBe(1);
  });
});

describe("mergeStylePresets", () => {
  it("appends imports and renames name collisions instead of dropping them", () => {
    const merged = mergeStylePresets(DEFAULT_STYLE_PRESETS, [byName("Stroke"), byName("Stroke")]);
    expect(merged).toHaveLength(DEFAULT_STYLE_PRESETS.length + 2);
    expect(merged.slice(-2).map((p) => p.name)).toEqual(["Stroke 2", "Stroke 3"]);
    expect(uniqueStylePresetName(["a"], "b")).toBe("b");
  });
});

describe("stylePreviewCss", () => {
  it("paints the colour overlay as the swatch fill", () => {
    const effects: StyleEffect[] = [{ fx: FX.COLOR_OVERLAY, params: [1, 0, 1, 1, 0, 0] }];
    const css = stylePreviewCss({ effects, blendIf: defaultBlendIf(), fillOpacity: 100 });
    expect(css.background).toBe("rgba(255, 0, 0, 1.000)");
  });

  it("offsets the drop shadow opposite the light angle and stacks the stroke ring", () => {
    const effects: StyleEffect[] = [
      { fx: FX.DROP_SHADOW, params: [1, 3, 0.75, 0, 0, 0, 0 /* light from the right */, 20, 0, 10, 0] },
      { fx: FX.STROKE, params: [1, 0, 1, 1, 1, 1, 4, 0 /* outside */] },
    ];
    const css = stylePreviewCss({ effects, blendIf: defaultBlendIf(), fillOpacity: 100 });
    expect(css.boxShadow).toMatch(/^0 0 0 1\.4px rgba\(255, 255, 255, 1\.000\), /); // stroke first
    expect(css.boxShadow).toContain("-7.0px 0.0px"); // shadow pushed left, away from the light
  });

  it("falls back to the neutral swatch when the style has no visible fill", () => {
    const empty = { effects: [] as StyleEffect[], blendIf: defaultBlendIf(), fillOpacity: 100 };
    expect(stylePreviewCss(empty)).toEqual({ background: "linear-gradient(135deg, var(--bg-2), var(--bg-1))", boxShadow: "" });
  });
});
