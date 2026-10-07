import { beforeEach, describe, expect, it } from "vitest";

import { parseBrushTips, serializeBrushTips, type BrushTip } from "./brushTips";
import { decodeProjectEnvelope, encodeProjectEnvelope, type ProjectDocumentMeta } from "./projectEnvelope";

/**
 * Custom brush tips used to be lost on reload and never travelled inside a
 * .mvision, so a document that painted with a tip could not be reopened with it.
 * These cover the two halves of the fix: the localStorage round trip the store
 * uses (saveBrushTips/loadBrushTips) and the project-envelope round trip.
 */

const tip = (name: string, w = 2, h = 2): BrushTip => ({
  name, w, h, alpha: new Uint8Array(w * h).fill(0x80),
});

// The unit run has no DOM, so stand up the same minimal Storage the store talks to
// (mirrors the stub in ui/createDropletScriptEventsWiring.test.ts).
function installLocalStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  } as Storage;
}

describe("brush tip persistence", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("survives a serialize -> localStorage -> parse round trip", () => {
    const lib = [tip("Chalk 40"), tip("Speckle", 3, 1)];
    localStorage.setItem("mv.brushTips", JSON.stringify(serializeBrushTips(lib)));

    const back = parseBrushTips(localStorage.getItem("mv.brushTips"));
    expect(back).not.toBeNull();
    expect(back!.map((t) => t.name)).toEqual(["Chalk 40", "Speckle"]);
    expect(back![0].w).toBe(2);
    expect(back![1].w).toBe(3);
    expect(back![1].h).toBe(1);
    // the pixel payload is the point — a tip without its alpha is not a tip
    expect(Array.from(back![0].alpha)).toEqual([0x80, 0x80, 0x80, 0x80]);
    expect(back![1].alpha.length).toBe(3);
  });

  it("returns null for a value that is not a library, so a bad key cannot wipe the panel", () => {
    expect(parseBrushTips(null)).toBeNull();
    expect(parseBrushTips("not json")).toBeNull();
    expect(parseBrushTips("{}")).toBeNull();
  });

  it("drops malformed entries rather than rejecting the whole library", () => {
    const good = serializeBrushTips([tip("Keep")]);
    const mixed = JSON.stringify([...good, { name: "Bad", w: 4, h: 4, alpha: [1, 2] }]);
    const back = parseBrushTips(mixed);
    expect(back).not.toBeNull();
    expect(back!.map((t) => t.name)).toEqual(["Keep"]);
  });

  it("travels inside a .mvision project envelope", () => {
    const doc: ProjectDocumentMeta = {
      colorProfileAssigned: true,
      brushTips: [tip("Travelled")],
    };
    const bytes = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], doc, []);
    const back = decodeProjectEnvelope(bytes);

    expect(back).not.toBeNull();
    expect(back!.document.brushTips?.map((t) => t.name)).toEqual(["Travelled"]);
    expect(Array.from(back!.document.brushTips![0].alpha)).toEqual([0x80, 0x80, 0x80, 0x80]);
  });

  it("a project with no tips does not carry a brushTips key", () => {
    const bytes = encodeProjectEnvelope(new Uint8Array([1]), [], { colorProfileAssigned: false }, []);
    const back = decodeProjectEnvelope(bytes);
    expect(back!.document.brushTips ?? []).toEqual([]);
  });
});
