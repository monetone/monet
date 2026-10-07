// ─────────────────────────────────────────────────────────────
// resolve.ts — relink an opened project's media back to real bytes. A `.monet`
// carries only a source path (or, from Rythme, embedded PCM); the runtime
// handles (blob URL + hidden element) live outside the document and have to be
// rebuilt on every open. Two sources, in priority order:
//   1. an embedded Rythme PCM payload → decoded to WAV (media/embed.ts)
//   2. `media.path` re-read from disk (native only)
// Anything we cannot resolve is reported, not silently left blank.
// ─────────────────────────────────────────────────────────────

import { isTauri } from "@tauri-apps/api/core";
import { store } from "../state/app";
import type { MediaItem, Project } from "../timeline/model/types";
import { pcmEmbedToWav, pcmEmbedsFromJson, type PcmEmbed } from "./embed";
import { attachHandle, mimeFor } from "./import";
import type { ProbeKind } from "./probe";
import { clearHandles } from "./registry";

export interface RelinkResult {
  relinked: MediaItem[];
  /** Media whose bytes could not be found — offline in the bin. */
  missing: MediaItem[];
}

async function sourceUrl(m: MediaItem, embed: PcmEmbed | undefined): Promise<string | null> {
  if (embed) {
    return URL.createObjectURL(new Blob([pcmEmbedToWav(embed) as BlobPart], { type: "audio/wav" }));
  }
  // A browser-imported item only ever stored a bare filename; nothing to re-read.
  if (!m.path || !isTauri()) return null;
  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(m.path);
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFor(m.name || m.path) }));
  } catch (e) {
    console.error("Relink failed for", m.path, e);
    return null;
  }
}

/**
 * Rebuild runtime media handles for `project` after a load. `json` is the raw
 * `.monet` text it came from, used to recover Rythme's embedded PCM.
 * Call it AFTER the project is in the store — it mutates `ready` in place and
 * repaints via `bump()`, so relinking never lands on the undo stack.
 */
export async function relinkProjectMedia(project: Project, json?: string): Promise<RelinkResult> {
  clearHandles(); // the outgoing project's blob URLs
  const embeds = json ? pcmEmbedsFromJson(json) : new Map<string, PcmEmbed>();
  const relinked: MediaItem[] = [];
  const missing: MediaItem[] = [];

  for (const m of project.media) {
    if (m.kind === "color") continue; // generated source — no bytes to find
    const url = await sourceUrl(m, embeds.get(m.id));
    if (!url) {
      m.ready = false;
      missing.push(m);
      continue;
    }
    attachHandle(m, url, m.kind as ProbeKind, m.hasAudio);
    m.ready = true;
    relinked.push(m);
  }

  store.bump();
  if (missing.length > 0) {
    // ponytail: Cinema has no toast surface yet — console is the loud channel we
    // have. Route this through a notification store once one exists.
    console.error(
      `Cinema: ${missing.length} media item(s) could not be relinked and will not play:`,
      missing.map((m) => m.path || m.name),
    );
  }
  return { relinked, missing };
}
