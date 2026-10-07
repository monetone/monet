// ─────────────────────────────────────────────────────────────
// engine/io/project — the project Save/Open path, on the universal Monet
// CONTAINER (@monet-ui/monet-format) shared by every Monet app.
// ─────────────────────────────────────────────────────────────
// Rythme saves `.mryt`: a v1 container holding `timeline.json` (role "time")
// and its PCM as real `audio/*.wav` entries. It OPENS any Monet container
// whatever the extension — dispatch is on the manifest, never the file name.
// The Project ⇆ container mapping lives in monet-adapter.ts.
// WAV/AIFF remain import/export-only audio formats.

import { readContainer, writeContainer } from "@monet-ui/monet-format";
import type { Project } from "../model/types";
import { fromContainer, toContainer } from "./monet-adapter";

/** Serialise a project to `.mryt` container bytes. */
export function serializeProject(p: Project): Uint8Array {
  return writeContainer(toContainer(p));
}

/** Read any Monet container: the project Rythme understood, plus the paths of
 *  the entries it did not — which the caller must report VISIBLY (rule 1).
 *  Throws on anything that is not a Monet container. */
export function readProject(bytes: Uint8Array): { project: Project; ignored: string[] } {
  return fromContainer(readContainer(bytes));
}

/** Read a container back into a Project, discarding the ignored-entry report. */
export function deserializeProject(bytes: Uint8Array): Project {
  return readProject(bytes).project;
}
