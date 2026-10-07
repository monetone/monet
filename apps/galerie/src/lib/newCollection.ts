// newCollection — File ▸ "New Collection…". The create form is CollectionsPanel's
// local state and unreachable from the menu bar, so the menu takes the same
// route "Save Quick Collection as…" already takes: prompt, create, browse it.
//
// ponytail: window.prompt like FoldersPanel/SnapshotsPanel — collections only.
// Point it at the panel's inline form if the menu ever needs sets or smart
// collections (those need a parent picker / rule builder).

import { PREVIOUS_IMPORT_NAME, store } from "../state/store";
import { QUICK_COLLECTION_NAME } from "./quickCollection";

export async function newCollectionFromMenu(): Promise<void> {
  const name = window.prompt("Collection name", "")?.trim();
  if (!name) return;
  // Same reserved names the panel's create form refuses (both are sentinels).
  if (name === QUICK_COLLECTION_NAME || name === PREVIOUS_IMPORT_NAME) {
    store.notify(`"${name}" is a reserved name`);
    return;
  }
  const id = await store.createCollection(name);
  if (id == null) return;
  store.setModule("grid");
  await store.setActiveCollection(id);
}
