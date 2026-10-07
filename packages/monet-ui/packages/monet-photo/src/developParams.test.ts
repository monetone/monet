import { describe, expect, it } from "vitest";

import { createDefaultRecipe, MAX_HEAL_SPOTS, MAX_POINT_COLOR_SAMPLES, normalizeRecipe } from "./developRecipe";
import { DEVELOP_ADVANCED_PARAMS_LEN, recipeToParams } from "./developParams";
import { CURVE_BASE, DEVELOP_PARAMS_LEN } from "./abiLayout";

describe("recipeToParams — ABI contract", () => {
  it("has the exact engine length + header", () => {
    const p = recipeToParams(createDefaultRecipe());
    expect(p).toBeInstanceOf(Float32Array);
    expect(p.length).toBe(1086);
    expect(DEVELOP_PARAMS_LEN).toBe(1086);
    expect(p[0]).toBe(1); // version
    expect(p[1]).toBe(1); // proxyScale default
    expect(recipeToParams(createDefaultRecipe(), 0.5)[1]).toBe(0.5);
  });

  it("a neutral recipe is engine-neutral (only sharpenRadius/vignetteMidpoint non-zero)", () => {
    const p = recipeToParams(createDefaultRecipe());
    // ABI-written fields must be neutral in the ENGINE domain, not LR UI ints —
    // a default develop render must not silently apply NR/grain/vignette.
    // Basic sliders (2..14) zero.
    for (let i = 2; i <= 14; i++) expect(p[i]).toBe(0);
    expect(p[15]).toBe(0); // sharpenAmount
    expect(p[16]).toBe(1); // sharpenRadius = 1.0 (engine-neutral, matches Vision)
    expect(p[17]).toBe(0); // nrLuminance
    expect(p[18]).toBe(0); // nrColor (NOT LR's UI 25 — that would over-smooth)
    expect(p[19]).toBe(0); // nrLuminanceDetail
    expect(p[20]).toBe(0); // grainAmount
    expect(p[21]).toBe(0); // grainRoughness
    expect(p[22]).toBe(0); // grainSize
    expect(p[23]).toBe(0); // vignetteAmount
    expect(p[24]).toBe(0.5); // vignetteMidpoint = 0.5 (engine-neutral)
    expect(p[25]).toBe(1); // curve enabled by default (identity → no-op)
    // Identity point curve → identity LUT (lut[i] === i) at each channel base.
    for (const base of [26, 26 + 256, 26 + 512, 26 + 768]) {
      expect(p[base]).toBe(0);
      expect(p[base + 128]).toBe(128);
      expect(p[base + 255]).toBe(255);
    }
    // Optics / mixer / grade / transform tail neutral (all zero at default).
    for (let i = 1050; i < 1086; i++) expect(p[i]).toBe(0);
  });

  it("composes the parametric tone regions into the master curve LUT only", () => {
    const r = createDefaultRecipe();
    r.toneCurve.parametric.shadows = 100; // lift the shadow region
    const p = recipeToParams(r);
    // Master curve (base 26) lifts the low/mid, endpoints stay pinned.
    expect(p[26]).toBe(0);
    expect(p[26 + 64]).toBeGreaterThan(64);
    expect(p[26 + 255]).toBe(255);
    // Parametric is master-only: R/G/B channel LUTs stay identity.
    for (const base of [26 + 256, 26 + 512, 26 + 768]) {
      expect(p[base]).toBe(0);
      expect(p[base + 128]).toBe(128);
      expect(p[base + 255]).toBe(255);
    }
  });

  it("pins Basic offsets", () => {
    const r = createDefaultRecipe();
    Object.assign(r.basic, {
      temp: 11, tint: 12, exposure: 0.5, contrast: 20, highlights: -30,
      shadows: 40, whites: 5, blacks: -6, texture: 7, clarity: 8, dehaze: 9,
      vibrance: 10, saturation: -11,
    });
    const p = recipeToParams(r);
    expect([p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], p[14]]).toEqual([
      11, 12, 0.5, 20, -30, 40, 5, -6, 7, 8, 9, 10, -11,
    ]);
  });

  it("pins Detail / grain / vignette offsets (with v2→ABI remap)", () => {
    const r = createDefaultRecipe();
    Object.assign(r.detail, { sharpenAmount: 40, sharpenRadius: 1.5, nrLuminance: 25, nrColor: 30, nrLuminanceDetail: 55 });
    Object.assign(r.effects, { grainAmount: 10, grainRoughness: 60, grainSize: 22, vignetteAmount: -15, vignetteMidpoint: 40 });
    const p = recipeToParams(r);
    expect([p[15], p[16], p[17], p[18], p[19]]).toEqual([40, 1.5, 25, 30, 55]);
    expect([p[20], p[21], p[22], p[23], p[24]]).toEqual([10, 60, 22, -15, 40]);
  });

  it("pins Optics / Color-Mixer / Color-Grading / Transform tail offsets", () => {
    const r = createDefaultRecipe();
    r.optics.distortionAmount = 3;
    r.optics.aberration = 1;
    r.optics.defringePurpleAmount = 2;
    r.colorMixer.hue = [1, 2, 3, 4, 5, 6, 7, 8];
    r.colorMixer.saturation = [-1, -2, -3, -4, -5, -6, -7, -8];
    r.colorMixer.luminance = [9, 9, 9, 9, 9, 9, 9, 9];
    r.colorGrading.shadows = { hue: 200, sat: 10, lum: 99 }; // lum dropped by the v1 ABI
    r.colorGrading.midtones = { hue: 100, sat: 5, lum: 0 };
    r.colorGrading.highlights = { hue: 50, sat: 3, lum: 0 };
    r.transform.vertical = 4;
    r.transform.horizontal = -2;
    r.transform.rotate = 1.5;
    const p = recipeToParams(r);
    // Optics @ 1050
    expect([p[1050], p[1051], p[1052]]).toEqual([3, 1, 2]);
    // Mixer @ 1053 (hue), 1061 (sat), 1069 (lum)
    expect(Array.from(p.slice(1053, 1061))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(p.slice(1061, 1069))).toEqual([-1, -2, -3, -4, -5, -6, -7, -8]);
    expect(Array.from(p.slice(1069, 1077))).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
    // Grade @ 1077 (shadow hue/sat, mid hue/sat, high hue/sat) — lum not in ABI
    expect(Array.from(p.slice(1077, 1083))).toEqual([200, 10, 100, 5, 50, 3]);
    // Transform @ 1083
    expect(Array.from(p.slice(1083, 1086))).toEqual([4, -2, 1.5]);
  });

  it("curveEnabled flag follows the panel enable", () => {
    const r = createDefaultRecipe();
    r.enabled.toneCurve = false;
    expect(recipeToParams(r)[25]).toBe(0);
  });

  it("reads a legacy boolean removeChromaticAberration at the aberration slot [1051]", () => {
    // An un-migrated legacy recipe carries the boolean, not `aberration`. The ABI
    // must still resolve it to 1 at p[1051] (back-compat: existing recipes render
    // byte-identically).
    const r = createDefaultRecipe();
    const legacy = { ...r, optics: { ...r.optics, removeChromaticAberration: true } };
    delete (legacy.optics as { aberration?: number }).aberration;
    expect(recipeToParams(legacy)[1051]).toBe(1);
  });
});

describe("recipeToParams — Camera Calibration advanced tail", () => {
  const CAL_KEYS = ["shadowTint", "redHue", "redSat", "greenHue", "greenSat", "blueHue", "blueSat"] as const;

  it("stays 1086 unless calibration is non-neutral (zero regression for existing photos)", () => {
    expect(recipeToParams(createDefaultRecipe()).length).toBe(1086);
    // A non-calibration edit alone must NOT append the tail.
    const r = createDefaultRecipe();
    r.basic.exposure = 1;
    r.effects.grainAmount = 50;
    expect(recipeToParams(r).length).toBe(1086);
  });

  it("appends the 1113-float legacy tail at engine-verified offsets when active", () => {
    const r = createDefaultRecipe();
    Object.assign(r.calibration, {
      shadowTint: 0.2, redHue: -0.1, redSat: 0.5, greenHue: 0.3, greenSat: -0.4, blueHue: 0.6, blueSat: -0.7,
    });
    const p = recipeToParams(r);

    expect(p.length).toBe(1113);
    expect(DEVELOP_ADVANCED_PARAMS_LEN).toBe(1113);
    expect(p[1086]).toBe(22026); // magic
    expect(p[1087]).toBe(1); // legacy version
    expect(p[1088]).toBe(0); // profile code 0 = camera-default (no-op)
    expect(p[1089]).toBe(1); // default profile amount (full; engine ignores it at code 0)
    // shadow tint + primaries at 1090..1096.
    expect(Array.from(p.slice(1090, 1097)).map((v) => Math.round(v * 100) / 100)).toEqual([
      0.2, -0.1, 0.5, 0.3, -0.4, 0.6, -0.7,
    ]);
    // Crop/denoise disabled and, critically, heal_count(1111)=mask_count(1112)=0 —
    // Galerie applies crop + masks in TS; a non-zero count would double-render.
    for (let i = 1097; i <= 1112; i++) expect(p[i]).toBe(0);
    // Every advanced float finite (parse_develop_advanced rejects NaN/Inf).
    for (let i = 1086; i < 1113; i++) expect(Number.isFinite(p[i])).toBe(true);
    // The 1086 prefix is preserved verbatim (basic neutral here).
    expect(p[0]).toBe(1);
    for (let i = 2; i <= 14; i++) expect(p[i]).toBe(0);
  });

  it("triggers the tail on any single non-neutral calibration field", () => {
    for (const key of CAL_KEYS) {
      const r = createDefaultRecipe();
      r.calibration[key] = 0.1;
      expect(recipeToParams(r).length).toBe(1113);
    }
  });
});

describe("recipeToParams — Profile advanced tail", () => {
  it("default profile (camera-default, amount 1) stays 1086 — byte-identity preserved", () => {
    const r = createDefaultRecipe();
    expect(r.profile.id).toBe("camera-default");
    expect(r.profile.amount).toBe(1);
    // The whole catalog is stored as neutral recipes; the default must not append
    // the tail or every photo silently re-develops.
    expect(recipeToParams(r).length).toBe(1086);
  });

  it("a non-default profile emits the legacy tail with code + amount at 1088/1089", () => {
    const r = createDefaultRecipe();
    r.profile = { ...r.profile, id: "monochrome", name: "Monochrome" };
    const p = recipeToParams(r);
    expect(p.length).toBe(1113);
    expect(p[1086]).toBe(22026); // magic
    expect(p[1087]).toBe(1); // legacy version (no Point Color)
    expect(p[1088]).toBe(3); // monochrome
    expect(p[1089]).toBe(1); // amount (default = full)
    // Calibration / crop / heal_count / mask_count around the profile block neutral.
    for (let i = 1090; i <= 1112; i++) expect(p[i]).toBe(0);
    for (let i = 1086; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
  });

  it("a non-default amount alone (camera-default) triggers the tail", () => {
    const r = createDefaultRecipe();
    r.profile = { ...r.profile, amount: 0.5 };
    const p = recipeToParams(r);
    expect(p.length).toBe(1113);
    expect(p[1088]).toBe(0); // camera-default code
    expect(p[1089]).toBeCloseTo(0.5); // amount
  });

  it("unknown profile id falls back to code 0 (camera-default no-op)", () => {
    const r = createDefaultRecipe();
    r.profile = { ...r.profile, id: "totally-unknown" };
    const p = recipeToParams(r);
    expect(p.length).toBe(1113); // id !== camera-default → tail appended
    expect(p[1088]).toBe(0); // fallback code 0
  });

  it("keeps embedded (4) / custom (5) in both tails, and a digest rides the v6 identity (#446)", () => {
    const digest = "0123456789ABCDEF0123456789ABCDEF";
    const words = [0x0123, 0x4567, 0x89ab, 0xcdef, 0x0123, 0x4567, 0x89ab, 0xcdef];
    for (const [id, code] of [["embedded", 4], ["custom", 5]] as const) {
      for (const opts of [undefined, { tailFormat: "visionV2" as const }]) {
        const r = createDefaultRecipe();
        r.profile = { ...r.profile, id, name: "Studio" };
        const unpinned = recipeToParams(r, 1, opts);
        expect(unpinned[1088]).toBe(code);
        expect(unpinned[1087]).toBeLessThan(6);
        r.profile.digest = digest;
        const p = recipeToParams(r, 1, opts);
        expect(p[1087]).toBe(6);
        expect(p[1088]).toBe(code);
        // v4 transform + v5 extras (neutral) precede the identity, as the engine parses them.
        expect(p.length).toBe(1164);
        expect(Array.from(p.slice(1138, 1143))).toEqual([0, 1, 0, 0, 0]);
        expect(Array.from(p.slice(-9))).toEqual([...words, 0]); // as-shot white unknown
        r.profile.asShotKelvin = 2850;
        const kelvinParams = recipeToParams(r, 1, opts);
        expect(kelvinParams[kelvinParams.length - 1]).toBe(2850);
      }
    }
    // A digest on a built-in look names nothing.
    const mono = createDefaultRecipe();
    mono.profile = { ...mono.profile, id: "monochrome", digest };
    expect(recipeToParams(mono).length).toBe(1113);
  });

  it("keeps a well-formed profile digest through normalizeRecipe and drops any other", () => {
    const digest = "0123456789ABCDEF0123456789ABCDEF";
    const keep = normalizeRecipe({ profile: { id: "custom", name: "Studio", group: "Custom", amount: 1, digest, asShotKelvin: 2850 } });
    expect(keep.profile).toEqual({ id: "custom", name: "Studio", group: "Custom", amount: 1, digest, asShotKelvin: 2850 });
    for (const bad of [500, 1e6, Number.NaN, "2850"]) {
      expect("asShotKelvin" in normalizeRecipe({ profile: { id: "custom", asShotKelvin: bad } }).profile).toBe(false);
    }
    for (const bad of [digest.toLowerCase(), digest.slice(1), 42, "<script>"]) {
      expect(normalizeRecipe({ profile: { id: "custom", name: "Studio", digest: bad } }).profile.digest).toBeUndefined();
    }
    expect("digest" in normalizeRecipe({}).profile).toBe(false);
  });

  it("clamps Point Color to the engine's socket cap in the DEFAULT tail (#223)", () => {
    // recipeToParams is reachable WITHOUT normalizeRecipe (galerie parses the
    // stored recipeJson straight into a preview), and a socket count above
    // DEV_MAX_POINT_COLORS makes the engine reject the WHOLE tail atomically —
    // calibration, profile and every heal spot with it.
    const r = createDefaultRecipe();
    r.pointColor.samples = Array.from({ length: 12 }, () => ({
      srcHue: 210, srcSat: 0.5, srcLum: 0.4, hue: -0.2, sat: 0.3, lum: 0.1, range: 0.6,
    }));
    const p = recipeToParams(r);
    expect(p[1137]).toBe(MAX_POINT_COLOR_SAMPLES); // socket count (0 heals) — was 12
    expect(p.length).toBe(1138 + MAX_POINT_COLOR_SAMPLES * 7); // was 1222
    expect(Array.from(p).every(Number.isFinite)).toBe(true);
  });

  it("profile coexists with heals + Point Color, offsets stay aligned", () => {
    const r = createDefaultRecipe();
    r.profile = { ...r.profile, id: "adobe-color", name: "Adobe Color" };
    r.heal.spots = [
      { mode: "heal", x: 0.5, y: 0.25, sourceX: 0.58, sourceY: 0.25, radius: 0.02, feather: 0.5, opacity: 1 },
    ];
    r.pointColor.samples = [{ srcHue: 210, srcSat: 0.5, srcLum: 0.4, hue: -0.2, sat: 0.3, lum: 0.1, range: 0.6 }];
    const p = recipeToParams(r);
    expect(p[1087]).toBe(3); // v3 (Point Color present)
    expect(p[1088]).toBe(1); // adobe-color
    expect(p[1089]).toBe(1); // amount
    expect(p[1111]).toBe(1); // heal_count — profile write didn't shift it
    // Socket lands after the 8·healCount shift (same layout as the heal+PC test).
    expect(p[1145]).toBe(1); // socket count
    expect(p[1146]).toBe(210); // socket refHue
    for (let i = 1086; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
  });
});

describe("recipeToParams — Galerie default path unaffected by the tailFormat opt", () => {
  // A neutral, a calibration-only, and a point-color recipe: the three Galerie
  // tail shapes (1086 / v1 legacy / v3). Absent opts and { tailFormat: "auto" }
  // must be byte-identical, and must equal the documented default output — i.e.
  // adding the opt is a strict no-op for every existing Galerie caller.
  const recipes: Record<string, () => ReturnType<typeof createDefaultRecipe>> = {
    neutral: () => createDefaultRecipe(),
    calibration: () => {
      const r = createDefaultRecipe();
      Object.assign(r.calibration, { shadowTint: 0.2, redHue: -0.1, blueSat: -0.7 });
      return r;
    },
    pointColor: () => {
      const r = createDefaultRecipe();
      r.pointColor.samples = [{ srcHue: 210, srcSat: 0.5, srcLum: 0.4, hue: -0.2, sat: 0.3, lum: 0.1, range: 0.6 }];
      return r;
    },
  };

  for (const [name, make] of Object.entries(recipes)) {
    it(`${name}: no opts === { tailFormat: "auto" }, byte-for-byte`, () => {
      const bare = recipeToParams(make(), 1);
      const auto = recipeToParams(make(), 1, { tailFormat: "auto" });
      expect(Array.from(auto)).toEqual(Array.from(bare));
    });
  }

  it("preserves the documented default lengths (1086 / 1113 / 1145)", () => {
    expect(recipeToParams(recipes.neutral(), 1).length).toBe(1086);
    expect(recipeToParams(recipes.calibration(), 1).length).toBe(1113);
    expect(recipeToParams(recipes.pointColor(), 1).length).toBe(1145);
    expect(recipeToParams(recipes.neutral(), 1, { tailFormat: "auto" }).length).toBe(1086);
    expect(recipeToParams(recipes.calibration(), 1, { tailFormat: "auto" }).length).toBe(1113);
    expect(recipeToParams(recipes.pointColor(), 1, { tailFormat: "auto" }).length).toBe(1145);
  });
});

describe("recipeToParams — Point Color v3 advanced tail", () => {
  const socket = { srcHue: 210, srcSat: 0.5, srcLum: 0.4, hue: -0.2, sat: 0.3, lum: 0.1, range: 0.6 };

  it("no samples → no v3 tail (stays 1086, zero regression)", () => {
    expect(createDefaultRecipe().pointColor.samples.length).toBe(0);
    expect(recipeToParams(createDefaultRecipe()).length).toBe(1086);
  });

  it("one sample → v3 tail: identity curve-source + the socket at engine offsets", () => {
    const r = createDefaultRecipe();
    r.pointColor.samples = [socket];
    const p = recipeToParams(r);
    // 1086 + 27 (v1 block) + 24 (curve-source) + 1 (count) + 7 (socket) = 1145.
    expect(p.length).toBe(1145);
    expect(p[1086]).toBe(22026); // magic
    expect(p[1087]).toBe(3); // v3
    // v1 block: default profile (code 0, amount 1), then calibration/crop/heal/
    // mask counts all neutral.
    expect(p[1088]).toBe(0); // camera-default code
    expect(p[1089]).toBe(1); // default amount
    for (let i = 1090; i <= 1112; i++) expect(p[i]).toBe(0);
    // Curve-source: 4 parametric zero, then 4 identity channels [2, 0,0,1,1].
    for (let i = 1113; i <= 1116; i++) expect(p[i]).toBe(0);
    for (let ch = 0; ch < 4; ch++) {
      const c = 1117 + ch * 5;
      expect([p[c], p[c + 1], p[c + 2], p[c + 3], p[c + 4]]).toEqual([2, 0, 0, 1, 1]);
    }
    // Socket count then [refHue, refSat, refLum, hue, sat, lum, range].
    expect(p[1137]).toBe(1);
    expect(Array.from(p.slice(1138, 1145))).toEqual(
      [210, 0.5, 0.4, -0.2, 0.3, 0.1, 0.6].map((v) => Math.fround(v)),
    );
    // Every advanced float finite — parse_develop_advanced rejects NaN/Inf.
    for (let i = 1086; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
  });

  it("length grows by 7 per socket, up to the engine's max of 8", () => {
    for (let n = 1; n <= 8; n++) {
      const r = createDefaultRecipe();
      r.pointColor.samples = Array.from({ length: n }, () => ({ ...socket }));
      expect(recipeToParams(r).length).toBe(1138 + n * 7);
    }
  });

  it("Point Color forces v3 and coexists with Calibration in one tail", () => {
    const r = createDefaultRecipe();
    r.pointColor.samples = [socket];
    r.calibration.redSat = 0.5;
    const p = recipeToParams(r);
    expect(p[1087]).toBe(3); // v3
    expect(p[1092]).toBeCloseTo(0.5); // calibration redSat at 1092 (v1 block preserved)
    expect(p[1138]).toBe(210); // socket refHue after the curve-source
  });
});

describe("recipeToParams — Heal spots in the advanced tail", () => {
  const spot = {
    mode: "heal" as const,
    x: 0.5, y: 0.25, sourceX: 0.58, sourceY: 0.25,
    radius: 0.02, feather: 0.5, opacity: 1,
  };

  it("no spots → no tail (stays 1086, zero regression)", () => {
    expect(createDefaultRecipe().heal.spots.length).toBe(0);
    expect(recipeToParams(createDefaultRecipe()).length).toBe(1086);
  });

  it("spots alone trigger a v1 tail with 8 floats per spot at engine offsets", () => {
    const r = createDefaultRecipe();
    r.heal.spots = [spot, { ...spot, mode: "clone", x: 0.1, opacity: 0.7 }];
    const p = recipeToParams(r);
    expect(p.length).toBe(1113 + 2 * 8);
    expect(p[1086]).toBe(22026); // magic
    expect(p[1087]).toBe(1); // legacy version (no Point Color)
    expect(p[1088]).toBe(0); // default profile code
    expect(p[1089]).toBe(1); // default profile amount
    for (let i = 1090; i <= 1110; i++) expect(p[i]).toBe(0); // cal/crop neutral
    expect(p[1111]).toBe(2); // heal_count
    // Engine record order: [mode, x, y, sourceX, sourceY, radius, feather, opacity].
    expect(Array.from(p.slice(1112, 1120))).toEqual(
      [0, 0.5, 0.25, 0.58, 0.25, 0.02, 0.5, 1].map((v) => Math.fround(v)),
    );
    expect(p[1120]).toBe(1); // second spot: clone → mode 1
    expect(p[1121]).toBeCloseTo(0.1); // second spot x
    expect(p[1127]).toBeCloseTo(0.7); // second spot opacity
    expect(p[1128]).toBe(0); // mask_count floats AFTER the heal block
    for (let i = 1086; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
  });

  it("shifts the v3 curve-source and sockets right by 8·healCount", () => {
    const r = createDefaultRecipe();
    r.heal.spots = [spot];
    r.pointColor.samples = [{ srcHue: 210, srcSat: 0.5, srcLum: 0.4, hue: -0.2, sat: 0.3, lum: 0.1, range: 0.6 }];
    const p = recipeToParams(r);
    expect(p.length).toBe(1145 + 8);
    expect(p[1087]).toBe(3); // v3
    expect(p[1111]).toBe(1); // heal_count
    expect(p[1112]).toBe(0); // the spot's mode (heal)
    expect(p[1120]).toBe(0); // mask_count after the 8-float spot
    // Identity curve-source channels moved from 1117+ch·5 to 1125+ch·5.
    for (let ch = 0; ch < 4; ch++) {
      const c = 1125 + ch * 5;
      expect([p[c], p[c + 1], p[c + 2], p[c + 3], p[c + 4]]).toEqual([2, 0, 0, 1, 1]);
    }
    expect(p[1145]).toBe(1); // socket count (was 1137)
    expect(p[1146]).toBe(210); // socket refHue (was 1138)
  });

  it("clamps to the engine cap of 64 spots (a longer list would reject the tail)", () => {
    const r = createDefaultRecipe();
    r.heal.spots = Array.from({ length: 70 }, () => ({ ...spot }));
    const p = recipeToParams(r);
    expect(MAX_HEAL_SPOTS).toBe(64);
    expect(p[1111]).toBe(64);
    expect(p.length).toBe(1113 + 64 * 8);
  });
});

describe("tone curve parametric splits reach the render", () => {
  const masterLut = (r: ReturnType<typeof createDefaultRecipe>) =>
    Array.from(recipeToParams(r).slice(CURVE_BASE, CURVE_BASE + 256));

  /** A recipe with a non-flat parametric curve, so moving a split point can
   *  actually change the composed master LUT. */
  const shaped = () => {
    const r = createDefaultRecipe();
    r.toneCurve.parametric = { ...r.toneCurve.parametric, highlights: 60, shadows: -60 };
    return r;
  };

  it("default splits are byte-identical to the historical quarter knots", () => {
    const explicit = shaped();
    explicit.toneCurve.parametricSplits = [0.25, 0.5, 0.75];
    expect(masterLut(explicit)).toEqual(masterLut(shaped()));
  });

  it("moving a split point changes the rendered curve, not just the panel", () => {
    const moved = shaped();
    moved.toneCurve.parametricSplits = [0.1, 0.5, 0.9];
    // Before the fix recipeToParams dropped the splits argument entirely, so
    // this came back equal and the handles were purely cosmetic.
    expect(masterLut(moved)).not.toEqual(masterLut(shaped()));
  });
});
