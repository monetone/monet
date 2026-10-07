import { describe, expect, it } from "vitest";
import {
  defaultNativeAudioPluginSearchRoots,
  mergeNativeAudioPluginInventories,
  nativeAudioPluginKindFromPath,
  nativeAudioPluginKindLabel,
  nativeAudioPluginValidationLabel,
  scanNativeAudioPlugins,
} from "./plugin-inventory";

describe("native audio plug-in inventory", () => {
  it("classifies common Audition native plug-in formats from paths", () => {
    expect(nativeAudioPluginKindFromPath("/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3")).toBe("vst3");
    expect(nativeAudioPluginKindFromPath("/Library/Audio/Plug-Ins/VST/Decapitator.vst")).toBe("vst2");
    expect(nativeAudioPluginKindFromPath("/Library/Audio/Plug-Ins/Components/ChannelStrip.component")).toBe("audioUnit");
    expect(nativeAudioPluginKindFromPath("C:\\Program Files\\VSTPlugins\\Massive.dll")).toBe("vst2");
    expect(nativeAudioPluginKindFromPath("/usr/lib/vst/u-he/Diva.so")).toBe("vst2");
    expect(nativeAudioPluginKindFromPath("/tmp/readme.txt")).toBe("unknown");
  });

  it("normalizes display names, ids, unsupported host status, and ordering", () => {
    const plugins = scanNativeAudioPlugins([
      "/Library/Audio/Plug-Ins/Components/ChannelStrip.component",
      { path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3", vendor: " FabFilter " },
      "C:\\Program Files\\VSTPlugins\\Massive.dll",
    ]);

    expect(plugins.map((p) => `${nativeAudioPluginKindLabel(p.kind)}:${p.name}`)).toEqual([
      "VST3:Pro-Q 3",
      "VST:Massive",
      "Audio Unit:ChannelStrip",
    ]);
    expect(plugins[0]).toMatchObject({
      vendor: "FabFilter",
      extension: ".vst3",
      canProcess: false,
      hostStatus: "inventoryOnly",
      validationStatus: "pathOnly",
      validationIssues: [],
      entryPointVerified: false,
    });
    expect(plugins[0].id).toMatch(/^native-vst3-pro-q-3-/);
  });

  it("preserves scanner-validated metadata and invalid candidate issues", () => {
    const verified = scanNativeAudioPlugins([{
      path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
      name: " Pro-Q 3 ",
      vendor: " FabFilter ",
      version: " 3.2.1 ",
      bundleIdentifier: " com.fabfilter.Pro-Q.3 ",
      validationStatus: "metadataVerified",
      entryPointVerified: true,
    }]);
    expect(verified[0]).toMatchObject({
      name: "Pro-Q 3",
      vendor: "FabFilter",
      version: "3.2.1",
      bundleIdentifier: "com.fabfilter.Pro-Q.3",
      validationStatus: "metadataVerified",
      validationIssues: [],
      entryPointVerified: true,
    });
    expect(nativeAudioPluginValidationLabel(verified[0].validationStatus)).toBe("metadata verified");

    const invalid = scanNativeAudioPlugins([{
      path: "/tmp/Readme.txt",
      validationStatus: "metadataVerified",
      validationIssues: [" Missing Info.plist ", "Missing Info.plist"],
    }], { includeUnknown: true });
    expect(invalid[0]).toMatchObject({
      kind: "unknown",
      validationStatus: "invalid",
      validationIssues: ["Unknown native plug-in format", "Missing Info.plist"],
    });
  });

  it("dedupes paths case-insensitively by default and can include unknown candidates", () => {
    const plugins = scanNativeAudioPlugins([
      "/Plug-Ins/Foo.vst3",
      "/Plug-Ins/foo.vst3",
      "/Plug-Ins/notes.txt",
    ], { includeUnknown: true });

    expect(plugins.map((p) => [p.kind, p.name])).toEqual([
      ["vst3", "Foo"],
      ["unknown", "notes"],
    ]);
  });

  it("merges inventories without duplicating an already discovered plug-in", () => {
    const first = scanNativeAudioPlugins(["/Plug-Ins/Foo.vst3"]);
    const second = scanNativeAudioPlugins([{ path: "/Plug-Ins/foo.vst3", vendor: "Example", version: "2.0", validationStatus: "metadataVerified" }]);
    const merged = mergeNativeAudioPluginInventories(first, second);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ validationStatus: "pathOnly" });
  });

  it("lists standard native plug-in search roots per platform", () => {
    expect(defaultNativeAudioPluginSearchRoots("darwin", "/Users/alex")).toEqual([
      "/Library/Audio/Plug-Ins/VST3",
      "/Library/Audio/Plug-Ins/VST",
      "/Library/Audio/Plug-Ins/Components",
      "/Users/alex/Library/Audio/Plug-Ins/VST3",
      "/Users/alex/Library/Audio/Plug-Ins/VST",
      "/Users/alex/Library/Audio/Plug-Ins/Components",
    ]);
    expect(defaultNativeAudioPluginSearchRoots("win32")).toContain("C:\\Program Files\\Common Files\\VST3");
    expect(defaultNativeAudioPluginSearchRoots("linux", "/home/alex")).toEqual(expect.arrayContaining([
      "/usr/lib/vst3",
      "/home/alex/.vst3",
      "/home/alex/.vst",
    ]));
  });
});
