// ──────────────────────────────────────────────────────────────────────────
//  Native macOS system menu bar — Monet Vision's binding.
//
//  The bridge itself is app-agnostic and shared by every Monet app
//  (`@monet-ui/monet-react` ▸ mac-menu). This module only supplies Vision's app
//  name; its menu label paths happen to be the shared defaults.
//
//  We intentionally set NO accelerators on the native items: the app's global
//  keydown handler already owns every shortcut and correctly defers to focused
//  text fields, so a native key-equivalent would hijack ⌘Z/⌘A inside inputs.
// ──────────────────────────────────────────────────────────────────────────
import { syncMacMenu as syncMacMenuShared, type MenuBarEntry } from "@monet-ui/monet-react";

export {
  APP_SETTINGS_ID,
  HELP_SHORTCUTS_ID,
  HELP_SYSTEM_INFO_ID,
  collectActions,
  currentActionIds,
  currentMenuTree,
  dispatchMenuAction,
  firstActionIdAt,
  menuSignature,
  menuTree,
  nativeBarMenus,
  type MenuNode,
} from "@monet-ui/monet-react";

/** Sync the macOS system menu bar with Vision's current React menu definitions. */
export async function syncMacMenu(menus: MenuBarEntry[], platform: string, blocked: () => boolean = () => false): Promise<void> {
  return syncMacMenuShared(menus, platform, { appName: "Vision", blocked });
}
