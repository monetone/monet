// Guards the App.tsx command-dispatch fixes for #239, #240, #241, #242, #243,
// #244, #245 and #246.
// App.tsx is asserted at source level (importing it drags the whole app into a
// node test) — same idiom as tabHideChrome.test.ts / workspaceLayout.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PS_MENUS, type PsNode } from "./ui/psMenuData";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("./state/app.ts", import.meta.url), "utf8");
const dialogsSource = readFileSync(new URL("./ui/Dialogs.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("./canvas/CanvasView.tsx", import.meta.url), "utf8");

describe("preview command isolation", () => {
  it("stops global shortcuts before they can enter an engine history transaction", () => {
    expect(appSource).toContain('import { historyTransactionActive } from "./engine/historyTransaction";');
    const keyHandler = appSource.slice(appSource.indexOf("const onKey = (e: KeyboardEvent) => {"), appSource.indexOf("const onKeyUp =", appSource.indexOf("const onKey = (e: KeyboardEvent) => {")));
    const guard = keyHandler.indexOf("if (historyTransactionActive(engine.engine)");
    expect(guard).toBeGreaterThan(0);
    // Home has an earlier documentless dispatcher; this guard protects the
    // open-document dispatcher that can enter an engine history transaction.
    expect(guard).toBeLessThan(keyHandler.lastIndexOf("const shortcut = shortcutFromEvent(e);"));
    expect(keyHandler.slice(guard, keyHandler.indexOf("// Spacebar"))).toContain("e.preventDefault();");
  });
});

/** The dispatch-table entry `id: …` up to the next top-level entry. */
function dispatchEntry(id: string): string {
  const start = appSource.indexOf(`\n    ${id}: `);
  expect(start, `dispatch entry ${id}`).toBeGreaterThan(0);
  const end = appSource.indexOf("\n    },\n", start) + 1 || 0;
  const line = appSource.indexOf("\n", start + 1);
  // Multi-line handlers end at their own `},`; one-liners at the next newline.
  const oneLine = appSource.slice(start + 1, line);
  return oneLine.trimEnd().endsWith("=> {") ? appSource.slice(start, end + 6) : oneLine;
}

describe("View ▸ Show ▸ All / None (#240)", () => {
  /** monetId → the AppSnapshot flag its own Show-submenu handler flips. */
  const showFlags = new Map<string, string>();
  for (const [, id, key] of appSource.matchAll(/\n {4}(\w+): \(\) => store\.toggleView\("(\w+)"\),/g)) showFlags.set(id, key);
  for (const [, id, name] of appSource.matchAll(/\n {4}(\w+): \(\) => store\.toggleShow(\w+)\(\),/g)) showFlags.set(id, `show${name}`);

  const view = PS_MENUS.find((m) => m.id === "view");
  const show = view?.tree.find((n): n is Extract<PsNode, { kind: "submenu" }> => n.kind === "submenu" && n.label === "Show");
  const wiredIds = [...new Set((show?.items ?? []).flatMap((n) => (n.kind === "item" && n.monetId ? [n.monetId] : [])))]
    .filter((id) => !["showall", "shownone", "showextrasoptions"].includes(id));

  it("covers every extra the Show submenu wires, not just grid + guides", () => {
    expect(wiredIds.length).toBeGreaterThanOrEqual(12);
    const body = appSource.match(/function showExtrasPatch\(v: boolean\) \{([\s\S]*?)\n\}/)?.[1];
    expect(body, "showExtrasPatch()").toBeTruthy();
    const patched = [...body!.matchAll(/(\w+): v/g)].map((m) => m[1]);
    for (const id of wiredIds) {
      const flag = showFlags.get(id);
      expect(flag, `Show ▸ ${id} has a live toggle`).toBeTruthy();
      expect(patched, `Show ▸ All/None covers ${flag!}`).toContain(flag!);
    }
  });

  it("drives both commands off that one patch", () => {
    expect(dispatchEntry("showall")).toContain("store.setOptions(showExtrasPatch(true))");
    expect(dispatchEntry("shownone")).toContain("store.setOptions(showExtrasPatch(false))");
  });
});

describe("Status-bar zoom field (#241)", () => {
  const zoomField = appSource.slice(appSource.indexOf("function ZoomField()"), appSource.indexOf("const LIQUIFY_MODE_ICONS"));
  const commit = zoomField.match(/const commit = \(revert = false\) => \{([\s\S]*?)\n {2}\};/)?.[1];

  it("commits from a ref, so Escape's blur() cannot re-apply the stale draft", () => {
    // blur() dispatches focusout synchronously inside the keydown, before React
    // flushes setDraft(null) — reading the `draft` state here applies the value
    // Escape just discarded.
    expect(commit, "ZoomField commit()").toBeTruthy();
    expect(commit!).toContain("draftRef.current");
    expect(commit!).not.toMatch(/\bdraft\b/);
  });

  it("keeps the ref in step with every edit", () => {
    expect(zoomField).toMatch(/setBoth = \(v: string \| null\) => \{ draftRef\.current = v;/);
    expect(zoomField).toContain("onChange={(e) => setBoth(e.currentTarget.value)}");
    expect(zoomField).toMatch(/onFocus=\{\(e\) => \{ setBoth\(/);
    expect(zoomField).toContain('e.key === "Escape") { commit(true)');
  });
});

describe("Close All / Close Others (#242)", () => {
  it("aborts the whole command when a save prompt is cancelled", () => {
    // closeDocumentTab resolves false on Cancel; both loops must honour it.
    // (`discard` is Batch's own close of a file it wrote out; tabs never pass it.)
    expect(stateSource).toContain("export async function closeDocumentTab(id: number, discard = false): Promise<boolean>");
    expect(appSource).toContain("const requestClose = (d: DocSummary) => closeDocumentTab(d.id);");
    const closeAll = appSource.match(/const doCloseAll = async \(\) => \{([\s\S]*?)\n {2}\};/)?.[1];
    const closeOthers = appSource.match(/const doCloseOthers = async \(\) => \{([\s\S]*?)\n {2}\};/)?.[1];
    for (const body of [closeAll, closeOthers]) {
      expect(body).toBeTruthy();
      expect(body!).toMatch(/!\(await requestClose\(d\)\)\) return;/);
    }
  });
});

describe("Document Browser close (#302)", () => {
  it("uses the same save/smart-object cleanup funnel as tabs", () => {
    const browser = dialogsSource.slice(dialogsSource.indexOf("function DocumentBrowser()"));
    const closeCard = browser.slice(browser.indexOf("const closeCard"), browser.indexOf("const onDrop"));
    expect(closeCard).toContain("await closeDocumentTab(c.id)");
    expect(closeCard).not.toContain("confirmDiscard");
    expect(closeCard).not.toContain("store.closeDoc");
  });
});

describe("Document geometry annotations (#332)", () => {
  it("scales Image Size and translates Canvas Size/Crop through the shared funnel", () => {
    expect(stateSource).toContain("E().resize_image(w, h), { scale: true }");
    expect(stateSource).toContain("E().resize_canvas(w, h, dx, dy), { dx, dy }");
    expect(stateSource).toContain("E().crop(x, y, w, h), { dx: -x, dy: -y }");
    expect(stateSource).toContain("store.remapDocSpaceAnnotations(");
    expect(canvasSource).toContain("store.remapDocSpaceAnnotations(1, 1, -x0, -y0)");
  });
});

describe("Layer ▸ Delete / Hide Layers / Lock Layers (#243)", () => {
  it("falls back to the active layer only when nothing is multi-selected", () => {
    const helper = appSource.match(/function targetLayerIds\(\): number\[\] \{([\s\S]*?)\n\}/)?.[1];
    expect(helper, "targetLayerIds()").toBeTruthy();
    expect(helper!).toMatch(/selectedLayerIds\.length \? \[\.\.\.selectedLayerIds\] : \[activeLayerId\]/);
  });

  it("acts on every selected layer", () => {
    for (const id of ["del", "hidelayers"]) {
      const entry = dispatchEntry(id);
      expect(entry, `${id} honours the selection`).toContain("targetLayerIds()");
      expect(entry, `${id} reads the selection, not just the active id`).not.toContain("store.state.activeLayerId");
    }
  });

  it("opens the real Lock Layers dialog, which is what its ellipsis promises", () => {
    // (#418) It used to set Lock All directly over targetLayerIds(); the four
    // checkboxes now live in the dialog, which applies them to the whole
    // selection itself (see LockLayers in ui/Dialogs.tsx).
    expect(dispatchEntry("locklayers")).toContain('open("lockLayers")');
  });

  it("makes Hide Layers a toggle, so it can show them again", () => {
    const entry = dispatchEntry("hidelayers");
    expect(entry).toContain("store.state.layers.some((l) => ids.includes(l.id) && l.visible)");
    expect(entry).toContain("store.setLayerVisible(id, v)");
    expect(entry).not.toMatch(/setLayerVisible\([^)]*, false\)/);
  });
});

// buildPhotoshopMenus only prunes hidden commands when it is rebuilt, and the
// baseMenus memo had no dep the Menus dialog moves — so hiding was served from
// the memo cache until some unrelated dep happened to change. The dialog's OK
// writes the hidden set and the shortcut overrides in the same handler, so the
// store field is the signal to re-read localStorage.
describe("Edit ▸ Menus… hiding (#239)", () => {
  // The bar is built through buildMenus(hidden, enablement) since #501, so the
  // live tree and the shortcut editor's unfiltered one share one definition.
  const memo = appSource.slice(
    appSource.indexOf("const baseMenus = useMemo("),
    appSource.indexOf("const shortcutCommands = useMemo("),
  );

  it("re-reads the hidden set whenever the dialog's shortcut write lands", () => {
    const imports = appSource.match(/import \{([^}]+)\} from "\.\/ui\/psMenus";/)?.[1].split(",").map((name) => name.trim());
    expect(imports).toEqual(expect.arrayContaining(["NO_HIDDEN", "buildPhotoshopMenus", "imageModeCheckedIds", "loadHiddenMenuCommands"]));
    expect(appSource).toContain("const hiddenMenuCommands = useMemo(() => loadHiddenMenuCommands(), [keyboardShortcuts]);");
  });

  it("passes that set to the builder and keys the menu memo on it", () => {
    expect(memo).toContain("buildMenus(hiddenMenuCommands, menuEnablement)");
    const deps = memo.match(/\[buildMenus[^\]]*\]/)?.[0];
    expect(deps, "baseMenus deps").toBeTruthy();
    expect(deps!).toContain("hiddenMenuCommands");
  });
});

describe("Edit ▸ Toggle Last State (#244)", () => {
  it("alternates between the two most recent states instead of walking backwards", () => {
    const entry = dispatchEntry("togglelaststate");
    expect(entry).toContain("store.undo()");
    expect(entry).toContain("store.redo()");
    // …and only while our own move is still the latest one: any other history
    // move (or a move that did nothing) resets it to plain Undo.
    expect(entry).toContain("store.state.historyIndex");
    expect(entry).toContain("lastToggleRef.current = now === at ? null : { at: now, undone };");
  });
});

describe("Global keydown guard (#245)", () => {
  it("leaves a focused dropdown its own keys", () => {
    // A Monet Select stops the keys it handles; an open one is an editable target.
    // Only Esc aimed at a Vanishing Point field or select gets past it (#447).
    expect(appSource).toContain('const vpControl = store.state.vanishingPointSession && t?.closest("[data-mv-vp-workspace]");');
    expect(appSource).toContain('if (isEditableTarget(t) && !(vpControl && e.key === "Escape")) { clearPendingDigit(); return; }');
  });
});

describe("File ▸ Export ▸ Zoomify (#465)", () => {
  it("is reachable from File ▸ Export and hands the export the document stem, not an .html name", () => {
    const ids = new Set<string>();
    const walk = (nodes: PsNode[]) => {
      for (const n of nodes) {
        if (n.kind === "item" && n.monetId) ids.add(n.monetId);
        if (n.kind === "submenu") walk(n.items);
      }
    };
    walk(PS_MENUS.find((m) => m.id === "file")!.tree);
    expect(ids).toContain("zoomify");
    // The pyramid is a folder named after the document; the viewer page and
    // ImageProperties.xml go inside it.
    expect(dispatchEntry("zoomify")).toBe('    zoomify: () => exportZoomify(doc.name.replace(/\\.[^.]+$/, "")),');
    expect(stateSource).toContain("export async function exportZoomify(stem");
  });
});

describe("Color Lookup ▸ Load 3D LUT… (#441)", () => {
  const between = (from: string, to: string) => dialogsSource.slice(dialogsSource.indexOf(from), dialogsSource.indexOf(to));
  const row = between("function ColorLookupRow(", "function ColorLookupAdjLayer()");
  const adjLayer = between("function ColorLookupAdjLayer()", "function ColorLookupDialog()");
  const direct = between("function ColorLookupDialog()", "// ── adjustment dialogs");

  it("offers Load 3D LUT… beside the preset list and packs the pick into kind-16 params", () => {
    expect(row).toContain(">Load 3D LUT…</Button>");
    expect(row).toContain("const lut = await pickColorLutFile(); if (lut) onChange(packColorLut(lut));");
    expect(row).toContain("isColorLutParams(params)");
  });

  it("the adjustment layer keeps the LUT live and re-editable; the direct dialog applies it", () => {
    expect(adjLayer).toContain("<ColorLookupRow params={params} onChange={update} />");
    // Re-opening a LUT layer seeds the dialog from the params it carries, LUT included.
    expect(adjLayer).toContain("Float32Array.from(edit.params)");
    expect(direct).toContain("<ColorLookupRow params={params} onChange={setParams} />");
    expect(direct).toContain("apply={() => adj.colorLookup(params)}");
    expect(stateSource).toContain("colorLookup: (params: Float32Array | number) =>");
  });

  it("shares one file picker with File ▸ Import ▸ 3D LUT", () => {
    expect(stateSource).toContain("export async function pickColorLutFile(): Promise<CubeLut | null>");
    const importer = stateSource.slice(stateSource.indexOf("export async function importColorLutFile()"));
    expect(importer.slice(0, importer.indexOf("\n}\n"))).toContain("await pickColorLutFile()");
  });
});

// #451: text.bindToPath and text.setOnPathOptions shipped implemented, recorded
// and unit-tested, but nothing called them — once created, an on-path type
// layer could never be re-bound or retuned.
describe("Type ▸ Text on Path ▸ Bind to Work Path / Options (#451)", () => {
  it("dispatches both new commands, and keeps the one-shot create", () => {
    expect(dispatchEntry("textonpath")).toContain("text.textOnPath()");
    expect(dispatchEntry("bindtoworkpath")).toContain("text.bindToPath()");
    expect(dispatchEntry("typeonpathoptions")).toContain('open("onPathOptions")');
  });

  it("routes the options dialog through the recorded facade, not a raw spec write", () => {
    const dialog = dialogsSource.slice(dialogsSource.indexOf("export function OnPathOptions()"));
    expect(dialog.slice(0, dialog.indexOf("\n}\n"))).toContain("text.setOnPathOptions(p)");
    expect(dialogsSource).toContain('case "onPathOptions": return <OnPathOptions />;');
  });
});

// #456: Layer ▸ Arrange ▸ Bring to Front / Send to Back retarget to the selected
// path components while the Path Selection tool is active (the store claims the
// command only then), and stay on the layer otherwise.
describe("Layer ▸ Arrange retargets to path components (#456)", () => {
  it("tries the path components first and falls back to the layer", () => {
    expect(dispatchEntry("arrFront")).toContain("if (!store.arrangePathComponents(true)) store.arrangeLayer(0);");
    expect(dispatchEntry("arrBack")).toContain("if (!store.arrangePathComponents(false)) store.arrangeLayer(3);");
    // Forward / Backward stay layer-only: the path variant does not exist.
    expect(dispatchEntry("arrFwd")).toBe("    arrFwd: () => store.arrangeLayer(1),");
    expect(dispatchEntry("arrBwd")).toBe("    arrBwd: () => store.arrangeLayer(2),");
  });
});
