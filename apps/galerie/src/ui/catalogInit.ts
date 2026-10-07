// catalogInit — open the default catalog on app start. v1 uses a single
// implicit catalog under the app-data dir; multi-catalog open/create/switch is
// Phase 1 UI. In the browser (no Tauri) this marks the catalog unavailable so
// the grid shows its degraded empty state instead of throwing.

import { catalogAvailable } from "../catalog/catalog";
import { store } from "../state/store";
import { invoke } from "@tauri-apps/api/core";

const CATALOG_FILE = "default.galcat";

export async function openDefaultCatalog(): Promise<void> {
  if (!catalogAvailable()) {
    await store.open("(browser)");
    return;
  }
  const proof = await invoke<{ catalogPath: string } | null>(
    "plugin:secondary|secondary_proof_config",
  );
  if (proof) {
    await store.open(proof.catalogPath);
    return;
  }
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const path = await join(await appDataDir(), CATALOG_FILE);
  await store.open(path);
}
