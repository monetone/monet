import { describe, expect, it } from "vitest";
import {
  addNativePluginSlotToRack,
  addNativePluginsToProject,
  formatManagedNativePluginInventory,
  formatNativePluginInventory,
  nativePluginSearchRoots,
  scanNativePluginPaths,
  scanNativePluginRootsWithNativeMetadata,
  setManagedNativePluginEnabled,
  setManagedNativePluginPresetState,
} from "./commands";
import { emptyProject, RythmeStore } from "../engine";

describe("native plug-in command helpers", () => {
  it("scans newline and semicolon separated candidate paths for MCP/UI callers", () => {
    const plugins = scanNativePluginPaths([
      "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
      "C:\\Program Files\\VSTPlugins\\Massive.dll",
    ].join("\n"));

    expect(plugins.map((p) => p.name)).toEqual(["Pro-Q 3", "Massive"]);
    expect(plugins.every((p) => p.canProcess === false)).toBe(true);
  });

  it("formats inventories without implying native hosting support", () => {
    const plugins = scanNativePluginPaths("/Library/Audio/Plug-Ins/Components/ChannelStrip.component;/tmp/readme.txt");
    expect(formatNativePluginInventory(plugins)).toBe(
      "ChannelStrip (Audio Unit) - inventory only, path only - /Library/Audio/Plug-Ins/Components/ChannelStrip.component",
    );
    expect(formatNativePluginInventory([])).toBe("No native audio plug-ins found");
  });

  it("formats scanner validation metadata for native plug-in candidates", () => {
    const plugins = scanNativePluginPaths([{
      path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
      vendor: "FabFilter",
      version: "3.2.1",
      validationStatus: "metadataVerified",
      entryPointVerified: true,
    }]);
    expect(formatNativePluginInventory(plugins)).toBe(
      "Pro-Q 3 3.2.1 by FabFilter (VST3) - inventory only, metadata verified, entry point verified - /Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
    );
  });

  it("falls back to direct candidate classification when root scanning is unavailable", async () => {
    const plugins = await scanNativePluginRootsWithNativeMetadata("/Plug-Ins/Foo.vst3;/Plug-Ins/readme.txt");
    expect(plugins.map((p) => p.name)).toEqual(["Foo"]);
  });

  it("returns explicit platform roots for automation clients", () => {
    expect(nativePluginSearchRoots("darwin", "/Users/alex")).toContain("/Users/alex/Library/Audio/Plug-Ins/Components");
    expect(nativePluginSearchRoots("win32")).toContain("C:\\Program Files\\Common Files\\VST3");
  });

  it("imports scanned plug-ins into the project manager and preserves manager metadata", () => {
    const store = new RythmeStore(emptyProject("Plug-ins", 1, 48000));
    const plugins = scanNativePluginPaths("/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3");

    expect(addNativePluginsToProject(store, plugins)).toBe(1);
    const plugin = store.getState().project.nativePluginManager!.plugins[0];
    expect(plugin).toMatchObject({ name: "Pro-Q 3", enabled: true, hostStatus: "inventoryOnly", canProcess: false, validationStatus: "pathOnly", entryPointVerified: false });

    expect(setManagedNativePluginEnabled(store, plugin.id, false)).toBe(true);
    expect(setManagedNativePluginPresetState(store, plugin.id, "Dialogue", { thresholdDb: -18 })).toBe(true);
    expect(formatManagedNativePluginInventory(store.getState().project.nativePluginManager!.plugins)).toContain("disabled, inventoryOnly, path only, preset Dialogue");
  });

  it("adds managed native plug-ins to the selected rack as inventory-only slots", () => {
    const store = new RythmeStore(emptyProject("Plug-ins", 1, 48000));
    const plugins = scanNativePluginPaths([{
      path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
      vendor: "FabFilter",
      version: "3.2.1",
      validationStatus: "metadataVerified",
      entryPointVerified: true,
    }]);
    addNativePluginsToProject(store, plugins);
    const plugin = store.getState().project.nativePluginManager!.plugins[0];

    const slotId = addNativePluginSlotToRack(store, plugin.id, { kind: "track", id: store.getState().project.tracks[0].id });

    expect(slotId).toMatch(/^fx-/);
    expect(store.getState().project.tracks[0].effectRack?.slots[0]).toMatchObject({
      id: slotId,
      kind: "nativePlugin",
      name: "Pro-Q 3",
      enabled: true,
      params: {
        pluginId: plugin.id,
        pluginKind: "vst3",
        vendor: "FabFilter",
        version: "3.2.1",
        hostStatus: "inventoryOnly",
        canProcess: false,
        validationStatus: "metadataVerified",
        entryPointVerified: true,
      },
    });
  });
});
