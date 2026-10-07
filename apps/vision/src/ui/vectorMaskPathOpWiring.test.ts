// Layer ▸ Vector Mask ▸ Current Path used to call store.addVectorMaskFromPath()
// with no `op`, so the GUI could only ever REPLACE a vector mask even though the
// engine (combine_layer_vector_mask*) and MCP (mcp/commands.ts vectorMaskFromPath)
// both support folding the path in via a boolean op.
//
// VectorMaskPathOp is exported, so the picker itself is driven for real:
// react-dom/server runs the component, the Dialog is swapped for a prop recorder
// so the rendered tree (with its real onClick closures) can be walked, and each
// option is clicked. What the store and the engine receive is the assertion.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

type Props = Record<string, unknown>;
const { dialogs } = vi.hoisted(() => ({ dialogs: [] as Props[] }));

vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const record = (props: Props) => { dialogs.push(props); return null; };
  return { ...(await importOriginal<Props>()), Dialog: record };
});

import { renderToStaticMarkup } from "react-dom/server";
import { VectorMaskPathOp } from "./Dialogs";
import { engine, store } from "../state/app";

/** Flatten a rendered React node into its elements, depth first. */
function elements(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!isValidElement(n)) return;
    out.push(n);
    visit((n.props as { children?: ReactNode }).children);
  };
  visit(node);
  return out;
}

interface Option { label: string; hint: string; click: () => void }

function openPicker() {
  dialogs.length = 0;
  const onClose = vi.fn();
  renderToStaticMarkup(createElement(VectorMaskPathOp, { onClose }));
  expect(dialogs, "the picker must render exactly one dialog").toHaveLength(1);
  const dialog = dialogs[0];
  const options: Option[] = elements(dialog.children as ReactNode)
    .filter((el) => el.type === "button")
    .map((el) => {
      const p = el.props as { children: string; title: string; onClick: () => void };
      return { label: p.children, hint: p.title, click: p.onClick };
    });
  return { dialog, options, onClose };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Vector Mask path-op picker", () => {
  it("offers Replace plus all four engine boolean ops (Combine/Subtract Front/Intersect/Exclude Overlapping)", () => {
    const { options } = openPicker();
    expect(options.map((o) => o.label)).toEqual(["Replace", "Combine", "Subtract Front", "Intersect", "Exclude Overlapping"]);
    // Every option explains itself — an unlabelled boolean op is unusable.
    for (const o of options) expect(o.hint, `${o.label} has no hint`).toBeTruthy();
  });

  it("routes each chosen op through store.addVectorMaskFromPath", () => {
    // undefined = the engine's replace path (set_layer_vector_mask*); 0..3 are
    // combine_layer_vector_mask*'s union / subtract / intersect / xor.
    const expected = [undefined, 0, 1, 2, 3];
    const add = vi.spyOn(store, "addVectorMaskFromPath").mockImplementation(() => {});
    vi.spyOn(engine, "consumeEditError").mockReturnValue(false);
    const { options } = openPicker();
    for (const option of options) option.click();
    expect(add.mock.calls.map((c) => c[0])).toEqual(expected);
  });

  it("surfaces a refusal via the shared edit-error toast, then closes", () => {
    // addVectorMaskFromPath doesn't return a boolean — a refusal (e.g. an
    // imported read-only Photoshop source) only sets the engine's
    // last_edit_error, so it must be drained the same way every other refused
    // edit in this app surfaces it (engine.onEditError wiring in App.tsx).
    const order: string[] = [];
    vi.spyOn(store, "addVectorMaskFromPath").mockImplementation(() => { order.push("apply"); });
    vi.spyOn(engine, "consumeEditError").mockImplementation(() => { order.push("drain"); return true; });
    const { options, onClose } = openPicker();
    options[1].click();
    expect(order).toEqual(["apply", "drain"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels without touching the mask", () => {
    const add = vi.spyOn(store, "addVectorMaskFromPath").mockImplementation(() => {});
    const { dialog, onClose } = openPicker();
    (dialog.onClose as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });
});

// ── residual source-level guard ────────────────────────────────
// App.tsx builds its `menuActions` map inside the App component, over the live
// engine/canvas — there is no exported handle on it, and the component cannot be
// mounted in the Node unit run, so this half of the wiring has no behaviour to
// call. Pinning the two call sites is the only check available below the e2e
// suite; the picker's own behaviour is covered above.
const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

describe("App menu reaches the picker", () => {
  it("opens the picker instead of replacing the mask directly from the menu", () => {
    expect(appSource).toContain('vectormaskpath: () => setVectorMaskOpPicker(true),');
    expect(appSource).not.toContain("vectormaskpath: () => store.addVectorMaskFromPath()");
  });

  it("mounts VectorMaskPathOp from the menu-driven state", () => {
    expect(appSource).toContain('{vectorMaskOpPicker && <VectorMaskPathOp onClose={() => setVectorMaskOpPicker(false)} />}');
  });
});
