// ─────────────────────────────────────────────────────────────
// cinema.ts — Cinema project (de)serialization. The document is the universal
// `.monet` JSON (@monet-ui/monet-format); the FILE is the universal container
// (docs/plans/11-universal-container.md), a `.mcin` whose `timeline.json` entry
// (role `time`) holds that JSON. The Project ⇆ document mapping lives in
// monet-adapter.ts; these are the stable entry points the app + tests use.
//
// Dispatch is on the MANIFEST, never the extension: any Monet container with a
// `time` entry opens here (a Rythme `.mryt`, or a `.mcin` renamed `.mvis`), its
// sequences converted to a frames timeBase on the way in.
//
// COURIER (design doc 11 rule 2): `projectFromContainer` hands back the WHOLE
// container and `projectToContainer` writes it back, replacing only our own
// entry — so another app's media, previews and unknown manifest fields survive
// a Cinema round trip byte-for-byte.
// ─────────────────────────────────────────────────────────────

import {
  createContainer,
  entriesByRole,
  parse,
  readContainer,
  serialize,
  setEntry,
  writeContainer,
  type MonetContainer,
} from "@monet-ui/monet-format";
import type { Project } from "../model/types";
import { CINEMA_APP, fromMonet, toMonet } from "./monet-adapter";

/** Cinema's entry in the container, and the only role it reads or writes. */
const TIMELINE_PATH = "timeline.json";
const TIMELINE_ROLE = "time";

/** Serialize a Cinema project to universal `.monet` JSON. */
export function projectToJson(project: Project): string {
  return serialize(toMonet(project));
}

/** Parse a `.monet` document into a Cinema project (cross-open aware). */
export function projectFromJson(json: string): Project {
  return fromMonet(parse(json));
}

/** What a container gave us — plus everything it gave us that we don't read. */
export interface OpenedContainer {
  /** `null` when there is no `time` entry (e.g. a Vision `.mvis`): not an error. */
  project: Project | null;
  /** The raw `timeline.json` text — the media relink pass reads PCM embeds from it. */
  json: string | null;
  /** The whole container, kept so the next save couriers what we didn't consume. */
  container: MonetContainer;
  /** Entry paths Cinema does not understand. Report them; never drop them. */
  ignored: string[];
  /** Who wrote the container last, for that report. */
  app: string;
}

/** Open any Monet container: load the `time` entry, keep the rest. Throws if the
 *  bytes are not a container at all. */
export function projectFromContainer(bytes: Uint8Array): OpenedContainer {
  const container = readContainer(bytes);
  const timeline = entriesByRole(container, TIMELINE_ROLE)[0];
  const json = timeline ? new TextDecoder().decode(timeline.data) : null;
  return {
    project: json === null ? null : projectFromJson(json),
    json,
    container,
    ignored: container.manifest.entries.filter((e) => e.path !== timeline?.path).map((e) => e.path),
    app: container.manifest.app.name,
  };
}

/**
 * Write the project as a container. Pass the container it was opened from and
 * every entry Cinema didn't consume rides along unchanged (rule 2).
 *
 * ponytail: Cinema keeps media by path, so it writes no `media/*` entries of its
 * own — it only couriers other apps'. Pack them here when Cinema learns to embed.
 */
export function projectToContainer(project: Project, source?: MonetContainer): Uint8Array {
  const container = source ?? createContainer(CINEMA_APP, "time");
  // Write back to the path we read from: a foreign time document may name its
  // entry something else, and a second `time` entry would leave a stale one first.
  const path = entriesByRole(container, TIMELINE_ROLE)[0]?.path ?? TIMELINE_PATH;
  container.manifest.app = CINEMA_APP; // we wrote it last; `kind` stays the author's
  setEntry(container, path, TIMELINE_ROLE, new TextEncoder().encode(projectToJson(project)));
  return writeContainer(container);
}
