// The Neural Filters dialog used to run blind: no preview, and once a job was
// running the only way out was changing the document. This drives the two real
// exported pieces — the preview pane and the job status line — the same way
// ./faceAwareLiquifyControls.test.ts drives the Face-Aware Liquify section:
// react-dom/server renders production code, the monet-ui leaves become prop
// recorders, and firing the recorded callbacks shows what actually reaches
// ml/onnx and ml/mlJob.
import { describe, expect, it, vi, beforeEach } from "vitest";
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

// The pane lazy-imports ml/onnx (ORT must stay off the boot path), so the model
// layer is mocked and the filter calls are recorded instead of run.
const { onnx } = vi.hoisted(() => ({ onnx: { calls: [] as unknown[][], preview: null as unknown } }));
vi.mock("../ml/onnx", () => {
  const record = (name: string) => (...args: unknown[]) => { onnx.calls.push([name, ...args]); return Promise.resolve({ ok: true }); };
  return {
    styleTransfer: record("styleTransfer"),
    colorizeML: record("colorizeML"),
    depthBlurML: record("depthBlurML"),
    harmonizeML: record("harmonizeML"),
    restoreML: record("restoreML"),
    // The real previewFilter runs the filter and returns pixels; here it runs
    // the thunk (so the filter args are observable) and hands back a stub.
    previewFilter: async (run: (p?: unknown) => Promise<unknown>) => {
      await run(undefined);
      return onnx.preview;
    },
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import {
  MlJobStatus, NeuralPreviewPane, NEURAL_PREVIEW_INIT, PREVIEW_FILTERS,
  type NeuralPreviewParams, type NeuralPreviewState,
} from "./Dialogs";
import { beginMlJob, throwIfCancelled, mlJobCancelled } from "../ml/mlJob";

const PARAMS: NeuralPreviewParams = {
  style: "mosaic", stStrength: 0.5, stPreserve: 0.25,
  colAmount: 0.75, dbFocal: 0.3, dbStrength: 1.5, hzAmount: 0.6, rsAmount: 0.4,
};

/** Render one of the exported pieces and hand back its live controls. */
function mount(node: ReturnType<typeof createElement>) {
  controls.length = 0;
  renderToStaticMarkup(node);
  const button = (text: string): Props => {
    const hit = controls.find((p) => p.children === text);
    expect(hit, `no button "${text}" — that control is unreachable`).toBeTruthy();
    return hit!;
  };
  return {
    button,
    click: (text: string) => (button(text).onClick as () => unknown)(),
    labelled: (label: string) => controls.find((p) => p["aria-label"] === label),
  };
}

function pane(state: NeuralPreviewState, onState: (s: NeuralPreviewState) => void = () => {}) {
  // `run` stands in for the dialog's shared busy/status wrapper, which invokes
  // the job immediately.
  const run = (fn: (p: (m: string) => void) => Promise<unknown>) => fn(() => {});
  return mount(createElement(NeuralPreviewPane, { busy: false, params: PARAMS, state, onState, run }));
}

describe("Neural Filters live preview", () => {
  beforeEach(() => { onnx.calls.length = 0; onnx.preview = { before: new Uint8ClampedArray(4), after: new Uint8ClampedArray(4), w: 1, h: 1 }; });

  it("offers a preview for every stamp-style neural filter", () => {
    const ui = pane(NEURAL_PREVIEW_INIT);
    const picker = ui.labelled("Preview filter");
    expect(picker, "the preview filter picker is unreachable").toBeTruthy();
    expect((picker!.options as { value: string }[]).map((o) => o.value))
      .toEqual(["style", "colorize", "depthblur", "harmonize", "restore"]);
  });

  it.each(PREVIEW_FILTERS.map((f) => f.key))("previews %s with the dialog's own slider values", async (filter) => {
    const next: NeuralPreviewState[] = [];
    const ui = pane({ ...NEURAL_PREVIEW_INIT, filter }, (s) => next.push(s));

    await ui.click("Run Preview");

    const expected: Record<string, unknown[]> = {
      style: ["styleTransfer", "mosaic", 0, undefined, { strength: 0.5, preserveColor: 0.25 }],
      colorize: ["colorizeML", undefined, 0.75],
      depthblur: ["depthBlurML", 0.3, 1.5, undefined],
      harmonize: ["harmonizeML", undefined, 0.6],
      restore: ["restoreML", undefined, 0.4],
    };
    expect(onnx.calls).toEqual([expected[filter]]);
    // The pixels come back into dialog state, showing "after" first.
    expect(next.at(-1)).toMatchObject({ filter, showBefore: false, result: onnx.preview });
  });

  it("toggles between before and after once a preview exists", () => {
    const next: NeuralPreviewState[] = [];
    const withResult = { ...NEURAL_PREVIEW_INIT, result: onnx.preview as NeuralPreviewState["result"] };
    const ui = pane(withResult, (s) => next.push(s));

    ui.click("After");

    expect(next.at(-1)!.showBefore).toBe(true);
    // …and the toggle is dead until there is something to compare.
    expect(pane(NEURAL_PREVIEW_INIT).button("After").disabled).toBe(true);
  });

  it("never previews a filter that has no preview entry", () => {
    // A key with no PREVIEW_FILTERS entry must fall back, not crash the dialog.
    const ui = pane({ ...NEURAL_PREVIEW_INIT, filter: "nope" });
    expect(() => ui.click("Run Preview")).not.toThrow();
  });
});

describe("Cancel for a running ML job", () => {
  it("shows Cancel only while a job runs and stops the job when pressed", () => {
    expect(mount(createElement(MlJobStatus, { busy: false, status: "Idle" })).labelled("x")).toBeUndefined();
    expect(controls.some((p) => p.children === "Cancel Job"), "Cancel must not show when idle").toBe(false);

    const ui = mount(createElement(MlJobStatus, { busy: true, status: "Denoising tile 3/40…" }));
    const end = beginMlJob();
    expect(() => throwIfCancelled()).not.toThrow();

    ui.click("Cancel Job");

    expect(mlJobCancelled()).toBe(true);
    expect(() => throwIfCancelled()).toThrow();
    end();
  });
});
