// ─────────────────────────────────────────────────────────────
// state/app — the app-wide ArtisanStore singleton
// ─────────────────────────────────────────────────────────────
// One store instance shared by the React tree (passed to <EditorProvider>) and
// by non-React drivers like the MCP bridge (src/mcp), so automation and the UI
// operate on the very same document. Mirrors Monet Vision's `state/app` store
// singleton convention.

import { ask, installQuitGuard, isTauri } from "@monet-ui/monet-react";
import { ArtisanStore } from "../engine";

export const store = new ArtisanStore();

/** Refuse any action that would replace an edited document unless the user
 *  explicitly accepts losing those changes. */
export async function confirmDiscard(s: ArtisanStore): Promise<boolean> {
  if (!s.getState().dirty) return true;
  const text = `“${s.doc.name}” has unsaved changes. Discard them?`;
  if (isTauri()) return ask(text, { title: "Unsaved Changes", kind: "warning" });
  return typeof globalThis.confirm === "function" ? globalThis.confirm(text) : false;
}

/** Guard both Tauri window close / quit and browser tab close. */
export async function installUnsavedWorkGuard(s: ArtisanStore = store): Promise<void> {
  if (!isTauri()) {
    window.addEventListener("beforeunload", (event) => {
      if (s.getState().dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    return;
  }
  try {
    const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      if (!s.getState().dirty) return;
      event.preventDefault();
      if (await confirmDiscard(s)) await win.destroy();
    });
    await installQuitGuard(() => confirmDiscard(s));
  } catch (error) {
    console.warn("unsaved-work guard unavailable", error);
  }
}
