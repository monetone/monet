// ─────────────────────────────────────────────────────────────
// app.ts — the app singletons. UI, commands and the Phaser runtime import
// `store` and `useStore` from here. Editing verbs live in commands.ts; this
// module stays dependency-light and free of cycles.
// ─────────────────────────────────────────────────────────────

import { startCollab } from "../collab";
import { Store, makeUseStore } from "./store";

export const store = new Store();
export const useStore = makeUseStore(store);

/** Real-time collaboration session (null unless ?room= / VITE_COLLAB=1). */
export const collab = startCollab(store);
