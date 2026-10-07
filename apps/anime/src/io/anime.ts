// ─────────────────────────────────────────────────────────────
// io/anime — the Anime project ⇄ the universal Monet container (`.mani`).
//
// Anime owns exactly ONE entry: `timeline.json`, role `"time"`, holding the
// same `.monet` document the adapter has always produced. Everything else in
// the container — another app's `graphics.json`, its `pixels/*`, `media/*`, a
// database, unknown manifest fields — is carried through byte-for-byte
// (docs/plans/11-universal-container.md rule 2), so a Cinema or Vision file
// survives an Anime save instead of being quietly emptied.
//
// Dispatch is on the manifest's ROLE, never the file's extension: a `.mcin`
// renamed `.mvis` opens here exactly the same.
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
import { createComposition } from "../model/factory";
import type { AnimeProject } from "../model/types";
import { fromMonet, toMonet } from "./monet-adapter";

const APP = { name: "monet-anime", version: "0.1.0" } as const;

/** Anime's entry, and the role every time-based app dispatches on. */
const TIMELINE_PATH = "timeline.json";
const TIMELINE_ROLE = "time";

/** The timeline entry's body: the `.monet` document the adapter produces. */
function projectToJson(project: AnimeProject): string {
  return serialize(toMonet(project));
}

function projectFromJson(json: string): AnimeProject {
  return fromMonet(parse(json));
}

export interface OpenedContainer {
  project: AnimeProject;
  /** The container it came from — hand it back to `projectToContainer` to courier. */
  container: MonetContainer;
  /** False when the container holds no `time` entry (e.g. a Vision `.mvis`). */
  hasTimeline: boolean;
  /** Entry paths Anime did not consume. Rule 1: report these visibly. */
  ignored: string[];
}

/** The entry Anime writes into: the container's existing `time` entry if it has
 *  one (so a foreign layout isn't duplicated), else our own `timeline.json`. */
function timelinePath(container: MonetContainer): string {
  return entriesByRole(container, TIMELINE_ROLE)[0]?.path ?? TIMELINE_PATH;
}

/**
 * Read any Monet container. A container with no `time` entry is NOT an error —
 * it is a document with nothing for Anime to show, and its entries still ride
 * along on the next save.
 */
export function projectFromContainer(bytes: Uint8Array): OpenedContainer {
  const container = readContainer(bytes);
  const timeline = entriesByRole(container, TIMELINE_ROLE)[0];
  const ignored = container.manifest.entries.map((e) => e.path).filter((p) => p !== timeline?.path);
  const empty = createComposition("Comp 1");
  return {
    project: timeline
      ? projectFromJson(new TextDecoder().decode(timeline.data))
      : { name: "Untitled", compositions: [empty], activeCompId: empty.id },
    container,
    hasTimeline: timeline !== undefined,
    ignored,
  };
}

/** A fresh, empty Anime container — what a never-saved project writes into. */
export function newContainer(): MonetContainer {
  return createContainer(APP, "time");
}

/**
 * Write `container`, with Anime's timeline swapped in. Every entry Anime never
 * read — plus the manifest's unknown fields — is re-emitted unchanged; only the
 * `time` entry and `app` (who wrote it last) are replaced. `kind` is
 * deliberately left alone: adding a timeline to a graphics document does not
 * make graphics stop being its primary payload.
 *
 * `container` is updated in place, so the caller's cached copy stays the exact
 * thing on disk and the next save couriers from it again.
 *
 * ponytail: image layers stay inline data URLs inside `timeline.json`, so Anime
 * writes no `images/*` entries yet. Split them out when a document gets big
 * enough that the base64 tax on every save is measurable.
 */
export function projectToContainer(project: AnimeProject, container: MonetContainer): Uint8Array {
  container.manifest.app = { ...APP };
  setEntry(container, timelinePath(container), TIMELINE_ROLE, new TextEncoder().encode(projectToJson(project)));
  return writeContainer(container);
}
