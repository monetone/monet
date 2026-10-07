// Guards V-WIN-1: the Window menu's checkmarked panel inventory (with
// Photoshop's open/close toggle), the open-document list, and the App wiring
// that keeps both live as the dock layout and document set change.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildPhotoshopMenus } from "./ui/psMenus";
import { dockLayoutPanelIds } from "../../../packages/monet-ui/packages/monet-react/src/dockable";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("Window menu panels + documents", () => {
  const onOpenPanel = vi.fn<(...args: unknown[]) => void>();
  const onActivateDocument = vi.fn<(...args: unknown[]) => void>();
  const bar = buildPhotoshopMenus({}, [], () => {}, {
    workspaces: [],
    onApplyWorkspace: () => {},
    panels: [
      { id: "layers", title: "Layers" },
      { id: "info", title: "Info" },
    ],
    openPanelIds: new Set(["layers"]),
    onOpenPanel,
    documents: [
      { id: "1", name: "one.png" },
      { id: "2", name: "two.png*" },
    ],
    activeDocumentId: "2",
    onActivateDocument,
  });
  const win = bar.find((menu) => menu.id === "window")!;

  it("lists every registered panel, checkmarking only the open ones", () => {
    const layersItem = win.items!.find((i) => i.id === "panel-layers")!;
    const infoItem = win.items!.find((i) => i.id === "panel-info")!;
    expect(layersItem.checked).toBe(true);
    expect(infoItem.checked).toBeUndefined();
    layersItem.action!();
    infoItem.action!();
    // Same handler for both directions — the host implements the toggle.
    expect(onOpenPanel.mock.calls).toEqual([["layers"], ["info"]]);
  });

  it("lists open documents with the active one checkmarked", () => {
    const doc1 = win.items!.find((i) => i.id === "doc-1")!;
    const doc2 = win.items!.find((i) => i.id === "doc-2")!;
    expect(doc1.checked).toBeUndefined();
    expect(doc2.checked).toBe(true);
    doc1.action!();
    expect(onActivateDocument).toHaveBeenCalledWith("1");
  });

  it("has an Arrange submenu with Photoshop's entries", () => {
    const arrange = win.items!.find((i) => i.id === "arrange")!;
    const labels = arrange.items!.map((i) => i.label);
    expect(labels).toContain("Consolidate All to Tabs");
    expect(labels).toContain("Match Zoom");
    expect(labels.some((l) => String(l).startsWith("New Window for"))).toBe(true);
  });

  it("derives the checkmark set from a dock layout, floats included", () => {
    const ids = dockLayoutPanelIds({
      right: { size: 440, cols: [
        { flex: 1, stack: [{ tabs: ["layers", "history"], active: "layers", flex: 1 }] },
      ] },
      floating: [{ id: "f1", x: 0, y: 0, w: 200, h: 200, cols: [{ stack: [{ tabs: ["info"] }] }] }],
    });
    expect(ids).toEqual(["layers", "history", "info"]);
  });

  it("App feeds live checkmarks, the toggle, and documents into the menu", () => {
    // Source-level wiring assertions, matching workspaceLayout.test.ts's style
    // (importing App.tsx would drag the whole app into a node test).
    expect(appSource).toContain("openPanelIds,");
    expect(appSource).toContain("setOpenPanelIds(new Set(dockLayoutPanelIds(layout)))");
    expect(appSource).toContain("dock.closePanel(id)");
    expect(appSource).toContain("dock.openPanel(id)");
    expect(appSource).toContain("onActivateDocument: (id) => store.activateDoc(Number(id))");
  });
});
