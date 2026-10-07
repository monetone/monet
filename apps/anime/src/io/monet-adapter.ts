// ─────────────────────────────────────────────────────────────
// io/monet-adapter — map the Anime project ⇄ the universal .monet document.
//
// Each Composition → a MonetSequence (seconds timeBase); each Layer → a MonetClip
// whose timing backbone (start/duration/enabled) is its in/out + visibility, and
// whose full Anime payload (kind/transform/keyframe tracks/effects/appearance)
// rides in the namespaced `data.anime` bag. Per-composition fps lives in the
// document's `data.anime.comps` map (the sequence schema has no fps slot when the
// timeBase is seconds), so a save→open round-trip is lossless.
//
// COURIER: Anime owns `data.anime` and nothing else. Every foreign `data.<app>`
// namespace, the media library, the source track layout and any unknown
// (forward-compat) field rides along on the model as opaque `foreign` cargo and
// is re-emitted verbatim on save, so a Cinema/Rythme document survives an Anime
// round-trip. A frames sequence (Cinema) converts to seconds once, on read.
// ─────────────────────────────────────────────────────────────

import {
  MonetFormatError,
  convertSequenceTimeBase,
  createFile,
  getData,
  type DataBag,
  type MonetClip,
  type MonetDocument,
  type MonetFile,
  type MonetSequence,
  type MonetTrack,
} from "@monet-ui/monet-format";
import { makeTransform } from "../model/factory";
import type {
  AnimeProject,
  BlendMode,
  Composition,
  ForeignPayload,
  Layer,
  LayerKind,
  ShapeKind,
} from "../model/types";

const APP = { name: "monet-anime", version: "0.1.0" };
/** Our data-bag namespace — the only key in any `data` bag Anime may rewrite. */
const NS = "anime";

type AnimeLayerData = Omit<Layer, "id" | "name" | "inPoint" | "outPoint" | "visible" | "trackId" | "foreign">;
interface AnimeCompMeta {
  fps: number;
}

/** The track Anime writes its own (or a foreign doc's homeless) layers into. */
const ownTrackId = (compId: string): string => `${compId}_layers`;

/** Everything in a `data` bag except our namespace — i.e. other apps' payload. */
function foreignData(data: DataBag | undefined): DataBag | undefined {
  if (!data) return undefined;
  const { [NS]: _mine, ...rest } = data;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Drop absent optionals — JSON has no `undefined`, and serializing them as
 *  `null` would make a reopen→resave differ from the file it came from. */
function dropUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Park unowned fields + foreign namespaces as cargo; `undefined` if nothing to carry. */
function cargo(unowned: ForeignPayload, foreign: DataBag | undefined): ForeignPayload | undefined {
  const out: ForeignPayload = { ...unowned, ...(foreign ? { data: foreign } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

// ── Layer ⇄ Clip ──────────────────────────────────────────────
function layerToClip(layer: Layer): MonetClip {
  const { id, name, inPoint, outPoint, visible, trackId: _t, foreign, ...rest } = layer;
  const src = (foreign ?? {}) as Partial<MonetClip>;
  return {
    ...src, // mediaId + any unknown field of the source clip, verbatim
    id,
    start: inPoint,
    duration: Math.max(0.001, outPoint - inPoint),
    inPoint: src.inPoint ?? 0, // clip-source trim — Anime has no UI for it, but carries it
    speed: src.speed ?? 1,
    enabled: visible,
    name,
    data: { ...(src.data ?? {}), [NS]: dropUndefined(rest as AnimeLayerData) },
  };
}

function clipToLayer(clip: MonetClip, trackId: string): Layer {
  const d = getData<Partial<AnimeLayerData>>(clip, NS);
  const { id: _i, start: _s, duration: _d, enabled: _e, name: _n, data, ...unowned } = clip;
  const width = d.width ?? 300;
  const height = d.height ?? 300;
  return {
    id: clip.id,
    name: clip.name ?? "Layer",
    kind: (d.kind as LayerKind) ?? "solid",
    visible: clip.enabled ?? true,
    locked: d.locked ?? false,
    solo: d.solo ?? false,
    inPoint: clip.start,
    outPoint: clip.start + clip.duration,
    blendMode: (d.blendMode as BlendMode) ?? "normal",
    transform: d.transform ?? makeTransform(0, 0, width / 2, height / 2),
    tracks: d.tracks ?? [],
    effects: d.effects ?? [],
    color: d.color ?? "#888888",
    width,
    height,
    shape: d.shape as ShapeKind | undefined,
    text: d.text,
    fontSize: d.fontSize,
    fontFamily: d.fontFamily,
    align: d.align,
    src: d.src,
    trackId,
    foreign: cargo(unowned, foreignData(data)),
  };
}

// ── Composition ⇄ Sequence ────────────────────────────────────
function compToSequence(comp: Composition): MonetSequence {
  const src = (comp.foreign ?? {}) as Partial<MonetSequence>;
  // Put every layer back in the track it came from, so a multi-track source
  // (Cinema video + audio lanes) keeps its layout instead of collapsing.
  const shells = src.tracks ?? [];
  const byTrack = new Map<string, MonetClip[]>(shells.map((t) => [t.id, []]));
  const own: MonetClip[] = [];
  for (const layer of comp.layers) {
    const clip = layerToClip(layer);
    const bucket = layer.trackId != null ? byTrack.get(layer.trackId) : undefined;
    (bucket ?? own).push(clip);
  }
  const tracks: MonetTrack[] = shells.map((t) => ({ ...t, clips: byTrack.get(t.id) ?? [] }));
  if (own.length > 0 || tracks.length === 0) {
    tracks.push({ id: ownTrackId(comp.id), kind: "video", name: "Layers", clips: own });
  }
  return {
    ...src, // markers + unknown sequence fields, verbatim
    id: comp.id,
    name: comp.name,
    timeBase: { kind: "seconds" },
    settings: {
      ...(src.settings ?? {}), // sampleRate/tempo/… belong to other apps
      width: comp.width,
      height: comp.height,
      duration: comp.duration,
      background: comp.background,
    },
    tracks,
  };
}

function sequenceToComp(raw: MonetSequence, fallbackFps: number): Composition {
  // Cross-open: Anime is a seconds app, so a frames sequence converts once here.
  const fps = raw.timeBase.kind === "frames" ? raw.timeBase.fps : fallbackFps;
  const seq = raw.timeBase.kind === "frames" ? convertSequenceTimeBase(raw, { kind: "seconds" }) : raw;
  // ponytail: every track flattens into one z-ordered layer stack (Anime has no
  // lanes). Track identity survives via layer.trackId; give Anime real lanes if
  // per-lane mute/lock ever needs to round-trip.
  const layers: Layer[] = seq.tracks.flatMap((t) => t.clips.map((c) => clipToLayer(c, t.id)));
  const { id: _i, name: _n, timeBase: _tb, settings, tracks, ...unowned } = seq;
  return {
    id: seq.id,
    name: seq.name ?? "Comp",
    width: settings?.width ?? 1920,
    height: settings?.height ?? 1080,
    fps,
    duration: settings?.duration ?? 6,
    background: settings?.background ?? "#0b0b10",
    layers,
    // Clip-stripped track shells keep kind/name/enabled/locked/data.<app>.
    foreign: {
      ...unowned,
      ...(settings ? { settings } : {}),
      tracks: tracks.map((t) => ({ ...t, clips: [] })),
    },
  };
}

// ── Project ⇄ File ────────────────────────────────────────────
export function toMonet(project: AnimeProject): MonetFile {
  const src = (project.foreign ?? {}) as Partial<MonetDocument>;
  const comps: Record<string, AnimeCompMeta> = {};
  for (const c of project.compositions) comps[c.id] = { fps: c.fps };
  const doc: MonetDocument = {
    ...src, // id, media, foreign document fields
    name: project.name,
    defaults: { ...(src.defaults ?? {}), fps: project.compositions[0]?.fps ?? 30 },
    media: src.media ?? [],
    sequences: project.compositions.map(compToSequence),
    activeSequenceId: project.activeCompId,
    data: { ...(src.data ?? {}), [NS]: { comps } },
  };
  return createFile(doc, APP);
}

export function fromMonet(file: MonetFile): AnimeProject {
  const doc = file.document;
  // Fail loudly: a document with nothing to open as a composition would land as
  // a blank "Untitled" project — indistinguishable from silent data loss.
  if (doc.sequences.length === 0) {
    throw new MonetFormatError("this .monet file has no sequences to open as a composition");
  }
  const meta = getData<{ comps?: Record<string, AnimeCompMeta> }>(doc, NS);
  const compositions = doc.sequences.map((seq) =>
    sequenceToComp(seq, meta.comps?.[seq.id]?.fps ?? doc.defaults?.fps ?? 30),
  );
  const { name: _n, sequences: _s, activeSequenceId: _a, data, ...unowned } = doc;
  return {
    name: doc.name,
    compositions,
    activeCompId: doc.activeSequenceId ?? compositions[0]?.id ?? "",
    foreign: cargo(unowned, foreignData(data)),
  };
}
