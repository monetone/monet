// autoImport — Lightroom's File ▸ Auto Import: watch one folder (and its
// subfolders) and import new files as they appear, moving them to the
// configured Destination with the configured File Naming and Apply During
// Import settings. The fs watcher only signals "something changed" — each
// debounced burst RESCANS the folder and diffs it against the catalog
// (planFolderSync), so missed or duplicated events cannot corrupt anything,
// and the suspected-duplicate fingerprint probe is the safety net beneath that.

import { isTauri } from "@tauri-apps/api/core";
import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";

import { listMetadataPresets, listPresets, listSourcePaths } from "./catalog/catalog";
import { IMPORT_EXTENSIONS, importWithOptions, listImportableFiles } from "./import";
import type { ImportApply } from "./import";
import { planFolderSync } from "./lib/folderSync";
import { autoImportDestDir, loadWatchedFolder, type WatchedFolder } from "./lib/watchedFolder";
import type { ImportPlanOptions } from "./lib/importPlan";

let stop: UnwatchFn | null = null;
let scanning = false;

/** The setting's Destination + File Naming as an import plan. No destination
 *  keeps the legacy "add in place" behaviour; a destination means MOVE, as in
 *  Lightroom — the watched folder is a drop box, not a library. */
export function autoImportPlan(setting: WatchedFolder): ImportPlanOptions {
  const destDir = autoImportDestDir(setting);
  return {
    handling: destDir ? "move" : "add",
    destDir,
    rename: setting.rename,
    template: setting.template,
    startNumber: setting.startNumber,
  };
}

/** The setting's Information + Initial Previews section. Preset ids resolve
 *  against the live catalog, so a preset deleted since the dialog was saved
 *  simply doesn't apply rather than failing the import. */
async function autoImportApply(setting: WatchedFolder): Promise<ImportApply> {
  const wantsPreset = setting.developPresetId != null || setting.metadataPresetId != null;
  const [devs, metas] = wantsPreset
    ? await Promise.all([
        listPresets().catch(() => []),
        listMetadataPresets().catch(() => []),
      ])
    : [[], []];
  return {
    keywords: setting.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    metadataPreset: metas.find((p) => p.id === setting.metadataPresetId) ?? null,
    developPreset: devs.find((p) => p.id === setting.developPresetId) ?? null,
    previewTier: setting.previewTier,
  };
}

async function scanAndImport(setting: WatchedFolder): Promise<void> {
  const dir = setting.path;
  if (!dir) return;
  if (scanning) return; // a concurrent burst rides the in-flight scan's follow-up event
  scanning = true;
  try {
    const cataloged = (await listSourcePaths()).map((s) => s.path);
    // Recursive, like LR: a card dumped as a folder tree into the watched
    // folder imports whole rather than being ignored below the top level.
    const files = await listImportableFiles(dir, true);
    const fresh = planFolderSync(cataloged, [{ dir, files }], new Set(IMPORT_EXTENSIONS));
    // ponytail: a file whose move fails (destination occupied) stays in the
    // watched folder and is retried every burst — same as LR. Persisting a
    // failed-path set would stop the retry loop if it ever gets noisy.
    if (fresh.length) {
      await importWithOptions(fresh, autoImportPlan(setting), await autoImportApply(setting));
    }
  } catch (e) {
    console.error("galerie auto-import scan failed", dir, e);
  } finally {
    scanning = false;
  }
}

/** (Re)start the watcher per the stored setting; stops any previous watcher.
 *  Runs one catch-up scan first so files that arrived while the app (or the
 *  setting) was off still import. */
export async function restartAutoImport(): Promise<void> {
  stop?.();
  stop = null;
  if (!isTauri()) return;
  const cfg = loadWatchedFolder();
  if (!cfg.enabled || !cfg.path) return;
  const dir = cfg.path;
  try {
    await scanAndImport(cfg);
    stop = await watch(dir, () => void scanAndImport(cfg), { delayMs: 1500, recursive: true });
  } catch (e) {
    console.error("galerie auto-import watch failed", dir, e);
  }
}
