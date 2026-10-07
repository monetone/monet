// Unit tests for buildPhotoshopMenus — the pure transform that turns the
// Photoshop blueprint (psMenuData) into the live Monet menu bar. It wires
// actions by monetId, disables everything Monet doesn't implement, dedupes
// sibling ids and injects the Open Recent list. Tests discover ids/structure
// from PS_MENUS at runtime so they survive blueprint regeneration.

import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus, imageModeCheckedIds } from "./psMenus";
import { PS_MENUS, type PsNode } from "./psMenuData";

const flatten = (items: MenuItemDef[]): MenuItemDef[] =>
  items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const allItems = (bar: MenuBarEntry[]): MenuItemDef[] => bar.flatMap((m) => flatten(m.items));
/** Interactive leaves: not separators, not submenus. */
const leaves = (bar: MenuBarEntry[]): MenuItemDef[] => allItems(bar).filter((it) => !it.separator && !it.items);
const itemAtPath = (bar: MenuBarEntry[], path: readonly string[]): MenuItemDef | undefined => {
  let items = bar.find((menu) => menu.label === path[0])?.items;
  let found: MenuItemDef | undefined;
  for (const label of path.slice(1)) {
    found = items?.find((item) => item.label === label);
    items = found?.items;
  }
  return found;
};

const collectMonetIds = (nodes: PsNode[]): string[] =>
  nodes.flatMap((n) => (n.kind === "submenu" ? collectMonetIds(n.items) : n.kind === "item" && n.monetId ? [n.monetId] : []));
const countSeparators = (nodes: PsNode[]): number =>
  nodes.reduce((acc, n) => acc + (n.kind === "separator" ? 1 : n.kind === "submenu" ? countSeparators(n.items) : 0), 0);

describe("buildPhotoshopMenus", () => {
  it("mirrors the blueprint's top-level menus, then appends Window and Help", () => {
    const bar = buildPhotoshopMenus({});
    // The blueprint has no Window menu (Photoshop does); buildPhotoshopMenus
    // appends it after the blueprint-derived menus.
    expect(bar.slice(0, PS_MENUS.length).map((m) => m.id)).toEqual(PS_MENUS.map((m) => m.id));
    expect(bar.slice(0, PS_MENUS.length).map((m) => m.label)).toEqual(PS_MENUS.map((m) => m.label));
    expect(bar.at(-2)?.id).toBe("window");
    expect(bar.at(-2)?.label).toBe("Window");
    expect(bar.at(-1)?.id).toBe("help");
    expect(bar.at(-1)?.label).toBe("Help");
  });

  it("wires the cross-platform Help commands", () => {
    const about = vi.fn();
    const systemInfo = vi.fn();
    const shortcuts = vi.fn();
    const bar = buildPhotoshopMenus({ about, systeminfo: systemInfo, keyboardshortcuts: shortcuts });
    for (const [label, action] of [
      ["About Monet Vision…", about],
      ["System Info…", systemInfo],
      ["Keyboard Shortcuts…", shortcuts],
    ] as const) {
      const item = itemAtPath(bar, ["Help", label]);
      expect(item?.disabled).toBeFalsy();
      item?.action?.();
      expect(action).toHaveBeenCalledOnce();
    }
  });

  it("disables every command when no actions are supplied", () => {
    const bar = buildPhotoshopMenus({});
    const ls = leaves(bar);
    expect(ls.length).toBeGreaterThan(0);
    expect(ls.every((it) => it.disabled === true)).toBe(true);
    expect(ls.every((it) => it.action === undefined)).toBe(true);
  });

  it("wires exactly the implemented commands and leaves the rest disabled", () => {
    const id = collectMonetIds(PS_MENUS.flatMap((m) => m.tree))[0]; // e.g. "new"
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ [id]: fn });
    const enabled = leaves(bar).filter((it) => typeof it.action === "function");
    expect(enabled).toHaveLength(1); // only the one wired id
    expect(enabled[0].disabled).toBeFalsy();
    enabled[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("deduplicates monetIds except at explicit shared-command paths", () => {
    const all = collectMonetIds(PS_MENUS.flatMap((m) => m.tree));
    const actions = Object.fromEntries(all.map((mid) => [mid, () => {}]));
    actions.dpinch = () => {};
    actions.hdrpro = () => {};
    const bar = buildPhotoshopMenus(actions);
    const enabled = leaves(bar).filter((it) => typeof it.action === "function");
    // Six commands intentionally appear twice (the three shared workflows, plus
    // Perspective, Show Guides, and Clear Guides). Pinch and Merge to HDR Pro
    // each add one path-specific command identity in place of a duplicated
    // blueprint id (Spherize's, and exposure fusion's).
    expect(enabled).toHaveLength(new Set(all).size + 8);
  });

  it("wires every menu path backed by an intentionally shared Monet workflow", () => {
    const sharedCommands: [string, readonly [readonly string[], readonly string[]]][] = [
      ["lenscorrection", [["File", "Automate", "Lens Correction…"], ["Filter", "Lens Correction…"]]],
      ["layercleanup", [["File", "Scripts", "Layer Cleanup…"], ["Layer", "Layer Cleanup…"]]],
      ["rasterizesmart", [["Layer", "Smart Objects", "Rasterize"], ["Layer", "Rasterize", "Smart Object"]]],
    ];

    for (const [id, paths] of sharedCommands) {
      const action = vi.fn();
      const bar = buildPhotoshopMenus({ [id]: action });
      for (const path of paths) {
        const item = itemAtPath(bar, path);
        expect(item, path.join(" ▸ ")).toBeDefined();
        expect(item?.disabled, path.join(" ▸ ")).toBeFalsy();
        item?.action?.();
      }
      expect(action, id).toHaveBeenCalledTimes(2);
    }
  });

  it("routes Pinch and Spherize to distinct commands", () => {
    const pinchAction = vi.fn();
    const spherizeAction = vi.fn();
    const bar = buildPhotoshopMenus({ dpinch: pinchAction, dsph: spherizeAction });
    const pinch = itemAtPath(bar, ["Filter", "Distort", "Pinch…"]);
    const spherize = itemAtPath(bar, ["Filter", "Distort", "Spherize…"]);

    expect(pinch?.id).toBe("dpinch");
    expect(spherize?.id).toBe("dsph");
    pinch?.action?.();
    expect(pinchAction).toHaveBeenCalledOnce();
    expect(spherizeAction).not.toHaveBeenCalled();
    spherize?.action?.();
    expect(spherizeAction).toHaveBeenCalledOnce();
  });

  it("routes Keyboard Shortcuts separately and General Preferences only from its matching path", () => {
    const generalAction = vi.fn();
    const shortcutAction = vi.fn();
    const bar = buildPhotoshopMenus({ prefgeneral: generalAction, keyboardshortcuts: shortcutAction });
    const shortcuts = itemAtPath(bar, ["Edit", "Keyboard Shortcuts…"]);
    expect(shortcuts?.disabled).toBeFalsy();
    expect(shortcuts?.shortcut).toBe("⌥⇧⌘K");
    shortcuts?.action?.();
    expect(shortcutAction).toHaveBeenCalledOnce();
    expect(generalAction).not.toHaveBeenCalled();

    // Edit ▸ Toolbar… still has no host action (the tool rail is fixed), so it
    // stays a placeholder. Edit ▸ Menus… shares the shortcuts dialog — see
    // psMenusCustomize.test.ts.
    const toolbar = itemAtPath(bar, ["Edit", "Toolbar…"]);
    expect(toolbar).toBeDefined();
    expect(toolbar?.disabled).toBe(true);
    expect(toolbar?.action).toBeUndefined();

    const general = itemAtPath(bar, ["Edit", "Preferences", "General…"]);
    expect(general?.disabled).toBeFalsy();
    general?.action?.();
    expect(generalAction).toHaveBeenCalledOnce();
  });

  it("routes File and Layer exports to distinct workflows", () => {
    const fileExport = vi.fn();
    const layerExport = vi.fn();
    const layerQuickExport = vi.fn();
    const bar = buildPhotoshopMenus({
      exportas: fileExport,
      layerexportas: layerExport,
      qexportpng: layerQuickExport,
    });
    const file = itemAtPath(bar, ["File", "Export", "Export As…"]);
    const layer = itemAtPath(bar, ["Layer", "Export As…"]);
    const quick = itemAtPath(bar, ["Layer", "Quick Export as PNG"]);

    expect(file?.id).toBe("exportas");
    expect(layer?.id).toBe("layerexportas");
    expect(file?.disabled).toBeFalsy();
    expect(layer?.disabled).toBeFalsy();
    expect(quick?.disabled).toBeFalsy();
    file?.action?.();
    layer?.action?.();
    quick?.action?.();
    expect(fileExport).toHaveBeenCalledOnce();
    expect(layerExport).toHaveBeenCalledOnce();
    expect(layerQuickExport).toHaveBeenCalledOnce();
  });

  it("keeps sibling ids unique at every level", () => {
    const bar = buildPhotoshopMenus({});
    const check = (items: MenuItemDef[]) => {
      const ids = items.map((it) => it.id);
      expect(new Set(ids).size, `dup id among ${ids.join(",")}`).toBe(ids.length);
      items.forEach((it) => it.items && check(it.items));
    };
    bar.forEach((m) => check(m.items));
  });

  it("preserves the blueprint's separators (when no recents are injected)", () => {
    const bar = buildPhotoshopMenus({});
    // Check the blueprint-derived menus only; the appended Window menu has its
    // own (code-defined) separators that aren't part of the blueprint.
    const built = bar.slice(0, PS_MENUS.length).flatMap((m) => flatten(m.items)).filter((it) => it.separator).length;
    const blueprint = PS_MENUS.reduce((n, m) => n + countSeparators(m.tree), 0);
    // +6 for the code-defined separators before the injected File ▸ Import ▸
    // "3D LUT (.cube/.3dl)…", the two File ▸ Export injection groups, Filter ▸ Render ▸
    // "Lighting Effects…", Edit ▸ Transform ▸ "Perspective Crop…", and Filter ▸
    // Stylize ▸ "Colored Pencil…" items (like the Window menu, not in the
    // blueprint), plus one inside the injected Type ▸ Text on Path submenu.
    expect(built).toBe(blueprint + 7);
  });

  it("injects Edit ▸ Transform ▸ Perspective Crop… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ perspcrop: fn });
    const pc = leaves(bar).filter((it) => it.label === "Perspective Crop…");
    expect(pc).toHaveLength(1);
    expect(pc[0].disabled).toBeFalsy();
    pc[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Perspective Crop…")?.disabled).toBe(true);
  });

  it("injects Image ▸ Transform Symmetry and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ transformsymmetry: fn });
    const image = bar.find((menu) => menu.label === "Image")!;
    const item = image.items.find((entry) => entry.label === "Transform Symmetry");
    expect(item?.disabled).toBeFalsy();
    item?.action?.();
    expect(fn).toHaveBeenCalledOnce();
    const disabled = buildPhotoshopMenus({}).find((menu) => menu.label === "Image")!
      .items.find((entry) => entry.label === "Transform Symmetry");
    expect(disabled?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Colored Pencil… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ coloredpencil: fn });
    const cp = leaves(bar).filter((it) => it.label === "Colored Pencil…");
    expect(cp).toHaveLength(1);
    expect(cp[0].disabled).toBeFalsy();
    cp[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    // disabled when the host doesn't provide the action
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Colored Pencil…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Smudge Stick… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ smudgestick: fn });
    const ss = leaves(bar).filter((it) => it.label === "Smudge Stick…");
    expect(ss).toHaveLength(1);
    expect(ss[0].disabled).toBeFalsy();
    ss[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Smudge Stick…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Palette Knife… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ paletteknife: fn });
    const pk = leaves(bar).filter((it) => it.label === "Palette Knife…");
    expect(pk).toHaveLength(1);
    expect(pk[0].disabled).toBeFalsy();
    pk[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Palette Knife…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Paint Daubs… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ paintdaubs: fn });
    const pd = leaves(bar).filter((it) => it.label === "Paint Daubs…");
    expect(pd).toHaveLength(1);
    expect(pd[0].disabled).toBeFalsy();
    pd[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Paint Daubs…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Fresco… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ fresco: fn });
    const fr = leaves(bar).filter((it) => it.label === "Fresco…");
    expect(fr).toHaveLength(1);
    expect(fr[0].disabled).toBeFalsy();
    fr[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Fresco…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Rough Pastels… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ roughpastels: fn });
    const rp = leaves(bar).filter((it) => it.label === "Rough Pastels…");
    expect(rp).toHaveLength(1);
    expect(rp[0].disabled).toBeFalsy();
    rp[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Rough Pastels…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Underpainting… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ underpainting: fn });
    const up = leaves(bar).filter((it) => it.label === "Underpainting…");
    expect(up).toHaveLength(1);
    expect(up[0].disabled).toBeFalsy();
    up[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Underpainting…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Stylize ▸ Sponge… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ sponge: fn });
    const sponge = leaves(bar).filter((it) => it.label === "Sponge…");
    expect(sponge).toHaveLength(1);
    sponge[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Sponge…")?.disabled).toBe(true);
  });

  it("injects Filter ▸ Render ▸ Lighting Effects… and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ lightingfx: fn });
    const lfx = leaves(bar).filter((it) => it.label === "Lighting Effects…");
    expect(lfx).toHaveLength(1);
    expect(lfx[0].disabled).toBeFalsy();
    lfx[0].action!();
    expect(fn).toHaveBeenCalledTimes(1);
    // disabled when the host doesn't provide the action
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Lighting Effects…")?.disabled).toBe(true);
  });

  it("injects View ▸ Fit Layer(s) on Screen right after Fit on Screen and wires it", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ fitlayer: fn });
    const view = bar.find((m) => m.id === "view")!;
    const labels = view.items.map((it) => it.label);
    const fitAt = labels.indexOf("Fit on Screen");
    expect(fitAt).toBeGreaterThanOrEqual(0);
    expect(labels[fitAt + 1]).toBe("Fit Layer(s) on Screen"); // adjacent, no separator
    const item = leaves(bar).find((it) => it.label === "Fit Layer(s) on Screen")!;
    expect(item.disabled).toBeFalsy();
    item.action!();
    expect(fn).toHaveBeenCalledTimes(1);
    // disabled when the host doesn't provide the action
    expect(leaves(buildPhotoshopMenus({})).find((it) => it.label === "Fit Layer(s) on Screen")?.disabled).toBe(true);
  });

  it("keeps the canonical Pattern Preview command at the View root", () => {
    const fn = vi.fn();
    const view = buildPhotoshopMenus({ patternpreview: fn }).find((m) => m.id === "view")!;
    const items = flatten(view.items);
    expect(view.items.filter((it) => it.label === "Pattern Preview")).toHaveLength(1);
    expect(items.filter((it) => it.label === "Pattern Preview")).toHaveLength(1);
    expect(items.some((it) => it.label === "Patterns Preview")).toBe(false);
    view.items.find((it) => it.label === "Pattern Preview")!.action!();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("injects the recent-files list into Open Recent and wires each entry", () => {
    const onOpenRecent = vi.fn();
    const recent = [
      { name: "a.psd", path: "/docs/a.psd" },
      { name: "b.psd", path: "/docs/b.psd" },
    ];
    const bar = buildPhotoshopMenus({}, recent, onOpenRecent);
    const openRecent = allItems(bar).find((it) => it.label === "Open Recent" && it.items);
    expect(openRecent, "Open Recent submenu present").toBeTruthy();
    const items = openRecent!.items!;
    expect(items[0].label).toBe("a.psd");
    expect(items[1].label).toBe("b.psd");
    expect(items[2].separator).toBe(true); // recents are separated from the rest
    items[0].action!();
    expect(onOpenRecent).toHaveBeenCalledWith("/docs/a.psd");
  });

  it("marks Image Assets checked while the Generator watch is on", () => {
    const on = buildPhotoshopMenus({ imageassets: () => {} }, [], () => {}, undefined, undefined, undefined, new Set(["imageassets"]));
    expect(allItems(on).find((it) => it.label === "Image Assets")?.checked).toBe(true);
    const off = buildPhotoshopMenus({ imageassets: () => {} }, [], () => {}, undefined, undefined, undefined, new Set());
    expect(allItems(off).find((it) => it.label === "Image Assets")?.checked).toBeUndefined();
  });

  it("injects a wired '3D LUT (.cube/.3dl)…' item into File ▸ Import", () => {
    const importlut = vi.fn();
    const bar = buildPhotoshopMenus({ importlut });
    const item = allItems(bar).find((it) => it.label === "3D LUT (.cube/.3dl)…");
    expect(item, "3D LUT item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(importlut).toHaveBeenCalledOnce();
    // It lives inside the Import submenu.
    const importSub = allItems(bar).find((it) => it.label === "Import" && it.items);
    expect(importSub!.items!.some((it) => it.label === "3D LUT (.cube/.3dl)…")).toBe(true);
  });

  it("disables the injected 3D LUT item when no action is provided", () => {
    const bar = buildPhotoshopMenus({});
    const item = allItems(bar).find((it) => it.label === "3D LUT (.cube/.3dl)…");
    expect(item!.disabled).toBe(true);
    expect(item!.action).toBeUndefined();
  });

  it("injects a wired 'Export Targa (.tga)…' item into File ▸ Export", () => {
    const exporttga = vi.fn();
    const bar = buildPhotoshopMenus({ exporttga });
    const item = allItems(bar).find((it) => it.label === "Export Targa (.tga)…");
    expect(item, "Targa export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(exporttga).toHaveBeenCalledOnce();
    const exportSub = allItems(bar).find((it) => it.label === "Export" && it.items);
    expect(exportSub!.items!.some((it) => it.label === "Export Targa (.tga)…")).toBe(true);
  });

  it("wires explicit PSB export separately from PSD", () => {
    const psb = vi.fn();
    const bar = buildPhotoshopMenus({ psb });
    const item = allItems(bar).find((entry) => entry.label === "Export PSB…");
    expect(item).toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(psb).toHaveBeenCalledOnce();
  });

  it("enables exact Photoshop-source export only for a preserved preview", () => {
    const original = vi.fn();
    const unavailable = buildPhotoshopMenus({ psdoriginal: original });
    const disabled = allItems(unavailable).find((entry) => entry.id === "psdoriginal");
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.action).toBeUndefined();

    const available = buildPhotoshopMenus(
      { psdoriginal: original }, [], () => {}, undefined, undefined, undefined, new Set(), true,
    );
    const item = allItems(available).find((entry) => entry.id === "psdoriginal");
    expect(item?.label).toBe("Export Preserved Photoshop Original…");
    expect(item?.disabled).toBeFalsy();
    item?.action?.();
    expect(original).toHaveBeenCalledOnce();
  });

  it("injects a wired 'Export Portable Bitmap (.ppm)…' item into File ▸ Export", () => {
    const exportppm = vi.fn();
    const bar = buildPhotoshopMenus({ exportppm });
    const item = allItems(bar).find((it) => it.label === "Export Portable Bitmap (.ppm)…");
    expect(item, "PPM export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(exportppm).toHaveBeenCalledOnce();
  });

  it("injects a wired 'Export PCX (.pcx)…' item into File ▸ Export", () => {
    const exportpcx = vi.fn();
    const bar = buildPhotoshopMenus({ exportpcx });
    const item = allItems(bar).find((it) => it.label === "Export PCX (.pcx)…");
    expect(item, "PCX export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(exportpcx).toHaveBeenCalledOnce();
  });

  it("injects a wired 'Export SVG (Document)…' item into File ▸ Export", () => {
    const exportsvgdoc = vi.fn();
    const bar = buildPhotoshopMenus({ exportsvgdoc });
    const item = allItems(bar).find((it) => it.label === "Export SVG (Document)…");
    expect(item, "SVG document export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(exportsvgdoc).toHaveBeenCalledOnce();
    // Disabled when no action is provided (blueprint-clean fallback).
    expect(allItems(buildPhotoshopMenus({})).find((it) => it.label === "Export SVG (Document)…")?.disabled).toBe(true);
  });

  it("injects a wired 'Export WebP (Lossy)…' item into File ▸ Export", () => {
    const webplossy = vi.fn();
    const bar = buildPhotoshopMenus({ webplossy });
    const item = allItems(bar).find((it) => it.label === "Export WebP (Lossy)…");
    expect(item, "WebP lossy export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(webplossy).toHaveBeenCalledOnce();
    expect(allItems(buildPhotoshopMenus({})).find((it) => it.label === "Export WebP (Lossy)…")?.disabled).toBe(true);
  });

  it("injects a wired 'Export HEIC…' item into File ▸ Export", () => {
    const exportheic = vi.fn();
    const bar = buildPhotoshopMenus({ exportheic });
    const item = allItems(bar).find((it) => it.label === "Export HEIC…");
    expect(item, "HEIC export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(exportheic).toHaveBeenCalledOnce();
    expect(allItems(buildPhotoshopMenus({})).find((it) => it.label === "Export HEIC…")?.disabled).toBe(true);
  });

  it("injects a wired 'Export DNG…' item into File ▸ Export", () => {
    const exportdng = vi.fn();
    const bar = buildPhotoshopMenus({ exportdng });
    const item = allItems(bar).find((it) => it.label === "Export DNG…");
    expect(item, "DNG export item present").toBeTruthy();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(exportdng).toHaveBeenCalledOnce();
    expect(allItems(buildPhotoshopMenus({})).find((it) => it.label === "Export DNG…")?.disabled).toBe(true);
  });

  it("expands Edit ▸ Presets into Photoshop's submenu, all of it reaching the Preset Manager", () => {
    const presetmanager = vi.fn();
    const bar = buildPhotoshopMenus({ presetmanager });
    const presets = allItems(bar).find((it) => it.label === "Presets");
    expect(presets, "Presets submenu present").toBeTruthy();
    expect(presets!.items!.map((it) => it.label))
      .toEqual(["Preset Manager…", "Migrate Presets…", "Export/Import Presets…"]);
    for (const item of presets!.items!) {
      expect(item.disabled, `${String(item.label)} enabled`).toBeFalsy();
      item.action!();
    }
    expect(presetmanager).toHaveBeenCalledTimes(3);
    // Without the host action every door is a placeholder, not a dead click.
    const off = allItems(buildPhotoshopMenus({})).find((it) => it.label === "Presets");
    expect(off!.items!.every((it) => it.disabled)).toBe(true);
  });

  it("wires File ▸ Package via LABEL_WIRING", () => {
    const packagefile = vi.fn();
    const item = allItems(buildPhotoshopMenus({ packagefile })).find((entry) => entry.label === "Package…");
    expect(item?.disabled).toBeFalsy();
    item?.action?.();
    expect(packagefile).toHaveBeenCalledOnce();
  });

  it("wires Place Embedded and Place Linked as distinct File commands", () => {
    const place = vi.fn();
    const placelinked = vi.fn();
    const items = allItems(buildPhotoshopMenus({ place, placelinked }));
    const embedded = items.find((entry) => entry.label === "Place Embedded…");
    const linked = items.find((entry) => entry.label === "Place Linked…");
    expect(embedded?.disabled).toBeFalsy();
    expect(linked?.disabled).toBeFalsy();
    embedded?.action?.();
    linked?.action?.();
    expect(place).toHaveBeenCalledOnce();
    expect(placelinked).toHaveBeenCalledOnce();
  });

  it("wires all six Type ▸ Font Preview Size choices to distinct commands", () => {
    const handlers = {
      fontpreviewnone: vi.fn(),
      fontpreviewsmall: vi.fn(),
      fontpreviewmedium: vi.fn(),
      fontpreviewlarge: vi.fn(),
      fontpreviewextralarge: vi.fn(),
      fontpreviewhuge: vi.fn(),
    };
    const typeMenu = buildPhotoshopMenus(handlers).find((menu) => menu.label === "Type")!;
    const previewMenu = typeMenu.items.find((item) => item.label === "Font Preview Size")!;
    expect(previewMenu.items?.map((item) => item.label)).toEqual([
      "None", "Small", "Medium", "Large", "Extra Large", "Huge",
    ]);
    expect(previewMenu.items?.every((item) => !item.disabled && item.action)).toBe(true);
    previewMenu.items?.forEach((item) => item.action?.());
    expect(Object.values(handlers).every((handler) => handler.mock.calls.length === 1)).toBe(true);
  });

  it("builds the live Pixel Aspect Ratio catalog with delete/reset and selection", () => {
    const custompixelaspect = vi.fn();
    const deletepixelaspect = vi.fn();
    const resetpixelaspects = vi.fn();
    const onSelect = vi.fn();
    const bar = buildPhotoshopMenus(
      { custompixelaspect, deletepixelaspect, resetpixelaspects },
      [],
      () => {},
      undefined,
      {
        presets: [
          { name: "Square", ratio: 1, builtin: true },
          { name: "Cinema", ratio: 1.25, builtin: false },
        ],
        currentRatio: 1.25,
        onSelect,
      },
    );
    const submenu = allItems(bar).find((item) => item.label === "Pixel Aspect Ratio")!;
    expect(submenu.items?.map((item) => item.label ?? "separator")).toEqual([
      "Custom Pixel Aspect Ratio…", "Delete Pixel Aspect Ratio…", "Reset Pixel Aspect Ratios…", "separator", "Square", "Cinema",
    ]);
    expect(submenu.items?.find((item) => item.label === "Cinema")?.checked).toBe(true);
    submenu.items?.find((item) => item.label === "Cinema")?.action?.();
    expect(onSelect).toHaveBeenCalledWith(1.25);
    submenu.items?.find((item) => item.label === "Delete Pixel Aspect Ratio…")?.action?.();
    expect(deletepixelaspect).toHaveBeenCalledOnce();
  });

  it("builds the live Set Measurement Scale catalog with Custom and selection", () => {
    const setmeasurescale = vi.fn();
    const onSelect = vi.fn();
    const bar = buildPhotoshopMenus(
      { setmeasurescale },
      [],
      () => {},
      undefined,
      undefined,
      {
        presets: [
          { name: "Microscope", px: 50, units: 1, unit: "microns" },
          { name: "Survey", px: 100, units: 2, unit: "cm" },
        ],
        currentScale: { px: 50, units: 1, unit: "microns" },
        onSelect,
      },
    );
    const submenu = itemAtPath(bar, ["Image", "Analysis", "Set Measurement Scale"])!;
    expect(submenu.items?.map((item) => item.label ?? "separator")).toEqual([
      "Custom…", "separator", "Microscope", "Survey",
    ]);
    expect(submenu.items?.find((item) => item.label === "Microscope")?.checked).toBe(true);
    submenu.items?.find((item) => item.label === "Custom…")?.action?.();
    submenu.items?.find((item) => item.label === "Survey")?.action?.();
    expect(setmeasurescale).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith({ name: "Survey", px: 100, units: 2, unit: "cm" });
    const surveyId = submenu.items?.find((item) => item.label === "Survey")?.id;
    const afterDelete = buildPhotoshopMenus(
      { setmeasurescale }, [], () => {}, undefined, undefined,
      { presets: [{ name: "Survey", px: 100, units: 2, unit: "cm" }], currentScale: { px: 1, units: 1, unit: "px" }, onSelect },
    );
    expect(itemAtPath(afterDelete, ["Image", "Analysis", "Set Measurement Scale"])
      ?.items?.find((item) => item.label === "Survey")?.id).toBe(surveyId);
  });

  it("wires Layer ▸ Layer Content Options via LABEL_WIRING", () => {
    const layercontentoptions = vi.fn();
    const item = allItems(buildPhotoshopMenus({ layercontentoptions }))
      .find((entry) => entry.label === "Layer Content Options…");
    expect(item?.disabled).toBeFalsy();
    item?.action?.();
    expect(layercontentoptions).toHaveBeenCalledOnce();
  });

  it("wires Layer ▸ Rasterize ▸ Fill Content via LABEL_WIRING", () => {
    const rasterizefillcontent = vi.fn();
    const item = allItems(buildPhotoshopMenus({ rasterizefillcontent }))
      .find((entry) => entry.label === "Fill Content");
    expect(item?.disabled).toBeFalsy();
    item?.action?.();
    expect(rasterizefillcontent).toHaveBeenCalledOnce();
  });

  it("wires the Internet Standard and Monitor RGB proof presets", () => {
    const proofsrgb = vi.fn();
    const proofmonitor = vi.fn();
    const items = allItems(buildPhotoshopMenus({ proofsrgb, proofmonitor }));
    items.find((item) => item.label === "Internet Standard RGB (sRGB)")?.action?.();
    items.find((item) => item.label === "Monitor RGB")?.action?.();
    expect(proofsrgb).toHaveBeenCalledOnce();
    expect(proofmonitor).toHaveBeenCalledOnce();
  });

  const OT = ["Type", "OpenType"] as const;

  it("wires the advanced OpenType items via PATH_WIRING to their feature-tag ids", () => {
    const tags = ["calt", "swsh", "onum", "salt", "titl", "jalt", "ss01", "ss20"];
    const bar = buildPhotoshopMenus(Object.fromEntries(tags.map((t) => [t, vi.fn()])));
    // Each blueprint item's id becomes its CSS feature tag, and it is wired.
    expect(itemAtPath(bar, [...OT, "Contextual Alternates"])?.id).toBe("calt");
    expect(itemAtPath(bar, [...OT, "Swash"])?.id).toBe("swsh");
    expect(itemAtPath(bar, [...OT, "Justification Alternates"])?.id).toBe("jalt");
    expect(itemAtPath(bar, [...OT, "Stylistic Sets", "Set 1"])?.id).toBe("ss01");
    expect(itemAtPath(bar, [...OT, "Stylistic Sets", "Set 20"])?.id).toBe("ss20");
    for (const label of ["Swash", "Stylistic Alternates"]) {
      expect(typeof itemAtPath(bar, [...OT, label])?.action).toBe("function");
    }
    expect(typeof itemAtPath(bar, [...OT, "Stylistic Sets", "Set 1"])?.action).toBe("function");
  });

  it("marks only checkedIds items checked (advanced tags + legacy toggles)", () => {
    const tags = ["calt", "swsh", "salt", "ss01", "ss02"];
    const actions = { ...Object.fromEntries(tags.map((t) => [t, vi.fn()])), otliga: vi.fn() };
    const bar = buildPhotoshopMenus(
      actions, [], () => {}, undefined, undefined, undefined,
      new Set(["ss01", "otliga"]),
    );
    expect(itemAtPath(bar, [...OT, "Stylistic Sets", "Set 1"])?.checked).toBe(true);
    expect(itemAtPath(bar, [...OT, "Standard Ligatures"])?.checked).toBe(true);
    expect(itemAtPath(bar, [...OT, "Stylistic Sets", "Set 2"])?.checked).toBeFalsy();
    expect(itemAtPath(bar, [...OT, "Swash"])?.checked).toBeFalsy();
  });

  it("checks the document's colour mode and bit depth under Image ▸ Mode", () => {
    const MODE = ["Image", "Mode"];
    const ids = ["bitmapmode", "mgray", "duotone", "indexedcolor", "mrgb", "mcmyk", "mlab", "mmultichannel", "d8", "d16", "d32"];
    const actions = Object.fromEntries(ids.map((id) => [id, vi.fn()]));
    const checked = (mode: number, depth: number, duotone: boolean) => {
      const bar = buildPhotoshopMenus(actions, [], () => {}, undefined, undefined, undefined, new Set(imageModeCheckedIds(mode, depth, duotone)));
      return ["Grayscale", "Duotone…", "RGB Color", "CMYK Color", "Lab Color", "Multichannel", "8 Bits/Channel", "16 Bits/Channel"]
        .filter((label) => itemAtPath(bar, [...MODE, label])?.checked);
    };
    expect(checked(2, 16, false)).toEqual(["CMYK Color", "16 Bits/Channel"]);
    expect(checked(0, 8, false)).toEqual(["RGB Color", "8 Bits/Channel"]);
    expect(checked(1, 8, true)).toEqual(["Duotone…", "8 Bits/Channel"]);
    expect(checked(3, 8, false)).toEqual(["Lab Color", "8 Bits/Channel"]);
  });

  it("leaves the OpenType items unchecked and disabled when no spec is active", () => {
    const bar = buildPhotoshopMenus({});
    expect(itemAtPath(bar, [...OT, "Swash"])?.checked).toBeFalsy();
    expect(itemAtPath(bar, [...OT, "Swash"])?.disabled).toBe(true);
  });

  // #451: the blueprint ships Text on Path as the one-shot create only, so an
  // on-path type layer could never be re-bound or retuned from the menu.
  const TOP = ["Type", "Text on Path"] as const;

  it("grows Type ▸ Text on Path into a submenu without losing the one-shot create", () => {
    const textonpath = vi.fn();
    const bindtoworkpath = vi.fn();
    const typeonpathoptions = vi.fn();
    const bar = buildPhotoshopMenus({ textonpath, bindtoworkpath, typeonpathoptions });
    expect(itemAtPath(bar, TOP)?.items?.map((it) => it.label)).toEqual([
      "Create from Work Path", "Bind to Work Path", undefined, "Type on a Path Options…",
    ]);
    itemAtPath(bar, [...TOP, "Create from Work Path"])?.action?.();
    itemAtPath(bar, [...TOP, "Bind to Work Path"])?.action?.();
    itemAtPath(bar, [...TOP, "Type on a Path Options…"])?.action?.();
    expect(textonpath).toHaveBeenCalledOnce();
    expect(bindtoworkpath).toHaveBeenCalledOnce();
    expect(typeonpathoptions).toHaveBeenCalledOnce();
    // The submenu's own id stays out of the leaf id space (no stray command).
    expect(leaves(bar).some((it) => it.label === "Text on Path")).toBe(false);
  });

  it("disables the two new on-path commands when the host doesn't register them", () => {
    const bar = buildPhotoshopMenus({ textonpath: vi.fn() });
    expect(itemAtPath(bar, [...TOP, "Create from Work Path"])?.disabled).toBeFalsy();
    expect(itemAtPath(bar, [...TOP, "Bind to Work Path"])?.disabled).toBe(true);
    expect(itemAtPath(bar, [...TOP, "Type on a Path Options…"])?.disabled).toBe(true);
  });
});
