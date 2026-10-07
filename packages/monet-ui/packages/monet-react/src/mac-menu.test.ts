import { describe, expect, it, vi } from "vitest";
import type { MenuBarEntry } from "./menu";

const native = vi.hoisted(() => ({
  enabled: false,
  installAttempts: 0,
  installs: [] as string[],
  installGate: Promise.resolve() as Promise<void>,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("@tauri-apps/api/menu", () => ({
  PredefinedMenuItem: { new: async ({ item }: { item: unknown }) => ({ item }) },
  MenuItem: { new: async (options: object) => ({ ...options }) },
  Submenu: { new: async ({ text, enabled, items }: { text: string; enabled?: boolean; items: unknown[] }) => ({
    text,
    enabled,
    items,
    append: async (more: unknown[]) => { items.push(...more); },
  }) },
  Menu: { new: async ({ items }: { items: unknown[] }) => ({
    setAsAppMenu: async () => {
      native.installAttempts += 1;
      await native.installGate;
      native.installs.push(JSON.stringify(items));
    },
  }) },
}));

const quit = vi.hoisted(() => ({ request: vi.fn<() => Promise<void>>(async () => {}) }));
vi.mock("./quit-guard", () => ({ requestAppQuit: quit.request }));

import {
  APP_QUIT_ID,
  APP_SETTINGS_ID,
  HELP_SYSTEM_INFO_ID,
  HELP_SHORTCUTS_ID,
  collectActions,
  currentActionIds,
  currentMenuTree,
  dispatchMenuAction,
  firstActionIdAt,
  menuSignature,
  menuTree,
  nativeBarMenus,
  syncMacMenu,
} from "./mac-menu";

const APP_NAME = "Monet Test";
const APP = { appName: APP_NAME } as const;

const menus = (run = vi.fn()): MenuBarEntry[] => [
  {
    id: "file",
    label: "File",
    items: [
      { id: "new", label: "New", action: run },
      { id: "sep", label: "", separator: true },
      {
        id: "export",
        label: "Export",
        items: [
          { id: "png", label: "PNG", action: run },
          { id: "psd", label: "PSD", disabled: true },
        ],
      },
    ],
  },
];

describe("macMenu pure menu bridge", () => {
  it("builds stable path ids for nested menu items", () => {
    expect(menuTree(menus())).toEqual([
      {
        kind: "submenu",
        id: "file",
        text: "File",
        enabled: true,
        items: [
          { kind: "item", id: "file/new", text: "New", enabled: true },
          { kind: "separator", id: "file/sep" },
          {
            kind: "submenu",
            id: "file/export",
            text: "Export",
            enabled: true,
            items: [
              { kind: "item", id: "file/export/png", text: "PNG", enabled: true },
              { kind: "item", id: "file/export/psd", text: "PSD", enabled: false },
            ],
          },
        ],
      },
    ]);
  });

  it("collects actions only for activatable leaves", () => {
    const run = vi.fn();
    const actions = collectActions(menus(run));
    expect([...actions.keys()]).toEqual(["file/new", "file/export/png"]);
    actions.get("file/export/png")?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("changes the rebuild signature when labels or enabled state change", () => {
    const base = menus();
    const disabled = menus();
    disabled[0].items[0].disabled = true;
    const renamed = menus();
    renamed[0].items[0].label = "New...";

    expect(menuSignature(base)).not.toBe(menuSignature(disabled));
    expect(menuSignature(base)).not.toBe(menuSignature(renamed));
  });

  it("drops the in-window Window and Help menus synthesized by the native bar", () => {
    const withNativeMenus: MenuBarEntry[] = [
      ...menus(),
      { id: "window", label: "Window", items: [{ id: "toggletaskbar", label: "Contextual Task Bar", action: vi.fn() }] },
      { id: "help", label: "Help", items: [{ id: "systeminfo", label: "System Info…", action: vi.fn() }] },
    ];
    const bar = nativeBarMenus(withNativeMenus);
    expect(bar.map((m) => m.id)).toEqual(["file"]);
    expect(nativeBarMenus(menus())).toHaveLength(1);
  });

  it("excludes the in-window Help actions from the mirrored native tree", async () => {
    const run = vi.fn();
    const withNativeMenus: MenuBarEntry[] = [
      ...menus(run),
      { id: "window", label: "Window", items: [{ id: "toggletaskbar", label: "Contextual Task Bar", action: run }] },
      { id: "help", label: "Help", items: [{ id: "systeminfo", label: "System Info…", action: run }] },
    ];
    await syncMacMenu(withNativeMenus, "mac", APP);
    expect(currentMenuTree().map((m) => m.id)).toEqual(["file"]);
    expect(currentActionIds()).not.toContain("help/systeminfo");
  });

  it("keeps the app's Window commands reachable under the native Window submenu", async () => {
    // The native bar is the ONLY menu bar on macOS — the window frame renders
    // no in-window one — so a Window command that is not mirrored anywhere has
    // no click path at all (#497).
    const run = vi.fn();
    const withNativeMenus: MenuBarEntry[] = [
      ...menus(run),
      {
        id: "window",
        label: "Window",
        items: [
          { id: "arrange", label: "Arrange", items: [{ id: "tileallvert", label: "Tile All Vertically", action: run }] },
          { id: "toggletaskbar", label: "Contextual Task Bar", action: run },
        ],
      },
      { id: "help", label: "Help", items: [{ id: "systeminfo", label: "System Info…", action: run }] },
    ];
    await syncMacMenu(withNativeMenus, "mac", APP);
    expect(currentActionIds()).toContain("window/arrange/tileallvert");
    expect(currentActionIds()).toContain("window/toggletaskbar");
    dispatchMenuAction("window/arrange/tileallvert");
    expect(run).toHaveBeenCalledTimes(1);
    // Still not a top-level mirror: it is folded into the OS Window submenu,
    // so the bar keeps exactly one Window menu.
    expect(currentMenuTree().map((m) => m.id)).toEqual(["file"]);
  });

  it("rebuilds the native bar when only the Window menu changed", async () => {
    // The Window items are part of the installed bar now, so they have to be
    // part of what decides a rebuild — otherwise the document list and the
    // panel checkmarks freeze at whatever they were on the first sync.
    const withWindow = (label: string): MenuBarEntry[] => [
      ...menus(),
      { id: "window", label: "Window", items: [{ id: "toggletaskbar", label, action: vi.fn() }] },
    ];
    native.enabled = true;
    try {
      await syncMacMenu(withWindow("Contextual Task Bar"), "mac", APP);
      const before = native.installAttempts;
      await syncMacMenu(withWindow("Hide Task Bar"), "mac", APP);
      expect(native.installAttempts).toBe(before + 1);
    } finally {
      native.enabled = false;
    }
  });

  it("refreshes live actions on every sync, even when native install is a no-op", async () => {
    const first = vi.fn();
    const second = vi.fn();

    await syncMacMenu(menus(first), "mac", APP);
    expect(currentActionIds()).toEqual(["file/new", "file/export/png"]);
    expect(currentMenuTree()[0].id).toBe("file");
    dispatchMenuAction("file/new");
    expect(first).toHaveBeenCalledTimes(1);

    await syncMacMenu(menus(second), "mac", APP);
    dispatchMenuAction("file/new");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch native commands into an open preview transaction", async () => {
    const run = vi.fn();
    let blocked = true;
    await syncMacMenu(menus(run), "mac", { ...APP, blocked: () => blocked });

    dispatchMenuAction("file/new");
    expect(run).not.toHaveBeenCalled();

    blocked = false;
    dispatchMenuAction("file/new");
    expect(run).toHaveBeenCalledOnce();
  });

  it("installs the latest tree after an update arrives during an async rebuild", async () => {
    native.enabled = true;
    native.installAttempts = 0;
    native.installs.length = 0;
    let release = () => {};
    native.installGate = new Promise<void>((resolve) => { release = resolve; });
    const first = menus();
    first[0].items.push({ id: "preset-first", label: "First Scale", action: vi.fn() });
    const latest = menus();
    latest[0].items.push({ id: "preset-latest", label: "Latest Scale", action: vi.fn() });

    const building = syncMacMenu(first, "mac", APP);
    await vi.waitFor(() => expect(native.installAttempts).toBe(1));
    await syncMacMenu(latest, "mac", APP);
    release();
    await building;

    expect(native.installAttempts).toBe(2);
    expect(native.installs[native.installs.length - 1]).toContain("Latest Scale");
    native.enabled = false;
    native.installGate = Promise.resolve();
  });
});

// ── macOS-only bar items ───────────────────────────────────────────────────
// The App menu's Settings… and native Help items reuse the matching in-window
// command under native-specific ids rather than adding a second implementation.
describe("native-bar aliases for in-window commands", () => {
  const editBar = (prefs = vi.fn(), shortcuts = vi.fn(), systemInfo = vi.fn()): MenuBarEntry[] => [
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "keyboard-shortcuts", label: "Keyboard Shortcuts…", action: shortcuts },
        { id: "sep", label: "", separator: true },
        {
          id: "preferences",
          label: "Preferences",
          items: [
            { id: "general", label: "General…", action: prefs },
            { id: "interface", label: "Interface…", action: vi.fn() },
          ],
        },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        { id: "systeminfo", label: "System Info…", action: systemInfo },
        { id: "keyboardshortcuts", label: "Keyboard Shortcuts…", action: shortcuts },
      ],
    },
  ];

  it("resolves the first activatable item under a label path", () => {
    const bar = editBar();
    expect(firstActionIdAt(bar, ["Edit", "Preferences"])).toBe("edit/preferences/general");
    expect(firstActionIdAt(bar, ["Edit", "Keyboard Shortcuts…"])).toBe("edit/keyboard-shortcuts");
    expect(firstActionIdAt(bar, ["Help", "System Info…"])).toBe("help/systeminfo");
    expect(firstActionIdAt(bar, ["Edit", "Menus…"])).toBeNull(); // branch hidden by Edit ▸ Menus…
    expect(firstActionIdAt(bar, ["Image", "Preferences"])).toBeNull();
    expect(firstActionIdAt(bar, ["Edit"])).toBeNull(); // a whole menu is not a command
  });

  it("returns null when the branch holds nothing activatable", () => {
    const bar: MenuBarEntry[] = [
      {
        id: "edit",
        label: "Edit",
        items: [
          {
            id: "preferences",
            label: "Preferences",
            items: [
              { id: "sep", label: "", separator: true },
              { id: "general", label: "General…", disabled: true },
            ],
          },
        ],
      },
    ];
    expect(firstActionIdAt(bar, ["Edit", "Preferences"])).toBeNull();
  });

  it("does not register or alias disabled actions", () => {
    const action = vi.fn();
    const bar: MenuBarEntry[] = [{
      id: "edit",
      label: "Edit",
      items: [{
        id: "preferences",
        label: "Preferences",
        disabled: true,
        items: [{ id: "general", label: "General…", action }],
      }],
    }];
    expect(collectActions(bar).size).toBe(0);
    expect(firstActionIdAt(bar, ["Edit", "Preferences"])).toBeNull();
    expect(menuTree(bar)).toEqual([
      expect.objectContaining({ items: [expect.objectContaining({ kind: "submenu", enabled: false })] }),
    ]);
  });

  it("disables a whole top-level menu and all of its actions", () => {
    const action = vi.fn();
    const bar: MenuBarEntry[] = [{
      id: "edit",
      label: "Edit",
      disabled: true,
      items: [{ id: "preferences", label: "Preferences", action }],
    }];
    expect(menuTree(bar)[0]).toEqual(expect.objectContaining({ kind: "submenu", enabled: false }));
    expect(collectActions(bar).size).toBe(0);
    expect(firstActionIdAt(bar, ["Edit", "Preferences"])).toBeNull();
  });

  it("runs Edit ▸ Preferences ▸ General… from the App menu's Settings…", async () => {
    const prefs = vi.fn();
    const shortcuts = vi.fn();
    const systemInfo = vi.fn();
    await syncMacMenu(editBar(prefs, shortcuts, systemInfo), "mac", APP);

    // Aliases stay OUT of the React-leaf registry (e2e asserts one registered
    // action per enabled leaf) but still dispatch.
    expect(currentActionIds()).not.toContain(APP_SETTINGS_ID);
    dispatchMenuAction(APP_SETTINGS_ID);
    expect(prefs).toHaveBeenCalledTimes(1);
    dispatchMenuAction(HELP_SHORTCUTS_ID);
    expect(shortcuts).toHaveBeenCalledTimes(1);
    dispatchMenuAction(HELP_SYSTEM_INFO_ID);
    expect(systemInfo).toHaveBeenCalledTimes(1);

    // The alias tracks the latest render's closures, like every other action.
    const next = vi.fn();
    await syncMacMenu(editBar(next), "mac", APP);
    dispatchMenuAction(APP_SETTINGS_ID);
    expect(prefs).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("drops the alias when the command goes away, so a stale closure cannot fire", async () => {
    const prefs = vi.fn();
    const shortcuts = vi.fn();
    const systemInfo = vi.fn();
    await syncMacMenu(editBar(prefs, shortcuts, systemInfo), "mac", APP);
    await syncMacMenu(menus(), "mac", APP); // File menu only — no Edit ▸ Preferences
    expect(() => dispatchMenuAction(APP_SETTINGS_ID)).not.toThrow();
    dispatchMenuAction(HELP_SYSTEM_INFO_ID);
    dispatchMenuAction(HELP_SHORTCUTS_ID);
    expect(prefs).not.toHaveBeenCalled();
    expect(systemInfo).not.toHaveBeenCalled();
    expect(shortcuts).not.toHaveBeenCalled();
  });

  it("installs Settings…, System Info…, and Keyboard Shortcuts… into the native bar", async () => {
    native.enabled = true;
    native.installs.length = 0;
    await syncMacMenu(editBar(), "mac", APP);
    const installed = native.installs[native.installs.length - 1] ?? "";
    expect(JSON.parse(installed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: APP_NAME,
          items: expect.arrayContaining([
            expect.objectContaining({ id: APP_SETTINGS_ID, text: "Settings…", enabled: true }),
          ]),
        }),
        expect.objectContaining({
          text: "Help",
          items: expect.arrayContaining([
            expect.objectContaining({ id: HELP_SYSTEM_INFO_ID, text: "System Info…", enabled: true }),
            expect.objectContaining({ id: HELP_SHORTCUTS_ID, text: "Keyboard Shortcuts…", enabled: true }),
          ]),
        }),
      ]),
    );
    native.enabled = false;
  });

  it("rebuilds when a Help command becomes unavailable", async () => {
    native.enabled = true;
    const bar = editBar();
    await syncMacMenu(bar, "mac", APP);
    const help = bar.find((menu) => menu.id === "help")!;
    help.items[0] = { ...help.items[0], disabled: true };
    await syncMacMenu(bar, "mac", APP);
    const installed = JSON.parse(native.installs[native.installs.length - 1] ?? "[]") as { text: string; items: unknown[] }[];
    expect(installed.find((menu) => menu.text === "Help")?.items)
      .toContainEqual(expect.objectContaining({ id: HELP_SYSTEM_INFO_ID, enabled: false }));
    native.enabled = false;
  });

  it("renders the items disabled rather than dead when the commands are gone", async () => {
    native.enabled = true;
    native.installs.length = 0;
    await syncMacMenu(menus(), "mac", APP); // no Edit menu at all
    const installed = JSON.parse(native.installs[native.installs.length - 1] ?? "[]") as { text: string; items: unknown[] }[];
    const app = installed.find((m) => m.text === APP_NAME);
    const help = installed.find((m) => m.text === "Help");
    expect(app?.items).toContainEqual(expect.objectContaining({ id: APP_SETTINGS_ID, enabled: false }));
    expect(help?.items).toContainEqual(expect.objectContaining({ id: HELP_SYSTEM_INFO_ID, enabled: false }));
    expect(help?.items).toContainEqual(expect.objectContaining({ id: HELP_SHORTCUTS_ID, enabled: false }));
    native.enabled = false;
  });


  it("drops the alias when the command goes away, so a stale closure cannot fire", async () => {
    const prefs = vi.fn();
    const shortcuts = vi.fn();
    const systemInfo = vi.fn();
    await syncMacMenu(editBar(prefs, shortcuts, systemInfo), "mac", APP);
    await syncMacMenu(menus(), "mac", APP); // File menu only — no Edit ▸ Preferences
    expect(() => dispatchMenuAction(APP_SETTINGS_ID)).not.toThrow();
    dispatchMenuAction(HELP_SYSTEM_INFO_ID);
    dispatchMenuAction(HELP_SHORTCUTS_ID);
    expect(prefs).not.toHaveBeenCalled();
    expect(systemInfo).not.toHaveBeenCalled();
    expect(shortcuts).not.toHaveBeenCalled();
  });

  it("installs Settings…, System Info…, and Keyboard Shortcuts… into the native bar", async () => {
    native.enabled = true;
    native.installs.length = 0;
    await syncMacMenu(editBar(), "mac", APP);
    const installed = native.installs[native.installs.length - 1] ?? "";
    expect(JSON.parse(installed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: APP_NAME,
          items: expect.arrayContaining([
            expect.objectContaining({ id: APP_SETTINGS_ID, text: "Settings…", enabled: true }),
          ]),
        }),
        expect.objectContaining({
          text: "Help",
          items: expect.arrayContaining([
            expect.objectContaining({ id: HELP_SYSTEM_INFO_ID, text: "System Info…", enabled: true }),
            expect.objectContaining({ id: HELP_SHORTCUTS_ID, text: "Keyboard Shortcuts…", enabled: true }),
          ]),
        }),
      ]),
    );
    native.enabled = false;
  });

  it("rebuilds when a Help command becomes unavailable", async () => {
    native.enabled = true;
    const bar = editBar();
    await syncMacMenu(bar, "mac", APP);
    const help = bar.find((menu) => menu.id === "help")!;
    help.items[0] = { ...help.items[0], disabled: true };
    await syncMacMenu(bar, "mac", APP);
    const installed = JSON.parse(native.installs[native.installs.length - 1] ?? "[]") as { text: string; items: unknown[] }[];
    expect(installed.find((menu) => menu.text === "Help")?.items)
      .toContainEqual(expect.objectContaining({ id: HELP_SYSTEM_INFO_ID, enabled: false }));
    native.enabled = false;
  });

  it("renders the items disabled rather than dead when the commands are gone", async () => {
    native.enabled = true;
    native.installs.length = 0;
    await syncMacMenu(menus(), "mac", APP); // no Edit menu at all
    const installed = JSON.parse(native.installs[native.installs.length - 1] ?? "[]") as { text: string; items: unknown[] }[];
    const app = installed.find((m) => m.text === APP_NAME);
    const help = installed.find((m) => m.text === "Help");
    expect(app?.items).toContainEqual(expect.objectContaining({ id: APP_SETTINGS_ID, enabled: false }));
    expect(help?.items).toContainEqual(expect.objectContaining({ id: HELP_SYSTEM_INFO_ID, enabled: false }));
    expect(help?.items).toContainEqual(expect.objectContaining({ id: HELP_SHORTCUTS_ID, enabled: false }));
    native.enabled = false;
  });
});

// ── the custom Quit item (#506) ─────────────────────────────────────────────
// The predefined Quit called NSApp terminate:, which no CloseRequested can
// veto — ⌘Q discarded unsaved work. A custom item dispatches into the webview
// instead, where the app's quit guard (quit-guard.ts) decides.
describe("the app menu's Quit item", () => {
  it("is a custom `Quit <App>` item holding ⌘Q, not the predefined Quit", async () => {
    native.enabled = true;
    native.installs.length = 0;
    // Earlier tests cached the File-only signature; sync a structurally
    // different bar first to force the rebuild this assertion needs, then the
    // canonical bar the test is about.
    await syncMacMenu([...menus(), { id: "view", label: "View", items: [] }], "mac", APP);
    native.installs.length = 0;
    await syncMacMenu(menus(), "mac", APP);
    const installed = JSON.parse(native.installs[native.installs.length - 1] ?? "[]") as {
      text: string;
      items: { id?: string; text?: string; item?: unknown; accelerator?: string }[];
    }[];
    const app = installed.find((m) => m.text === APP_NAME);
    expect(app).toBeDefined();
    // No predefined Quit anywhere in the app menu: that one terminates the
    // process without ever asking the webview.
    expect(app?.items.some((i) => i.item === "Quit")).toBe(false);
    expect(app?.items).toContainEqual(
      expect.objectContaining({ id: APP_QUIT_ID, text: `Quit ${APP_NAME}`, enabled: true, accelerator: "CmdOrControl+Q" }),
    );
    native.enabled = false;
  });

  it("dispatches to the shared quit flow, like any other native item", async () => {
    quit.request.mockClear();
    await syncMacMenu(menus(), "mac", APP);
    dispatchMenuAction(APP_QUIT_ID);
    expect(quit.request).toHaveBeenCalledTimes(1);

    // The alias is re-registered on every sync, so it never goes stale.
    await syncMacMenu(menus(), "mac", APP);
    dispatchMenuAction(APP_QUIT_ID);
    expect(quit.request).toHaveBeenCalledTimes(2);
  });

  it("is swallowed mid-transaction like every native command", async () => {
    quit.request.mockClear();
    let blocked = true;
    await syncMacMenu(menus(), "mac", { ...APP, blocked: () => blocked });
    dispatchMenuAction(APP_QUIT_ID);
    expect(quit.request).not.toHaveBeenCalled();

    blocked = false;
    dispatchMenuAction(APP_QUIT_ID);
    expect(quit.request).toHaveBeenCalledOnce();
  });
});
