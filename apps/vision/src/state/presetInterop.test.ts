// Unit tests for the Preset Manager's Load… / Save Set… interop: the Adobe .grd
// and .abr readers, the .grd writer, and the `.mvpresets` set envelope.
// Engine-free (node); the dialog wiring is exercised through state/app.
import { describe, it, expect } from "vitest";
import {
  buildGrd,
  buildPresetSet,
  mergeNamed,
  parseAbr,
  parseGrd,
  presetSetItems,
  PRESET_CATEGORIES,
} from "./presetManager";
import type { GradientPreset } from "./gradientPresets";
import type { GradientStop } from "./store";

// ── a hand-built Adobe descriptor writer, so the readers are tested against
// bytes this module did not produce ─────────────────────────────────────────
class Bytes {
  out: number[] = [];
  private scratch = new DataView(new ArrayBuffer(8));
  u8(v: number) { this.out.push(v & 0xff); return this; }
  u16(v: number) { this.out.push((v >> 8) & 0xff, v & 0xff); return this; }
  u32(v: number) { this.out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this; }
  f64(v: number) { this.scratch.setFloat64(0, v); for (let i = 0; i < 8; i++) this.out.push(this.scratch.getUint8(i)); return this; }
  ascii(s: string) { for (const c of s) this.out.push(c.charCodeAt(0) & 0xff); return this; }
  key(k: string) { return this.u32(k.length === 4 ? 0 : k.length).ascii(k); }
  ustr(s: string) { this.u32(s.length + 1); for (const c of s) this.u16(c.charCodeAt(0)); return this.u16(0); }
  bytes() { return Uint8Array.from(this.out); }
}

type Node = ["doub", number] | ["long", number] | ["unit", string, number] | ["TEXT", string]
  | ["enum", string, string] | ["desc", string, Record<string, Node>] | ["list", Node[]];

function writeNode(b: Bytes, n: Node) {
  switch (n[0]) {
    case "doub": b.ascii("doub").f64(n[1]); break;
    case "long": b.ascii("long").u32(n[1]); break;
    case "unit": b.ascii("UntF").ascii(n[1]).f64(n[2]); break;
    case "TEXT": b.ascii("TEXT").ustr(n[1]); break;
    case "enum": b.ascii("enum").key(n[1]).key(n[2]); break;
    case "list": b.ascii("VlLs").u32(n[1].length); for (const x of n[1]) writeNode(b, x); break;
    case "desc": b.ascii("Objc"); writeDesc(b, n[1], n[2]); break;
  }
}
function writeDesc(b: Bytes, cls: string, d: Record<string, Node>) {
  const items = Object.entries(d);
  b.ustr("").key(cls).u32(items.length);
  for (const [k, v] of items) { b.key(k); writeNode(b, v); }
}

const colorStop = (loc: number, rgb: [number, number, number]): Node =>
  ["desc", "Clrt", {
    "Clr ": ["desc", "RGBC", { "Rd  ": ["doub", rgb[0]], "Grn ": ["doub", rgb[1]], "Bl  ": ["doub", rgb[2]] }],
    Type: ["enum", "Clry", "UsrS"],
    Lctn: ["long", loc],
    Mdpn: ["long", 50],
  }];
const transStop = (loc: number, pct: number): Node =>
  ["desc", "TrnS", { Opct: ["unit", "#Prc", pct], Lctn: ["long", loc], Mdpn: ["long", 50] }];

/** A two-gradient .grd v5: an opaque red→blue and a white ramp fading to clear. */
function sampleGrd(): Uint8Array {
  const b = new Bytes();
  b.ascii("8BGR").u16(5).u32(16);
  writeDesc(b, "null", {
    Grdn: ["list", [
      ["desc", "Grdn", {
        "Nm  ": ["TEXT", "Red Blue"],
        Grad: ["desc", "Grdn", {
          GrdF: ["enum", "GrdF", "CstS"],
          Intr: ["doub", 4096],
          Clrs: ["list", [colorStop(0, [255, 0, 0]), colorStop(4096, [0, 0, 255])]],
          Trns: ["list", [transStop(0, 100), transStop(4096, 100)]],
        }],
      }],
      ["desc", "Grdn", {
        "Nm  ": ["TEXT", "White Fade"],
        Grad: ["desc", "Grdn", {
          GrdF: ["enum", "GrdF", "CstS"],
          Intr: ["doub", 4096],
          Clrs: ["list", [colorStop(0, [255, 255, 255]), colorStop(4096, [255, 255, 255])]],
          Trns: ["list", [transStop(0, 100), transStop(2048, 50), transStop(4096, 0)]],
        }],
      }],
    ]],
  });
  return b.bytes();
}

/** A version-6 .abr holding one `desc` 8BIM block with two computed brushes. */
function sampleAbr(): Uint8Array {
  const inner = new Bytes();
  inner.u32(16);
  writeDesc(inner, "null", {
    Brsh: ["list", [
      ["desc", "Brsh", {
        "Nm  ": ["TEXT", "Big Soft"],
        Brsh: ["desc", "computedBrush", {
          Dmtr: ["unit", "#Pxl", 120],
          Hrdn: ["unit", "#Prc", 0],
          Spcn: ["unit", "#Prc", 25],
          Angl: ["unit", "#Ang", -30],
          Rndn: ["unit", "#Prc", 50],
        }],
      }],
      ["desc", "Brsh", {
        "Nm  ": ["TEXT", "Tiny Hard"],
        Brsh: ["desc", "computedBrush", {
          Dmtr: ["unit", "#Pxl", 3],
          Hrdn: ["unit", "#Prc", 100],
          Spcn: ["unit", "#Prc", 10],
        }],
      }],
    ]],
  });
  const body = inner.bytes();
  const b = new Bytes();
  b.u16(6).u16(2);
  b.ascii("8BIM").ascii("phry").u32(4).u32(0); // a block the reader must step over
  b.ascii("8BIM").ascii("desc").u32(body.length);
  for (const x of body) b.u8(x);
  return b.bytes();
}

describe("parseGrd", () => {
  it("reads every gradient, its name and its colour stops", () => {
    const out = parseGrd(sampleGrd());
    expect(out.map((g) => g.name)).toEqual(["Red Blue", "White Fade"]);
    expect(out[0].stops).toEqual([
      { pos: 0, r: 255, g: 0, b: 0, a: 255 },
      { pos: 1, r: 0, g: 0, b: 255, a: 255 },
    ]);
  });

  it("folds Photoshop's separate transparency ramp onto the colour stops", () => {
    const fade = parseGrd(sampleGrd())[1];
    expect(fade.stops.map((s) => s.a)).toEqual([255, 0]); // 100% at 0, 0% at 1
  });

  it("rejects a foreign or unsupported file instead of guessing", () => {
    expect(() => parseGrd(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(/Not an Adobe/);
    expect(() => parseGrd(new Bytes().ascii("8BGR").u16(3).bytes())).toThrow(/version 3/);
    // truncated mid-descriptor: bounded reads throw, never run past the buffer
    const full = sampleGrd();
    expect(() => parseGrd(full.slice(0, full.length - 20))).toThrow(/truncated/);
  });
});

describe("buildGrd", () => {
  const ramp: GradientStop[] = [
    { pos: 0, r: 12, g: 34, b: 56, a: 255 },
    { pos: 0.5, r: 0, g: 128, b: 255, a: 128 },
    { pos: 1, r: 255, g: 255, b: 255, a: 0 },
  ];
  const presets: GradientPreset[] = [{ name: "Vision Ramp", stops: ramp }];

  it("writes a Photoshop-readable header: 8BGR, version 5, descriptor version 16", () => {
    const bytes = buildGrd(presets);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("8BGR");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint16(4)).toBe(5);
    expect(v.getUint32(6)).toBe(16);
  });

  it("round-trips colour, position and alpha through parseGrd", () => {
    const [back] = parseGrd(buildGrd(presets));
    expect(back.name).toBe("Vision Ramp");
    expect(back.stops).toEqual(ramp);
  });

  it("round-trips an explicitly empty gradient library", () => {
    expect(parseGrd(buildGrd([]))).toEqual([]);
  });
});

describe("parseAbr", () => {
  it("reads computed brushes with their names and settings", () => {
    const out = parseAbr(sampleAbr());
    expect(out.map((b) => b.name)).toEqual(["Big Soft", "Tiny Hard"]);
    expect(out[0].brush).toEqual({ size: 120, hardness: 0, spacing: 0.25, angle: -30, roundness: 0.5 });
    // absent fields fall back to Photoshop's own defaults, not to garbage
    expect(out[1].brush).toEqual({ size: 3, hardness: 1, spacing: 0.1, angle: 0, roundness: 1 });
  });

  it("rejects pre-6 files and files with nothing importable", () => {
    expect(() => parseAbr(new Bytes().u16(2).u16(0).bytes())).toThrow(/version 2/);
    expect(() => parseAbr(new Bytes().u16(6).u16(2).bytes())).toThrow(/No procedural brushes/);
  });

  it("reports an unreadable block after the brushes it could import", () => {
    const good = sampleAbr();
    const partial = new Uint8Array(good.length + 12 + good.length - 4);
    partial.set(good);
    partial.set(good.subarray(4), good.length + 12);
    const stats: { dropped: number; partial?: boolean } = { dropped: 0 };
    expect(parseAbr(partial, stats)).toHaveLength(2);
    expect(stats).toEqual({ dropped: 0, partial: true });
  });
});

describe("preset sets", () => {
  it("round-trips a library through the .mvpresets envelope", () => {
    const items = [{ name: "One", brush: { size: 4 } }];
    expect(JSON.parse(presetSetItems(buildPresetSet("brushes", items), "brushes"))).toEqual(items);
  });

  it("refuses a set from another category or another app", () => {
    const set = buildPresetSet("brushes", []);
    expect(() => presetSetItems(set, "gradients")).toThrow(/brushes presets, not gradients/);
    expect(() => presetSetItems("not json", "brushes")).toThrow(/Not a Monet preset set/);
    expect(() => presetSetItems(JSON.stringify({ items: [] }), "brushes")).toThrow(/Not a Monet preset set/);
  });

  it("covers every Preset Manager category", () => {
    // Photoshop's Preset Manager set. `patterns` joined it once the library got
    // rename/reorder alongside the others; the Patterns picker keeps pick+delete.
    expect([...PRESET_CATEGORIES]).toEqual([
      "swatches", "brushes", "tools", "patterns", "gradients", "styles", "shapes",
    ]);
  });

  it("carries every category through the .mvpresets envelope", () => {
    // The guard that matters: a new category must survive the set round trip, or
    // Save Set…/Load… silently loses it. Checked for all of them, not just the
    // one being added.
    for (const cat of PRESET_CATEGORIES) {
      const items = [{ name: `${cat} one` }];
      expect(JSON.parse(presetSetItems(buildPresetSet(cat, items), cat)), cat).toEqual(items);
    }
  });
});

describe("mergeNamed", () => {
  it("appends an imported library, renaming collisions instead of dropping them", () => {
    const live = [{ name: "Soft Round" }];
    expect(mergeNamed(live, [{ name: "Soft Round" }, { name: "Chalk" }]).map((p) => p.name))
      .toEqual(["Soft Round", "Soft Round 2", "Chalk"]);
    expect(live).toHaveLength(1); // immutable
  });
});
