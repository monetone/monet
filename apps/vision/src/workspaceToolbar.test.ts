// @vitest-environment jsdom
// Guards V-WS-1: a workspace is panel layout AND toolbar placement (tool rail /
// options bar), plus the shortcut set that was active when it was saved — and
// the live toolbar placement survives a reload like the panel layout does.
//
// The shortcut half is driven through the real Store and the real
// keyboardShortcuts persistence below. The dock half is not: `savews`,
// `applyWorkspace` and the <DockableWorkspace> props are closures and JSX inside
// App.tsx, and App.tsx cannot be imported here — monet-react is a workspace
// source dep that resolves its own React copy, so rendering the shell (or the
// dock alone) throws "Invalid hook call" under vision's vitest resolution.
// Those stay source-level wiring guards, in the same style as
// workspaceLayout.test.ts / workspacePresets.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "./state/store";
import { loadShortcutOverrides, type ShortcutOverrides } from "./state/keyboardShortcuts";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

/** The slice of App.tsx between `marker` and the next `close`. */
function block(marker: string, close: string): string {
  const start = appSource.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const end = appSource.indexOf(close, start);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

const workspaceJsx = block("<DockableWorkspace\n", "\n      />");

describe("Vision toolbar placement persistence (App wiring)", () => {
  it("replays the persisted toolbar layout and writes every change back", () => {
    // Mirrors the panel-layout wiring: factory seed stays the reset target,
    // the persisted snapshot drives the controlled prop.
    expect(workspaceJsx).toContain("initialToolbarLayout={initialToolbarLayout}");
    expect(appSource).toContain("const [persistedToolbarLayout] = useState(loadLastToolbarLS);");
    expect(workspaceJsx).toContain("toolbarLayout={persistedToolbarLayout ?? undefined}");
    expect(workspaceJsx).not.toContain("toolbarLayout={loadLastToolbarLS()");
    expect(workspaceJsx).toContain("onToolbarLayoutChange={saveLastToolbarLS}");
  });

  it("adds the Extra Tools footer (and the rail's spacer) only when tools are behind it", () => {
    expect(workspaceJsx).toContain("footer={toolbarConfiguration.extra.length ? <ExtraTools ");
  });

  it("keys the toolbar snapshot separately from the panel layout", () => {
    expect(appSource).toContain('loadLS<ToolbarLayout | null>("mv.toolbarLast", null)');
    expect(appSource).toContain('saveLS("mv.toolbarLast", toolbarLayout)');
    // The factory seed is a named constant so Apply Workspace can restore it.
    expect(appSource).toContain(
      'const initialToolbarLayout: ToolbarLayout = { left: ["tools"], top: ["options"] };',
    );
  });
});

describe("Vision saved workspaces (App wiring)", () => {
  it("captures toolbar placement and the custom shortcut set alongside the panels", () => {
    const savews = block("    savews: () => {", "\n    },");
    expect(savews).toContain("layout: dockRef.current.getLayout()");
    expect(savews).toContain("toolbarLayout: dockRef.current.getToolbarLayout()");
    expect(savews).toContain("store.state.keyboardShortcuts");
    expect(savews).toContain("toolConfiguration: validateToolbarConfiguration(store.state.toolbarConfiguration)");
    // Only non-empty override sets are stored, so a default install saves nothing.
    expect(savews).toContain("Object.keys(shortcuts).length ? { shortcuts:");
  });

  it("restores toolbar placement on apply, falling back to the factory seed", () => {
    const apply = block("  const applyWorkspace = (name: string)", "\n  };");
    expect(apply).toContain("dockRef.current.setLayout(w.layout);");
    expect(apply).toContain("dockRef.current.setToolbarLayout(w.toolbarLayout ?? initialToolbarLayout);");
    // Built-ins carry no shortcut set — applying one must not wipe the user's.
    expect(apply).toContain("if (w.shortcuts) store.setKeyboardShortcuts(w.shortcuts);");
    // Same rule for the tool arrangement: no snapshot, no change to the user's rail.
    expect(apply).toContain("if (w.toolConfiguration && !store.setToolbarConfiguration(w.toolConfiguration)) return;");
    expect(apply).not.toContain("factoryToolbarConfiguration");
  });

  it("types a saved workspace as layout + toolbar + shortcuts", () => {
    const type = block("type SavedWorkspace = {", "\n};");
    expect(type).toContain("layout: DockLayout;");
    expect(type).toContain("toolbarLayout?: ToolbarLayout;");
    expect(type).toContain("toolConfiguration?: ToolbarConfiguration;");
    expect(type).toContain("shortcuts?: ShortcutOverrides;");
  });
});

// The half that does have a home outside App.tsx: what `store.state.keyboardShortcuts`
// actually holds when a workspace is saved, and what applying one puts back.
describe("Vision saved workspaces — the shortcut set", () => {
  const freshStore = () =>
    new Store({ engine: {}, e: new Proxy({}, { get: () => () => 0 }), commit: () => true, sync: () => {} } as never);

  beforeEach(() => localStorage.clear());

  it("has nothing to capture on a default install", () => {
    // This is what makes `Object.keys(shortcuts).length ? …` above a no-op for
    // everyone who never opened Edit ▸ Keyboard Shortcuts.
    expect(freshStore().state.keyboardShortcuts).toEqual({});
  });

  it("captures the live overrides and restores them verbatim on apply", () => {
    const store = freshStore();
    store.setKeyboardShortcuts({ printsize: "Mod+Alt+KeyP", fit: null });
    const captured: ShortcutOverrides = store.state.keyboardShortcuts;
    expect(captured).toMatchObject({ printsize: "Mod+Alt+KeyP", fit: null });

    store.setKeyboardShortcuts({ zoom200: "Mod+Shift+Digit2" });
    expect(store.state.keyboardShortcuts.printsize).toBeUndefined();

    // Apply Workspace hands the captured set straight back.
    store.setKeyboardShortcuts(captured);
    expect(store.state.keyboardShortcuts).toEqual(captured);
  });

  it("survives the JSON round trip a saved workspace goes through", () => {
    const store = freshStore();
    store.setKeyboardShortcuts({ printsize: "Mod+Alt+KeyP" });
    const persisted = JSON.parse(JSON.stringify(store.state.keyboardShortcuts)) as ShortcutOverrides;
    store.setKeyboardShortcuts({});
    store.setKeyboardShortcuts(persisted);
    expect(store.state.keyboardShortcuts).toEqual(persisted);
  });

  it("leaves the user's own bindings in place when a workspace carries none", () => {
    const store = freshStore();
    store.setKeyboardShortcuts({ printsize: "Mod+Alt+KeyP" });
    // A built-in workspace has no `shortcuts` field, so App applies nothing —
    // the live set (and its persisted copy) must be exactly as the user left it.
    expect(store.state.keyboardShortcuts).toEqual({ printsize: "Mod+Alt+KeyP" });
    expect(loadShortcutOverrides()).toEqual({ printsize: "Mod+Alt+KeyP" });
  });
});
