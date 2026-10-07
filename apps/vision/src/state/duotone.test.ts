// Image ▸ Mode ▸ Duotone: the ink model (transfer curves, subtractive ink mixing,
// Overprint Colors) and the store wiring that turns a document into a duotone one
// — a grayscale plate plus an editable ink composite.
import { describe, expect, it, vi } from "vitest";
import {
  DUOTONE_CURVE_INPUTS, DUOTONE_PRESETS, decodeDuotoneSpec, duotoneColorAt, duotoneInk, duotoneLutF32, encodeDuotoneSpec,
  gammaInkCurve, inkDensity, inkPlateLut, linearInkCurve, normalizeDuotoneInkSpec, normalizeDuotoneInks, overprintCombos,
  overprintKey, presetForInkCount, type Ink,
} from "./duotone";

const BLACK: Ink = [0, 0, 0];
const TAN: Ink = [176, 122, 45];
const at = (lut: Float32Array, i: number): Ink =>
  [Math.round(lut[i * 3] * 255), Math.round(lut[i * 3 + 1] * 255), Math.round(lut[i * 3 + 2] * 255)];
const near = (a: Ink, b: Ink, tol = 2) => a.every((v, c) => Math.abs(v - b[c]) <= tol);

describe("inkDensity", () => {
  it("hits every curve stop exactly and interpolates between them", () => {
    const curve = linearInkCurve();
    DUOTONE_CURVE_INPUTS.forEach((x, i) => expect(inkDensity(curve, x)).toBeCloseTo(curve[i] / 100, 6));
    expect(inkDensity(curve, 15)).toBeCloseTo(0.15, 6); // between the 10 and 20 stops
  });

  it("clamps outside the tonal range and rides a non-linear curve", () => {
    const curve = gammaInkCurve(2);
    expect(inkDensity(curve, -20)).toBe(0);
    expect(inkDensity(curve, 400)).toBe(1);
    expect(inkDensity(curve, 50)).toBeLessThan(0.5); // gamma 2 holds the ink back into the shadows
  });
});

describe("normalizeDuotoneInks", () => {
  it("caps at four inks, pads short curves and clamps out-of-range values", () => {
    const five = [1, 2, 3, 4, 5].map((n) => duotoneInk(`Ink ${n}`, [n, n, n]));
    expect(normalizeDuotoneInks(five)).toHaveLength(4);
    const [ink] = normalizeDuotoneInks([{ name: "  ", color: [300, -5, 20] as Ink, curve: [0, 500, -100] }]);
    expect(ink.name).toBe("Ink 1"); // a blank name still labels its plate
    expect(ink.color).toEqual([255, 0, 20]);
    expect(ink.curve).toHaveLength(DUOTONE_CURVE_INPUTS.length);
    expect(ink.curve[1]).toBe(100);
    expect(ink.curve[2]).toBe(0);
    expect(ink.curve[12]).toBe(100); // padded from the linear default
  });

  it("falls back to a single black ink rather than an empty set", () => {
    expect(normalizeDuotoneInks([])).toEqual([duotoneInk("Black", BLACK)]);
  });
});

describe("duotoneLutF32", () => {
  it("a linear black monotone is the identity gray ramp", () => {
    const lut = duotoneLutF32([duotoneInk("Black", BLACK)]);
    expect(lut.length).toBe(256 * 3);
    expect(at(lut, 0)).toEqual([0, 0, 0]); // plate shadow → 100% ink
    expect(at(lut, 255)).toEqual([255, 255, 255]); // plate highlight → bare paper
    expect(near(at(lut, 128), [128, 128, 128])).toBe(true);
  });

  it("inks mix subtractively: two inks are darker than either alone", () => {
    const black = duotoneInk("Black", BLACK, gammaInkCurve(1.4));
    const tan = duotoneInk("Tan", TAN, gammaInkCurve(0.7, 85));
    const both = at(duotoneLutF32([black, tan]), 96);
    const onlyBlack = at(duotoneLutF32([black]), 96);
    const onlyTan = at(duotoneLutF32([tan]), 96);
    for (let c = 0; c < 3; c++) {
      expect(both[c]).toBeLessThanOrEqual(Math.min(onlyBlack[c], onlyTan[c]));
    }
  });

  it("a mid-tone ink tints the mid-tones without moving the paper white", () => {
    const lut = duotoneLutF32([duotoneInk("Black", BLACK, gammaInkCurve(1.5)), duotoneInk("Tan", TAN, gammaInkCurve(0.7, 85))]);
    expect(at(lut, 255)).toEqual([255, 255, 255]);
    const mid = at(lut, 160);
    expect(mid[0]).toBeGreaterThan(mid[2]); // warm cast: more red than blue
  });
});

describe("overprint colours", () => {
  it("lists the combinations Photoshop's dialog shows, pairs before triples", () => {
    expect(overprintCombos(2)).toEqual([[0, 1]]);
    expect(overprintCombos(3)).toEqual([[0, 1], [0, 2], [1, 2], [0, 1, 2]]);
    expect(overprintCombos(1)).toEqual([]);
    expect(overprintKey([2, 0])).toBe("0+2");
  });

  it("overrides the colour where the combination prints solid", () => {
    const inks = [duotoneInk("A", [200, 0, 0]), duotoneInk("B", [0, 0, 200])];
    const measured: Ink = [40, 90, 30]; // a press proof the multiply model cannot predict
    const plain = duotoneColorAt(inks, {}, 100);
    const fixed = duotoneColorAt(inks, { [overprintKey([0, 1])]: measured }, 100);
    expect(near(fixed, measured)).toBe(true);
    expect(near(plain, measured, 20)).toBe(false);
  });

  it("fades out with the combination's joint density and ignores stale keys", () => {
    const inks = [duotoneInk("A", [200, 0, 0]), duotoneInk("B", [0, 0, 200])];
    const op = { [overprintKey([0, 1])]: [40, 90, 30] as Ink };
    expect(duotoneColorAt(inks, op, 0)).toEqual([255, 255, 255]); // no ink down, no correction
    // A key naming an ink that no longer exists (Tritone → Duotone) is inert.
    expect(duotoneColorAt(inks, { "0+2": [0, 255, 0] }, 100)).toEqual(duotoneColorAt(inks, {}, 100));
    // (#164) …including a TRIPLE left behind by the same switch. It used to have
    // its out-of-range index filtered out and was applied as the 0+1 pair.
    expect(duotoneColorAt(inks, { "0+1+2": [0, 255, 0] }, 100)).toEqual(duotoneColorAt(inks, {}, 100));
    expect(duotoneColorAt(inks, { "0+1+3": [0, 255, 0] }, 100)).toEqual(duotoneColorAt(inks, {}, 100));
    // A live triple on a real tritone still applies.
    const tri = [...inks, duotoneInk("C", [0, 200, 0])];
    expect(duotoneColorAt(tri, { "0+1+2": [0, 255, 0] }, 100))
      .not.toEqual(duotoneColorAt(tri, {}, 100));
  });
});

describe("inkPlateLut", () => {
  it("is the ink's density per plate level — the press separation", () => {
    const plate = inkPlateLut(duotoneInk("Black", BLACK));
    expect(plate.length).toBe(256);
    expect(plate[0]).toBe(255); // plate shadow prints solid
    expect(plate[255]).toBe(0); // plate highlight prints nothing
    expect(Math.abs(plate[128] - 128)).toBeLessThanOrEqual(2);
  });
});

describe("DUOTONE_PRESETS", () => {
  it("ships a monotone through quadtone set, all already normalised", () => {
    for (const n of [1, 2, 3, 4]) expect(presetForInkCount(n).inks).toHaveLength(n);
    for (const p of DUOTONE_PRESETS) expect(normalizeDuotoneInks(p.inks)).toEqual(p.inks);
  });
});

// ── Photoshop Duotone files (#459) ─────────────────────────────────────────────
// The inks travel in the colour mode data, laid out like a Duotone Options
// (.ado) file: colours at 4, names at 44, curves at 300, dot gain at 412,
// overprints at 414. A colour Photoshop left unset has colour space 0xFFFF.
describe("Duotone ink specification", () => {
  const u16 = (spec: Uint8Array, at: number) => new DataView(spec.buffer, spec.byteOffset).getUint16(at);
  const i16 = (spec: Uint8Array, at: number) => new DataView(spec.buffer, spec.byteOffset).getInt16(at);
  const hex = (text: string) => Uint8Array.from(text.match(/../g)!.map((b) => parseInt(b, 16)));
  // psd-tools' 4x4_8bit_duotone.psd, saved by Photoshop: a CMYK "Black" ink, a
  // colour-book "PANTONE 327 CVC", sparse curves and its one overprint unset.
  const PHOTOSHOP_SPEC = hex(
    "000100020002ffffffffffff000000032020333237430000ffff0000000000000000ffff000000000000000005426c61636b0000" +
    "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "000000000f50414e544f4e4520333237204356430000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffff" +
    "0190ffffffffffffffffffff03e800000000ffffffffffffffffffff015effffffff02bcffffffff03e800000000ffffffffffff" +
    "ffffffffffffffffffffffffffffffff03e800000000ffffffffffffffffffffffffffffffffffffffffffff03e800000014ffff" +
    "0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000" +
    "000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff00000000" +
    "00000000",
  );
  // The same file's Alternate Duotone Colors (1066): both inks as Lab.
  const PHOTOSHOP_ALTERNATES = hex("00010002000703b901f201a90000000711c5e638fe0c00000100");

  it("lays a tritone out like a Duotone Options file and reads it back exactly", () => {
    const inks = DUOTONE_PRESETS[3].inks;
    const overprints = { "0+2": [12, 34, 56] as Ink };
    const spec = encodeDuotoneSpec({ inks, overprints });
    expect(spec.length).toBe(524);
    expect([u16(spec, 0), u16(spec, 2)]).toEqual([1, 3]); // version, ink count
    expect([0, 1, 2, 3, 4].map((i) => u16(spec, 14 + i * 2))).toEqual([0, 166 * 257, 25 * 257, 46 * 257, 0]); // ink 2, RGB
    expect(u16(spec, 34)).toBe(0xffff); // the fourth ink is unused
    expect(String.fromCharCode(...spec.subarray(45, 45 + spec[44]))).toBe("Black");
    expect(DUOTONE_CURVE_INPUTS.map((_, j) => i16(spec, 300 + 28 + j * 2))).toEqual(inks[1].curve.map((v) => v * 10));
    expect([i16(spec, 300 + 3 * 28), i16(spec, 300 + 3 * 28 + 2), i16(spec, 300 + 3 * 28 + 24)]).toEqual([0, -1, 1000]); // the unused ink's NULL curve
    expect(u16(spec, 412)).toBe(20); // dot gain
    // Tritone overprints in Photoshop's order: 1+2, 1+3, 2+3, 1+2+3. Only 1+3 is
    // set; the rest stay unset for Photoshop to predict.
    expect([0, 1, 2, 3].map((slot) => u16(spec, 414 + slot * 10))).toEqual([0xffff, 0, 0xffff, 0xffff]);
    expect([0, 1, 2].map((c) => u16(spec, 414 + 10 + 2 + c * 2) / 257)).toEqual([12, 34, 56]);

    expect(decodeDuotoneSpec(spec)).toEqual({ inks, overprints });
  });

  it("reads Photoshop's own Duotone file: book ink previewed, overprint left to the ink model", () => {
    const decoded = decodeDuotoneSpec(PHOTOSHOP_SPEC, PHOTOSHOP_ALTERNATES)!;
    expect(decoded.inks.map((ink) => ink.name)).toEqual(["Black", "PANTONE 327 CVC"]);
    expect(decoded.inks[0].color).toEqual([0, 0, 0]); // CMYK K 100%
    expect(decoded.inks[1].color).toEqual([0, 132, 114]); // its Lab alternate, not black
    // Sparse Photoshop curves: 40% ink at 50% tone, the stops between interpolated.
    expect(decoded.inks[0].curve).toEqual([0, 4, 8, 16, 24, 32, 40, 52, 64, 76, 88, 94, 100]);
    expect(decoded.inks[1].curve[6]).toBe(35);
    expect(decoded.overprints).toEqual({}); // unset, not an explicit black
    // Without the alternates a book ink still previews as a colour, keeping its name.
    expect(decodeDuotoneSpec(PHOTOSHOP_SPEC)!.inks[1].color).toEqual([128, 128, 128]);
  });

  it("re-saves an unedited Photoshop Duotone byte for byte", () => {
    const decoded = decodeDuotoneSpec(PHOTOSHOP_SPEC, PHOTOSHOP_ALTERNATES)!;
    // Colour structures, names, the sparse curves (points at 0/50/100 only),
    // dot gain and the unset overprints all go back as the file stated them.
    expect(encodeDuotoneSpec(decoded)).toEqual(PHOTOSHOP_SPEC);
    // A project stores the inks as data; they still re-save exactly.
    const stored = normalizeDuotoneInkSpec(JSON.parse(JSON.stringify(decoded)))!;
    expect(encodeDuotoneSpec(stored)).toEqual(PHOTOSHOP_SPEC);

    // An edited curve goes out with all 13 stops; the untouched ink's stays sparse.
    const curve = decoded.inks[1].curve.map((v, j) => (j === 3 ? v + 5 : v));
    const edited = encodeDuotoneSpec({ ...decoded, inks: [decoded.inks[0], { ...decoded.inks[1], curve }] });
    expect(edited.subarray(300, 328)).toEqual(PHOTOSHOP_SPEC.subarray(300, 328));
    expect(DUOTONE_CURVE_INPUTS.map((_, j) => i16(edited, 328 + j * 2))).toEqual(curve.map((v) => v * 10));
    expect(decodeDuotoneSpec(edited, PHOTOSHOP_ALTERNATES)!.inks[1].curve).toEqual(curve);
  });

  it("re-saves a Photoshop Duotone's colours exactly as the file stated them", () => {
    const decoded = decodeDuotoneSpec(PHOTOSHOP_SPEC, PHOTOSHOP_ALTERNATES)!;
    const resaved = encodeDuotoneSpec(decoded);
    expect(decodeDuotoneSpec(resaved, PHOTOSHOP_ALTERNATES)).toEqual(decoded);

    // A changed colour goes out as RGB; the untouched ink keeps its structure.
    const recoloured = { ...decoded, inks: decoded.inks.map((ink, i) => (i === 1 ? { ...ink, color: [200, 30, 40] as Ink } : ink)) };
    const edited = encodeDuotoneSpec(recoloured);
    expect(edited.subarray(4, 14)).toEqual(PHOTOSHOP_SPEC.subarray(4, 14));
    expect([0, 1, 2, 3, 4].map((i) => u16(edited, 14 + i * 2))).toEqual([0, 200 * 257, 30 * 257, 40 * 257, 0]);
  });

  it("reads Photoshop's other colour spaces, sparse curves and measured overprints", () => {
    const spec = encodeDuotoneSpec({ inks: [duotoneInk("Process Black", BLACK), duotoneInk("Warm", TAN)], overprints: {} });
    const view = new DataView(spec.buffer);
    [7, 5000, 0, 0].forEach((v, i) => (i < 2 ? view.setUint16(14 + i * 2, v) : view.setInt16(14 + i * 2, v))); // Lab L50
    view.setUint16(14 + 8, 0);
    [0, -1, -1, -1, -1, -1, 500, -1, -1, -1, -1, -1, 1000].forEach((v, j) => view.setInt16(300 + j * 2, v));
    [0, 0, 65535, 0, 0].forEach((v, i) => view.setUint16(414 + i * 2, v)); // a measured green overprint

    const decoded = decodeDuotoneSpec(spec)!;
    expect(decoded.inks[1].color.every((v) => Math.abs(v - 119) <= 1)).toBe(true); // L 50 is middle gray
    expect(decoded.inks[1].spec?.bytes).toEqual([...spec.subarray(14, 24)]); // kept as Lab
    expect(decoded.inks[0].curve).toEqual(linearInkCurve()); // the left-out stops are interpolated
    expect(decoded.overprints).toEqual({ "0+1": [0, 255, 0] });
  });

  it("writes names Photoshop can read and refuses bytes that are no spec", () => {
    const long = "Pantone \u00e9t\u00e9 ".repeat(8);
    const spec = encodeDuotoneSpec({ inks: [duotoneInk(long, BLACK)], overprints: {} });
    expect(spec[44]).toBe(63);
    expect(decodeDuotoneSpec(spec)!.inks[0].name).toBe(long.slice(0, 63).replace(/[^ -~]/g, "?").trim());
    expect(decodeDuotoneSpec(spec.subarray(0, 523))).toBeNull();
    for (const [at, value] of [[0, 2], [2, 0], [2, 5]]) {
      const bad = spec.slice();
      new DataView(bad.buffer).setUint16(at, value);
      expect(decodeDuotoneSpec(bad)).toBeNull();
    }
  });

  it("restores a stored ink specification and drops what does not fit it", () => {
    const stored = JSON.parse(JSON.stringify(decodeDuotoneSpec(PHOTOSHOP_SPEC, PHOTOSHOP_ALTERNATES)));
    stored.overprints = { "0+1": [1, 2, 3], "0+2": [4, 5, 6], "0+1+x": [7, 8, 9] };
    stored.inks[1].spec.bytes = [1, 2, 3];
    const restored = normalizeDuotoneInkSpec(stored)!;
    expect(restored.overprints).toEqual({ "0+1": [1, 2, 3] });
    expect(restored.inks[0].spec?.bytes).toEqual([...PHOTOSHOP_SPEC.subarray(4, 14)]);
    expect(restored.inks[1].spec).toBeUndefined();
    expect(normalizeDuotoneInkSpec({ inks: [] })).toBeNull();
    expect(normalizeDuotoneInkSpec("nope")).toBeNull();
  });
});

// ── store wiring ─────────────────────────────────────────────────────────────
// Engine-free (node), mirroring the newStore() idiom in layerCompStore.test.ts.
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = [string, ...unknown[]];

function storeWith() {
  const calls: Call[] = [];
  const layers: number[] = [];
  let mode = 0;
  const eng = {
    doc_mode: () => mode,
    convert_grayscale: () => { mode = 1; calls.push(["convert_grayscale"]); },
    set_mode: (m: number) => { mode = m; calls.push(["set_mode", m]); },
    add_adjustment_layer: (kind: number, params: Float32Array, name: string) => {
      calls.push(["add_adjustment_layer", kind, params, name]);
      layers.push(41 + layers.length);
      return layers[layers.length - 1];
    },
    set_adjustment_params: (id: number, params: Float32Array) => calls.push(["set_adjustment_params", id, params]),
    layer_count: () => layers.length,
    layer_id_at: (i: number) => layers[i],
    layer_kind: () => 1, // every layer this harness makes is an adjustment
    layer_adj_kind: () => 13,
    layer_name: () => "Duotone",
    undo_pushes: () => 0,
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), eng, calls, drop: () => layers.splice(0, layers.length) };
}

describe("convertDuotone", () => {
  it("makes a duotone document: one gray plate under an ink composite", () => {
    const { store, calls } = storeWith();
    store.convertDuotone(DUOTONE_PRESETS[1].inks);
    expect(calls.map((c) => c[0])).toEqual(["convert_grayscale", "add_adjustment_layer"]);
    const [, kind, params, name] = calls[1];
    expect(kind).toBe(13); // gradient-map adjustment: the plate itself is untouched
    expect(name).toBe("Duotone");
    expect((params as Float32Array).length).toBe(256 * 3);
    expect(store.state.duotone?.inks).toEqual(DUOTONE_PRESETS[1].inks);
    expect(store.state.duotone?.layerId).toBe(41);
  });

  it("adopts the ink layer a reload left behind instead of stacking a second", () => {
    // A tab switch or a project reload rebuilds every layer id, so the store's
    // record of the ink layer is gone while the layer itself is still in the
    // document. Re-opening Duotone Options then built a SECOND gradient map on
    // top of the first, double-inking the document (#492).
    const { store, calls } = storeWith();
    store.convertDuotone(DUOTONE_PRESETS[1].inks);
    const layerId = store.state.duotone?.layerId;
    calls.length = 0;
    store.setDuotoneRecord(null); // what activateDoc / a reload leaves behind

    store.convertDuotone(DUOTONE_PRESETS[2].inks);

    expect(calls.map((c) => c[0])).toEqual(["set_adjustment_params"]);
    expect(calls[0][1]).toBe(layerId);
    expect(store.state.duotone?.layerId).toBe(layerId);
    expect(store.state.duotone?.inks).toEqual(DUOTONE_PRESETS[2].inks);
  });

  it("re-inks an existing duotone document instead of re-mapping its pixels", () => {
    const { store, calls } = storeWith();
    store.convertDuotone(DUOTONE_PRESETS[1].inks);
    calls.length = 0;
    const relit = DUOTONE_PRESETS[1].inks.map((ink, i) => (i === 1 ? { ...ink, color: [0, 120, 255] as Ink } : ink));
    store.convertDuotone(relit, { "0+1": [10, 20, 30] });
    expect(calls.map((c) => c[0])).toEqual(["set_adjustment_params"]); // no second grayscale, no second layer
    expect(calls[0][1]).toBe(41);
    expect(store.state.duotone?.inks[1].color).toEqual([0, 120, 255]);
    expect(store.state.duotone?.overprints).toEqual({ "0+1": [10, 20, 30] });
  });

  it("normalises the ink set it is handed", () => {
    const { store } = storeWith();
    store.convertDuotone([{ name: "Cyan", color: [0, 400, 255] as Ink, curve: [] }]);
    expect(store.state.duotone?.inks[0].color).toEqual([0, 255, 255]);
    expect(store.state.duotone?.inks[0].curve).toEqual(linearInkCurve());
  });

  it("stays out of the way when the engine refuses the grayscale conversion", () => {
    const { store, eng, calls } = storeWith();
    eng.convert_grayscale = () => { calls.push(["convert_grayscale"]); }; // 32-bit float document: refused
    store.convertDuotone(DUOTONE_PRESETS[1].inks);
    expect(calls.map((c) => c[0])).toEqual(["convert_grayscale"]);
    expect(store.state.duotone).toBeNull();
  });

  it("leaving Duotone for another mode drops the ink specification", () => {
    const { store } = storeWith();
    store.convertDuotone(DUOTONE_PRESETS[2].inks);
    expect(store.state.duotone).not.toBeNull();
    store.setColorMode(0); // Image ▸ Mode ▸ RGB
    expect(store.state.duotone).toBeNull();
  });

  it("re-converts from scratch once the ink layer is gone", () => {
    const { store, calls, drop } = storeWith();
    store.convertDuotone(DUOTONE_PRESETS[1].inks);
    drop(); // the user deleted the Duotone adjustment layer
    calls.length = 0;
    store.convertDuotone(DUOTONE_PRESETS[1].inks);
    expect(calls.map((c) => c[0])).toEqual(["convert_grayscale", "add_adjustment_layer"]);
  });
});

// The inks belong to one document and only while its ink layer is there: a
// stale record made another file save as Duotone and dropped the layer whose id
// it happened to name (#459).
describe("a document's Duotone record", () => {
  /** A Photoshop open's engine: Grayscale, one layer (`id`) of `kind`. */
  function openedEngine(id: number, kind: number, more: Record<string, unknown> = {}) {
    const known: Record<string, unknown> = {
      doc_mode: () => 1,
      photoshop_duotone_spec: () => new Uint8Array(0),
      photoshop_duotone_alternates: () => new Uint8Array(0),
      photoshop_paths_json: () => "[]",
      width: () => 4,
      height: () => 4,
      layer_count: () => 1,
      layer_id_at: () => id,
      layer_kind: () => kind,
      layer_adj_kind: () => 13,
      ...more,
    };
    return new Proxy(known, { get: (t, key) => (key in t ? t[key as string] : () => 0) });
  }
  function storeOpening(eng: unknown) {
    const client = { engine: null, e: null, onCommit: null, onEditError: vi.fn(), lastBrush: [] as number[], activate: vi.fn(), buildFormat: vi.fn(() => eng) };
    return new Store(client as never);
  }
  const record = { inks: DUOTONE_PRESETS[1].inks, overprints: {}, layerId: 2 };
  /** The store's own active id; the fake client never publishes it to state. */
  const active = (store: Store) => (store as unknown as { activeDocId: number }).activeDocId;

  it("is not inherited by the next document opened", () => {
    const store = storeOpening(openedEngine(2, 0));
    store.setDuotoneRecord(record);
    store.openFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53]), "gray.psd");
    expect(store.state.duotone).toBeNull();
    expect(store.docDuotone(active(store))).toBeNull();
  });

  it("Image ▸ Mode ▸ Grayscale takes the ink layer out in the Grayscale undo step", () => {
    for (const refused of [false, true]) {
      let pushes = 0;
      const calls: string[] = [];
      const eng = openedEngine(2, 1, {
        undo_pushes: () => pushes,
        convert_grayscale: () => { calls.push("convert_grayscale"); if (!refused) pushes++; },
        delete_layer: (id: number) => { calls.push(`delete_layer ${id}`); pushes++; },
        drop_last_undo: () => calls.push("drop_last_undo"),
      });
      const client = { engine: eng, e: eng, onCommit: null, onEditError: vi.fn(), lastBrush: [], activate: vi.fn(), buildFormat: vi.fn(() => eng), commit: vi.fn(() => true) };
      const store = new Store(client as never);
      store.openFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53]), "duo.psd");
      store.setDuotoneRecord(record);
      store.convertGrayscale();
      // Photoshop discards the inks; a refused conversion (32-bit) keeps them.
      expect(calls).toEqual(refused ? ["convert_grayscale"] : ["convert_grayscale", "delete_layer 2", "drop_last_undo"]);
      // The record stays for an Undo to bring back with the layer.
      expect(store.state.duotone).toBe(record);
    }
  });

  it("counts only while its layer is still the document's gradient-map ink layer", () => {
    const pixelLayer = storeOpening(openedEngine(2, 0));
    pixelLayer.openFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53]), "gray.psd");
    pixelLayer.setDuotoneRecord(record);
    expect(pixelLayer.docDuotone(active(pixelLayer))).toBeNull(); // id 2 is an ordinary layer

    const inkLayer = storeOpening(openedEngine(2, 1));
    inkLayer.openFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53]), "duo.psd");
    inkLayer.setDuotoneRecord(record);
    expect(inkLayer.docDuotone(active(inkLayer))).toBe(inkLayer.state.duotone);
  });
});
