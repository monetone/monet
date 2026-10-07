// Metadata browser (LR's Library Filter ▸ Metadata tab) — the two pieces of the
// column browser that are pure: what a list-box change selects, and what the
// persisted column choice is trusted to contain. There is no DOM in this test
// env, so `localStorage` is stubbed.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { META_COLUMNS, type MetaSelection } from "../catalog/types";
import { loadMetaCols, nextMetaSelection } from "./FilterBar";

const KEY = "galerie.filter.metaColumns";

beforeEach(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("nextMetaSelection", () => {
  it("keeps every picked value — a column is multi-select, not a dropdown", () => {
    expect(nextMetaSelection({}, "camera", ["EOS R5", "Z9"])).toEqual({
      camera: ["EOS R5", "Z9"],
    });
  });

  it("leaves the other columns alone (columns AND together)", () => {
    const base: MetaSelection = { year: ["2026"] };
    expect(nextMetaSelection(base, "lens", ["23mm"])).toEqual({
      year: ["2026"],
      lens: ["23mm"],
    });
    expect(base).toEqual({ year: ["2026"] }); // no mutation
  });

  it("drops the column when All is in the selection, or nothing is picked", () => {
    const base: MetaSelection = { camera: ["Z9"], year: ["2026"] };
    expect(nextMetaSelection(base, "camera", ["", "Z9"])).toEqual({ year: ["2026"] });
    expect(nextMetaSelection(base, "camera", [])).toEqual({ year: ["2026"] });
  });
});

describe("loadMetaCols", () => {
  it("defaults to LR's four columns when nothing is stored", () => {
    expect(loadMetaCols()).toEqual(["year", "camera", "lens", "label"]);
  });

  it("round-trips a stored choice", () => {
    localStorage.setItem(KEY, JSON.stringify(["keyword", "aspect"]));
    expect(loadMetaCols()).toEqual(["keyword", "aspect"]);
  });

  it("rejects ids this build cannot resolve, rather than rendering dead columns", () => {
    localStorage.setItem(KEY, JSON.stringify(["camera", "serial-no", 7, null]));
    expect(loadMetaCols()).toEqual(["camera"]);
  });

  it("falls back on garbage and caps the column count", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadMetaCols()).toEqual(["year", "camera", "lens", "label"]);
    localStorage.setItem(KEY, JSON.stringify([])); // no columns at all
    expect(loadMetaCols()).toEqual(["year", "camera", "lens", "label"]);
    localStorage.setItem(KEY, JSON.stringify(META_COLUMNS.map((c) => c.id)));
    expect(loadMetaCols()).toHaveLength(8);
  });
});
