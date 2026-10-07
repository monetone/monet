// Cluster 4 (#526, #529, #544). Paste Into's unlinked mask and Fade's
// availability are proven in the engine tests `paste_into_masks_to_the_selection`
// and `can_fade_tracks_the_last_op`. Here the shipped menu helpers must name
// Undo after the step it reverses, and the later Perspective / canvas-guide
// items must invoke the same command as the first copy. The five dialogs must
// preview through PreviewDialog rather than applying only when OK is clicked.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus, nameUndoItem } from "../ui/psMenus";

const dialogs = readFileSync(fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

function body(start: string, end: string): string {
  const from = dialogs.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = dialogs.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return dialogs.slice(from, to);
}

function itemAtPath(bar: MenuBarEntry[], path: readonly string[]): MenuItemDef | undefined {
  let items = bar.find((menu) => menu.label === path[0])?.items;
  let found: MenuItemDef | undefined;
  for (const label of path.slice(1)) {
    found = items?.find((item) => item.label === label);
    items = found?.items;
  }
  return found;
}

describe("#529 Edit ▸ Undo names the step", () => {
  it("renames only the exact Undo item, and only when a step name exists", () => {
    const bar = buildPhotoshopMenus({ undo: () => {} });
    const before = itemAtPath(bar, ["Edit", "Undo"]);
    expect(before?.label).toBe("Undo");
    nameUndoItem(bar, "");
    expect(itemAtPath(bar, ["Edit", "Undo"])?.label).toBe("Undo");
    const undo = vi.fn();
    const wired = buildPhotoshopMenus({ undo });
    nameUndoItem(wired, "Brush");
    expect(itemAtPath(wired, ["Edit", "Undo"])).toBeUndefined();
    const named = itemAtPath(wired, ["Edit", "Undo Brush"]);
    expect(named?.label).toBe("Undo Brush");
    expect(named?.disabled).toBeFalsy();
    named?.action?.();
    expect(undo).toHaveBeenCalledOnce();
    expect(itemAtPath(wired, ["Edit", "Redo"])?.label).toBe("Redo");
  });

  it("is what the menu bar applies after the menus are built", () => {
    const from = appSource.indexOf("const menus = buildPhotoshopMenus(");
    const to = appSource.indexOf("return menus;", from);
    expect(appSource.slice(from, to)).toContain("nameUndoItem(menus, undoLabel)");
  });
});

describe("#544 duplicate Perspective and guide commands stay enabled", () => {
  it("invokes the shared handler on the later item and leaves the other scopes dead", () => {
    const persp = vi.fn();
    const showguides = vi.fn();
    const clearguides = vi.fn();
    const bar = buildPhotoshopMenus({ persp, showguides, clearguides });
    const later: [readonly string[], ReturnType<typeof vi.fn>][] = [
      [["Edit", "Transform", "Perspective"], persp],
      [["View", "Show", "Canvas Guides"], showguides],
      [["View", "Clear Canvas Guides"], clearguides],
    ];
    for (const [path, action] of later) {
      const item = itemAtPath(bar, path);
      expect(item, path.join(" ▸ ")).toBeDefined();
      expect(item?.disabled, path.join(" ▸ ")).toBeFalsy();
      item?.action?.();
      expect(action, path.join(" ▸ ")).toHaveBeenCalledOnce();
    }
    expect(itemAtPath(bar, ["Edit", "Perspective Warp"])?.action).toBe(persp);
    expect(itemAtPath(bar, ["View", "Show", "Guides"])?.action).toBe(showguides);
    expect(itemAtPath(bar, ["View", "Clear Guides"])?.action).toBe(clearguides);
    expect(itemAtPath(bar, ["View", "Show", "Artboard Guides"])?.disabled).toBe(true);
    expect(itemAtPath(bar, ["View", "Clear Selected Artboard Guides"])?.action).toBeUndefined();
  });
});

describe("#529 transform dialogs preview before OK", () => {
  const cases: [string, string, string, string][] = [
    ["function FreeTransform() {", "function Skew() {", "xform.transformLayer(w / 100, h / 100, angle, Math.round(tx), Math.round(ty))", "deps={[w, h, angle, tx, ty]}"],
    ["function Skew() {", "function PerspectiveWarp() {", "xform.skewLayer(horiz, vert)", "deps={[horiz, vert]}"],
    ["function WarpDialog() {", "function SurfaceBlur() {", "warpLayer({ style, bend, h, v, orient: \"h\" })", "deps={[style, bend, h, v]}"],
    ["function Fade() {", "function ReplaceColor() {", "store.fadeLast(opacity / 100, mode)", "deps={[opacity, mode]}"],
    ["function StrokeSelection() {", "function NewGuide() {", "store.strokeSelection(w, +loc)", "deps={[w, loc]}"],
  ];

  it("applies through PreviewDialog as the controls change", () => {
    for (const [start, end, apply, deps] of cases) {
      const fn = body(start, end);
      expect(fn, start).toContain("<PreviewDialog");
      expect(fn, start).toContain(deps);
      expect(fn, start).toContain(`apply={() => ${apply}}`);
      expect(fn, start).not.toContain("onClick={() => {");
    }
  });
});
