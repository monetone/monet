import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, type AppSnapshot } from "./store";

function setup(converted = true) {
  const raster = {
    convert_imported_photoshop_to_rgb: vi.fn(() => converted),
    set_mode: vi.fn(),
    set_depth: vi.fn(),
    // setColorMode re-reads the mode after set_mode, because the engine can
    // refuse the change (32-bit float / imported Photoshop); 1 = Grayscale.
    doc_mode: vi.fn(() => 1),
    assign_profile: vi.fn(),
    convert_profile_with_icc: vi.fn(),
  };
  const client = {
    engine: raster,
    e: raster,
    commit: vi.fn(() => true),
    consumeEditError: vi.fn(() => true),
    sync: vi.fn(),
    lastBrush: [] as number[],
    onCommit: null as (() => void) | null,
  };
  const store = new Store(client as never);
  const set = (store as unknown as { set: (patch: Partial<AppSnapshot>) => void }).set.bind(store);
  set({ photoshopPreview: { mode: 4, depth: 16, isPsb: false } });
  return { store, client, raster };
}

describe("preserved Photoshop preview", () => {
  it("makes RGB the one explicit conversion escape hatch", () => {
    const { store, client, raster } = setup();

    store.setColorMode(0);

    expect(raster.convert_imported_photoshop_to_rgb).toHaveBeenCalledOnce();
    expect(raster.set_mode).not.toHaveBeenCalled();
    expect(client.commit).toHaveBeenCalledOnce();
  });

  it("keeps ordinary mode and depth changes behind commit error handling", () => {
    const { store, client, raster } = setup(false);

    store.setColorMode(2);
    store.setDepth(16);

    expect(raster.set_mode).toHaveBeenCalledWith(2);
    expect(raster.set_depth).toHaveBeenCalledWith(16);
    expect(client.commit).toHaveBeenCalledTimes(2);
    expect(client.sync).not.toHaveBeenCalled();
    expect(store.state.mode).toBe(0);
    expect(store.state.depth).toBe(8);
  });

  it("does not fall through to a normal mode change when conversion fails", () => {
    const { store, client, raster } = setup(false);

    store.setColorMode(0);

    expect(raster.set_mode).not.toHaveBeenCalled();
    expect(client.commit).not.toHaveBeenCalled();
    expect(client.consumeEditError).toHaveBeenCalledOnce();
  });
});
