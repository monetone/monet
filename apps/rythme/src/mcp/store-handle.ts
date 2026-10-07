// Monet Rythme — MCP store handle.
//
// Rythme's commands take the live `RythmeStore` as their first argument, but the
// store is created inside React (EditorProvider), not as a module singleton like
// Vision's `state/app`. The MCP bridge runs outside React, so it needs a stable
// reference to the same store the UI drives. EditorProvider registers the store
// here on mount (see state/store-context); the @mcp wrappers read it back.
//
// This is a process-local module variable — NOT a `window` global — so it stays
// out of the page's global namespace and is tree-shaken from the web bundle when
// the MCP entry point is never imported.

import type { RythmeStore } from "../engine";

let active: RythmeStore | null = null;

/** Register the live store so the MCP wrappers can reach it (called once by EditorProvider). */
export function setMcpStore(store: RythmeStore): void {
  active = store;
}

/** The live store the UI is driving. Throws if the app hasn't booted yet. */
export function getMcpStore(): RythmeStore {
  if (!active) throw new Error("MCP store not ready: the Rythme editor has not booted yet");
  return active;
}
