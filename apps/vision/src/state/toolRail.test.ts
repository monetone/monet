import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOOLS, TOOL_DEFS, configuredToolRail, factoryToolbarConfiguration, moveToolbarSlot, moveToolbarTool, validateToolbarConfiguration,
  type ToolbarConfiguration,
} from "./toolRail";
import { Store, type ToolId } from "./store";

const ids = Object.keys(TOOL_DEFS) as ToolId[];
const freshStore = () => new Store({ engine: {}, e: new Proxy({}, { get: () => () => 0 }), commit: () => true, sync: () => {} } as never);
const slotOf = (tool: ToolId) => factoryToolbarConfiguration().slots.findIndex((slot) => slot !== "div" && slot.includes(tool));

describe("customizable toolbar layout", () => {
  it("reproduces the factory rail and rejects duplicate or malformed tools", () => {
    const factory = factoryToolbarConfiguration();
    expect(validateToolbarConfiguration(factory)).toEqual(factory);
    expect(configuredToolRail(factory)).toEqual(TOOLS);
    expect(configuredToolRail(undefined)).toEqual(TOOLS); // a rail configured before #481
    for (const bad of [null, [], {}, { ...factory, version: 2 }, { ...factory, slots: [[]] },
      { ...factory, extra: ["brush"] }, { ...factory, extra: [7] }, { ...factory, extra: null },
    ]) expect(() => validateToolbarConfiguration(bad)).toThrow();
  });

  it("restores tools a saved configuration predates and drops tools Vision no longer has", () => {
    const factory = factoryToolbarConfiguration();
    // Saved before Pencil (a Brush flyout member) and Frame (its own slot) existed,
    // and while a since-retired tool was still around.
    const saved = {
      ...factory,
      slots: factory.slots.map((slot) => slot === "div" ? slot : slot.filter((id) => id !== "pencil" && id !== "frame"))
        .filter((slot) => slot === "div" || slot.length),
      extra: ["retired"],
    };
    expect(validateToolbarConfiguration(saved)).toEqual({
      ...factory, slots: factory.slots.filter((slot) => slot === "div" || !slot.includes("frame")), extra: ["frame"],
    });
  });

  it("reorders tools and groups, splits/regroups tools, and removes vacated slots without mutating the source", () => {
    const factory = factoryToolbarConfiguration();
    const brushGroup = slotOf("brush");
    const count = (factory.slots[brushGroup] as ToolId[]).length;
    const reordered = moveToolbarTool(factory, "brush", brushGroup, count);
    expect(reordered.slots[brushGroup]).toEqual(["pencil", "colorreplace", "mixerbrush", "adjustmentbrush", "brush"]);
    expect(moveToolbarTool(reordered, "brush", brushGroup, 0)).toEqual(factory);

    const split = moveToolbarTool(factory, "brush", 0);
    expect(configuredToolRail(split)[0]).toEqual(TOOL_DEFS.brush);
    expect((split.slots[brushGroup + 1] as ToolId[]).includes("brush")).toBe(false);
    const grouped = moveToolbarTool(factory, "zoom", 0, 1);
    expect(grouped.slots[0]).toEqual(["move", "zoom"]);
    expect(configuredToolRail(grouped)[0]).toMatchObject({ children: [TOOL_DEFS.move, TOOL_DEFS.zoom] });
    const shifted = moveToolbarSlot(factory, brushGroup, 0);
    expect(shifted.slots[0]).toEqual(factory.slots[brushGroup]);
    expect(moveToolbarSlot(shifted, 0, brushGroup + 1)).toEqual(factory);
    expect(factory).toEqual(factoryToolbarConfiguration());
    for (const config of [reordered, split, grouped, shifted]) expect(validateToolbarConfiguration(config)).toEqual(config);
  });

  it("keeps every tool reachable while moving everything to Extra Tools and back, including Extra Tools ordering", () => {
    let config = factoryToolbarConfiguration();
    for (const id of ids) config = moveToolbarTool(config, id, "extra");
    expect(config.slots).toEqual([]);
    expect(config.extra).toEqual(ids);
    config = moveToolbarTool(config, ids[0], "extra", ids.length);
    expect(config.extra.at(-1)).toBe(ids[0]);
    for (const id of ids) config = moveToolbarTool(config, id, config.slots.length);
    expect(config.extra).toEqual([]);
    expect(config.slots).toEqual(ids.map((id) => [id]));
    expect(validateToolbarConfiguration(config)).toEqual(config);
  });

  it("refuses invalid drag destinations instead of losing or duplicating a tool", () => {
    const factory = factoryToolbarConfiguration();
    expect(() => moveToolbarTool(factory, "missing" as ToolId, "extra")).toThrow();
    expect(() => moveToolbarTool(factory, "brush", -1)).toThrow();
    expect(() => moveToolbarTool(factory, "brush", 7, 0)).toThrow(); // separator
    expect(() => moveToolbarTool(factory, "brush", 0, 99)).toThrow();
    expect(() => moveToolbarTool(factory, "brush", "extra", -1)).toThrow();
    expect(() => moveToolbarSlot(factory, -1, 0)).toThrow();
    expect(factory).toEqual(factoryToolbarConfiguration());
  });
});

describe("toolbar preferences and workspace configuration", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("persists a validated configuration, restores it in a fresh store, and supports old workspaces with factory tools", () => {
    const store = freshStore();
    const custom = moveToolbarTool(factoryToolbarConfiguration(), "brush", "extra");
    expect(store.setToolbarConfiguration(custom)).toBe(true);
    expect(freshStore().state.toolbarConfiguration).toEqual(custom);
    // The saved-workspace snapshot is JSON, independent of the current rail.
    const workspace = JSON.parse(JSON.stringify({ toolConfiguration: store.state.toolbarConfiguration }));
    store.setToolbarConfiguration(factoryToolbarConfiguration());
    store.setToolbarConfiguration(workspace.toolConfiguration);
    expect(store.state.toolbarConfiguration).toEqual(custom);
    // A built-in workspace, or one saved before the toolbar was customizable,
    // carries no snapshot — Apply Workspace skips the setter, so the user's rail
    // and its preference stay exactly as they were.
    const legacy: { toolConfiguration?: ToolbarConfiguration } = JSON.parse(JSON.stringify({ name: "Essentials" }));
    if (legacy.toolConfiguration) store.setToolbarConfiguration(legacy.toolConfiguration);
    expect(store.state.toolbarConfiguration).toEqual(custom);
    expect(freshStore().state.toolbarConfiguration).toEqual(custom);
  });

  it("loads a saved rail that predates a newly added tool, keeping the user's customization", () => {
    const custom = moveToolbarTool(factoryToolbarConfiguration(), "brush", "extra");
    const withoutPencil = { ...custom, slots: custom.slots.map((slot) => slot === "div" ? slot : slot.filter((id) => id !== "pencil")) };
    localStorage.setItem("mv.toolbarConfiguration", JSON.stringify(withoutPencil));
    const store = freshStore();
    expect(store.state.toolbarConfigurationError).toBe("");
    expect(store.state.toolbarConfiguration).toEqual(custom);
    // A saved workspace carrying the same snapshot applies instead of erroring.
    expect(store.setToolbarConfiguration(JSON.parse(JSON.stringify(withoutPencil)))).toBe(true);
    expect(store.state.toolbarConfiguration).toEqual(custom);
  });

  it("leaves state and preferences intact when validation or persistence fails", () => {
    const store = freshStore();
    store.setToolbarConfiguration(factoryToolbarConfiguration());
    const before = localStorage.getItem("mv.toolbarConfiguration");
    expect(() => store.setToolbarConfiguration({ version: 1, slots: [[]], extra: [] })).toThrow("nonempty");
    expect(localStorage.getItem("mv.toolbarConfiguration")).toBe(before);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    expect(store.setToolbarConfiguration(moveToolbarTool(factoryToolbarConfiguration(), "brush", "extra"))).toBe(false);
    expect(store.state.toolbarConfiguration).toEqual(factoryToolbarConfiguration());
  });

  it("reports corrupt preferences and falls back to reachable factory tools without overwriting the source", () => {
    localStorage.setItem("mv.toolbarConfiguration", "{");
    const store = freshStore();
    expect(store.state.toolbarConfiguration).toEqual(factoryToolbarConfiguration());
    expect(store.state.toolbarConfigurationError).toContain("Restore Defaults");
    expect(localStorage.getItem("mv.toolbarConfiguration")).toBe("{");
  });
});
