// Guards vis-type-02: the H&J composer (text/raster.ts hyphenationPoints,
// composeGreedy, the every-line DP, justifyLine) and Character ▸ No Break
// were fully implemented and fully unreachable — no panel control ever wrote
// spec.hyphenate / hyphenation / justification / lineComposer, or run.noBreak,
// so the composer always ran on factory defaults. text/compose.test.ts and
// text/noBreak.test.ts already prove those fields drive the composer; this
// file proves the Paragraph/Character panels actually reach them.
//
// ParagraphPanel / CharacterPanel are exported, so these drive the real
// components: react-dom/server runs the real hooks (useActiveTextSpec included)
// and the leaf inputs are swapped for prop recorders, which hands back the very
// onChange closures the production render built. Firing one and inspecting the
// TextSpec that lands in text.apply is the whole path under test.
import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement, type FunctionComponent } from "react";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

type Props = Record<string, unknown>;
const { controls } = vi.hoisted(() => ({ controls: [] as Props[] }));

vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const record = (props: Props) => { controls.push(props); return null; };
  return { ...(await importOriginal<Props>()), Checkbox: record, NumberField: record, Select: record, SegmentedControl: record };
});

import { renderToStaticMarkup } from "react-dom/server";
import { CharacterPanel, ParagraphPanel } from "./Panels";
import { store, text } from "../state/app";
import { LAYER_KIND } from "../state/engineContracts";
import { DEFAULT_FONT_PREVIEW_SIZE } from "../state/fontPreview";
import { DEFAULT_HYPHENATION, DEFAULT_JUSTIFICATION, type TextSpec } from "../text/spec";

const LAYER = 7;

/** Render a panel over an active type layer holding `spec`, and hand back the
 *  real controls it produced plus whatever it writes back through text.apply. */
function mount(Panel: FunctionComponent, spec: TextSpec) {
  controls.length = 0;
  vi.spyOn(store, "getSnapshot").mockReturnValue({
    activeLayerId: LAYER, layers: [{ id: LAYER, kind: LAYER_KIND.text }], doc: {},
    fontPreviewSize: DEFAULT_FONT_PREVIEW_SIZE,
  } as never);
  vi.spyOn(text, "get").mockReturnValue(spec);
  const applied = vi.spyOn(text, "apply").mockImplementation(() => {});
  renderToStaticMarkup(createElement(Panel));

  const control = (label: string): Props => {
    const hit = controls.find((p) => p["aria-label"] === label);
    expect(hit, `no control labelled "${label}" — the composer field is unreachable`).toBeTruthy();
    return hit!;
  };
  return {
    labels: () => controls.map((p) => p["aria-label"]).filter((l): l is string => typeof l === "string"),
    control,
    /** Fire a control's onChange and return the TextSpec that reached the engine. */
    fire: (label: string, value: unknown): TextSpec => {
      (control(label).onChange as (v: unknown) => void)(value);
      const call = applied.mock.calls.at(-1);
      expect(call, `"${label}" changed nothing — its patch never reached text.apply`).toBeTruthy();
      expect(call![0]).toBe(LAYER);
      return call![1] as TextSpec;
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

const base = (patch: Partial<TextSpec> = {}): TextSpec => text.defaultSpec("Hello world", patch);

describe("ParagraphPanel reaches the H&J composer", () => {
  it("wires the Hyphenate checkbox to TextSpec.hyphenate", () => {
    const off = mount(ParagraphPanel, base());
    expect(off.control("Hyphenate").checked).toBe(false);
    expect(off.fire("Hyphenate", true).hyphenate).toBe(true);

    const on = mount(ParagraphPanel, base({ hyphenate: true }));
    expect(on.control("Hyphenate").checked).toBe(true);
    expect(on.fire("Hyphenate", false).hyphenate).toBe(false);
  });

  it("wires every Hyphenation dialog field through hyPatch", () => {
    // hyPatch must land on spec.hyphenation (the field wrapPara reads via
    // hyphenationOf) and must MERGE, not replace — a sibling already set by an
    // earlier edit has to survive.
    const fields: [string, keyof typeof DEFAULT_HYPHENATION, number][] = [
      ["Words longer than", "wordsLongerThan", 9],
      ["After first", "afterFirst", 4],
      ["Before last", "beforeLast", 3],
      ["Hyphen limit", "hyphenLimit", 1],
      ["Hyphenation zone", "zone", 48],
    ];
    for (const [label, key, value] of fields) {
      const panel = mount(ParagraphPanel, base({ hyphenate: true, hyphenation: { zone: 12 } as never }));
      const next = panel.fire(label, value);
      expect(next.hyphenation?.[key]).toBe(value);
      if (key !== "zone") expect(next.hyphenation?.zone, "hyPatch replaced the object instead of merging it").toBe(12);
      expect(next.hyphenate, "the H&J fields must not disturb the flag that enables them").toBe(true);
    }
  });

  it("only offers the Hyphenation fields once hyphenation is on", () => {
    const off = mount(ParagraphPanel, base());
    expect(off.labels()).not.toContain("Words longer than");
    expect(mount(ParagraphPanel, base({ hyphenate: true })).labels()).toContain("Words longer than");
  });

  it("wires the Single-line / Every-line composer choice to TextSpec.lineComposer", () => {
    const panel = mount(ParagraphPanel, base());
    const picker = panel.control("Line composer");
    expect(picker.options).toEqual(text.LINE_COMPOSERS.map((c) => ({ value: c.id, label: c.label })));
    expect(picker.value, "the composer defaults to Photoshop's single-line composer").toBe("single");
    expect(panel.fire("Line composer", "everyline").lineComposer).toBe("everyline");
  });

  it("wires every Justification dialog field through juPatch", () => {
    const fields: [string, keyof typeof DEFAULT_JUSTIFICATION, number][] = [
      ["Word spacing minimum", "wordMin", 70],
      ["Word spacing maximum", "wordMax", 150],
      ["Letter spacing minimum", "letterMin", -5],
      ["Letter spacing maximum", "letterMax", 25],
      ["Glyph scaling minimum", "glyphMin", 95],
      ["Glyph scaling maximum", "glyphMax", 105],
      ["Auto leading", "autoLeading", 140],
    ];
    for (const [label, key, value] of fields) {
      const panel = mount(ParagraphPanel, base({ justification: { autoLeading: 111 } as never }));
      const next = panel.fire(label, value);
      expect(next.justification?.[key]).toBe(value);
      if (key !== "autoLeading") expect(next.justification?.autoLeading, "juPatch replaced the object instead of merging it").toBe(111);
    }
  });

  it("reads back through the same resolved getters raster.ts composes with", () => {
    // Nothing is stored yet, so every field has to show the resolved default
    // (hyphenationOf / justificationOf) rather than an empty control — that is
    // what the composer will actually run with.
    const spec = base({ hyphenate: true });
    const panel = mount(ParagraphPanel, spec);
    const hy = text.hyphenationOf(spec), ju = text.justificationOf(spec);
    expect(panel.control("Hyphenation zone").value).toBe(hy.zone);
    expect(panel.control("Words longer than").value).toBe(hy.wordsLongerThan);
    expect(panel.control("Word spacing minimum").value).toBe(ju.wordMin);
    expect(panel.control("Auto leading").value).toBe(ju.autoLeading);

    // …and a partially-stored object still resolves the gaps.
    const partial = base({ hyphenate: true, hyphenation: { zone: 5 } as never });
    const p2 = mount(ParagraphPanel, partial);
    expect(p2.control("Hyphenation zone").value).toBe(5);
    expect(p2.control("After first").value).toBe(DEFAULT_HYPHENATION.afterFirst);
  });

  it("does not expose the *Desired justification fields — justifyLine never reads them", () => {
    const written = new Set<string>();
    const labels = ["Word spacing minimum", "Word spacing maximum", "Letter spacing minimum", "Letter spacing maximum",
      "Glyph scaling minimum", "Glyph scaling maximum", "Auto leading"];
    for (const label of labels) {
      const panel = mount(ParagraphPanel, base());
      for (const key of Object.keys(panel.fire(label, 1).justification ?? {})) written.add(key);
    }
    expect([...written].sort()).toEqual(["autoLeading", "glyphMax", "glyphMin", "letterMax", "letterMin", "wordMax", "wordMin"]);
    expect(mount(ParagraphPanel, base({ hyphenate: true })).labels().filter((l) => /desired/i.test(l))).toEqual([]);

    // A *Desired already on the spec (an import, a future field) is preserved
    // rather than dropped — juPatch spreads, it does not rewrite.
    const panel = mount(ParagraphPanel, base({ justification: { wordDesired: 90 } as never }));
    expect(panel.fire("Word spacing minimum", 60).justification?.wordDesired).toBe(90);
  });
});

describe("CharacterPanel reaches Character ▸ No Break", () => {
  it("wires the No Break checkbox to the run's noBreak field via charPatch", () => {
    const spec = base();
    const panel = mount(CharacterPanel, spec);
    expect(panel.control("No break").checked).toBe(false);

    // No on-canvas editor is open, so the panel formats the whole layer.
    const next = panel.fire("No break", true);
    expect(next.runs.length).toBeGreaterThan(0);
    for (const run of next.runs) expect(text.resolveStyle(next, run).noBreak).toBe(true);
    expect(text.fullText(next), "formatting must not disturb the text itself").toBe(text.fullText(spec));
  });

  it("reads the checkbox back off the run under the caret", () => {
    const spec = base();
    const on = base({ runs: spec.runs.map((r) => ({ ...r, noBreak: true })) });
    expect(mount(CharacterPanel, on).control("No break").checked).toBe(true);
  });
});
