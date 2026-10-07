// ─────────────────────────────────────────────────────────────
// app.ts — the app singletons. UI and command modules import `engine`,
// `store` and `useStore` from here. Editing actions live in commands.ts and
// the playback runtime in playback/ (both import these singletons), so this
// module stays dependency-light and free of cycles.
// ─────────────────────────────────────────────────────────────

import { startCollab } from "../collab";
import { EngineClient } from "../engine/EngineClient";
import { Store, makeUseStore } from "./store";

export const engine = new EngineClient();
export const store = new Store();
export const useStore = makeUseStore(store);

/** Real-time collaboration session (null unless ?room= / VITE_COLLAB=1). */
export const collab = startCollab(store);
