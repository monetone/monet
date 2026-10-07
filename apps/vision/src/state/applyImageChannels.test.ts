// Guards #415: Apply Image gained a Channel picker and Calculations gained
// Transparency, saved alpha channels and Result ▸ New Document. The engine
// predicates are covered in packages/engine; these assert the store forwards
// the right channel code and that New Document never touches the selection.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = [string, ...unknown[]];

function storeWith(over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const eng = {
    apply_image: (...a: unknown[]) => calls.push(["apply_image", ...a]),
    apply_image_channel: (...a: unknown[]) => calls.push(["apply_image_channel", ...a]),
    calculations: (...a: unknown[]) => calls.push(["calculations", ...a]),
    calculations_mask: (...a: unknown[]) => { calls.push(["mask", ...a]); return Uint8Array.of(1, 2); },
    encode_gray_png: (p: Uint8Array) => { calls.push(["png", Array.from(p)]); return Uint8Array.of(9); },
    saved_selection_names: () => ["Alpha 1"],
    ...over,
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  const store = new Store(client as never);
  const opened: [Uint8Array, string][] = [];
  (store as unknown as { openImage: unknown }).openImage = (b: Uint8Array, n: string) => { opened.push([b, n]); };
  return { store, calls, opened };
}

describe("Apply Image channel picker (#415)", () => {
  it("defaults to the RGB composite, so existing behaviour is unchanged", () => {
    const { store, calls } = storeWith();
    store.applyImage(3, "normal", 100, false);
    expect(calls[0]).toEqual(["apply_image_channel", 3, 0, 1, false, 255]);
  });

  it("forwards a chosen channel code, including a saved alpha channel", () => {
    const { store, calls } = storeWith();
    store.applyImage(3, "normal", 50, true, 4); // Transparency
    store.applyImage(3, "normal", 50, true, 5); // the first saved channel
    expect(calls.map((c) => c[5])).toEqual([4, 5]);
    expect(calls[0][3]).toBeCloseTo(0.5); // opacity is still a 0..1 fraction
  });

  it("falls back to the composite call on a wasm build without the channel op", () => {
    const { store, calls } = storeWith({ apply_image_channel: undefined });
    store.applyImage(3, "normal", 100, false, 4);
    expect(calls[0][0]).toBe("apply_image");
  });
});

describe("Calculations ▸ New Document (#415)", () => {
  it("reads the blend back and opens it as a grayscale document", () => {
    const { store, calls, opened } = storeWith();
    expect(store.calculationsToDocument(1, 4, false, 2, 0, true, "multiply", 80)).toBe(true);
    expect(calls[0].slice(0, 7)).toEqual(["mask", 1, 4, false, 2, 0, true]);
    // Crucially it never calls `calculations`, which would replace the selection.
    expect(calls.some((c) => c[0] === "calculations")).toBe(false);
    expect(calls).toContainEqual(["png", [1, 2]]);
    expect(opened).toHaveLength(1);
    expect(opened[0][1]).toMatch(/_Calculations$/);
  });

  it("does nothing when the blend has no result to open", () => {
    const { store, opened } = storeWith({ calculations_mask: () => new Uint8Array() });
    expect(store.calculationsToDocument(1, 0, false, 2, 0, false, "normal", 100)).toBe(false);
    expect(opened).toHaveLength(0);
  });

  it("reports failure rather than throwing on a wasm build without the readback", () => {
    const { store } = storeWith({ calculations_mask: undefined });
    expect(store.calculationsToDocument(1, 0, false, 2, 0, false, "normal", 100)).toBe(false);
  });
});
