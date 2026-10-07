// ──────────────────────────────────────────────────────────────────────────
//  Native macOS system menu bar — shared by every Monet app.
//
//  A Monet app draws its own chrome, and on macOS the `Titlebar` deliberately
//  does NOT draw a menu bar: application menus belong in the global bar at the
//  top of the screen. An app without this bridge therefore has only Tauri's
//  stock menu, and every command with no keyboard shortcut and no panel button
//  is UNREACHABLE.
//
//  This module mirrors an app's React menu definitions — its single source of
//  truth — into the *real* macOS system menu bar via Tauri's JS menu API. The
//  visible menu structure is static (only the `action` closures capture live
//  state), so we build the NSMenu once and only refresh the id→action registry on
//  every render; the native tree is rebuilt solely when its structure changes.
//
//  We intentionally set NO accelerators on the items: the app's global keydown
//  handler already owns every shortcut and correctly defers to focused text
//  fields, so a native key-equivalent would hijack ⌘Z/⌘A inside inputs. Shortcuts
//  keep working through that handler; the native menu is click-to-invoke.
// ──────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { MenuBarEntry, MenuItemDef } from "./menu";
import type { Menu, Submenu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { requestAppQuit } from "./quit-guard";

/** Platform-agnostic intermediate representation — pure, serialisable, testable. */
export type MenuNode =
  | { kind: "separator"; id: string }
  | { kind: "item"; id: string; text: string; enabled: boolean }
  | { kind: "submenu"; id: string; text: string; enabled: boolean; items: MenuNode[] };

type MenuModule = typeof import("@tauri-apps/api/menu");

/** Menu labels are `ReactNode`; every Monet menu label is a plain string. */
function labelText(label: ReactNode): string {
  return typeof label === "string" ? label : typeof label === "number" ? String(label) : "";
}

/** Path-id makes ids globally unique across menus ("file/new", "image/mode/d8"). */
function childId(path: string, id: string): string {
  return path ? `${path}/${id}` : id;
}

function nodeFromItem(item: MenuItemDef, path: string): MenuNode {
  const id = childId(path, item.id);
  if (item.separator) return { kind: "separator", id };
  if (item.items && item.items.length)
    return { kind: "submenu", id, text: labelText(item.label), enabled: item.disabled !== true, items: item.items.map((c) => nodeFromItem(c, id)) };
  return { kind: "item", id, text: labelText(item.label), enabled: item.disabled !== true };
}

/** Pure: the React menu bar → a tree of menu nodes (top level = submenus). */
export function menuTree(menus: MenuBarEntry[]): MenuNode[] {
  return menus.map((m) => ({
    kind: "submenu" as const,
    id: m.id,
    text: labelText(m.label),
    enabled: m.disabled !== true,
    items: m.items.map((c) => nodeFromItem(c, m.id)),
  }));
}

/** Pure: a stable signature of the *visible* structure (ids/labels/nesting/enabled).
 *  The native menu is rebuilt only when this changes; actions refresh separately. */
export function menuSignature(menus: MenuBarEntry[]): string {
  const sig = (n: MenuNode): string =>
    n.kind === "separator" ? "|"
    : n.kind === "item" ? `${n.id}:${n.text}:${n.enabled ? 1 : 0}`
    : `${n.id}[${n.text}:${n.enabled ? 1 : 0}{${n.items.map(sig).join(",")}}]`;
  return menuTree(menus).map(sig).join(";");
}

/** Pure: flat map of path-id → live action for every activatable leaf item. */
export function collectActions(menus: MenuBarEntry[]): Map<string, () => void> {
  const out = new Map<string, () => void>();
  const walk = (item: MenuItemDef, path: string) => {
    const id = childId(path, item.id);
    if (item.disabled) return;
    if (item.items && item.items.length) item.items.forEach((c) => walk(c, id));
    else if (item.action && !item.separator) out.set(id, item.action);
  };
  menus.forEach((m) => {
    if (!m.disabled) m.items.forEach((c) => walk(c, m.id));
  });
  return out;
}

/** Ids for the items the native bar owns but the React bar has no entry for.
 *  They are aliases: the action they run is the one already registered for the
 *  matching in-window menu item, so there is exactly one implementation. */
export const APP_SETTINGS_ID = "app/settings";
export const HELP_SYSTEM_INFO_ID = "help/system-info";
export const HELP_SHORTCUTS_ID = "help/shortcuts";
/** The app menu's custom Quit item (#506). The predefined Quit called
 *  NSApp terminate: and discarded unsaved work; this one dispatches into the
 *  webview, where the shared quit guard decides. */
export const APP_QUIT_ID = "app/quit";

/** Pure: the path-id of the first activatable item under a LABEL path — e.g.
 *  `["Edit", "Preferences"]` → the id of Edit ▸ Preferences ▸ General…. Labels,
 *  not ids, because the React bar slugs its ids out of the blueprint labels and
 *  uniquifies them. Returns null when the branch is missing (Edit ▸ Menus… can
 *  hide whole branches) or leads to nothing activatable, so a caller can render
 *  its item disabled instead of shipping one that does nothing. */
export function firstActionIdAt(menus: MenuBarEntry[], labels: string[]): string | null {
  const top = menus.find((m) => labelText(m.label) === labels[0]);
  if (!top || top.disabled || labels.length < 2) return null;
  let node: MenuItemDef | undefined;
  let path = top.id;
  let items: MenuItemDef[] = top.items;
  for (const label of labels.slice(1)) {
    node = items.find((i) => !i.separator && labelText(i.label) === label);
    if (!node || node.disabled) return null;
    path = childId(path, node.id);
    items = node.items ?? [];
  }
  return node ? firstActionLeaf(node, path) : null;
}

function firstActionLeaf(item: MenuItemDef, path: string): string | null {
  if (item.disabled) return null;
  if (item.items && item.items.length) {
    for (const child of item.items) {
      const hit = firstActionLeaf(child, childId(path, child.id));
      if (hit) return hit;
    }
    return null;
  }
  return !item.separator && item.action ? path : null;
}

/** Pure: the menus the NATIVE macOS bar should mirror. Window and Help are
 *  synthesized below in platform order, so omit their in-window counterparts. */
export function nativeBarMenus(menus: MenuBarEntry[]): MenuBarEntry[] {
  return menus.filter((m) => m.id !== "window" && m.id !== "help");
}

// ── live registry, refreshed every render so captured closures never go stale ──
let actions = new Map<string, () => void>();
/** Native-bar-only ids (see [`APP_SETTINGS_ID`]) → the in-window action they
 *  alias. Kept out of `actions` because that map mirrors the React bar leaf for
 *  leaf — e2e asserts one registered action per enabled leaf and nothing more. */
let aliases = new Map<string, () => void>();
let lastMenus: MenuBarEntry[] = [];
let commandBlocked = () => false;

/** Invoked by a native menu item (Tauri passes the item id we assigned). */
export function dispatchMenuAction(id: string): void {
  if (commandBlocked()) return;
  (actions.get(id) ?? aliases.get(id))?.();
}

/** Test/introspection hooks (exposed via `window.__mv.macMenu`). */
export function currentMenuTree(): MenuNode[] {
  return menuTree(lastMenus);
}
export function currentActionIds(): string[] {
  return [...actions.keys()];
}

// ── native (Tauri) build ──────────────────────────────────────────────────────
async function buildNode(M: MenuModule, node: MenuNode): Promise<Submenu | MenuItem | PredefinedMenuItem> {
  if (node.kind === "separator") return M.PredefinedMenuItem.new({ item: "Separator" });
  if (node.kind === "submenu")
    return M.Submenu.new({ text: node.text, enabled: node.enabled, items: await Promise.all(node.items.map((c) => buildNode(M, c))) });
  return M.MenuItem.new({ id: node.id, text: node.text, enabled: node.enabled, action: dispatchMenuAction });
}

/** The standard macOS application menu (bold, app-named) — About/Settings/Hide/Quit.
 *  Settings… belongs here on macOS (Photoshop ▸ Settings, and where every mac user
 *  looks); it runs the same action as Edit ▸ Preferences ▸ General…. */
async function appSubmenu(M: MenuModule, appName: string, settingsEnabled: boolean): Promise<Submenu> {
  return M.Submenu.new({
    text: appName,
    items: [
      await M.PredefinedMenuItem.new({ item: { About: { name: appName } } }),
      await M.PredefinedMenuItem.new({ item: "Separator" }),
      await M.MenuItem.new({
        id: APP_SETTINGS_ID,
        text: "Settings…",
        enabled: settingsEnabled,
        action: dispatchMenuAction,
      }),
      await M.PredefinedMenuItem.new({ item: "Separator" }),
      await M.PredefinedMenuItem.new({ item: "Services" }),
      await M.PredefinedMenuItem.new({ item: "Separator" }),
      await M.PredefinedMenuItem.new({ item: "Hide" }),
      await M.PredefinedMenuItem.new({ item: "HideOthers" }),
      await M.PredefinedMenuItem.new({ item: "ShowAll" }),
      await M.PredefinedMenuItem.new({ item: "Separator" }),
      await M.MenuItem.new({
        id: APP_QUIT_ID,
        text: `Quit ${appName}`,
        enabled: true,
        accelerator: "CmdOrControl+Q",
        action: dispatchMenuAction,
      }),
    ],
  });
}

/** The app's own Window items as menu nodes. menuTree always yields submenus
 *  at the top level, but its return type is the whole MenuNode union. */
function windowAppItems(entry: MenuBarEntry | null): MenuNode[] {
  if (!entry) return [];
  const node = menuTree([entry])[0];
  return node?.kind === "submenu" ? node.items : [];
}

/** The standard macOS Window menu — Minimize/Zoom/Fullscreen/Close — followed
 *  by the app's own Window commands (Arrange, Workspace, the panel inventory,
 *  the open-document list).
 *
 *  Those are not optional extras: the native bar is the only menu bar a Monet
 *  window has, so anything not mirrored here has no click path at all. They go
 *  BELOW the OS items, which is where macOS apps put their own window commands
 *  and keeps Minimize/Zoom/Close where every mac user reaches for them (#497). */
async function windowSubmenu(M: MenuModule, appItems: MenuNode[]): Promise<Submenu> {
  const own = appItems.length
    ? [
        await M.PredefinedMenuItem.new({ item: "Separator" }),
        ...(await Promise.all(appItems.map((n) => buildNode(M, n)))),
      ]
    : [];
  return M.Submenu.new({
    text: "Window",
    items: [
      await M.PredefinedMenuItem.new({ item: "Minimize" }),
      await M.PredefinedMenuItem.new({ item: "Maximize" }),
      await M.PredefinedMenuItem.new({ item: "Fullscreen" }),
      await M.PredefinedMenuItem.new({ item: "Separator" }),
      await M.PredefinedMenuItem.new({ item: "CloseWindow" }),
      ...own,
    ],
  });
}

/** Native Help mirrors the implemented cross-platform Help commands. About is
 *  already the standard first item in the macOS application menu. */
async function helpSubmenu(M: MenuModule, systemInfoEnabled: boolean, shortcutsEnabled: boolean): Promise<Submenu> {
  return M.Submenu.new({
    text: "Help",
    items: [
      await M.MenuItem.new({
        id: HELP_SYSTEM_INFO_ID,
        text: "System Info…",
        enabled: systemInfoEnabled,
        action: dispatchMenuAction,
      }),
      await M.PredefinedMenuItem.new({ item: "Separator" }),
      await M.MenuItem.new({
        id: HELP_SHORTCUTS_ID,
        text: "Keyboard Shortcuts…",
        enabled: shortcutsEnabled,
        action: dispatchMenuAction,
      }),
    ],
  });
}

let builtSignature: string | null = null;
let building = false;
let pendingMenus: MenuBarEntry[] | null = null;

/**
 * Sync the macOS system menu bar with the current React menu definitions.
 * Always refreshes the action registry; (re)builds + installs the native NSMenu
 * only when its visible structure changes. No-op off Mac / outside Tauri.
 */
export interface MacMenuOptions {
  /** Bold application-menu title, and the name shown in "About …". */
  appName: string;
  /** Label path to the command the app menu's "Settings…" should run. */
  settingsPath?: string[];
  /** Label path behind Help ▸ System Info…. */
  systemInfoPath?: string[];
  /** Label path behind Help ▸ Keyboard Shortcuts…. */
  shortcutsPath?: string[];
  /** Return true to swallow activations (e.g. mid-transaction). */
  blocked?: () => boolean;
}

export async function syncMacMenu(menus: MenuBarEntry[], platform: string, opts: MacMenuOptions): Promise<void> {
  const {
    appName,
    settingsPath = ["Edit", "Preferences"],
    systemInfoPath = ["Help", "System Info…"],
    shortcutsPath = ["Help", "Keyboard Shortcuts…"],
  } = opts;
  commandBlocked = opts.blocked ?? (() => false);
  const bar = nativeBarMenus(menus); // Window/Help are synthesized, not mirrored
  const sourceBar = menus.filter((m) => m.id !== "window");
  // The app's Window commands are folded into the OS Window submenu rather than
  // mirrored as a second top-level menu, so they are dispatchable even though
  // they are not in `bar`.
  const windowEntry = menus.find((m) => m.id === "window") ?? null;
  actions = collectActions(windowEntry ? [...bar, windowEntry] : bar); // fresh handlers every render
  const sourceActions = collectActions(sourceBar);
  // Native-bar-only items run an existing in-window command under an alias id.
  // Both aliases are derived from `bar`, so whether they resolve is already part
  // of menuSignature — a hidden branch changes the signature and rebuilds.
  aliases = new Map();
  const alias = (id: string, labels: string[], lookup = bar, registry = actions): boolean => {
    const target = firstActionIdAt(lookup, labels);
    const run = target ? registry.get(target) : undefined;
    if (run) aliases.set(id, run);
    return run !== undefined;
  };
  const settingsEnabled = alias(APP_SETTINGS_ID, settingsPath);
  const systemInfoEnabled = alias(HELP_SYSTEM_INFO_ID, systemInfoPath, sourceBar, sourceActions);
  const shortcutsEnabled = alias(HELP_SHORTCUTS_ID, shortcutsPath, sourceBar, sourceActions);
  // The custom Quit item (#506) always routes through the shared quit guard,
  // re-registered every sync so it never captures a stale closure.
  aliases.set(APP_QUIT_ID, () => {
    void requestAppQuit();
  });
  lastMenus = bar;
  if (!isTauri() || platform !== "mac") return;

  // Everything that shapes the installed bar: the mirrored menus, the Window
  // commands folded in below, and Help (whose presence enables the two native
  // Help items). The document list and the panel checkmarks live in Window, so
  // leaving it out froze them at whatever the first sync installed.
  const sig = menuSignature(menus) + "|" + appName;
  if (building) {
    pendingMenus = menus;
    return;
  }
  if (sig === builtSignature) return; // structure unchanged → keep the installed menu
  building = true;
  try {
    const M: MenuModule = await import("@tauri-apps/api/menu");
    const tree = menuTree(bar);
    const submenus = await Promise.all(tree.map((n) => buildNode(M, n)));
    // Restore the native Edit ▸ Cut/Copy/Paste that Tauri's default menu provided
    // (setAsAppMenu replaces the whole bar). ⌘X/⌘C/⌘V have no canvas binding, so
    // they only drive the focused text field; we deliberately omit Undo/Redo and
    // Select All — those would hijack the canvas ⌘Z/⌘A owned by the keydown handler.
    const editIdx = tree.findIndex((n) => n.id === "edit");
    if (editIdx >= 0) {
      await (submenus[editIdx] as Submenu).append([
        await M.PredefinedMenuItem.new({ item: "Separator" }),
        await M.PredefinedMenuItem.new({ item: "Cut" }),
        await M.PredefinedMenuItem.new({ item: "Copy" }),
        await M.PredefinedMenuItem.new({ item: "Paste" }),
      ]);
    }
    const menu: Menu = await M.Menu.new({
      items: [
        await appSubmenu(M, appName, settingsEnabled),
        ...submenus,
        await windowSubmenu(M, windowAppItems(windowEntry)),
        await helpSubmenu(M, systemInfoEnabled, shortcutsEnabled),
      ],
    });
    await menu.setAsAppMenu();
    builtSignature = sig;
  } catch (e) {
    console.error("[macMenu] failed to install the native menu bar", e);
  } finally {
    building = false;
    const pending = pendingMenus;
    pendingMenus = null;
    if (pending) await syncMacMenu(pending, platform, opts);
  }
}
