// afterExport — Lightroom's Post-Processing ▸ "After Export" menu: the one
// action that runs once an export batch has finished writing.
//
// Both primitives already existed on the native side — `catalog_reveal_path`
// ("Show in Finder") and `catalog_open_in_app` ("Edit in <Monet app>") — but
// nothing ran either of them after an export, so a finished export was a pile of
// files the user had to go find in the OS by hand.

import { invoke } from "@tauri-apps/api/core";

import { revealPath } from "../catalog/catalog";

/** Stored in ExportConfig, so a preset carries its own post-processing.
 *  "" (or absent) is LR's "Do Nothing". */
export type AfterExportAction = "" | "showInFinder" | `openIn:${string}`;

const OPEN_IN = "openIn:";

/** Mirrors `MONET_APPS` in src-tauri/src/catalog.rs. That allow-list is the
 *  trust boundary for `catalog_open_in_app`, so offering an app outside it here
 *  would only ever produce a rejection.
 *
 *  ponytail: LR's "Open in Other Application" and its Export Actions droplets
 *  both need to launch an arbitrary binary — which is exactly what the
 *  allow-list exists to prevent. They land together with a real Export Actions
 *  folder and an OS file-pick that carries the user's consent, not by widening
 *  this array. */
export const AFTER_EXPORT_APPS = [
  "Monet Vision",
  "Monet Artisan",
  "Monet Cinema",
  "Monet Jouer",
  "Monet Rythme",
  "Monet Anime",
] as const;

/** The After Export menu, in LR's order: Do Nothing, then reveal, then editors. */
export const AFTER_EXPORT_OPTS: { value: AfterExportAction; label: string }[] = [
  { value: "", label: "Do Nothing" },
  { value: "showInFinder", label: "Show in Finder" },
  ...AFTER_EXPORT_APPS.map((app) => ({ value: `${OPEN_IN}${app}` as AfterExportAction, label: `Open in ${app}` })),
];

/** Run `action` over the files the batch wrote (`dir` is the fallback when it
 *  wrote none — the folder still exists and is still worth revealing).
 *
 *  Returns a message to show the user, or null when there is nothing to say.
 *  Never throws: the export itself already succeeded, and post-processing
 *  failing must not read as a failed export. */
export async function runAfterExport(
  action: AfterExportAction | undefined,
  dir: string,
  paths: string[],
): Promise<string | null> {
  if (!action) return null;
  try {
    if (action === "showInFinder") {
      // LR selects the exported files; the folder is the fallback when the batch
      // wrote nothing (everything skipped or failed).
      await revealPath(paths[0] ?? dir);
      return null;
    }
    // The action comes back out of a preset in localStorage — validate it rather
    // than forwarding an arbitrary string to a process launcher.
    if (!action.startsWith(OPEN_IN)) return `Unknown After Export action: ${action}`;
    const app = action.slice(OPEN_IN.length);
    if (!(AFTER_EXPORT_APPS as readonly string[]).includes(app)) return `${app} is not a Monet app.`;
    if (paths.length === 0) return `Nothing was exported to open in ${app}.`;
    // One call per file: `open -a` reuses the running instance, and every Monet
    // app opens documents from argv / the OS open-file event.
    for (const path of paths) {
      await invoke("plugin:catalog|catalog_open_in_app", { app, path });
    }
    return null;
  } catch (e) {
    return `After Export failed: ${String(e)}`;
  }
}
