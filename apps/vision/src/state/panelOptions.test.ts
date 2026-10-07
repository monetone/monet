import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PANEL_OPTIONS, normalizePanelOptions } from "./panelOptions";

vi.mock("@engine", () => ({ default: vi.fn(), Engine: class {} }));
import { Store } from "./store";

afterEach(() => vi.unstubAllGlobals());

describe("panel view options (#480)", () => {
  it("validates saved sizes and view modes without accepting corrupt preferences", () => {
    for (const value of [null, [], "list", { layerThumbnailSize: -1, channelThumbnailSize: Infinity, swatchThumbnailSize: 999, swatchView: "other" }]) {
      expect(normalizePanelOptions(value)).toEqual(DEFAULT_PANEL_OPTIONS);
    }
    expect(normalizePanelOptions({ layerThumbnailSize: 64, channelThumbnailSize: 40, swatchThumbnailSize: 16, swatchView: "list" }))
      .toEqual({ layerThumbnailSize: 64, channelThumbnailSize: 40, swatchThumbnailSize: 16, swatchView: "list" });
  });

  it("persists view changes across store reloads, and keeps state intact when storage fails", () => {
    const cells = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { cells.set(key, value); });
    vi.stubGlobal("localStorage", { getItem: (key: string) => cells.get(key) ?? null, setItem });
    const onEditError = vi.fn();
    const client = { onCommit: null, onEditError };
    const store = new Store(client as never);
    expect(store.setPanelOptions({ layerThumbnailSize: 64, swatchView: "list" })).toBe(true);
    expect(new Store(client as never).state.panelOptions).toEqual({ ...DEFAULT_PANEL_OPTIONS, layerThumbnailSize: 64, swatchView: "list" });
    setItem.mockImplementation(() => { throw new Error("quota"); });
    expect(store.setPanelOptions({ layerThumbnailSize: 40 })).toBe(false);
    expect(store.state.panelOptions.layerThumbnailSize).toBe(64);
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("panel options"));
  });

  it("reports corrupt or invalid saved options, keeping the valid fields and the stored preference", () => {
    const cells = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => cells.get(key) ?? null, setItem: (key: string, value: string) => { cells.set(key, value); } });
    const client = { onCommit: null, onEditError: vi.fn() };
    expect(new Store(client as never).state.panelOptionsError).toBe(""); // nothing saved is not an error
    cells.set("mv.panelOptions", JSON.stringify({ layerThumbnailSize: 64, swatchView: "tiles" }));
    const store = new Store(client as never);
    expect(store.state.panelOptions).toEqual({ ...DEFAULT_PANEL_OPTIONS, layerThumbnailSize: 64 });
    expect(store.state.panelOptionsError).toContain("Panel Options");
    expect(cells.get("mv.panelOptions")).toContain("tiles");
    cells.set("mv.panelOptions", "{");
    const corrupt = new Store(client as never);
    expect(corrupt.state.panelOptions).toEqual(DEFAULT_PANEL_OPTIONS);
    expect(corrupt.state.panelOptionsError).toContain("Panel Options");
    expect(cells.get("mv.panelOptions")).toBe("{");
    // Choosing an option saves valid options again, which clears the report.
    expect(store.setPanelOptions({ swatchView: "list" })).toBe(true);
    expect(store.state.panelOptionsError).toBe("");
    expect(new Store(client as never).state).toMatchObject({ panelOptionsError: "", panelOptions: { layerThumbnailSize: 64, swatchView: "list" } });
  });
});
