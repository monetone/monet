// Unit tests for the Color Sampler tool's pure reducers + menu wiring. The
// reducers are engine-free so they run in node; the live readout + canvas
// interactions are covered by e2e/color-sampler.spec.ts.
import { describe, it, expect, vi } from "vitest";
import {
  addSampler,
  removeNearestSampler,
  moveSampler,
  nearestSamplerIndex,
  MAX_SAMPLERS,
  type SamplePoint,
} from "@monet-ui/monet-color";
import { buildPhotoshopMenus } from "../ui/psMenus";
import { PS_MENUS, type PsNode } from "../ui/psMenuData";

const collectMonetIds = (nodes: PsNode[]): string[] =>
  nodes.flatMap((n) =>
    n.kind === "submenu" ? collectMonetIds(n.items) : n.kind === "item" && n.monetId ? [n.monetId] : [],
  );
const flatten = (items: any[]): any[] => items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const allLeaves = (bar: any[]) => bar.flatMap((m) => flatten(m.items));

describe("color sampler reducers", () => {
  it("addSampler appends rounded points and reports the cap", () => {
    let list: SamplePoint[] = [];
    list = addSampler(list, 10.4, 20.6);
    expect(list).toEqual([{ x: 10, y: 21 }]);
    list = addSampler(list, 30, 40);
    expect(list).toHaveLength(2);
    // the original array is never mutated
    const before = list;
    addSampler(list, 1, 1);
    expect(before).toHaveLength(2);
  });

  it("addSampler caps at MAX_SAMPLERS (10) and returns the same ref past the cap", () => {
    let list: SamplePoint[] = [];
    for (let i = 0; i < MAX_SAMPLERS + 5; i++) list = addSampler(list, i, i);
    expect(list).toHaveLength(MAX_SAMPLERS);
    const full = list;
    expect(addSampler(full, 99, 99)).toBe(full); // no-op returns identity
  });

  it("nearestSamplerIndex finds the closest point, -1 when empty", () => {
    expect(nearestSamplerIndex([], 5, 5)).toBe(-1);
    const list = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 }];
    expect(nearestSamplerIndex(list, 48, 52)).toBe(2);
    expect(nearestSamplerIndex(list, 95, 99)).toBe(1);
  });

  it("removeNearestSampler drops only the closest point", () => {
    const list = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 }];
    const after = removeNearestSampler(list, 51, 49);
    expect(after).toEqual([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    expect(list).toHaveLength(3); // input untouched
    expect(removeNearestSampler([], 1, 1)).toEqual([]);
  });

  it("moveSampler repositions one point (rounded); out-of-range is a no-op", () => {
    const list = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(moveSampler(list, 1, 33.7, 44.2)).toEqual([{ x: 0, y: 0 }, { x: 34, y: 44 }]);
    expect(moveSampler(list, 5, 1, 1)).toBe(list); // bad index → identity
    expect(moveSampler(list, -1, 1, 1)).toBe(list);
  });
});

describe("Color Sampler tool menu wiring", () => {
  it("is present in the blueprint under monetId 'colorsamplertool'", () => {
    expect(collectMonetIds(PS_MENUS.flatMap((m) => m.tree))).toContain("colorsamplertool");
  });

  it("renders enabled and wired when a handler is supplied", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ colorsamplertool: fn });
    const item = allLeaves(bar).find((it: any) => it.id === "colorsamplertool");
    expect(item).toBeTruthy();
    expect(item.label).toBe("Color Sampler Tool");
    expect(item.disabled).toBeFalsy();
    item.action();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exposes View ▸ Show ▸ Color Samplers under monetId 'showsamplers'", () => {
    expect(collectMonetIds(PS_MENUS.flatMap((m) => m.tree))).toContain("showsamplers");
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ showsamplers: fn });
    const item = allLeaves(bar).find((it: any) => it.id === "showsamplers");
    expect(item.label).toBe("Color Samplers");
    item.action();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
