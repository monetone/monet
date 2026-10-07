import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { ARTISAN_RE, Store, parseArtisanScene } from "./store";

const utf8 = (text: string) => new TextEncoder().encode(text);

const artisanFile = (doc: Record<string, unknown>) =>
  utf8(JSON.stringify({ format: "monet-artisan", version: 1, document: doc }));

const docWith = (board: Record<string, unknown>) => ({
  id: "D1",
  name: "Poster",
  artboards: [board],
  activeArtboard: 0,
  layers: [{ id: "L1", name: "Layer 1", items: [] }],
});

function fakeEngine() {
  return {
    set_document: vi.fn(),
    vector_set_view: vi.fn(),
    layer_id_at: vi.fn(() => 7),
    set_history_source: vi.fn(),
  };
}

function storeWith(eng: ReturnType<typeof fakeEngine>) {
  const client = { onCommit: null as null | (() => void), buildNew: vi.fn(() => eng) };
  return { store: new Store(client as never), client };
}

describe("ARTISAN_RE", () => {
  it("matches .artisan names case-insensitively, not others", () => {
    expect(ARTISAN_RE.test("logo.artisan")).toBe(true);
    expect(ARTISAN_RE.test("LOGO.ARTISAN")).toBe(true);
    expect(ARTISAN_RE.test("a.b.artisan")).toBe(true);
    expect(ARTISAN_RE.test("artisan.png")).toBe(false);
    expect(ARTISAN_RE.test("logo.artisanx")).toBe(false);
  });
});

describe("parseArtisanScene", () => {
  it("measures the active artboard and keeps the document text verbatim", () => {
    const bytes = artisanFile({
      ...docWith({ id: "A2", name: "Artboard 2", x: 1100, y: 40, width: 640.4, height: 480.6 }),
      artboards: [
        { id: "A1", name: "Artboard 1", x: 0, y: 0, width: 100, height: 100 },
        { id: "A2", name: "Artboard 2", x: 1100, y: 40, width: 640.4, height: 480.6 },
      ],
      activeArtboard: 1,
    });
    const scene = parseArtisanScene(bytes);
    expect(scene.width).toBe(640);
    expect(scene.height).toBe(481);
    expect(scene.x).toBe(1100);
    expect(scene.y).toBe(40);
    // The engine parses the same JSON; re-serializing in TS would drop the
    // Artisan-only fields the Rust model doesn't model.
    expect(scene.json).toBe(new TextDecoder().decode(bytes));
  });

  it("tolerates a bare document object (no wrapper)", () => {
    const bytes = utf8(JSON.stringify(docWith({ x: 0, y: 0, width: 800, height: 600 })));
    expect(parseArtisanScene(bytes)).toMatchObject({ width: 800, height: 600, x: 0, y: 0 });
  });

  it("falls back to Artisan's default size when no usable artboard exists", () => {
    const bytes = artisanFile({ artboards: [], activeArtboard: 0, layers: [] });
    expect(parseArtisanScene(bytes)).toMatchObject({ width: 1000, height: 1000 });
    const degenerate = artisanFile(docWith({ x: 0, y: 0, width: 0, height: -5 }));
    expect(parseArtisanScene(degenerate)).toMatchObject({ width: 1000, height: 1000 });
  });

  it("fails loudly on anything that is not an Artisan document", () => {
    // A wrong-format open must throw, never open as an empty "Untitled".
    expect(() => parseArtisanScene(utf8("\x89PNG\r\n\x1a\n not json"))).toThrow(/Monet Artisan/);
    expect(() => parseArtisanScene(utf8('{"format":"monet-artisan","version":1}'))).toThrow(/Monet Artisan/);
    expect(() => parseArtisanScene(utf8('{"layers":[]}'))).toThrow(/Monet Artisan/);
    expect(() => parseArtisanScene(utf8("[]"))).toThrow(/Monet Artisan/);
  });
});

describe("Store.buildArtisan", () => {
  it("sizes the canvas to the artboard and hands the scene to the engine", () => {
    const eng = fakeEngine();
    const { store, client } = storeWith(eng);
    const bytes = artisanFile(docWith({ x: 0, y: 0, width: 800, height: 600 }));
    expect(store.buildArtisan(bytes)).toBe(eng as never);
    expect(client.buildNew).toHaveBeenCalledWith(800, 600);
    expect(eng.set_document).toHaveBeenCalledWith(new TextDecoder().decode(bytes));
    expect(eng.vector_set_view).not.toHaveBeenCalled(); // artboard already at the origin
    expect(eng.set_history_source).toHaveBeenCalled();
  });

  it("pans an off-origin artboard onto the canvas origin", () => {
    const eng = fakeEngine();
    const { store } = storeWith(eng);
    store.buildArtisan(artisanFile(docWith({ x: 1100, y: -25, width: 300, height: 200 })));
    expect(eng.vector_set_view).toHaveBeenCalledWith(7, -1100, 25, 1, 0);
  });

  it("propagates a malformed document instead of building a blank one", () => {
    const eng = fakeEngine();
    const { store, client } = storeWith(eng);
    expect(() => store.buildArtisan(utf8("not json"))).toThrow(/Monet Artisan/);
    expect(client.buildNew).not.toHaveBeenCalled();
  });
});

// routeOpen and the file dialogs live in the heavy state/app module (it pulls in
// the WASM engine, so it isn't importable in the node unit env). Guard the wiring
// at the source level instead. Mirrors heic.test.ts › app.ts open wiring.
describe("app.ts open wiring", () => {
  const src = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  it("dispatches ARTISAN_RE to openArtisan in routeOpen", () => {
    expect(src).toMatch(/else if \(ARTISAN_RE\.test\(name\)\) store\.openArtisan\(bytes, name\);/);
  });
  it("rebuilds an .artisan document on File ▸ Revert", () => {
    expect(src).toMatch(/if \(ARTISAN_RE\.test\(name\)\) return \{ engine: store\.buildArtisan\(bytes\) \};/);
  });
  it("lists artisan in the open filters and accept string", () => {
    expect(src).toMatch(/"mvision", \.\.\.MONET_CONTAINER_EXTENSIONS, "artisan",/);
    expect(src).toMatch(/\{ name: "Monet Artisan", extensions: \["artisan"\] \}/);
    expect(src).toMatch(/OPEN_ACCEPT = "[^"]*\.artisan"/);
  });
});
