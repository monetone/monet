import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildPhotoshopMenus } from "./ui/psMenus";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./state/store.ts", import.meta.url), "utf8");
const dialogsSource = readFileSync(new URL("./ui/Dialogs.tsx", import.meta.url), "utf8");

describe("Vision menu enablement", () => {
  it("filters registered actions through one shared runtime map", () => {
    const undo = vi.fn();
    const bar = buildPhotoshopMenus(
      { undo }, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set(), { undo: false },
    );
    const item = bar.find((menu) => menu.label === "Edit")?.items.find((entry) => entry.label === "Undo");
    expect(item?.disabled).toBe(true);
    expect(item?.action).toBeUndefined();

    const enabled = buildPhotoshopMenus(
      { undo }, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set(), { undo: true },
    ).find((menu) => menu.label === "Edit")?.items.find((entry) => entry.label === "Undo");
    enabled?.action?.();
    expect(undo).toHaveBeenCalledOnce();
  });

  it("covers the unavailable commands named by #396 and #399", () => {
    const start = appSource.indexOf("const menuEnablement = useMemo");
    const body = appSource.slice(start, appSource.indexOf("const baseMenus = useMemo", start));
    expect(start).toBeGreaterThan(0);
    for (const gate of [
      "undo: canUndo", "redo: canRedo", "fade: canFade", "resel: canReselect",
      "paste: hasDocument,", "pasteinplace: hasDocument,",
      "pasteinto: hasDocument && selectionActive", "pasteoutside: hasDocument && selectionActive",
      "cut: hasDocument", "copy: hasDocument",
      "autoalignlayers: hasDocument && layers.filter((l) => selectedLayerIds.includes(l.id)",
      "autoblendlayers: hasDocument && layers.filter((l) => selectedLayerIds.includes(l.id)",
      "clear: hasDocument && selectionActive", "fill: hasDocument",
      "stroke: hasDocument && selectionActive", "cropsel: hasDocument && selectionActive",
      "transformagain: hasDocument && canTransformAgain",
      "deletefiltermask: hasSmartFilterMask", "disablefiltermask: hasSmartFilterMask",
      "revert: hasDocument && documents.some((d) => d.id === activeDocId && d.hasFile),",
    ]) expect(body, gate).toContain(gate);
    // buildMenus takes both as parameters (#501); the live bar is the call that
    // supplies the real hidden set and enablement map.
    expect(appSource).toContain("hidden,\n      enablement,");
    expect(appSource).toContain("buildMenus(hiddenMenuCommands, menuEnablement)");
  });

  it("publishes the engine's existing availability predicates reactively", () => {
    const start = storeSource.indexOf("syncFromEngine() {");
    const body = storeSource.slice(start, storeSource.indexOf("this.syncDisplayProfile();", start));
    for (const gate of [
      "canFade: e.can_fade()", "canReselect: e.can_reselect()",
      "hasClipboard: e.has_clipboard()", "hasHistorySource: e.has_history_source()",
      "hasSmartFilterMask: e.has_smart_filter_mask(activeLayerId)",
    ]) expect(body, gate).toContain(gate);
    expect(dialogsSource).toContain('disabled: o.value === "history" && !hasHistorySource');
  });
});
