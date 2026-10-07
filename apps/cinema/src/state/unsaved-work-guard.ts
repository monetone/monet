// ─────────────────────────────────────────────────────────────
// state/unsaved-work-guard — keep ⌘Q / window close from eating unsaved work
// ─────────────────────────────────────────────────────────────
// #506: the shared macOS menu's predefined Quit called NSApp terminate:, which
// no webview close handler can veto — quitting discarded an unsaved project,
// and closing the window did too (no guard existed here at all). The shared
// Monet guard (@monet-ui/monet-react) owns the native hooks — window
// onCloseRequested, the quit handshake behind the custom Quit item /
// applicationShouldTerminate, and the browser's beforeunload; this module only
// maps Cinema's store onto it.

import { installUnsavedWorkGuard as installSharedGuard } from "@monet-ui/monet-react";
import type { Store } from "./store";

/** Prompt before closing the window or quitting while the project is dirty. */
export async function installUnsavedWorkGuard(store: Store): Promise<void> {
  return installSharedGuard({
    dirtyNames: () => (store.state.dirty ? [store.state.project.name] : []),
  });
}
