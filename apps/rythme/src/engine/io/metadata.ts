// ─────────────────────────────────────────────────────────────
// engine/io/metadata — shared audio metadata shape
// ─────────────────────────────────────────────────────────────

import type { ProjectMeta } from "../model/types";

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  comment?: string;
  description?: string;
  copyright?: string;
  date?: string;
  software?: string;
  keywords?: string;
}

export function projectMetaToAudioMetadata(meta: ProjectMeta, fallbackTitle?: string): AudioMetadata {
  return compactMetadata({
    title: meta.title ?? fallbackTitle,
    artist: meta.artist ?? meta.author,
    album: meta.album,
    genre: meta.genre,
    comment: meta.comment,
    description: meta.description,
    copyright: meta.copyright,
    keywords: meta.keywords,
    date: meta.created ? new Date(meta.created).toISOString() : undefined,
    software: "Monet Rythme",
  });
}

export function compactMetadata(meta: AudioMetadata): AudioMetadata {
  const out: AudioMetadata = {};
  for (const [key, value] of Object.entries(meta) as [keyof AudioMetadata, string | undefined][]) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}
