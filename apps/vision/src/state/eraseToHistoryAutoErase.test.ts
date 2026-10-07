// Guards #432 at the store: Erase to History rides the History Brush's paint
// path (engine mode 12) with the Eraser's own tip, and the Pencil's Auto Erase
// swaps the background colour in for a stroke that starts on foreground pixels.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, hsvToRgba } from "./store";

function storeWith({ historySource = true, pixel = 0, reader = true } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const eng = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => {
      if (name === "has_history_source") return () => historySource;
      if (name === "active_layer_pixel") return reader ? () => pixel : undefined;
      if (name === "has_pattern") return () => true;
      return (...a: unknown[]) => { calls.push([name, ...a]); return 0; };
    },
    has: (_t, name: string) => name !== "active_layer_pixel" || reader,
  });
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), blit: vi.fn(), onCommit: null, lastBrush: [] as number[] };
  const store = new Store(client as never);
  // The snapshot's hasHistorySource is what the options bar and pushBrush read.
  (store as unknown as { set(patch: object): void }).set({ hasHistorySource: historySource });
  const last = (name: string) => [...calls].reverse().find((c) => c[0] === name);
  return { store, calls, last };
}

/** Pack the foreground the way active_layer_pixel does: 0xRRGGBBAA, opaque. */
function packed(store: Store, alpha = 255): number {
  const [r, g, b] = hsvToRgba(store.state.fg);
  return ((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0;
}

describe("Erase to History (#432)", () => {
  it("paints from the history source through mode 12 with the erase flag off", () => {
    const { store, last } = storeWith({ historySource: true });
    store.setTool("erase");
    store.setBrush({ eraseToHistory: true });
    store.beginBrushStroke(0, 0);
    expect(last("set_brush_mode")).toEqual(["set_brush_mode", 12]);
    expect(last("set_brush")!.at(-1)).toBe(false); // nothing erases
  });

  it("stays a plain eraser while no source is set, and when the box is off", () => {
    const noSource = storeWith({ historySource: false });
    noSource.store.setTool("erase");
    noSource.store.setBrush({ eraseToHistory: true });
    noSource.store.beginBrushStroke(0, 0);
    expect(noSource.last("set_brush_mode")).toEqual(["set_brush_mode", 1]);
    expect(noSource.last("set_brush")!.at(-1)).toBe(true);

    const off = storeWith({ historySource: true });
    off.store.setTool("erase");
    off.store.beginBrushStroke(0, 0);
    expect(off.last("set_brush_mode")).toEqual(["set_brush_mode", 1]);
  });

  it("keeps the Eraser's tip: Block mode still squares the footprint", () => {
    const { store, last } = storeWith({ historySource: true });
    store.setTool("erase");
    store.setOptions({ eraserMode: "block" });
    store.setBrush({ eraseToHistory: true });
    store.beginBrushStroke(0, 0);
    expect(last("set_block")).toEqual(["set_block", true]);
    expect(last("set_brush")![2]).toBe(1); // hard-edged, like the Block eraser
  });
});

describe("Pencil Auto Erase (#432)", () => {
  const rgb = (call: unknown[]) => call.slice(6, 9);

  it("paints the background colour when the stroke starts on a foreground pixel", () => {
    const { store, last } = storeWith();
    store.setTool("pencil");
    store.setBrush({ autoErase: true });
    const fgCall = () => { store.beginBrushStroke(3, 4); return rgb(last("set_brush")!); };
    // Some other pixel: the foreground paints as usual.
    expect(fgCall()).toEqual(hsvToRgba(store.state.fg).slice(0, 3));
    store.endBrushStroke();
    // A pixel wearing the foreground: the whole stroke paints the background.
    const { store: s2, last: l2 } = storeWith({ pixel: packed(store) });
    s2.setTool("pencil");
    s2.setBrush({ autoErase: true });
    s2.beginBrushStroke(3, 4);
    expect(rgb(l2("set_brush")!)).toEqual(hsvToRgba(s2.state.bg).slice(0, 3));
    // …and only for that stroke.
    s2.endBrushStroke();
    s2.beginBrushStroke(9, 9);
    s2.endBrushStroke();
  });

  it("does not swap for a translucent pixel, an off box, or the Brush tool", () => {
    const fg = (s: Store) => hsvToRgba(s.state.fg).slice(0, 3);
    const translucent = storeWith({ pixel: 0 });
    translucent.store.setTool("pencil");
    translucent.store.setBrush({ autoErase: true });
    const semi = storeWith({ pixel: packed(translucent.store, 128) });
    semi.store.setTool("pencil");
    semi.store.setBrush({ autoErase: true });
    semi.store.beginBrushStroke(0, 0);
    expect(rgb(semi.last("set_brush")!)).toEqual(fg(semi.store));

    const off = storeWith({ pixel: packed(translucent.store) });
    off.store.setTool("pencil");
    off.store.beginBrushStroke(0, 0);
    expect(rgb(off.last("set_brush")!)).toEqual(fg(off.store));

    const brush = storeWith({ pixel: packed(translucent.store) });
    brush.store.setTool("brush");
    brush.store.setBrush({ autoErase: true });
    brush.store.beginBrushStroke(0, 0);
    expect(rgb(brush.last("set_brush")!)).toEqual(fg(brush.store));
  });

  it("degrades to the foreground on a wasm build without the pixel reader", () => {
    const { store, last } = storeWith({ reader: false, pixel: 0xffffffff });
    store.setTool("pencil");
    store.setBrush({ autoErase: true });
    expect(() => store.beginBrushStroke(0, 0)).not.toThrow();
    expect(rgb(last("set_brush")!)).toEqual(hsvToRgba(store.state.fg).slice(0, 3));
  });
});
