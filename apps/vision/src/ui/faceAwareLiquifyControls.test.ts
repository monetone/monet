// The Face-Aware Liquify dialog only ever exposed Eyes / Smile / Face Width and
// called the legacy 3-arg facade overload, so the other 13 FaceLiquifyParams
// controls and `faceIndex` were unreachable from the UI (ml/faceLiquify.test.ts
// already proves each one drives its own dabs). This file drives the real
// exported section component: react-dom/server runs the production render, the
// monet-ui leaves are swapped for prop recorders, and firing the recorded
// callbacks shows exactly what the section writes back and what finally lands
// in ml.faceAwareLiquify.
import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement } from "react";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

type Props = Record<string, unknown>;
const { controls } = vi.hoisted(() => ({ controls: [] as Props[] }));

vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const record = (props: Props) => { controls.push(props); return null; };
  return { ...(await importOriginal<Props>()), Slider: record, Select: record, Button: record };
});

import { renderToStaticMarkup } from "react-dom/server";
import { FACE_LIQUIFY_GROUPS, FACE_LIQUIFY_INIT, FaceAwareLiquifySection, type FaceLiquifyState } from "./Dialogs";
import { ml } from "../state/app";

/** Render the section over `state` and hand back its live controls. `run`
 *  invokes the job immediately, as the real NeuralAI `run` does. */
function mount(state: FaceLiquifyState = FACE_LIQUIFY_INIT) {
  controls.length = 0;
  const next: FaceLiquifyState[] = [];
  const run = (fn: (p: (m: string) => void) => Promise<unknown>) => fn(() => {});
  renderToStaticMarkup(createElement(FaceAwareLiquifySection, {
    busy: false, run, state, onState: (s: FaceLiquifyState) => next.push(s),
  }));
  const labelled = (label: string): Props => {
    const hit = controls.find((p) => p["aria-label"] === label);
    expect(hit, `no control labelled "${label}" — that Face-Aware Liquify control is unreachable`).toBeTruthy();
    return hit!;
  };
  const button = (text: string): Props => {
    const hit = controls.find((p) => p.children === text);
    expect(hit, `no button "${text}"`).toBeTruthy();
    return hit!;
  };
  return {
    labels: () => controls.map((p) => p["aria-label"]).filter((l): l is string => typeof l === "string"),
    labelled, button,
    /** Move a slider; MlRow maps the 0..1 fraction onto the control's −1..1 range. */
    slide: (label: string, fraction: number) => {
      (labelled(label).onChange as (f: number) => void)(fraction);
      return next.at(-1)!;
    },
    pick: (label: string, value: string) => {
      (labelled(label).onChange as (v: string) => void)(value);
      return next.at(-1)!;
    },
    click: (text: string) => (button(text).onClick as () => unknown)(),
    emitted: () => next,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

const ALL = FACE_LIQUIFY_GROUPS.flatMap((g) => g.controls);
const applied = () => vi.spyOn(ml, "faceAwareLiquify")
  .mockResolvedValue({ ok: true, dabs: 1, faces: 1, model: "face-landmarks" });

describe("Face-Aware Liquify dialog exposes the whole control set", () => {
  it("renders a labelled slider for each of the 16 FaceLiquifyParams controls", () => {
    const ui = mount();
    expect(ALL).toHaveLength(16);
    for (const [, label] of ALL) expect(ui.labels()).toContain(label);
  });

  it.each(ALL)("wires the %s slider to its own param and nothing else", (key, label) => {
    const ui = mount();
    const state = ui.slide(label, 1); // full right = +1 on the −1..1 range
    expect(state.params[key]).toBeCloseTo(1);
    for (const [other] of ALL) if (other !== key) expect(state.params[other] ?? 0).toBe(0);
  });

  it.each(ALL)("sends %s through to ml.faceAwareLiquify on Apply", (key, label) => {
    const spy = applied();
    mount({ params: { [key]: 0.5 }, faces: 0 }).click("Apply to Layer");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0][key]).toBe(0.5);
    expect(label).toBeTruthy();
  });

  it("shows each slider's current value, so re-opening the dialog is not a blank sheet", () => {
    const ui = mount({ params: { eyeTilt: -0.25 }, faces: 0 });
    // MlRow maps −1..1 onto the Slider's 0..1 fraction.
    expect(ui.labelled("Eye Tilt").value).toBeCloseTo(0.375);
    expect(ui.labelled("Smile").value).toBeCloseTo(0.5);
  });

  it("keeps Apply disabled until a control moves and Reset clears every control", () => {
    expect(mount().button("Apply to Layer").disabled).toBe(true);
    const moved: FaceLiquifyState = { params: { smile: 0.4, jawline: -0.2, faceIndex: 2 }, faces: 3 };
    const ui = mount(moved);
    expect(ui.button("Apply to Layer").disabled).toBe(false);
    ui.click("Reset");
    const reset = ui.emitted().at(-1)!;
    for (const [key] of ALL) expect(reset.params[key] ?? 0).toBe(0);
    // Resetting the warps must not throw away the picked face or the detection.
    expect(reset.params.faceIndex).toBe(2);
    expect(reset.faces).toBe(3);
    expect(mount(reset).button("Apply to Layer").disabled).toBe(true);
  });

  it("no longer goes through the legacy 3-number overload", () => {
    const spy = applied();
    mount({ params: { eyeSize: 0.5 }, faces: 0 }).click("Apply to Layer");
    expect(typeof spy.mock.calls[0][0]).toBe("object");
  });
});

describe("Face picker", () => {
  it("offers one option per detected face and sends the chosen faceIndex", async () => {
    const detect = vi.spyOn(ml, "detectFaces").mockResolvedValue({
      ok: true, faces: [[], [], []] as unknown as [number, number][][], w: 100, h: 100, model: "face-landmarks",
    });
    const ui = mount({ params: { eyeSize: 0.5 }, faces: 0 });
    // Before detection there is nothing to choose between.
    expect(ui.labelled("Face").disabled).toBe(true);
    expect(ui.labelled("Face").options).toEqual([{ value: "0", label: "Face 1" }]);

    await ui.click("Detect Faces");
    const detected = ui.emitted().at(-1)!;
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detected.faces).toBe(3);
    expect(detected.params.eyeSize, "detecting faces must not discard the pending warps").toBe(0.5);

    const after = mount(detected);
    expect(after.labelled("Face").disabled).toBe(false);
    expect(after.labelled("Face").options).toEqual([
      { value: "0", label: "Face 1" }, { value: "1", label: "Face 2" }, { value: "2", label: "Face 3" },
    ]);

    const picked = after.pick("Face", "2");
    expect(picked.params.faceIndex).toBe(2);
    const spy = applied();
    mount(picked).click("Apply to Layer");
    expect(spy.mock.calls[0][0].faceIndex).toBe(2);
  });

  it("defaults to face 0 without a detection pass", () => {
    const spy = applied();
    mount().slide("Jawline", 1);
    const ui = mount({ params: { jawline: 1 }, faces: 0 });
    expect(ui.labelled("Face").value).toBe("0");
    ui.click("Apply to Layer");
    expect(spy.mock.calls[0][0].faceIndex ?? 0).toBe(0);
  });
});
