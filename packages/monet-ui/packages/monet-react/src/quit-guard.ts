// ──────────────────────────────────────────────────────────────────────────
//  Shared quit guard — one unsaved-work check for every way an app can exit.
//
//  On macOS the predefined Quit menu item called NSApp terminate:, which tao
//  answers with applicationWillTerminate only: no window ever saw a
//  CloseRequested, so ⌘Q / App menu ▸ Quit / Dock ▸ Quit / logout discarded
//  unsaved work in every Monet app (#506). This module routes all of those
//  through the app's dirty-work check and exits for real only once it approves.
//
//  Rust half (kept in sync by hand — see crates/monet-ui):
//    • event   "monet://quit-requested"  — the OS asked the app to terminate
//    • command "monet_quit_guard_ready"  — webview announces its listener exists
//    • command "monet_quit_exit"         — approved: release NSTerminateLater as
//                                           NSTerminateNow and terminate
//    • command "monet_quit_cancel"       — declined: release NSTerminateLater as
//                                           NSTerminateCancel and stay alive
//  The native side answers applicationShouldTerminate with NSTerminateLater, so
//  a declined quit MUST send monet_quit_cancel to release it; the command is a
//  no-op on Rust when no native termination is pending.
// ──────────────────────────────────────────────────────────────────────────
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Native event the Rust side emits when the OS asks the app to terminate. */
export const QUIT_REQUESTED_EVENT = "monet://quit-requested";

/** Build the unsaved-changes prompt. One document reads differently from many;
 *  four or more are abbreviated to the first three plus an ellipsis. */
function unsavedMessage(names: string[], verb: "quit" | "close"): string {
  const action = verb === "close" ? "Close" : "Quit";
  if (names.length === 1) return `“${names[0]}” has unsaved changes. ${action} without saving?`;
  const shown = names.length <= 3 ? names : names.slice(0, 3);
  const list = shown.map((n) => `“${n}”`).join(", ") + (names.length > 3 ? ", …" : "");
  return `${names.length} documents (${list}) have unsaved changes. ${action} without saving?`;
}

/** Ask the user to confirm discarding unsaved work. Native `ask` under Tauri,
 *  `window.confirm` in a plain browser. Resolves true when discarding is OK. */
export async function confirmDiscardUnsaved(
  names: string[],
  verb: "quit" | "close" = "quit",
): Promise<boolean> {
  const message = unsavedMessage(names, verb);
  if (!isTauri()) return window.confirm(message);
  return ask(message);
}

// ── installed guard + re-entrancy ───────────────────────────────────────────
let guard: (() => boolean | Promise<boolean>) | null = null;
/** The in-flight quit decision. While it is pending, further quit requests
 *  (⌘Q again, a second Dock Quit) join it instead of re-prompting. */
let pending: Promise<void> | null = null;

async function runGuard(): Promise<void> {
  if (pending) return pending;
  if (!guard) {
    await invoke("monet_quit_exit");
    return;
  }
  pending = (async () => {
    try {
      const approved = await guard!();
      await invoke(approved ? "monet_quit_exit" : "monet_quit_cancel");
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Run the installed guard and exit or stay accordingly. With no guard
 *  installed, exit directly. No-op outside Tauri. */
export async function requestAppQuit(): Promise<void> {
  if (!isTauri()) return;
  await runGuard();
}

/** Install the app's unsaved-work guard and announce it to the native side.
 *  The listener is registered BEFORE `monet_quit_guard_ready` so Rust can never
 *  route a quit to a webview that is not yet listening. Inert outside Tauri. */
export async function installQuitGuard(g: () => boolean | Promise<boolean>): Promise<void> {
  guard = g;
  if (!isTauri()) return;
  // Return the promise so an awaiting caller (the tests) can observe the
  // decision; the native event path ignores it.
  await listen(QUIT_REQUESTED_EVENT, () => runGuard());
  await invoke("monet_quit_guard_ready");
}

/** Options for {@link installUnsavedWorkGuard}. */
export interface UnsavedWorkGuardOptions {
  /** Names of the documents with unsaved changes (empty when clean). */
  dirtyNames: () => string[];
}

/** Wire the shared close + quit check into an app: a dirty window close is
 *  gated on the prompt, and every native quit path shares the same check.
 *  `verb` is the wording for the quit prompt (default "quit"). */
export async function installUnsavedWorkGuard(
  opts: UnsavedWorkGuardOptions,
  verb: "quit" | "close" = "quit",
): Promise<void> {
  const { dirtyNames } = opts;
  if (isTauri()) {
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      const names = dirtyNames();
      if (!names.length) return; // clean: let the window close
      event.preventDefault();
      if (await confirmDiscardUnsaved(names, "close")) await win.destroy();
    });
    await installQuitGuard(async () => {
      const names = dirtyNames();
      return names.length ? confirmDiscardUnsaved(names, verb) : true;
    });
    return;
  }
  window.addEventListener("beforeunload", (event) => {
    if (dirtyNames().length) event.preventDefault();
  });
}
