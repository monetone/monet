import { describe, it, expect, beforeEach } from "vitest";
import { addGraphic, loadLibrary, removeGraphic, saveLibrary, MAX_ASSETS, type LibraryGraphic } from "./libraries";

const g = (id: string): LibraryGraphic => ({ id, name: id, dataUrl: "data:,", w: 1, h: 1 });

// The unit suite runs in node, which has no Storage.
function installStorage(setItem?: (k: string, v: string) => void): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: setItem ?? ((k: string, v: string) => { cells.set(k, v); }),
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

describe("libraries", () => {
  it("prepends, dedupes by id, and caps the count", () => {
    let list: LibraryGraphic[] = [];
    for (let i = 0; i < MAX_ASSETS + 5; i++) list = addGraphic(list, g(`a${i}`));
    expect(list).toHaveLength(MAX_ASSETS);
    expect(list[0].id).toBe(`a${MAX_ASSETS + 4}`); // newest first
  });

  it("re-adding an id moves it to front without duplicating", () => {
    const list = addGraphic(addGraphic([], g("x")), g("y"));
    const bumped = addGraphic(list, g("x"));
    expect(bumped.filter((a) => a.id === "x")).toHaveLength(1);
    expect(bumped[0].id).toBe("x");
  });

  it("removes by id", () => {
    const list = addGraphic(addGraphic([], g("x")), g("y"));
    expect(removeGraphic(list, "x").map((a) => a.id)).toEqual(["y"]);
  });
});

describe("library storage (#137)", () => {
  beforeEach(() => { installStorage(); });

  it("reports whether the list really reached storage", () => {
    expect(saveLibrary([g("x")])).toBe(true);
    installStorage(() => { throw new DOMException("quota", "QuotaExceededError"); });
    expect(saveLibrary([g("y")])).toBe(false);
  });

  it("drops entries that could never be drawn", () => {
    localStorage.setItem("mv.library", JSON.stringify([
      g("ok"),
      { id: "truncated", name: "t", w: 1, h: 1 }, // no dataUrl — would reach loadImg(undefined)
      { id: 7, name: "n", dataUrl: "data:,", w: 1, h: 1 },
      "not an object",
    ]));
    expect(loadLibrary().map((a) => a.id)).toEqual(["ok"]);
  });

  it("survives a corrupt or non-array value", () => {
    localStorage.setItem("mv.library", "{oops");
    expect(loadLibrary()).toEqual([]);
    localStorage.setItem("mv.library", '{"a":1}');
    expect(loadLibrary()).toEqual([]);
  });
});
