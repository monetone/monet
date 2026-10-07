import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

function setup(commitResult: boolean) {
  const raster = { content_aware_scale: vi.fn() };
  const client = {
    engine: raster,
    e: raster,
    commit: vi.fn(() => commitResult),
    lastBrush: [] as number[],
    onCommit: null as (() => void) | null,
  };
  const store = new Store(client as never);
  const requestFit = vi.spyOn(store, "requestFit").mockImplementation(() => {});
  return { store, client, raster, requestFit };
}

describe("float geometry refusal", () => {
  it("does not continue content-aware scale UI work after a rejected commit", () => {
    const { store, client, raster, requestFit } = setup(false);

    store.contentAwareScale(20, 12);

    expect(raster.content_aware_scale).toHaveBeenCalledWith(20, 12);
    expect(client.commit).toHaveBeenCalledTimes(1);
    expect(requestFit).not.toHaveBeenCalled();
  });

  it("refits after a successful content-aware scale commit", () => {
    const { store, requestFit } = setup(true);

    store.contentAwareScale(20, 12);

    expect(requestFit).toHaveBeenCalledTimes(1);
  });
});
