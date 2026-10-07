// Guards #416: a group or multi-layer selection becomes ONE smart object whose
// contents keep their stack, instead of the group being refused outright. The
// engine ops are covered in packages/engine; this drives the real `smart.convert`
// facade so the routing between the flat and layered ops is what is asserted,
// not a copy of it.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { engine, smart, store } from "./app";
import { LAYER_KIND } from "./engineContracts";
import { getSmartEditBinding, setSmartEditBinding } from "./smartEdits";

type Call = [string, ...unknown[]];
const calls: Call[] = [];

function installEngine({ layeredOp = true } = {}) {
  calls.length = 0;
  const eng: Record<string, unknown> = {
    convert_to_smart_object: (id: number) => calls.push(["flat", id]),
    layer_kind: () => LAYER_KIND.pixel,
    active_layer_id: () => 1,
  };
  if (layeredOp) {
    eng.convert_layers_to_smart_object = (ids: Uint32Array) => calls.push(["layered", Array.from(ids)]);
  }
  engine.engine = eng as never;
  vi.spyOn(engine, "commit").mockReturnValue(true);
}

function setLayers(layers: { id: number; kind: number }[], selected: number[], active: number) {
  vi.spyOn(store, "state", "get").mockReturnValue({
    ...store.state, layers, selectedLayerIds: selected, activeLayerId: active, activeDocId: 1,
  } as never);
}

describe("Convert to Smart Object routing (#416)", () => {
  beforeEach(() => { vi.restoreAllMocks(); installEngine(); });

  it("packs a multi-layer selection into one smart object", () => {
    setLayers([{ id: 1, kind: 0 }, { id: 2, kind: 0 }, { id: 3, kind: 0 }], [1, 2, 3], 2);
    smart.convert(2);
    expect(calls).toEqual([["layered", [1, 2, 3]]]);
  });

  it("packs a group header, which the flat path refuses outright", () => {
    setLayers([{ id: 5, kind: LAYER_KIND.groupHeader }], [5], 5);
    smart.convert(5);
    expect(calls).toEqual([["layered", [5]]]);
  });

  it("keeps the original flat path for a single plain layer", () => {
    setLayers([{ id: 7, kind: 0 }], [7], 7);
    smart.convert(7);
    expect(calls).toEqual([["flat", 7]]);
  });

  it("ignores a stale selection that does not contain the target layer", () => {
    setLayers([{ id: 9, kind: 0 }], [1, 2], 9);
    smart.convert(9);
    expect(calls).toEqual([["flat", 9]]);
  });

  it("falls back to the flat conversion on a wasm build without the layered op", () => {
    installEngine({ layeredOp: false });
    setLayers([{ id: 1, kind: 0 }, { id: 2, kind: 0 }], [1, 2], 1);
    smart.convert(1);
    expect(calls).toEqual([["flat", 1]]);
  });
});

describe("smart edit binding carries the contents shape (#416)", () => {
  it("marks a layered edit so it commits back as a document, not a PNG", () => {
    setSmartEditBinding({ editDocId: 2, parentDocId: 1, parentLayerId: 8, name: "x.mvision", layered: true });
    expect(getSmartEditBinding(2)?.layered).toBe(true);
    // A flat edit leaves the flag off, so the PNG path stays the default.
    setSmartEditBinding({ editDocId: 3, parentDocId: 1, parentLayerId: 8, name: "x.png" });
    expect(getSmartEditBinding(3)?.layered).toBeUndefined();
  });
});

describe("smart object instances (#417)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("detaches an instance through the engine, for New Smart Object via Copy", () => {
    const calls: string[] = [];
    engine.engine = {
      detach_smart_object: (id: number) => { calls.push(`detach:${id}`); return true; },
      smart_source_id: (id: number) => (id === 4 ? 77 : 0),
    } as never;
    vi.spyOn(engine, "commit").mockReturnValue(true);
    smart.detach(4);
    expect(calls).toEqual(["detach:4"]);
    expect(smart.sourceId(4)).toBe(77);
    expect(smart.sourceId(5)).toBe(0);
  });

  it("degrades quietly on a wasm build without instancing", () => {
    engine.engine = {} as never;
    vi.spyOn(engine, "commit").mockReturnValue(true);
    expect(() => smart.detach(4)).not.toThrow();
    expect(smart.sourceId(4)).toBe(0); // nothing is ever badged as an instance
  });
});

describe("Update Edited Contents (#460)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  function commitBack(accepted: boolean) {
    let active = 2;
    const replaced: number[] = [];
    engine.engine = {
      save_project: () => new Uint8Array([1]),
      layer_kind: () => LAYER_KIND.smartObject,
      replace_smart_object_document: (id: number) => { replaced.push(id); return accepted; },
    } as never;
    const commit = vi.spyOn(engine, "commit").mockReturnValue(true);
    const consume = vi.spyOn(engine, "consumeEditError").mockReturnValue(true);
    const base = store.state;
    vi.spyOn(store, "state", "get").mockImplementation(() => ({ ...base, activeDocId: active }) as never);
    vi.spyOn(store, "activateDoc").mockImplementation((id: number) => { active = id; });
    setSmartEditBinding({ editDocId: 2, parentDocId: 1, parentLayerId: 8, name: "x.mvision", layered: true });
    return { updated: smart.updateEditedContents(), replaced, active: () => active, commit, consume };
  }

  it("commits the contents document into its Smart Object", () => {
    const r = commitBack(true);
    expect(r).toMatchObject({ updated: true, replaced: [8] });
    expect(r.active()).toBe(1);
    expect(r.commit).toHaveBeenCalled();
    expect(r.consume).not.toHaveBeenCalled();
  });

  it("returns a refused commit, says why and keeps the contents tab open", () => {
    const r = commitBack(false);
    expect(r).toMatchObject({ updated: false, replaced: [8] });
    expect(r.consume).toHaveBeenCalled();
    expect(r.active()).toBe(2);
    expect(r.commit).not.toHaveBeenCalled();
  });
});
