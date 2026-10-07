// vis-type-10: named type styles support Photoshop's Based On inheritance and
// Next Style. A child stores only its drift from the parent, so redefining the
// parent flows down into the child *and* into every layer linked to it; Next
// Style seeds and links the next type layer created. Same stub harness as
// typeStyleLinks.test.ts — the rasterizer is Canvas-2D-only, so what is asserted
// is the spec JSON the engine ends up storing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

vi.mock("../text/raster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/raster")>()),
  rasterizeSpec: () => ({ w: 1, h: 1, placeX: 0, placeY: 0, data: new Uint8ClampedArray(4) }),
}));

import { engine, store, text } from "./app";
import { defaultSpec } from "../text/spec";
import type { TextSpec } from "../text/spec";

type LinkedSpec = TextSpec & { charStyle?: string; paraStyle?: string };

const specs = new Map<number, string>();
function install(ids: number[], active: number) {
  specs.clear();
  engine.engine = {
    layer_text_spec: (id: number) => specs.get(id) ?? "",
    set_text_layer_spec: (id: number, _x: number, _y: number, _w: number, _h: number, _b: Uint8Array, json: string) =>
      void specs.set(id, json),
    text_edit_session: () => {},
    set_layer_name_untracked: () => {},
  } as unknown as typeof engine.engine;
  vi.spyOn(engine, "commit").mockReturnValue(true);
  // A new layer just takes the next free id and becomes active, which is all
  // createAt needs from the store.
  vi.spyOn(store, "addLayer").mockImplementation(() => {
    const id = Math.max(0, ...store.state.layers.map((l) => l.id)) + 1;
    store.state.layers = [...store.state.layers, { id, name: `Type ${id}` }] as typeof store.state.layers;
    store.state.activeLayerId = id;
  });
  vi.spyOn(store, "beginTextEdit").mockImplementation(() => {});
  store.state.layers = ids.map((id) => ({ id, name: `Type ${id}` })) as typeof store.state.layers;
  store.state.activeLayerId = active;
  for (const id of ids) specs.set(id, JSON.stringify(defaultSpec("Hello", { size: 24, tracking: 0 })));
}
const specOf = (id: number) => JSON.parse(specs.get(id)!) as LinkedSpec;
const patch = (id: number, p: Partial<TextSpec>) => text.apply(id, { ...specOf(id), ...p });
const styleOf = (kind: "char" | "para", name: string) => text.typeStyles(kind).find((x) => x.name === name)!;

/** Capture layer `id`'s current attributes as `name`, optionally based on a parent. */
function capture(kind: "char" | "para", name: string, id: number, basedOn?: string) {
  store.state.activeLayerId = id;
  text.addTypeStyle(kind, name, basedOn);
}

describe("Based On inheritance", () => {
  beforeEach(() => {
    localStorage.clear();
    install([1, 2], 1);
  });

  it("stores only the child's drift from its parent", () => {
    capture("char", "Body", 1);
    patch(2, { size: 48 });
    capture("char", "Headline", 2, "Body");

    const child = styleOf("char", "Headline");
    expect(child.basedOn).toBe("Body");
    expect(child.fields).toEqual({ size: 48 }); // everything else comes from Body
  });

  it("flows a parent redefine into the child and the layers linked to it", () => {
    capture("char", "Body", 1);
    patch(2, { size: 48 });
    capture("char", "Headline", 2, "Body");

    // Redefine the parent from layer 1 with a new font.
    patch(1, { font: "Georgia" });
    store.state.activeLayerId = 1;
    text.redefineTypeStyle("char", "Body");

    expect(specOf(2).font).toBe("Georgia"); // inherited through Headline
    expect(specOf(2).size).toBe(48); // the child's own field still wins
    expect(text.typeStyleLink("char", 2)).toEqual({ name: "Headline", overrides: [] });
  });

  it("refuses a Based On that would close a cycle", () => {
    capture("char", "Body", 1);
    capture("char", "Headline", 2, "Body");
    text.setTypeStyleBasedOn("char", "Body", "Headline");
    expect(styleOf("char", "Body").basedOn).toBeUndefined();
    expect(text.typeStyleBasedOnChoices("char", "Body")).toEqual([]);
  });

  it("keeps a style looking the same when it is re-parented", () => {
    capture("char", "Body", 1);
    patch(2, { size: 48 });
    capture("char", "Headline", 2);

    text.setTypeStyleBasedOn("char", "Headline", "Body");
    expect(styleOf("char", "Headline").fields).toEqual({ size: 48 });
    expect(specOf(2).size).toBe(48); // the linked layer is untouched by re-parenting
  });

  it("flattens children when the parent is deleted, without restyling them", () => {
    capture("char", "Body", 1);
    patch(2, { size: 48 });
    capture("char", "Headline", 2, "Body");

    text.deleteTypeStyle("char", "Body");
    const child = styleOf("char", "Headline");
    expect(child.basedOn).toBeUndefined();
    expect(child.fields.size).toBe(48);
    expect(child.fields.font).toBe(specOf(1).font); // the inherited font was baked in
    expect(specOf(2).size).toBe(48);
  });
});

describe("Next Style", () => {
  beforeEach(() => {
    localStorage.clear();
    install([1, 2], 1);
  });

  it("starts the next type layer in the linked style's Next Style", () => {
    capture("char", "Body", 1);
    patch(2, { size: 48 });
    capture("char", "Headline", 2);
    text.setTypeStyleNext("char", "Headline", "Body");

    // Layer 2 is linked to Headline, so the layer created next picks up Body.
    store.state.activeLayerId = 2;
    const id = text.createAt(10, 20);
    expect(specOf(id).charStyle).toBe("Body");
    expect(specOf(id).size).toBe(24);
  });

  it("leaves a new layer alone when no Next Style is set", () => {
    capture("char", "Headline", 1);
    store.state.activeLayerId = 1;
    const id = text.createAt(10, 20);
    expect(specOf(id).charStyle).toBeUndefined();
  });

  it("drops a Next Style pointing at a deleted style", () => {
    capture("char", "Body", 1);
    capture("char", "Headline", 2);
    text.setTypeStyleNext("char", "Headline", "Body");
    text.deleteTypeStyle("char", "Body");
    expect(styleOf("char", "Headline").next).toBeUndefined();
  });
});
