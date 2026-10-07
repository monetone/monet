// Guards V-WIN-2: Window ▸ Arrange's second view of the active document ("New
// Window for <doc>") and the n-up tilings of the open set. The Arrange submenu
// existed as disabled placeholders; these lock in that the tiling/second-view
// entries are now reachable and that App wires them to the Second View panel.
// The panes' liveness and editing are covered by CanvasView.test.ts and
// e2e/arrange-views.spec.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPhotoshopMenus } from "./ui/psMenus";
import { Store, arrangeColumns, type AppSnapshot } from "./state/store";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

const arrangeItems = (actions: Record<string, () => void>) => {
  const bar = buildPhotoshopMenus(actions, [], () => {}, {
    workspaces: [],
    onApplyWorkspace: () => {},
    documents: [{ id: "1", name: "one.png" }],
    activeDocumentId: "1",
  });
  const win = bar.find((menu) => menu.id === "window")!;
  return win.items!.find((i) => i.id === "arrange")!.items!;
};

describe("Window ▸ Arrange", () => {
  const WIRED = ["newwindowfordoc", "tileallvert", "tileallhoriz", "tile", "consolidatetabs", "cascade", "floatinwindow", "floatallwindows"];

  it("lays documents out the way Photoshop's tilings do", () => {
    // Vertically = side by side, Horizontally = stacked, Tile = squarest grid.
    expect(arrangeColumns(3, "vertical")).toBe(3);
    expect(arrangeColumns(3, "horizontal")).toBe(1);
    expect(arrangeColumns(4, "grid")).toBe(2);
    expect(arrangeColumns(5, "grid")).toBe(3);
    // A lone document is a single tile in every mode, and n<1 never divides by 0.
    for (const mode of ["vertical", "horizontal", "grid", "single"] as const) {
      expect(arrangeColumns(1, mode)).toBe(1);
      expect(arrangeColumns(0, mode)).toBe(1);
    }
  });

  it("wires the second view and the tilings once the host supplies actions", () => {
    const calls: string[] = [];
    const items = arrangeItems(Object.fromEntries(WIRED.map((id) => [id, () => calls.push(id)])));
    for (const id of WIRED) {
      const item = items.find((i) => i.id === id)!;
      expect(item.disabled).toBeUndefined();
      item.action!();
    }
    expect(calls).toEqual(WIRED);
  });

  it("leaves the entries disabled when the host has no such command", () => {
    const items = arrangeItems({});
    for (const id of WIRED) expect(items.find((i) => i.id === id)!.disabled).toBe(true);
  });

  it("App opens/closes the Second View panel from the Arrange entries", () => {
    // Source-level wiring assertions, matching windowMenu.test.ts's style
    // (importing App.tsx would drag the whole app into a node test).
    expect(appSource).toContain('secondview: { title: "Second View"');
    expect(appSource).toContain('newwindowfordoc: () => showSecondView("single")');
    expect(appSource).toContain('tileallvert: () => showSecondView("vertical")');
    expect(appSource).toContain('tileallhoriz: () => showSecondView("horizontal")');
    expect(appSource).toContain('tile: () => showSecondView("grid")');
    expect(appSource).toContain('dockRef.current?.openPanel("secondview")');
    expect(appSource).toContain('consolidatetabs: () => { store.consolidateFloats(); dockRef.current?.closePanel("secondview"); }');
  });

  it("App floats documents into OS windows on the desktop, and into the live in-app views in a browser (#477)", () => {
    expect(appSource).toContain('floatinwindow: () => (isTauri() ? store.floatDoc(store.state.activeDocId) : showSecondView("single"))');
    expect(appSource).toContain('floatallwindows: () => (isTauri() ? store.floatAllDocs() : showSecondView("grid"))');
    expect(appSource).toContain('cascade: () => (isTauri() ? void cascadeFloats().catch((e) => console.warn("Cascade failed:", e)) : showSecondView("grid"))');
    expect(appSource).toContain("{isTauri() && <FloatWindows />}");
    // A floated document leaves the tab bar (and the tiled views).
    expect(appSource).toContain("docs={documents.filter((d) => !floatDocs.includes(d.id)).map(docLabel)}");
  });

  it("renders every pane as a live canvas view, not a cached composite (#478)", () => {
    expect(appSource).toContain("<CanvasView paneDocId={d.id} />");
    expect(appSource).not.toContain("docThumbUrl(engine.engine");
    expect(appSource).not.toContain("store.docCards(");
  });
});

describe("Window ▸ Arrange ▸ Float (#477)", () => {
  const setup = () => {
    const store = new Store({ engine: null, onCommit: null, lastBrush: [] } as never);
    const internal = store as unknown as { docs: object[]; activeDocId: number; set: (p: Partial<AppSnapshot>) => void };
    internal.docs = [1, 2, 3].map((id) => ({ id, name: `${id}.psd`, dirty: false }));
    internal.activeDocId = 1;
    internal.set({ activeDocId: 1 });
    return store;
  };

  it("floats a document once, and Float All the rest after it, in Cascade order", () => {
    const store = setup();
    store.floatDoc(2);
    store.floatDoc(2);
    store.floatDoc(99); // not an open document
    expect(store.state.floatDocs).toEqual([2]);
    store.floatAllDocs();
    expect(store.state.floatDocs).toEqual([2, 1, 3]);
  });

  it("returns a document to the tabs when its window closes or it does, and all of them on Consolidate", () => {
    const store = setup();
    store.floatAllDocs();
    store.unfloatDoc(1); // its window was closed
    expect(store.state.floatDocs).toEqual([2, 3]);
    store.closeDoc(3); // closing the document takes its window with it
    expect(store.state.floatDocs).toEqual([2]);
    expect(store.openDocIds()).toEqual([1, 2]); // the others stay open
    store.consolidateFloats();
    expect(store.state.floatDocs).toEqual([]);
    expect(store.openDocIds()).toEqual([1, 2]);
  });
});
