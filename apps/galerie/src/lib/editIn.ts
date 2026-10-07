// editIn — Lightroom's "Edit in <external editor>", pointed at Monet Vision.
//
// Every piece of this already existed and was tested; nothing ran them in
// sequence, so "Edit in Vision" was unreachable. The sequence is LR's:
//
//   1. render the master at its develop recipe into a NEW derivative beside it
//   2. write the shared Camera Raw sidecar (monet-photo/xmp) next to the
//      derivative, so the recipe + catalog metadata travel with the pixels
//   3. hand the derivative to Vision (it takes file paths on argv / open-file)
//   4. import the derivative and stack it under its master, so the round trip
//      lands IN the catalog instead of beside it on disk
//
// A failed launch never loses the render: steps 1/2/4 still stand and the
// failure is reported, rather than silently leaving an orphan file on disk.

import { invoke } from "@tauri-apps/api/core";
import { exists, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { serializeCameraRawXmp, xmpSidecarPath } from "@monet-ui/monet-photo";

import { getRecipe, listPhotoKeywords, listStack, stackPhotos } from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { exportBytes, type ExportOptions } from "../export";
import { importPathsWithIds } from "../import";
import { exportKeywords, exportVocab } from "./xmpAutoWrite";

/** The app the derivative is handed to. Matches Vision's `productName`, which is
 *  what the native side's allow-list and `open -a` both key on. */
export const VISION_APP = "Monet Vision";

/** Full-resolution, lossless, 8-bit RGBA. PNG (not 16-bit TIFF) because the
 *  native 16-bit route is RAW-only and refuses crops/masks — a derivative that
 *  silently dropped the crop would be worse than 8 bits.
 *  ponytail: bump to 16-bit TIFF once the native route honors crop + masks. */
const DERIVATIVE: ExportOptions = {
  format: "png",
  quality: 1,
  longEdge: null,
  metadata: { include: "all", removeLocation: false },
};

const stemOf = (path: string): string => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) : path;
};

/** LR's derivative naming: `<stem>-Edit.png`, then `-Edit-2`, `-Edit-3`… The
 *  first name whose image AND sidecar are both free wins, so a second trip
 *  through Vision never overwrites the first one's edits. */
export async function freeDerivativePath(
  masterPath: string,
  taken: (path: string) => Promise<boolean> = exists,
): Promise<string> {
  const stem = stemOf(masterPath);
  for (let n = 1; n <= 999; n++) {
    const path = `${stem}-Edit${n === 1 ? "" : `-${n}`}.png`;
    if (!(await taken(path)) && !(await taken(xmpSidecarPath(path)))) return path;
  }
  throw new Error(`no free "-Edit" name beside ${masterPath}`);
}

/** The derivative's sidecar: the master's develop recipe + catalog metadata in
 *  the one shared Camera Raw dialect, so Vision reads exactly what Galerie
 *  rendered. Exported for tests. */
export async function derivativeXmp(master: PhotoRow): Promise<string> {
  const [recipeJson, kws, vocab] = await Promise.all([
    getRecipe(master.id),
    listPhotoKeywords(master.id),
    exportVocab(),
  ]);
  // Same per-keyword export flags Export and auto-write honour — a keyword
  // marked "don't include on export" must not leak through Edit In either.
  const { flat: keywords, hierarchical } = exportKeywords(kws, vocab);
  return serializeCameraRawXmp({
    recipe: recipeJson ? JSON.parse(recipeJson) : undefined,
    metadata: {
      rating: master.rating,
      label: master.colorLabel,
      title: master.title,
      caption: master.caption,
      creator: master.creator,
      copyright: master.copyright,
      city: master.city,
      stateProvince: master.stateProvince,
      country: master.country,
      jobTitle: master.jobTitle,
      credit: master.credit,
      source: master.source,
      keywords,
      hierarchical,
    },
  });
}

export interface EditInResult {
  /** The derivative written beside the master. */
  path: string;
  /** Its catalog id, or null when the import produced nothing. */
  photoId: number | null;
  /** The stack the derivative joined, or null when it wasn't stacked. */
  stackId: number | null;
  /** Non-null when Vision couldn't be launched — the derivative is cataloged
   *  regardless, so the user can open it by hand. */
  launchError: string | null;
}

/** Render `master` to a derivative, hand it to Vision, and stack it under the
 *  master. Throws only when the render/sidecar write fails (nothing has been
 *  cataloged yet at that point); a launch failure is reported in the result. */
export async function editInVision(master: PhotoRow): Promise<EditInResult> {
  const path = await freeDerivativePath(master.path);
  await writeFile(path, await exportBytes(master, DERIVATIVE));
  await writeTextFile(xmpSidecarPath(path), await derivativeXmp(master));

  let launchError: string | null = null;
  try {
    await invoke("plugin:catalog|catalog_open_in_app", { app: VISION_APP, path });
  } catch (e) {
    launchError = String(e);
  }

  // The user asked for this file explicitly — never let the duplicate heuristic
  // decide it isn't worth cataloging.
  const [photoId = null] = await importPathsWithIds([path], { skipDuplicates: false });
  const stackId = photoId == null ? null : await stackUnderMaster(master, photoId);
  return { path, photoId, stackId, launchError };
}

/** Stack the derivative under its master. `stackPhotos` regroups from scratch,
 *  so an already-stacked master is re-stacked WITH its existing members (cover
 *  first) rather than being torn out of the stack it was in. */
async function stackUnderMaster(master: PhotoRow, photoId: number): Promise<number> {
  const members = master.stackId == null ? [master.id] : (await listStack(master.stackId)).map((p) => p.id);
  return stackPhotos([...members, photoId]);
}
