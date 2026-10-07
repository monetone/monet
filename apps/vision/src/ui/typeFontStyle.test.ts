// #453: the Character panel and the Type options bar offered B/I checkboxes and
// nothing else, so a family's registered Semibold — and every variable-font axis
// the engine already parses — was unreachable. state/fontStyles.test.ts proves
// the model; this file proves the two surfaces actually reach it.
//
// Both components are exported, so these drive the real renders: react-dom/server
// runs the production hooks and the monet-ui leaves are swapped for prop
// recorders, which hands back the very onChange closures the render built.
// Firing one and inspecting the TextSpec that lands in text.apply is the path
// under test. Same discipline as ./textComposerControls.test.ts.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { createElement, type FunctionComponent } from "react";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

type Props = Record<string, unknown>;
const { controls } = vi.hoisted(() => ({ controls: [] as Props[] }));

vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const record = (props: Props) => { controls.push(props); return null; };
  const group = (props: Props) => {
    // Capture native toolbar buttons as well as the mocked Monet input leaves.
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      const el = node as { type?: unknown; props?: Props } | null;
      if (!el?.props) return;
      if (el.type === "button") controls.push(el.props);
      visit(el.props.children);
    };
    visit(props.children);
    return props.children as never;
  };
  const bar = Object.assign((props: Props) => props.children as never, { Group: group });
  return {
    ...(await importOriginal<Props>()),
    Checkbox: record, NumberField: record, Select: record, SegmentedControl: record, Slider: record,
    Textarea: record, OptionsBar: bar,
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { CharacterPanel } from "./Panels";
import { TypeToolbar } from "./Dialogs";
import { engine, store, text } from "../state/app";
import { LAYER_KIND } from "../state/engineContracts";
import { DEFAULT_FONT_PREVIEW_SIZE } from "../state/fontPreview";
import { setFontFaces } from "../state/fontStyles";
import { resolveStyle, type TextSpec } from "../text/spec";
import type { VectorFontFaceInfo } from "../engine/vectorFonts";

const LAYER = 7;
const HELVETICA = "Helvetica, Arial, sans-serif";
const INTER = "Inter, system-ui, sans-serif";

const face = (patch: Partial<VectorFontFaceInfo> & { family: string }): VectorFontFaceInfo =>
  ({ faceIndex: 0, weight: 400, italic: false, ...patch });

const SCANNED: VectorFontFaceInfo[] = [
  face({ family: "Helvetica", fullName: "Helvetica", weight: 400 }),
  face({ family: "Helvetica", fullName: "Helvetica Semibold", weight: 600 }),
  face({ family: "Helvetica", fullName: "Helvetica Oblique", italic: true }),
  face({
    family: "Inter", fullName: "Inter", weight: 400,
    axes: [
      { tag: "wght", min: 100, def: 400, max: 900 },
      { tag: "wdth", min: 75, def: 100, max: 125 },
      { tag: "slnt", min: -10, def: 0, max: 0 },
    ],
  }),
];

/** Render a type surface over an active type layer holding `spec`, and hand back
 *  the real controls it produced plus whatever it writes through text.apply. */
function mount(Surface: FunctionComponent<never>, spec: TextSpec, props: Props = {}) {
  controls.length = 0;
  vi.spyOn(store, "getSnapshot").mockReturnValue({
    activeLayerId: LAYER, layers: [{ id: LAYER, kind: LAYER_KIND.text }], doc: {},
    fontPreviewSize: DEFAULT_FONT_PREVIEW_SIZE,
  } as never);
  vi.spyOn(text, "get").mockReturnValue(spec);
  const applied = vi.spyOn(text, "apply").mockImplementation(() => {});
  renderToStaticMarkup(createElement(Surface as FunctionComponent, props));

  const control = (label: string): Props => {
    const hit = controls.find((p) => p["aria-label"] === label);
    expect(hit, `no control labelled "${label}" — that type control is unreachable`).toBeTruthy();
    return hit!;
  };
  return {
    has: (label: string) => controls.some((p) => p["aria-label"] === label),
    control,
    /** Fire a control's onChange and return the TextSpec that reached the engine. */
    fire: (label: string, value: unknown): TextSpec => {
      const props = control(label);
      ((props.onChange ?? props.onClick) as (v: unknown) => void)(value);
      const call = applied.mock.calls.at(-1);
      expect(call, `"${label}" changed nothing — its patch never reached text.apply`).toBeTruthy();
      return call![1] as TextSpec;
    },
  };
}

const base = (patch: Partial<TextSpec> = {}): TextSpec => text.defaultSpec("Hi", patch);
const styleOf = (spec: TextSpec) => resolveStyle(spec, spec.runs[0]);

beforeEach(() => { setFontFaces(SCANNED); });
afterEach(() => { vi.restoreAllMocks(); setFontFaces([]); });

describe("the Character panel's Style dropdown", () => {
  it("lists the family's registered subfamilies and writes the real weight", () => {
    const panel = mount(CharacterPanel, base({ font: HELVETICA }));
    const picker = panel.control("Font style");
    expect((picker.options as { label: string }[]).map((o) => o.label)).toEqual(["Regular", "Semibold", "Oblique"]);
    expect(picker.value).toBe("400");

    const next = styleOf(panel.fire("Font style", "600"));
    expect(next.weight).toBe(600);
    expect(next.italic).toBe(false);
    // Helvetica really ships a 600 face, so nothing is synthesized.
    expect(next.fauxBold).toBe(false);
  });

  it("bolds through the numeric weight and leaves the user's Faux checkboxes alone", () => {
    // Faux bold/italic are the user's own checkboxes (the Faux row): neither the
    // B/I buttons nor a Style pick may switch them off behind the user's back.
    const faux = base({ font: HELVETICA });
    faux.runs = [{ ...faux.runs[0], fauxBold: true, fauxItalic: true }];
    const bolded = styleOf(mount(CharacterPanel, faux).fire("Bold", true));
    expect(bolded).toMatchObject({ weight: 700, bold: true, fauxBold: true, fauxItalic: true });
    const styled = styleOf(mount(CharacterPanel, faux).fire("Font style", "600"));
    expect(styled).toMatchObject({ weight: 600, bold: true, fauxBold: true, fauxItalic: true });
    const slanted = styleOf(mount(CharacterPanel, faux).fire("Italic", true));
    expect(slanted).toMatchObject({ italic: true, fauxBold: true, fauxItalic: true });
  });

  it("shows a slider per variable axis, and none for a static family", () => {
    const variable = mount(CharacterPanel, base({ font: INTER }));
    expect(variable.control("Width")).toMatchObject({ min: 75, max: 125, value: 100, step: 0.1 });
    expect(variable.control("Weight")).toMatchObject({ min: 100, max: 900, value: 400, step: 1 });
    // slnt −10–0 needs tenths; a whole-number step would leave it a ten-notch slider.
    expect(variable.control("Slant")).toMatchObject({ min: -10, max: 0, value: 0, step: 0.1 });

    const statik = mount(CharacterPanel, base({ font: HELVETICA }));
    expect(statik.has("Width")).toBe(false);
    expect(statik.has("Weight")).toBe(false);
    expect(statik.has("Slant")).toBe(false);
  });

  it("drives wght through the run's weight and every other axis through its variation settings", () => {
    const panel = mount(CharacterPanel, base({ font: INTER }));
    expect(styleOf(panel.fire("Width", 125)).axes).toEqual({ wdth: 125 });
    // CSS font-weight IS the wght axis, so it stays on the run's weight rather
    // than being duplicated into font-variation-settings.
    const heavy = styleOf(mount(CharacterPanel, base({ font: INTER })).fire("Weight", 725));
    expect(heavy.weight).toBe(725);
    expect(heavy.axes).toEqual({});
  });
});

describe("the Type options bar's Style dropdown", () => {
  it("offers the same subfamilies and restyles the whole layer", () => {
    const bar = mount(TypeToolbar as never, base({ font: HELVETICA }), { id: LAYER });
    expect((bar.control("Font style").options as { label: string }[]).map((o) => o.label))
      .toEqual(["Regular", "Semibold", "Oblique"]);
    const next = bar.fire("Font style", "400i");
    expect(next.runs.every((r) => r.weight === 400 && r.italic === true)).toBe(true);
  });

  it("shows a slider per variable axis, and none for a static family", () => {
    const variable = mount(TypeToolbar as never, base({ font: INTER }), { id: LAYER });
    expect(variable.control("Font Width")).toMatchObject({ min: 75, max: 125, value: 100, step: 0.1 });
    expect(variable.control("Font Weight")).toMatchObject({ min: 100, max: 900, value: 400, step: 1 });
    expect(variable.control("Font Slant")).toMatchObject({ min: -10, max: 0, value: 0, step: 0.1 });
    const wide = variable.fire("Font Width", 125);
    expect(wide.runs.map((run) => resolveStyle(wide, run).axes)).toEqual(wide.runs.map(() => ({ wdth: 125 })));

    const statik = mount(TypeToolbar as never, base({ font: HELVETICA }), { id: LAYER });
    expect(statik.has("Font Width")).toBe(false);
    expect(statik.has("Font Weight")).toBe(false);
    expect(statik.has("Font Slant")).toBe(false);
  });
});

describe("two faces at the same weight", () => {
  // Bold and Condensed Bold are both 700: a (weight, slope) value would snap the
  // controlled dropdown back to whichever one sorts first.
  for (const [name, surface, props] of [
    ["Character panel", CharacterPanel, {}],
    ["Type toolbar", TypeToolbar, { id: LAYER }],
  ] as const) {
    it(`${name}: picking Condensed Bold keeps it selected`, () => {
      setFontFaces([
        face({ family: "Helvetica", subfamily: "Bold", postscriptName: "Helvetica-Bold", weight: 700 }),
        face({ family: "Helvetica", subfamily: "Condensed Bold", postscriptName: "Helvetica-CondensedBold", faceIndex: 1, weight: 700 }),
      ]);
      const picked = mount(surface as never, base({ font: HELVETICA }), props).fire("Font style", "face:Helvetica-CondensedBold");
      expect(picked.runs[0].face).toBe("Helvetica-CondensedBold");

      const picker = mount(surface as never, picked, props).control("Font style");
      expect(picker.value).toBe("face:Helvetica-CondensedBold");
      expect((picker.options as { value: string; label: string }[]).find((o) => o.value === picker.value)?.label)
        .toBe("Condensed Bold");
    });
  }
});


describe("mixed-run character formatting", () => {
  const mixed = () => base({ font: INTER, runs: [
    { text: "AB", weight: 400, italic: false, axes: { wdth: 100, slnt: -2 } },
    { text: "CD", weight: 600, italic: true, axes: { wdth: 110, slnt: -7 } },
  ] });

  for (const [name, surface, props] of [
    ["Character panel", CharacterPanel, {}],
    ["Type toolbar", TypeToolbar, { id: LAYER }],
  ] as const) {
    it(`${name}: Bold preserves each run's italic, and Italic preserves each run's weight`, () => {
      const bold = mount(surface as never, mixed(), props).fire("Bold", true);
      expect(bold.runs.map((run) => resolveStyle(bold, run))).toMatchObject([
        { weight: 700, bold: true, italic: false },
        { weight: 700, bold: true, italic: true },
      ]);
      const italic = mount(surface as never, mixed(), props).fire("Italic", true);
      expect(italic.runs.map((run) => resolveStyle(italic, run))).toMatchObject([
        { weight: 400, italic: true },
        { weight: 600, italic: true },
      ]);
    });
  }

  it("Weight and Width change only their own dimension in each selected run", () => {
    const heavy = mount(CharacterPanel, mixed()).fire("Weight", 725);
    expect(heavy.runs.map((run) => resolveStyle(heavy, run))).toMatchObject([
      { weight: 725, bold: true, italic: false, axes: { wdth: 100, slnt: -2 } },
      { weight: 725, bold: true, italic: true, axes: { wdth: 110, slnt: -7 } },
    ]);
    const wide = mount(CharacterPanel, mixed()).fire("Width", 125);
    expect(wide.runs.map((run) => resolveStyle(wide, run).axes)).toEqual([
      { wdth: 125, slnt: -2 }, { wdth: 125, slnt: -7 },
    ]);
  });

  // The sliders come from the FIRST run's face; dragging Weight across a later
  // run must not overwrite that run's own Condensed Bold pick with it.
  const mixedFaces = () => base({ font: INTER, runs: [
    { text: "AB", weight: 400, face: "Inter" },
    { text: "CD", weight: 700, bold: true, face: "Inter-CondensedBold" },
  ] });
  for (const [name, surface, props, slider] of [
    ["Character panel", CharacterPanel, {}, "Weight"],
    ["Type toolbar", TypeToolbar, { id: LAYER }, "Font Weight"],
  ] as const) {
    it(`${name}: the Weight axis keeps each run's own face`, () => {
      const heavy = mount(surface as never, mixedFaces(), props).fire(slider, 725);
      expect(heavy.runs.map((run) => resolveStyle(heavy, run))).toMatchObject([
        { weight: 725, bold: true, face: "Inter" },
        { weight: 725, bold: true, face: "Inter-CondensedBold" },
      ]);
    });
  }
});

describe("a style value the family does not offer", () => {
  for (const [name, surface, props] of [
    ["Character panel", CharacterPanel, {}],
    ["Type toolbar", TypeToolbar, { id: LAYER }],
  ] as const) {
    it(`${name}: reports an actionable notice and leaves the layer untouched`, () => {
      const notice = vi.fn();
      engine.onEditError = notice;
      try {
        const picker = mount(surface as never, base({ font: HELVETICA }), props).control("Font style");
        (picker.onChange as (value: string) => void)("face:Helvetica-Gone");
        expect(text.apply).not.toHaveBeenCalled();
        expect(notice).toHaveBeenCalledWith("That font style is not available for Helvetica. Choose one from the Font style list.");
      } finally {
        engine.onEditError = null;
      }
    });
  }
});
