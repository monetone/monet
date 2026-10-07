// ─────────────────────────────────────────────────────────────
// monet-adapter — map Rythme's Project ⇆ the universal Monet CONTAINER
// (@monet-ui/monet-format), so a Rythme session interchanges with every Monet
// app. Rythme's entries are `timeline.json` (role "time") and `audio/*` (role
// "audio"); everything else in the container is another app's and is couriered.
//
// Time is seconds (sequence timeBase = "seconds"). Rythme has no media library —
// clips carry their own PCM — so each unique AudioData buffer becomes a real
// `audio/<id>.wav` entry (32-bit float, lossless) referenced by a `media` record
// via `source.path`, and clips reference that by `mediaId` (shared buffers
// de-dup). Rythme's per-clip/-track audio payload rides in the namespaced
// `data.rythme` bag; the timing backbone (start/duration/inPoint=offset) is
// shared. A frames-based timeline (e.g. a Cinema project) cross-opens by
// converting to seconds on load.
//
// COURIER: Rythme owns `data.rythme` and its own entries, nothing else. Every
// foreign `data.<app>` namespace, the media entries Rythme cannot rebuild, the
// other sequences, the unowned sequence settings, any unknown forward-compat key
// AND every container entry Rythme did not consume (plus unknown manifest
// fields) ride along as opaque `foreign` cargo and are re-emitted verbatim on
// save — so a Cinema document keeps its transform/color/effects, and a Vision
// document keeps its pixels, through a Rythme round-trip.
// ─────────────────────────────────────────────────────────────

import {
  type DataBag,
  type MonetClip,
  type MonetContainer,
  type MonetDocument,
  type MonetFile,
  type MonetMarker,
  type MonetMedia,
  type MonetSequence,
  type MonetTrack,
  convertSequenceTimeBase,
  createContainer,
  createFile,
  entriesByRole,
  getData,
  getEntry,
  parse,
  removeEntry,
  serialize,
  setEntry,
} from "@monet-ui/monet-format";
import type { AudioData } from "../audio/types";
import { durationSeconds } from "../audio/types";
import { defaultAudioHardwareSettings, emptyProject, normalizeEditorPreferences, normalizePanelPreferences } from "../model/factory";
import type {
  AudioHardwareSettings,
  AutomationMode,
  AudioRole,
  AutomationLane,
  Bus,
  Clip,
  EditorPreferences,
  EffectRack,
  FavoriteEffectChain,
  FadeShape,
  ForeignPayload,
  Marker,
  MarkerKind,
  NativePluginManager,
  PanelPreferences,
  Project,
  ProjectMeta,
  Send,
  SurroundPan,
  Track,
  TrackInputAssignment,
  VideoAsset,
  VideoClip,
  VideoTrack,
} from "../model/types";
import { decodeAudio, sniffFormat } from "./import";
import { encodeWav } from "./wav";

const APP = { name: "monet-rythme" as const, version: "0.1.0" };
/** Our data-bag namespace — the only key in any `data` bag Rythme may rewrite. */
const NS = "rythme";
/** The sequence id Rythme writes when it authored the document itself. */
const DEFAULT_SEQ_ID = "seq_main";
/** Rythme's manifest kind, and the two entry roles it owns. */
const KIND = "time";
const TIME_ROLE = "time";
const AUDIO_ROLE = "audio";
/** Where Rythme writes its timeline + PCM. `audio/` is also the ownership test
 *  on read: an audio entry outside it belongs to another app and is couriered. */
const TIMELINE_PATH = "timeline.json";
const AUDIO_DIR = "audio/";
/** Reserved key inside `Project.foreign`: the container Rythme opened, minus the
 *  entries it consumed. Stripped before the document is written (it is cargo for
 *  the container level, not a document field). */
const CONTAINER_CARGO = "container";

interface RythmeClipData {
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  fadeInShape: FadeShape;
  fadeOutShape: FadeShape;
  groupId?: string;
  muted?: boolean;
  locked?: boolean;
  looped?: boolean;
  effectRack?: EffectRack;
  automation?: AutomationLane[];
  automationMode?: AutomationMode;
}
interface RythmeTrackData {
  color: string;
  gainDb: number;
  pan: number;
  surroundPan?: SurroundPan;
  audioRole?: AudioRole;
  input?: TrackInputAssignment;
  mute: boolean;
  solo: boolean;
  recordArm: boolean;
  height: number;
  effectRack?: EffectRack;
  automation?: AutomationLane[];
  automationMode?: AutomationMode;
  sends?: Send[];
  outputId?: string;
}
interface RythmeVideoAssetData {
  sourceName?: string;
  mimeType?: string;
  frameRate?: number;
}
interface RythmeVideoTrackData {
  color?: string;
  height?: number;
  visible?: boolean;
}
interface RythmeVideoClipData {
  locked?: boolean;
}
interface RythmeDocumentData {
  meta?: ProjectMeta;
  channelCount?: number;
  videoFrameRate?: number;
  buses?: Bus[];
  masterEffectRack?: EffectRack;
  masterAutomation?: AutomationLane[];
  masterAutomationMode?: AutomationMode;
  audioHardware?: AudioHardwareSettings;
  editorPreferences?: EditorPreferences;
  panelPreferences?: PanelPreferences;
  nativePluginManager?: NativePluginManager;
  favoriteEffectChains?: FavoriteEffectChain[];
}
/** Rythme's PCM entries, keyed by container path. The side channel between the
 *  document mapping (which only names paths) and the container. */
export type AudioEntries = Map<string, AudioData>;

/** Document-level cargo: the source document's unowned fields, plus `seq` — the
 *  clip-stripped shell of the one sequence Rythme edits — plus the couriered
 *  container. */
type DocumentForeign = Partial<MonetDocument> & {
  seq?: Partial<MonetSequence>;
  [CONTAINER_CARGO]?: MonetContainer;
};

// ── Courier plumbing ──────────────────────────────────────────
// ponytail: these helpers are duplicated in every app's adapter (see
// apps/anime/src/io/monet-adapter.ts). Hoist them into @monet-ui/monet-format
// once a fourth app needs them — they are ~10 lines and the package is shared.

/** Everything in a `data` bag except our namespace — i.e. other apps' payload. */
function foreignData(data: DataBag | undefined): DataBag | undefined {
  if (!data) return undefined;
  const { [NS]: _mine, ...rest } = data;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Park unowned fields + foreign namespaces as cargo; `undefined` if nothing to carry. */
function cargo(unowned: ForeignPayload, foreign: DataBag | undefined): ForeignPayload | undefined {
  const out: ForeignPayload = { ...unowned, ...(foreign ? { data: foreign } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Merge our namespace back into a carried `data` bag. */
function withData(src: { data?: DataBag }, mine: unknown): DataBag {
  return { ...(src.data ?? {}), [NS]: mine };
}

/** The active sequence stripped to what Rythme cannot rebuild from its model:
 *  a non-default id, other apps' settings, and unknown fields. */
function seqShell(seq: MonetSequence): Partial<MonetSequence> | undefined {
  const { id, name: _n, timeBase: _tb, tracks: _t, markers: _mk, settings, ...unknownFields } = seq;
  const { sampleRate: _sr, tempo: _tp, timeSignature: _ts, masterGainDb: _mg, ...foreignSettings } = settings ?? {};
  const shell: Partial<MonetSequence> = {
    ...unknownFields,
    ...(id !== DEFAULT_SEQ_ID ? { id } : {}),
    ...(Object.keys(foreignSettings).length > 0 ? { settings: foreignSettings } : {}),
  };
  return Object.keys(shell).length > 0 ? shell : undefined;
}

// ── Project ⇆ container ───────────────────────────────────────

/** A shallow copy deep enough that `setEntry`/`removeEntry` cannot reach back
 *  into the caller's container (entry BYTES stay shared — nobody mutates them). */
function cloneContainer(c: MonetContainer): MonetContainer {
  return {
    manifest: { ...c.manifest, entries: c.manifest.entries.map((e) => ({ ...e })) },
    entries: c.entries.map((e) => ({ ...e })),
  };
}

/** The carried container, or `undefined` when there is nothing left to courier —
 *  so a Rythme-authored session keeps a cargo-free model. */
function leftover(c: MonetContainer): MonetContainer | undefined {
  const { format: _f, schemaVersion: _v, app: _a, kind, entries: _e, ...unknownFields } = c.manifest;
  return c.entries.length > 0 || Object.keys(unknownFields).length > 0 || kind !== KIND ? c : undefined;
}

/** Save: rewrite Rythme's own entries, courier every other one (rule 2). */
export function toContainer(p: Project): MonetContainer {
  const carried = (p.foreign as DocumentForeign | undefined)?.[CONTAINER_CARGO];
  // `app` says who wrote it LAST; `kind` describes the primary payload, which a
  // cross-opened document still has — a Vision container Rythme re-saves is
  // still "graphics" with a timeline added.
  const container = carried ? cloneContainer(carried) : createContainer(APP, KIND);
  container.manifest.app = APP;

  const audio: AudioEntries = new Map();
  const file = toMonet(p, audio);
  setEntry(container, TIMELINE_PATH, TIME_ROLE, new TextEncoder().encode(serialize(file)));
  for (const [path, buffer] of audio) {
    setEntry(container, path, AUDIO_ROLE, encodeWav(buffer, { bitDepth: 32, float: true }));
  }
  return container;
}

/** Open ANY Monet container: load the timeline + Rythme's own PCM, courier the
 *  rest, and name what was ignored so the caller can say so out loud (rule 1). */
export function fromContainer(c: MonetContainer): { project: Project; ignored: string[] } {
  const carried = cloneContainer(c);
  // Dispatch on the manifest ROLE, never the path: another app's timeline may
  // live anywhere. Rythme always re-emits it at `timeline.json`.
  const timeline = entriesByRole(c, TIME_ROLE)[0];
  const file = timeline ? parse(new TextDecoder().decode(timeline.data)) : undefined;

  const audio: AudioEntries = new Map();
  for (const m of file?.document.media ?? []) {
    const path = m.source.path;
    if (m.kind !== "audio" || !path?.startsWith(AUDIO_DIR)) continue;
    const bytes = getEntry(c, path);
    // An entry we cannot decode stays foreign cargo — the clip keeps its link
    // and lands in `ignored` instead of being silently emptied.
    if (bytes && sniffFormat(bytes) !== "unknown") audio.set(path, decodeAudio(bytes, path));
  }

  // No timeline at all is not an error: a Vision/Galerie container opens as an
  // empty session that still couriers every entry it brought with it.
  const project = file ? fromMonet(file, audio) : emptyProject("Untitled", 0);

  if (timeline) removeEntry(carried, timeline.path);
  for (const path of audio.keys()) removeEntry(carried, path);
  const cargo = leftover(carried);
  if (cargo) project.foreign = { ...(project.foreign ?? {}), [CONTAINER_CARGO]: cargo };

  return { project, ignored: carried.manifest.entries.map((e) => e.path) };
}

// ── Project → MonetFile ───────────────────────────────────────
export function toMonet(p: Project, audio?: AudioEntries): MonetFile {
  const { seq: seqSrc = {}, [CONTAINER_CARGO]: _container, ...docSrc } = (p.foreign ?? {}) as DocumentForeign;
  // Media another app owns (referenced audio, stills…) leads the bin, verbatim.
  const media: MonetMedia[] = [...(docSrc.media ?? [])];
  const taken = new Set(media.map((m) => m.id));

  for (const asset of p.videoAssets ?? []) {
    const src = (asset.foreign ?? {}) as Partial<MonetMedia>;
    const data: RythmeVideoAssetData = {
      sourceName: asset.sourceName,
      mimeType: asset.mimeType,
      frameRate: asset.frameRate,
    };
    media.push({
      ...src,
      id: asset.id,
      name: asset.name,
      kind: "video",
      source: { ...(src.source ?? {}), path: asset.sourcePath ?? asset.sourceName ?? asset.name },
      duration: asset.duration != null ? { seconds: asset.duration } : undefined,
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
      data: withData(src, data),
    });
    taken.add(asset.id);
  }

  const idForBuffer = new Map<AudioData, string>();
  const mediaIdFor = (buf: AudioData, name: string): string => {
    const existing = idForBuffer.get(buf);
    if (existing) return existing;
    let n = media.length + 1;
    while (taken.has(`rmedia_${n}`)) n += 1; // never shadow a carried foreign id
    const id = `rmedia_${n}`;
    idForBuffer.set(buf, id);
    taken.add(id);
    const path = `${AUDIO_DIR}${id}.wav`;
    // A channel-less buffer has no WAV to write; the media record still names the
    // path so the clip keeps a link, and the reader falls back to silence.
    if (buf.channels.length > 0) audio?.set(path, buf);
    media.push({ id, name, kind: "audio", source: { path }, duration: { seconds: durationSeconds(buf) }, hasAudio: true });
    return id;
  };

  const seq: MonetSequence = {
    ...seqSrc,
    id: seqSrc.id ?? DEFAULT_SEQ_ID,
    name: p.name,
    timeBase: { kind: "seconds" },
    settings: {
      ...(seqSrc.settings ?? {}), // width/height/background belong to Cinema
      sampleRate: p.sampleRate,
      tempo: p.tempo,
      timeSignature: p.timeSignature,
      masterGainDb: p.masterGainDb,
    },
    tracks: [
      ...(p.videoTracks ?? []).map((t): MonetTrack => {
        const src = (t.foreign ?? {}) as Partial<MonetTrack>;
        const data: RythmeVideoTrackData = { color: t.color, height: t.height, visible: t.visible };
        return {
          ...src,
          id: t.id,
          kind: "video",
          name: t.name,
          enabled: t.visible !== false,
          locked: t.locked ?? false,
          clips: t.clips.map((c): MonetClip => {
            const csrc = (c.foreign ?? {}) as Partial<MonetClip>;
            const cd: RythmeVideoClipData = { locked: c.locked };
            return {
              ...csrc,
              id: c.id,
              mediaId: c.assetId,
              name: c.name,
              start: c.start,
              duration: c.duration,
              inPoint: c.inPoint,
              speed: c.speed,
              enabled: c.enabled,
              data: withData(csrc, cd),
            };
          }),
          data: withData(src, data),
        };
      }),
      ...p.tracks.map((t): MonetTrack => {
      const src = (t.foreign ?? {}) as Partial<MonetTrack>;
      const data: RythmeTrackData = { color: t.color, gainDb: t.gainDb, pan: t.pan, surroundPan: t.surroundPan, audioRole: t.audioRole, input: t.input, mute: t.mute, solo: t.solo, recordArm: t.recordArm, height: t.height, effectRack: t.effectRack, automation: t.automation, automationMode: t.automationMode, sends: t.sends, outputId: t.outputId };
      return {
        ...src,
        id: t.id,
        kind: "audio",
        name: t.name,
        enabled: !t.mute,
        locked: src.locked ?? false,
        clips: t.clips.map((c): MonetClip => {
          const csrc = (c.foreign ?? {}) as Partial<MonetClip>;
          const cd: RythmeClipData = { gainDb: c.gainDb, fadeIn: c.fadeIn, fadeOut: c.fadeOut, fadeInShape: c.fadeInShape, fadeOutShape: c.fadeOutShape, effectRack: c.effectRack, automation: c.automation, automationMode: c.automationMode, ...(c.groupId ? { groupId: c.groupId } : {}), ...(c.muted ? { muted: true } : {}), ...(c.locked ? { locked: true } : {}), ...(c.looped ? { looped: true } : {}) };
          return {
            ...csrc,
            id: c.id,
            // A cross-opened clip has no PCM of ours; keep pointing at the media
            // entry it came with instead of minting an empty embed beside it.
            mediaId: c.buffer.channels.length === 0 && csrc.mediaId != null ? csrc.mediaId : mediaIdFor(c.buffer, c.name),
            name: c.name,
            start: c.start,
            duration: c.duration,
            inPoint: c.inPoint,
            speed: c.speed,
            enabled: c.enabled,
            data: withData(csrc, cd),
          };
        }),
        data: withData(src, data),
      };
    }),
    ],
    markers: p.markers.map((m): MonetMarker => {
      const src = (m.foreign ?? {}) as Partial<MonetMarker>;
      return { ...src, time: m.time, end: m.end ?? null, name: m.name, color: m.color, data: withData(src, { id: m.id, kind: m.kind }) };
    }),
  };

  const doc: MonetDocument = {
    ...docSrc, // unknown document fields, verbatim
    id: p.id,
    name: p.name,
    defaults: { ...(docSrc.defaults ?? {}), sampleRate: p.sampleRate },
    media,
    // ponytail: the edited sequence leads; carried siblings keep their relative
    // order but not their original index. Store the index if a Cinema user ever
    // notices their sequence order shuffling after a Rythme round-trip.
    sequences: [seq, ...(docSrc.sequences ?? [])],
    activeSequenceId: seq.id,
    data: withData(docSrc, {
      meta: p.meta,
      channelCount: p.channelCount,
      videoFrameRate: p.videoFrameRate,
      buses: p.buses ?? [],
      masterEffectRack: p.masterEffectRack,
      masterAutomation: p.masterAutomation,
      masterAutomationMode: p.masterAutomationMode,
      audioHardware: p.audioHardware,
      editorPreferences: p.editorPreferences,
      panelPreferences: p.panelPreferences,
      nativePluginManager: p.nativePluginManager,
      favoriteEffectChains: p.favoriteEffectChains ?? [],
    }),
  };
  return createFile(doc, APP);
}

// ── MonetFile → Project ───────────────────────────────────────
export function fromMonet(file: MonetFile, audio?: AudioEntries): Project {
  const doc = file.document;
  const defSr = doc.defaults?.sampleRate ?? 48000;

  // Re-link the PCM entries the container handed us, by media id.
  const buffers = new Map<string, AudioData>();
  for (const m of doc.media) {
    const buffer = m.source.path ? audio?.get(m.source.path) : undefined;
    if (buffer) buffers.set(m.id, buffer);
  }

  // Rythme is a single timeline: take the active (or first) sequence, and
  // cross-open a frames-based one (e.g. Cinema) by converting to seconds.
  const rawSeq = doc.sequences.find((s) => s.id === doc.activeSequenceId) ?? doc.sequences[0];
  const seq = rawSeq && rawSeq.timeBase.kind === "frames" ? convertSequenceTimeBase(rawSeq, { kind: "seconds" }) : rawSeq;

  const settings = seq?.settings ?? {};
  const rythmeDoc = getData<RythmeDocumentData>(doc, NS);
  const meta = rythmeDoc.meta ?? { created: 0, modified: 0 };
  let markerN = 0;

  const videoAssets: VideoAsset[] = doc.media
    .filter((m) => m.kind === "video")
    .map((m): VideoAsset => {
      const data = getData<RythmeVideoAssetData>(m, NS);
      const { id: _i, name: _n, kind: _k, source: _s, duration: _du, width: _w, height: _h, hasAudio: _ha, data: bag, ...unowned } = m;
      return {
        id: m.id,
        name: m.name,
        sourceName: data.sourceName ?? pathName(m.source.path) ?? m.name,
        sourcePath: m.source.path ?? undefined,
        mimeType: data.mimeType,
        duration: monetDurationSeconds(m.duration),
        width: m.width,
        height: m.height,
        frameRate: data.frameRate ?? m.duration?.fps,
        hasAudio: m.hasAudio,
        foreign: cargo(unowned, foreignData(bag)),
      };
    });

  const videoTracks: VideoTrack[] = (seq?.tracks ?? [])
    .filter((t) => t.kind === "video")
    .map((t): VideoTrack => {
      const td = getData<RythmeVideoTrackData>(t, NS);
      const { id: _i, kind: _k, name: _n, enabled: _e, locked: _l, clips: _c, data: bag, ...unowned } = t;
      return {
        id: t.id,
        name: t.name ?? t.id,
        kind: "video",
        color: td.color ?? "oklch(0.72 0.14 75)",
        height: td.height ?? 64,
        visible: td.visible ?? t.enabled ?? true,
        locked: t.locked,
        foreign: cargo(unowned, foreignData(bag)),
        clips: t.clips.map((c): VideoClip => {
          const cd = getData<RythmeVideoClipData>(c, NS);
          return {
            id: c.id,
            trackId: t.id,
            assetId: c.mediaId ?? "",
            name: c.name ?? "",
            start: c.start,
            duration: c.duration,
            inPoint: c.inPoint,
            speed: c.speed,
            enabled: c.enabled,
            locked: cd.locked,
            foreign: clipCargo(c, false), // `assetId` already models the link
          };
        }),
      };
    });

  const tracks: Track[] = (seq?.tracks ?? [])
    .filter((t) => t.kind === "audio")
    .map((t): Track => {
      const td = getData<Partial<RythmeTrackData>>(t, NS);
      const { id: _i, kind: _k, name: _n, enabled: _e, locked: _l, clips: _c, data: bag, ...unowned } = t;
      return {
        id: t.id,
        name: t.name ?? t.id,
        kind: "audio",
        color: td.color ?? "var(--accent-audio)",
        gainDb: td.gainDb ?? 0,
        pan: td.pan ?? 0,
        surroundPan: td.surroundPan,
        audioRole: td.audioRole,
        input: td.input,
        mute: td.mute ?? false,
        solo: td.solo ?? false,
        recordArm: td.recordArm ?? false,
        height: td.height ?? 96,
        effectRack: td.effectRack,
        automation: td.automation ?? [],
        automationMode: td.automationMode,
        sends: td.sends ?? [],
        outputId: td.outputId,
        foreign: cargo({ ...unowned, ...(t.locked ? { locked: true } : {}) }, foreignData(bag)),
        clips: t.clips.map((c): Clip => {
          const cd = getData<Partial<RythmeClipData>>(c, NS);
          return {
            id: c.id,
            trackId: t.id,
            name: c.name ?? "",
            start: c.start,
            duration: c.duration,
            inPoint: c.inPoint,
            speed: c.speed,
            enabled: c.enabled,
            gainDb: cd.gainDb ?? 0,
            fadeIn: cd.fadeIn ?? 0,
            fadeOut: cd.fadeOut ?? 0,
            fadeInShape: cd.fadeInShape ?? "equalPower",
            fadeOutShape: cd.fadeOutShape ?? "equalPower",
            groupId: cd.groupId,
            muted: cd.muted,
            locked: cd.locked,
            looped: cd.looped,
            effectRack: cd.effectRack,
            automation: cd.automation ?? [],
            automationMode: cd.automationMode,
            buffer: buffers.get(c.mediaId ?? "") ?? { sampleRate: defSr, channels: [] },
            foreign: clipCargo(c, !buffers.has(c.mediaId ?? "")),
          };
        }),
      };
    });

  const markers: Marker[] = (seq?.markers ?? []).map((mk): Marker => {
    const rd = getData<{ id?: string; kind?: MarkerKind }>(mk, NS);
    const { time: _t, end: _e, name: _n, color: _c, data: bag, ...unowned } = mk;
    return {
      id: rd.id ?? `mk_${(markerN += 1)}`,
      time: mk.time,
      end: mk.end ?? undefined,
      name: mk.name ?? "",
      color: mk.color ?? "var(--accent-audio)",
      kind: rd.kind ?? (mk.end != null ? "region" : "cue"),
      foreign: cargo(unowned, foreignData(bag)),
    };
  });

  // Document cargo: everything Rythme cannot rebuild from the model above.
  const { id: _di, name: _dn, defaults, media: _dm, sequences: _ds, activeSequenceId: _da, data: docBag, ...docUnowned } = doc;
  const { sampleRate: _sr, ...foreignDefaults } = defaults ?? {};
  const carriedMedia = doc.media.filter((m) => m.kind !== "video" && !buffers.has(m.id));
  const otherSequences = doc.sequences.filter((s) => s.id !== seq?.id);
  const shell = seq ? seqShell(seq) : undefined;

  return {
    id: doc.id ?? "project",
    name: doc.name,
    sampleRate: settings.sampleRate ?? defSr,
    channelCount: rythmeDoc.channelCount ?? 2,
    tempo: settings.tempo ?? 120,
    timeSignature: settings.timeSignature ?? [4, 4],
    videoFrameRate: rythmeDoc.videoFrameRate ?? doc.defaults?.fps ?? 24,
    masterGainDb: settings.masterGainDb ?? 0,
    masterEffectRack: rythmeDoc.masterEffectRack,
    masterAutomation: rythmeDoc.masterAutomation ?? [],
    masterAutomationMode: rythmeDoc.masterAutomationMode,
    audioHardware: { ...defaultAudioHardwareSettings(settings.sampleRate ?? defSr), ...(rythmeDoc.audioHardware ?? {}) },
    editorPreferences: normalizeEditorPreferences(rythmeDoc.editorPreferences, settings.sampleRate ?? defSr),
    panelPreferences: normalizePanelPreferences(rythmeDoc.panelPreferences, settings.sampleRate ?? defSr),
    nativePluginManager: rythmeDoc.nativePluginManager ?? { plugins: [] },
    videoAssets,
    videoTracks,
    tracks,
    buses: rythmeDoc.buses ?? [],
    favoriteEffectChains: rythmeDoc.favoriteEffectChains ?? [],
    markers,
    meta,
    foreign: cargo(
      {
        ...docUnowned,
        ...(Object.keys(foreignDefaults).length > 0 ? { defaults: foreignDefaults } : {}),
        ...(carriedMedia.length > 0 ? { media: carriedMedia } : {}),
        ...(otherSequences.length > 0 ? { sequences: otherSequences } : {}),
        ...(shell ? { seq: shell } : {}),
      },
      foreignData(docBag),
    ),
  };
}

/** A clip's unowned fields + foreign namespaces. `mediaId` only rides along when
 *  the model cannot rebuild it — i.e. a cross-opened clip whose PCM Rythme never
 *  embedded — so the link survives instead of being replaced by an empty embed. */
function clipCargo(c: MonetClip, keepMediaId: boolean): ForeignPayload | undefined {
  const { id: _i, name: _n, start: _s, duration: _d, inPoint: _ip, speed: _sp, enabled: _e, mediaId, data, ...unowned } = c;
  return cargo({ ...unowned, ...(keepMediaId && mediaId != null ? { mediaId } : {}) }, foreignData(data));
}

function monetDurationSeconds(duration: MonetMedia["duration"]): number | undefined {
  if (!duration) return undefined;
  if (duration.seconds != null) return duration.seconds;
  if (duration.frames != null && duration.fps) return duration.frames / duration.fps;
  return undefined;
}

function pathName(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.split(/[\\/]/).pop() || undefined;
}
