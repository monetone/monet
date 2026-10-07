// ─────────────────────────────────────────────────────────────
// Monet · Native OS dialogs (Tauri plugin-dialog wrapper)
// ─────────────────────────────────────────────────────────────
// Thin, typed helpers over @tauri-apps/plugin-dialog. The plugin module is
// lazy-imported only when running inside a Tauri webview (mirrors the
// isTauri-guard + dynamic-import pattern chrome.tsx uses for
// @tauri-apps/api/event). Outside Tauri (e.g. `vite dev` in a plain browser)
// everything degrades gracefully and never throws:
//   • openFile / saveFile → resolve `null` (as if the user cancelled)
//   • confirm / ask        → resolve `false`
//   • message              → resolve `undefined` (no-op)
// On the Rust side, register the plugin with `monet_ui::dialog_plugin()` and
// add the `"dialog:default"` capability so these commands are permitted.

import { isTauri } from "./chrome";

// Lazily-imported shape of @tauri-apps/plugin-dialog. Declared locally (rather
// than importing the package's types eagerly) so this module's own type-check
// never forces the optional dependency to be installed; the runtime import is
// still fully typed against this contract.
interface PluginDialogModule {
  open(options?: PluginOpenOptions): Promise<string | string[] | null>;
  save(options?: PluginSaveOptions): Promise<string | null>;
  message(message: string, options?: string | PluginMessageOptions): Promise<unknown>;
  ask(message: string, options?: string | PluginConfirmOptions): Promise<boolean>;
  confirm(message: string, options?: string | PluginConfirmOptions): Promise<boolean>;
}

interface PluginOpenOptions {
  title?: string;
  filters?: DialogFilter[];
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  recursive?: boolean;
  canCreateDirectories?: boolean;
}

interface PluginSaveOptions {
  title?: string;
  filters?: DialogFilter[];
  defaultPath?: string;
  canCreateDirectories?: boolean;
}

interface PluginMessageOptions {
  title?: string;
  kind?: DialogKind;
}

interface PluginConfirmOptions {
  title?: string;
  kind?: DialogKind;
  okLabel?: string;
  cancelLabel?: string;
}

// ─── public option types ────────────────────────────────────

/** The kind of a message/confirm/ask dialog. Defaults to `"info"`. */
export type DialogKind = "info" | "warning" | "error";

/** An extension filter for the open/save file dialogs. Extensions are given
 *  without a leading `.` (e.g. `["png", "jpeg"]`). */
export interface DialogFilter {
  /** Human-readable filter name shown in the dialog. */
  name: string;
  /** Extensions to filter by, without the `.` prefix. */
  extensions: string[];
}

/** Options for {@link openFile}. */
export interface OpenFileOptions {
  /** The dialog window title (desktop only). */
  title?: string;
  /** Extension filters to constrain the selectable files. */
  filters?: DialogFilter[];
  /** Initial directory or file path the dialog opens at. */
  defaultPath?: string;
  /** Allow selecting more than one path. When `true`, {@link openFile}
   *  resolves to a `string[]` (or `null` if cancelled). */
  multiple?: boolean;
  /** Select directories instead of files. */
  directory?: boolean;
  /** When `directory` is `true`, allow the picked scope to be read
   *  recursively later. */
  recursive?: boolean;
  /** Allow creating directories from within the dialog (macOS only). */
  canCreateDirectories?: boolean;
}

/** Options for {@link saveFile}. */
export interface SaveFileOptions {
  /** The dialog window title (desktop only). */
  title?: string;
  /** Extension filters to constrain/suggest the file type. */
  filters?: DialogFilter[];
  /** Initial directory or suggested file path. */
  defaultPath?: string;
  /** Allow creating directories from within the dialog (macOS only). */
  canCreateDirectories?: boolean;
}

/** Options for {@link message}. */
export interface MessageOptions {
  /** Dialog title. Defaults to the app name. */
  title?: string;
  /** Dialog kind. Defaults to `"info"`. */
  kind?: DialogKind;
}

/** Options for {@link confirm} (Ok / Cancel). */
export interface ConfirmOptions {
  /** Dialog title. Defaults to the app name. */
  title?: string;
  /** Dialog kind. Defaults to `"info"`. */
  kind?: DialogKind;
  /** Label of the confirm (Ok) button. */
  okLabel?: string;
  /** Label of the cancel button. */
  cancelLabel?: string;
}

/** Options for {@link ask} (Yes / No). */
export interface AskOptions {
  /** Dialog title. Defaults to the app name. */
  title?: string;
  /** Dialog kind. Defaults to `"info"`. */
  kind?: DialogKind;
  /** Label of the affirmative (Yes) button. */
  okLabel?: string;
  /** Label of the negative (No) button. */
  cancelLabel?: string;
}

// ─── lazy plugin loader + one-time warning ──────────────────

let warnedOutsideTauri = false;

/** Warn (once) that a native dialog was requested outside a Tauri webview. */
function warnOutsideTauri(fn: string): void {
  if (warnedOutsideTauri) return;
  warnedOutsideTauri = true;
  if (typeof console !== "undefined") {
    console.warn(
      `[monet-ui] ${fn}() called outside a Tauri webview; native dialogs are ` +
        `unavailable here. Returning a safe default.`,
    );
  }
}

/** Lazily import the dialog plugin, but only inside Tauri. Returns `null`
 *  outside Tauri or if the optional dependency is missing — callers map that
 *  to their graceful default. */
async function loadPlugin(fn: string): Promise<PluginDialogModule | null> {
  if (!isTauri()) {
    warnOutsideTauri(fn);
    return null;
  }
  try {
    return (await import("@tauri-apps/plugin-dialog")) as PluginDialogModule;
  } catch {
    return null;
  }
}

// ─── public helpers ─────────────────────────────────────────

/** Open a native file/directory selection dialog.
 *
 *  Resolves to the selected path as a `string`, or — when
 *  `opts.multiple` is `true` — a `string[]`. Resolves to `null` if the user
 *  cancels, or (gracefully) when running outside a Tauri webview. */
export async function openFile(
  opts: OpenFileOptions = {},
): Promise<string | string[] | null> {
  const plugin = await loadPlugin("openFile");
  if (!plugin) return null;
  const selected = await plugin.open({
    title: opts.title,
    filters: opts.filters,
    defaultPath: opts.defaultPath,
    multiple: opts.multiple,
    directory: opts.directory,
    recursive: opts.recursive,
    canCreateDirectories: opts.canCreateDirectories,
  });
  return selected ?? null;
}

/** Open a native save dialog. Resolves to the chosen path, or `null` if the
 *  user cancels or when running outside a Tauri webview. */
export async function saveFile(
  opts: SaveFileOptions = {},
): Promise<string | null> {
  const plugin = await loadPlugin("saveFile");
  if (!plugin) return null;
  const selected = await plugin.save({
    title: opts.title,
    filters: opts.filters,
    defaultPath: opts.defaultPath,
    canCreateDirectories: opts.canCreateDirectories,
  });
  return selected ?? null;
}

/** Show a native confirmation dialog (Ok / Cancel). Resolves to `true` when
 *  the user confirms, `false` when they cancel — or (gracefully) `false`
 *  when running outside a Tauri webview. */
export async function confirm(
  message: string,
  opts: ConfirmOptions = {},
): Promise<boolean> {
  const plugin = await loadPlugin("confirm");
  if (!plugin) return false;
  return plugin.confirm(message, {
    title: opts.title,
    kind: opts.kind,
    okLabel: opts.okLabel,
    cancelLabel: opts.cancelLabel,
  });
}

/** Show a native question dialog (Yes / No). Resolves to `true` when the user
 *  answers Yes, `false` for No — or (gracefully) `false` when running outside
 *  a Tauri webview. */
export async function ask(
  message: string,
  opts: AskOptions = {},
): Promise<boolean> {
  const plugin = await loadPlugin("ask");
  if (!plugin) return false;
  return plugin.ask(message, {
    title: opts.title,
    kind: opts.kind,
    okLabel: opts.okLabel,
    cancelLabel: opts.cancelLabel,
  });
}

/** Show a native message dialog with a single Ok button. Resolves when the
 *  dialog is dismissed — or (gracefully) immediately as a no-op when running
 *  outside a Tauri webview. */
export async function message(
  message: string,
  opts: MessageOptions = {},
): Promise<void> {
  const plugin = await loadPlugin("message");
  if (!plugin) return;
  await plugin.message(message, { title: opts.title, kind: opts.kind });
}
