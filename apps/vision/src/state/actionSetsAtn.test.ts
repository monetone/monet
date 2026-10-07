import { describe, expect, it } from "vitest";
import {
  atnToActionsFile, parseActionsFile, parseAtn, serializeAtn, STOP_OP, type PortableAction,
} from "./actionSets";

// Minimal big-endian .atn writer — enough to build the packs these tests read
// back. Independent of the app's own writer (serializeAtn, #473) on purpose:
// the reader must be pinned against bytes it did not produce.
class AtnWriter {
  readonly b: number[] = [];
  u8(v: number) { this.b.push(v & 0xff); }
  u16(v: number) { this.b.push((v >>> 8) & 0xff, v & 0xff); }
  u32(v: number) { this.b.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  f64(v: number) {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.b.push(d.getUint8(i));
  }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i) & 0xff); }
  ustr(s: string) {
    const t = `${s}\0`;
    this.u32(t.length);
    for (let i = 0; i < t.length; i++) this.u16(t.charCodeAt(i));
  }
  key(k: string) { if (k.length === 4) this.u32(0); else this.u32(k.length); this.ascii(k); }
  bytes() { return new Uint8Array(this.b); }
}

type Entry = [string, (w: AtnWriter) => void];
const unit = (u: string, v: number) => (w: AtnWriter) => { w.ascii("UntF"); w.ascii(u); w.f64(v); };
const long = (v: number) => (w: AtnWriter) => { w.ascii("long"); w.u32(v >>> 0); };
const text = (v: string) => (w: AtnWriter) => { w.ascii("TEXT"); w.ustr(v); };
const bool = (v: boolean) => (w: AtnWriter) => { w.ascii("bool"); w.u8(v ? 1 : 0); };
const enumv = (t: string, v: string) => (w: AtnWriter) => { w.ascii("enum"); w.key(t); w.key(v); };
const list = (items: ((w: AtnWriter) => void)[]) => (w: AtnWriter) => {
  w.ascii("VlLs"); w.u32(items.length); for (const it of items) it(w);
};
// `obj ` reference with one 'prop' item — the shape a real "Set" step targets.
const layerRef = (w: AtnWriter) => {
  w.ascii("obj "); w.u32(1); w.ascii("prop"); w.ustr(""); w.key("Lyr "); w.key("Bckg");
};

function writeDesc(w: AtnWriter, entries: Entry[], withVersion: boolean) {
  if (withVersion) w.u32(16);
  w.ustr("");
  w.key("null");
  w.u32(entries.length);
  for (const [k, v] of entries) { w.key(k); v(w); }
}

interface Step { event: string; label: string; entries?: Entry[]; enabled?: boolean; dialog?: boolean }

function writeAtn(setName: string, actions: { name: string; steps: Step[] }[], withVersion = true): Uint8Array {
  const w = new AtnWriter();
  w.u32(16);
  w.ustr(setName);
  w.u8(1);
  w.u32(actions.length);
  for (const a of actions) {
    w.u32(0); w.u8(0); w.u8(0); w.u16(0);
    w.ustr(a.name);
    w.u8(1);
    w.u32(a.steps.length);
    for (const s of a.steps) {
      w.u8(1);
      w.u8(s.enabled === false ? 0 : 1);
      w.u8(s.dialog ? 1 : 0);
      w.u8(0);
      w.key(s.event);
      w.ustr(s.label);
      if (s.entries) { w.u32(1); writeDesc(w, s.entries, withVersion); } else w.u32(0);
    }
  }
  return w.bytes();
}

const SOFT_GLOW: Step[] = [
  { event: "GsnB", label: "Gaussian Blur", entries: [["Rds ", unit("#Pxl", 12.5)]] },
  { event: "BrgC", label: "Brightness/Contrast", dialog: true, entries: [["Brgh", long(10)], ["Cntr", long(4294967291)]] },
  {
    event: "Lvls",
    label: "Levels",
    enabled: false,
    entries: [["null", layerRef], ["Adjs", list([text("a"), bool(true), enumv("Chnl", "Cmps")])]],
  },
  { event: "Dslc", label: "Deselect" },
];

describe("Adobe .atn import", () => {
  it("rebuilds the set, action names, mapped ops and per-step flags", () => {
    const { setName, actions, error } = parseAtn(writeAtn("Glow Pack", [{ name: "Soft Glow", steps: SOFT_GLOW }]), 42);
    expect(error).toBeNull();
    expect(setName).toBe("Glow Pack");
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a).toMatchObject({ name: "Soft Glow", set: "Glow Pack", createdAt: 42, favorite: false });
    expect(a.steps[0]).toEqual(["fil.gaussian", [12.5]]);
    // Photoshop writes Contrast as a signed long; -5 must survive its sign, and
    // both terms are ±100 percentages where the op wants -1..1 (#139).
    expect(a.steps[1]).toEqual(["adj.brightnessContrast", [0.1, -0.05]]);
    expect(a.steps[3]).toEqual(["store.deselect", []]);
    // Disabled/modal steps keep Photoshop's toggles.
    expect(a.disabled).toEqual([2]);
    expect(a.dialogs).toEqual([1]);
  });

  it("normalizes Unsharp Mask's percent Amount and 0..255 Threshold to fractions (#140)", () => {
    // fil.unsharp gates on |diff| >= threshold * 65535, so a raw Thsh of 4 would
    // make the imported sharpen a silent no-op.
    const bytes = writeAtn("Pack", [{
      name: "Sharpen",
      steps: [{
        event: "UnsM",
        label: "Unsharp Mask",
        entries: [["Rds ", unit("#Pxl", 1.5)], ["Amnt", unit("#Prc", 180)], ["Thsh", long(4)]],
      }],
    }]);
    expect(parseAtn(bytes).actions[0].steps[0]).toEqual(["fil.unsharp", [1.5, 1.8, 4 / 255]]);
  });

  it("normalizes Threshold's 0..255 Level to a luminance fraction and leaves Posterize's count alone (#138)", () => {
    // adj.threshold compares against 0..1 luminance, so a raw Lvl of 128 is
    // never reached and the whole selection goes black. Posterize really does
    // want a 2..255 level count, so it must NOT be rescaled.
    const bytes = writeAtn("Pack", [{
      name: "Punch",
      steps: [
        { event: "Thrs", label: "Threshold", entries: [["Lvl ", long(128)]] },
        { event: "Pstr", label: "Posterize", entries: [["Lvls", long(6)]] },
      ],
    }]);
    const { steps } = parseAtn(bytes).actions[0];
    expect(steps[0]).toEqual(["adj.threshold", [128 / 255]]);
    expect(steps[1]).toEqual(["adj.posterize", [6]]);
  });

  it("keeps an unmappable step in place as a Stop naming the Photoshop command", () => {
    const { actions } = parseAtn(writeAtn("Pack", [{ name: "A", steps: SOFT_GLOW }]));
    expect(actions[0].steps[2]).toEqual([STOP_OP, ["Unsupported Photoshop step: Levels", true]]);
  });

  it("reads step descriptors written without the leading version word", () => {
    const bytes = writeAtn("Pack", [{ name: "A", steps: [SOFT_GLOW[0]] }], false);
    expect(parseAtn(bytes).actions[0].steps[0]).toEqual(["fil.gaussian", [12.5]]);
  });

  it("falls back to a Stop when a mapped event is missing its parameters", () => {
    const bytes = writeAtn("Pack", [{ name: "A", steps: [{ event: "GsnB", label: "Gaussian Blur", entries: [["Strt", long(3)]] }] }]);
    expect(parseAtn(bytes).actions[0].steps[0][0]).toBe(STOP_OP);
  });

  it("reports a non-.atn payload instead of throwing", () => {
    const { actions, error } = parseAtn(new TextEncoder().encode('{"format":"mvactions"}'));
    expect(actions).toEqual([]);
    expect(error).toMatch(/not an Adobe \.atn file/);
  });

  it("keeps the actions read before a truncation and reports the stop", () => {
    const full = writeAtn("Pack", [
      { name: "First", steps: [SOFT_GLOW[3]] },
      { name: "Second", steps: SOFT_GLOW },
    ]);
    const { actions, error } = parseAtn(full.subarray(0, full.length - 12));
    expect(actions.map((a) => a.name)).toEqual(["First"]);
    expect(error).toMatch(/truncated/);
  });

  it("emits an .mvactions payload the normal import path accepts", () => {
    const { json, setName, error } = atnToActionsFile(writeAtn("Glow Pack", [{ name: "Soft Glow", steps: SOFT_GLOW }]), 42);
    expect(setName).toBe("Glow Pack");
    expect(error).toBeNull();
    const allowed = new Set(["fil.gaussian", "adj.brightnessContrast", "store.deselect"]);
    const { actions, rejected } = parseActionsFile(json, allowed);
    expect(rejected).toEqual([]);
    expect(actions[0].set).toBe("Glow Pack");
    expect(actions[0].steps.map(([p]) => p)).toEqual([
      "fil.gaussian", "adj.brightnessContrast", STOP_OP, "store.deselect",
    ]);
    expect(actions[0].disabled).toEqual([2]);
    expect(actions[0].dialogs).toEqual([1]);
  });

  it("rejects an action whose op is not in the allowlist, keeping its siblings", () => {
    const { json } = atnToActionsFile(writeAtn("Pack", [
      { name: "Blurry", steps: [SOFT_GLOW[0]] },
      { name: "Plain", steps: [SOFT_GLOW[3]] },
    ]));
    const { actions, rejected } = parseActionsFile(json, new Set(["store.deselect"]));
    expect(actions.map((a) => a.name)).toEqual(["Plain"]);
    expect(rejected).toEqual([{ name: "Blurry", reason: "unknown op: fil.gaussian" }]);
  });
});

// ── Save Actions (#473) ──────────────────────────────────────────────────────
// Vision could read Photoshop's packs but not write them, so nothing recorded
// here could go back. Every assertion below reads the writer's bytes with the
// parser the tests above pin against hand-written Photoshop bytes.
describe("serializeAtn", () => {
  const action = (name: string, steps: PortableAction["steps"], extra: Partial<PortableAction> = {}): PortableAction =>
    ({ name, favorite: false, createdAt: 7, set: "Web", steps, ...extra });

  it("round-trips every step whose Photoshop event Vision knows", () => {
    const steps: PortableAction["steps"] = [
      ["fil.gaussian", [12.5]],
      ["adj.brightnessContrast", [0.1, -0.05]],
      ["adj.threshold", [128 / 255]],
      ["adj.posterize", [4]],
      ["fil.unsharp", [2.5, 0.8, 3 / 255]],
      ["adj.invert", []],
      ["store.deselect", []],
    ];
    const { actions, setName, error } = parseAtn(serializeAtn([action("Everything", steps)]), 42);
    expect(error).toBeNull();
    expect(setName).toBe("Web");
    expect(actions[0].name).toBe("Everything");
    expect(actions[0].steps).toEqual(steps);
  });

  it("keeps disabled steps disabled and modal steps modal", () => {
    const steps: PortableAction["steps"] = [["adj.invert", []], ["fil.gaussian", [2]], ["store.deselect", []]];
    const bytes = serializeAtn([action("Flags", steps, { disabled: [1], dialogs: [0, 2] })]);
    const [back] = parseAtn(bytes, 42).actions;
    expect(back.disabled).toEqual([1]);
    expect(back.dialogs).toEqual([0, 2]);
  });

  it("writes a Vision-only step as a Stop that names it, in place", () => {
    const steps: PortableAction["steps"] = [
      ["adj.invert", []],
      ["paintStroke", [1, 2, 3]], // a recorded tool gesture: no Photoshop event
      ["store.deselect", []],
    ];
    const [back] = parseAtn(serializeAtn([action("Mixed", steps)]), 42).actions;
    expect(back.steps.map(([path]) => path)).toEqual(["adj.invert", STOP_OP, "store.deselect"]);
    expect(back.steps[1][1][0]).toContain("Paint Stroke");
    expect(back.steps[1][1][1]).toBe(true); // …and playback can continue past it
  });

  it("round-trips a Stop as a Stop, message and Continue intact", () => {
    const steps: PortableAction["steps"] = [[STOP_OP, ["Sharpen to taste", true]], [STOP_OP, ["Check the mask", false]]];
    const [back] = parseAtn(serializeAtn([action("Paused", steps)]), 42).actions;
    expect(back.steps).toEqual(steps);
  });

  it("writes several actions as one named set, and survives the ordinary import funnel", () => {
    const bytes = serializeAtn([
      action("Blur", [["fil.gaussian", [4]]]),
      action("Flat", [["store.flatten", []]]),
    ], "Glow Pack");
    const { json, setName, error } = atnToActionsFile(bytes, 42);
    expect(setName).toBe("Glow Pack");
    expect(error).toBeNull();
    const { actions, rejected } = parseActionsFile(json, new Set(["fil.gaussian", "store.flatten"]));
    expect(rejected).toEqual([]);
    expect(actions.map((a) => [a.name, a.set])).toEqual([["Blur", "Glow Pack"], ["Flat", "Glow Pack"]]);
    expect(actions[1].steps).toEqual([["store.flatten", []]]);
  });

  it("round-trips Photoshop Merge Down with no layer id (#533)", () => {
    const portable: PortableAction = {
      name: "Merge", favorite: false, createdAt: 7, set: "Web",
      steps: [["store.mergeDown", []]],
    };
    const { json, error } = atnToActionsFile(serializeAtn([portable]), 42);
    expect(error).toBeNull();
    const { actions, rejected } = parseActionsFile(json, new Set(["store.mergeDown"]));
    expect(rejected).toEqual([]);
    expect(actions[0].steps).toEqual([["store.mergeDown", []]]);
  });

  it("writes an empty set rather than a malformed file", () => {
    expect(parseAtn(serializeAtn([]), 42)).toEqual({ setName: "Default Actions", actions: [], error: null });
  });
});
