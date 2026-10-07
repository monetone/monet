// ─────────────────────────────────────────────────────────────
// ui/commands — high-level app commands (file · generate · effects)
// ─────────────────────────────────────────────────────────────
// Glue between the UI (menus, panels, shortcuts) and the engine store. File
// commands are async (they touch the file picker / downloads); generate and
// effect commands are synchronous store dispatches.

import * as E from "../engine";
import type { RythmeStore } from "../engine";
import { decodeBrowserAudio } from "../audio/decode";
import { message, openFile } from "@monet-ui/monet-react";
import { CONTAINER_APPS, isContainer } from "@monet-ui/monet-format";
import { downloadBytes, downloadText, pickFiles, saveBytes, type PickedFile } from "./io-web";
import { registerVideoPreviewUrl } from "./video-preview";
import { audioHardwareSettingsFromPreferences, loadAppPreferencesAsync, loadFileBehaviorPreferencesAsync, type AppPreferences, type FileBehaviorPreferences, type WorkspaceBehaviorPreferences } from "./app-preferences";

// ── file ──────────────────────────────────────────────────────────────────────

const VIDEO_ACCEPT = "video/*,.mp4,.mov,.m4v,.webm,.ogv,.avi,.mkv";
const AUDIO_ACCEPT = "audio/*,.wav,.aif,.aiff,.aifc,.mp3,.m4a,.aac,.flac,.ogg,.opus,.caf";
/** The same extension sets, for routing a drop (which carries no accept list). */
const AUDIO_RE = /\.(wav|aif|aiff|aifc|mp3|m4a|aac|flac|ogg|opus|caf)$/i;
/** Rythme opens EVERY Monet extension — dispatch is on the manifest, so the
 *  accept list is only a picker hint. Saving uses Rythme's own row. */
const SESSION_ACCEPT = CONTAINER_APPS.map((row) => row.ext).join(",");
const SESSION_EXT = ".mryt";

export async function newSession(store: RythmeStore): Promise<void> {
  const project = E.emptyProject("Untitled", 4);
  store.replaceProject(applyAppDefaults(project, await loadAppPreferencesAsync()), { markClean: true });
}

function applyAppDefaults(project: E.Project, preferences: AppPreferences): E.Project {
  return {
    ...applyWorkspaceDefaults(project, preferences.workspace),
    audioHardware: audioHardwareSettingsFromPreferences(preferences.audioHardware),
    panelPreferences: E.normalizePanelPreferences(preferences.panelDefaults, project.sampleRate),
  };
}

function applyWorkspaceDefaults(project: E.Project, preferences: WorkspaceBehaviorPreferences): E.Project {
  return {
    ...project,
    editorPreferences: {
      ...E.normalizeEditorPreferences(project.editorPreferences, project.sampleRate),
      activeWorkspaceId: preferences.defaultWorkspaceId,
      editorMode: preferences.defaultEditorMode,
      tool: preferences.defaultTool,
      snap: preferences.defaultSnap,
      displayTimeFormat: preferences.defaultDisplayTimeFormat,
    },
  };
}

export async function importAudio(store: RythmeStore): Promise<number> {
  return importAudioFiles(store, await pickFiles(AUDIO_ACCEPT));
}

/** Import already-read audio files (the picker's result, or an OS drop). */
export async function importAudioFiles(store: RythmeStore, files: PickedFile[]): Promise<number> {
  let added = 0;
  for (const f of files) {
    try {
      let buffer = await decodeImportedAudio(f.bytes, f.name);
      if (buffer.sampleRate !== store.getState().project.sampleRate) {
        buffer = E.resampleLinear(buffer, store.getState().project.sampleRate);
      }
      const before = store.getState().project.tracks.length;
      store.dispatch(E.addTrack({ name: f.name.replace(/\.[^.]+$/, "") }), { label: "Import" });
      const trackId = store.getState().project.tracks[before].id;
      store.dispatch(E.insertClip(trackId, buffer, 0, f.name), { label: "Import audio" });
      // bring across any embedded markers (WAV cue points / AIFF MARK) — the clip starts at 0
      const cues = embeddedAudioMarkers(f.bytes);
      if (cues.length) {
        store.dispatch((s) => {
          let st = s;
          for (const c of cues) st = E.addMarker({ time: c.time, name: c.name ?? "Marker" })(st);
          return st;
        }, { label: "Import markers" });
      }
      added++;
    } catch (err) {
      console.error("import failed", f.name, err);
    }
  }
  return added;
}

export async function importVideo(store: RythmeStore): Promise<number> {
  const files = await pickFiles(VIDEO_ACCEPT, true);
  let added = 0;
  for (const f of files) {
    const ref = await loadVideoFileReference(f, store.getState().project.videoFrameRate);
    const asset = E.newVideoAsset({
      name: ref.name,
      sourceName: ref.sourceName,
      mimeType: ref.mimeType,
      duration: ref.duration,
      width: ref.width,
      height: ref.height,
      frameRate: ref.frameRate,
      hasAudio: true,
    });
    registerVideoPreviewUrl(asset.id, ref.url);
    store.dispatch(E.addVideoReference(asset, { start: store.getState().transport.playhead, duration: ref.duration }), { label: "Import video" });
    added++;
  }
  return added;
}

export async function importVideoWithAudio(store: RythmeStore): Promise<number> {
  const files = await pickFiles(VIDEO_ACCEPT, true);
  let added = 0;
  for (const f of files) {
    const start = store.getState().transport.playhead;
    const ref = await loadVideoFileReference(f, store.getState().project.videoFrameRate);
    const asset = E.newVideoAsset({
      name: ref.name,
      sourceName: ref.sourceName,
      mimeType: ref.mimeType,
      duration: ref.duration,
      width: ref.width,
      height: ref.height,
      frameRate: ref.frameRate,
      hasAudio: true,
    });
    registerVideoPreviewUrl(asset.id, ref.url);
    try {
      let audio = await decodeBrowserAudio(f.bytes);
      if (audio.sampleRate !== store.getState().project.sampleRate) audio = E.resampleLinear(audio, store.getState().project.sampleRate);
      store.dispatch(
        E.addVideoReferenceWithExtractedAudio(asset, audio, {
          start,
          duration: ref.duration,
          audioTrackName: `${f.name.replace(/\.[^.]+$/, "")} Audio`,
          audioClipName: `${f.name} audio`,
        }),
        { label: "Import video + audio" },
      );
    } catch (err) {
      console.warn("video audio extraction failed", f.name, err);
      store.dispatch(E.addVideoReference(asset, { start, duration: ref.duration }), { label: "Import video" });
    }
    added++;
  }
  return added;
}

export async function relinkVideoMedia(store: RythmeStore, assetId?: string): Promise<boolean> {
  const target = videoRelinkTarget(store, assetId);
  if (!target) return false;
  const [file] = await pickFiles(VIDEO_ACCEPT, false);
  if (!file) return false;
  const ref = await loadVideoFileReference(file, target.frameRate ?? store.getState().project.videoFrameRate);
  registerVideoPreviewUrl(target.id, ref.url);
  store.dispatch(
    E.updateVideoAsset(target.id, {
      sourceName: ref.sourceName,
      mimeType: ref.mimeType,
      duration: ref.duration,
      width: ref.width,
      height: ref.height,
      frameRate: ref.frameRate,
      hasAudio: target.hasAudio ?? true,
    }),
    { label: "Relink video media" },
  );
  return true;
}

function videoRelinkTarget(store: RythmeStore, assetId?: string): E.VideoAsset | undefined {
  const s = store.getState();
  if (assetId) return E.videoAssetById(s.project, assetId);
  return E.activeVideoClipAt(s.project, s.transport.playhead)?.asset ?? s.project.videoAssets?.[0];
}

async function loadVideoFileReference(file: PickedFile, frameRate: number): Promise<Omit<E.VideoAsset, "id"> & { url: string }> {
  const mimeType = videoMimeType(file.name);
  const blob = new Blob([new Uint8Array(file.bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const meta = await loadVideoMetadata(url).catch(() => null);
  return {
    name: file.name,
    sourceName: file.name,
    mimeType,
    duration: meta?.duration,
    width: meta?.width,
    height: meta?.height,
    frameRate,
    hasAudio: true,
    url,
  };
}

function loadVideoMetadata(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
      resolve({ duration, width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => reject(new Error("video metadata unavailable"));
    video.src = url;
  });
}

function videoMimeType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ogv")) return "video/ogg";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "video/mp4";
}

async function decodeImportedAudio(bytes: Uint8Array, name: string): Promise<E.AudioData> {
  try {
    return E.IO.decodeAudio(bytes, name);
  } catch (err) {
    if (!isLikelyBrowserDecodable(name, bytes)) throw err;
    return decodeBrowserAudio(bytes);
  }
}

function embeddedAudioMarkers(bytes: Uint8Array): { time: number; name?: string }[] {
  const fmt = E.IO.sniffFormat(bytes);
  if (fmt === "wav") return E.IO.decodeWavCues(bytes);
  if (fmt === "aiff") return E.IO.decodeAiffMarks(bytes);
  return [];
}

function isLikelyBrowserDecodable(name: string, bytes: Uint8Array): boolean {
  const lower = name.toLowerCase();
  return (
    E.IO.sniffFormat(bytes) === "unknown" ||
    /\.(mp3|m4a|aac|flac|ogg|opus|caf|webm|mp4|mpeg|mpga)$/i.test(lower)
  );
}

export async function openProject(store: RythmeStore): Promise<boolean> {
  const files = await pickFiles(SESSION_ACCEPT, false);
  return files.length ? openProjectFile(store, files[0]) : false;
}

/** Replace the session from an already-read Monet container — any app's, any
 *  extension. What Rythme could not read is reported, not swallowed. */
export function openProjectFile(store: RythmeStore, file: PickedFile): boolean {
  try {
    const { project, ignored } = E.IO.readProject(file.bytes);
    store.replaceProject(project, { markClean: true });
    if (ignored.length) void reportIgnoredEntries(file.name, ignored);
    return true;
  } catch (err) {
    console.error("open project failed", file.name, err);
    return false;
  }
}

/** Rule 1: an entry Rythme does not handle is not an error, but staying silent
 *  about it is — the user must know it is there (and that saving keeps it). */
function reportIgnoredEntries(name: string, ignored: string[]): Promise<void> {
  return message(
    `Rythme opened “${name}” but does not handle ${ignored.length === 1 ? "1 part" : `${ignored.length} parts`} of it: ${ignored.join(", ")}. They are kept and written back when you save.`,
    { title: "Opened With Parts Ignored", kind: "warning" },
  );
}

/** Route an OS drop: a dropped session replaces the project, dropped audio
 *  imports as tracks. A drop that lands nothing says so — a silent no-op reads
 *  as "it worked", and the file is already gone from the user's cursor.
 *  ponytail: session wins over audio and only the first one opens; a drop mixing
 *  a session with loose audio is ambiguous, and asking is worse than picking. */
export async function openDroppedFiles(store: RythmeStore, files: PickedFile[]): Promise<number> {
  // Sniff the BYTES, not the name: a renamed container still opens.
  const session = files.find((f) => isContainer(f.bytes));
  if (session) {
    if (openProjectFile(store, session)) return 1;
    void reportDropRejected([session.name]);
    return 0;
  }
  const audio = files.filter((f) => AUDIO_RE.test(f.name));
  const added = audio.length ? await importAudioFiles(store, audio) : 0;
  if (!added && files.length) void reportDropRejected(files.map((f) => f.name));
  return added;
}

function reportDropRejected(names: string[]): Promise<void> {
  return message(`Rythme could not open ${names.map((n) => `“${n}”`).join(", ")}.`, {
    title: "Nothing Imported",
    kind: "error",
  });
}

/** Save the session. Only clears the dirty flag once the bytes actually landed —
 *  a cancelled native save dialog must not make an unsaved session look saved. */
export async function saveProject(store: RythmeStore): Promise<boolean> {
  const p = store.getState().project;
  if (!await saveBytes(`${p.name}${SESSION_EXT}`, E.IO.serializeProject(p), "application/zip")) return false;
  store.markClean();
  return true;
}

export function exportMixdown(store: RythmeStore, opts: { bitDepth?: 16 | 24 | 32; float?: boolean } = {}): void {
  const p = store.getState().project;
  const mix = E.Ops.renderProject(p);
  const bytes = E.IO.encodeWav(mix, {
    bitDepth: opts.bitDepth ?? 24,
    float: opts.float,
    markers: p.markers.map((m) => ({ time: m.time, name: m.name })), // embed markers as cue points
    metadata: E.IO.projectMetaToAudioMetadata(p.meta, p.name),
  });
  downloadBytes(`${p.name}.wav`, bytes, "audio/wav");
}

export function exportMixdownAiff(store: RythmeStore, opts: { bitDepth?: 16 | 24 | 32 } = {}): void {
  const p = store.getState().project;
  const mix = E.Ops.renderProject(p);
  const bytes = E.IO.encodeAiff(mix, {
    bitDepth: opts.bitDepth ?? 24,
    markers: p.markers.map((m) => ({ time: m.time, name: m.name })),
    metadata: E.IO.projectMetaToAudioMetadata(p.meta, p.name),
  });
  downloadBytes(`${p.name}.aiff`, bytes, "audio/aiff");
}

export async function exportDefaultMixdown(store: RythmeStore): Promise<void> {
  exportMixdownWithPreferences(store, await loadFileBehaviorPreferencesAsync());
}

export function exportMixdownWithPreferences(store: RythmeStore, preferences: FileBehaviorPreferences): void {
  if (preferences.exportFormat === "aiff") {
    exportMixdownAiff(store, { bitDepth: preferences.exportBitDepth });
    return;
  }
  exportMixdown(store, { bitDepth: preferences.exportBitDepth, float: preferences.exportFloat });
}

/** Export only the selected range as a WAV (Audition's Export ▸ File of a range); whole mix if none. */
export function exportRange(store: RythmeStore, opts: { bitDepth?: 16 | 24 | 32; float?: boolean } = {}): void {
  const s = store.getState();
  const range = s.selection.range;
  if (!range) {
    exportMixdown(store, opts);
    return;
  }
  const p = s.project;
  const audio = E.Ops.renderProjectRange(p, range.start, range.end);
  const bytes = E.IO.encodeWav(audio, {
    bitDepth: opts.bitDepth ?? 24,
    float: opts.float,
    markers: E.IO.markersInRange(p.markers, range.start, range.end), // in-range markers, re-based
    metadata: E.IO.projectMetaToAudioMetadata(p.meta, p.name),
  });
  downloadBytes(`${p.name}-range.wav`, bytes, "audio/wav");
}

export function premiereXml(store: RythmeStore, opts: E.IO.PremiereInterchangeOptions = {}): string {
  return E.IO.exportPremiereXml(store.getState().project, opts);
}

export function premiereEdl(store: RythmeStore, opts: E.IO.PremiereInterchangeOptions = {}): string {
  return E.IO.exportPremiereEdl(store.getState().project, opts);
}

/** Export the session timeline as Final Cut Pro 7 XML for Premiere import. */
export function exportPremiereXml(store: RythmeStore, opts: E.IO.PremiereInterchangeOptions = {}): void {
  const p = store.getState().project;
  downloadText(`${p.name}-premiere.xml`, premiereXml(store, opts), "application/xml");
}

/** Export the session timeline as a CMX-style EDL for Premiere import. */
export function exportPremiereEdl(store: RythmeStore, opts: E.IO.PremiereInterchangeOptions = {}): void {
  const p = store.getState().project;
  downloadText(`${p.name}.edl`, premiereEdl(store, opts), "application/edl");
}

export type BatchExportScopeId = "tracks" | "regions" | "clips";

export interface BatchExportCommandOptions extends E.Ops.BatchExportEncodeOptions {
  trackIds?: string[];
  markerIds?: string[];
  clipIds?: string[];
}

export type BatchProcessPresetId = "normalizeLimit" | "podcastLoudness" | "trimThreeDb";

export interface BatchProcessPreset {
  id: BatchProcessPresetId;
  label: string;
  processing: E.Ops.BatchProcessStep[];
}

export const BATCH_PROCESS_PRESETS: BatchProcessPreset[] = [
  {
    id: "normalizeLimit",
    label: "Normalize Peak + Limit",
    processing: [
      { kind: "normalizePeak", targetDb: -1 },
      { kind: "hardLimiter", ceilingDb: -1, lookAheadMs: 5 },
    ],
  },
  {
    id: "podcastLoudness",
    label: "Podcast Loudness (-16 LUFS)",
    processing: [{ kind: "matchLoudness", targetLufs: -16, peakCeilingDb: -1 }],
  },
  {
    id: "trimThreeDb",
    label: "Trim -3 dB",
    processing: [{ kind: "gain", gainDb: -3 }],
  },
];

export function batchProcessOptions(presetId: BatchProcessPresetId, opts: BatchExportCommandOptions = {}): BatchExportCommandOptions {
  const preset = BATCH_PROCESS_PRESETS.find((p) => p.id === presetId);
  return preset ? { ...opts, processing: preset.processing.map((step) => ({ ...step })) } : opts;
}

/** Export a batch of separate files: track stems, marker regions, or selected clips. */
export function exportBatch(store: RythmeStore, scope: BatchExportScopeId, opts: BatchExportCommandOptions = {}): number {
  const s = store.getState();
  const batchScope: E.Ops.BatchExportScope =
    scope === "tracks"
      ? { kind: "tracks", trackIds: opts.trackIds }
      : scope === "regions"
        ? { kind: "regions", markerIds: opts.markerIds }
        : { kind: "clips", clipIds: opts.clipIds ?? s.selection.clipIds };
  const files = E.Ops.encodeBatchExports(s.project, batchScope, opts);
  for (const file of files) downloadBytes(file.name, file.bytes, file.mime);
  return files.length;
}

export const exportTrackStems = (store: RythmeStore, opts: BatchExportCommandOptions = {}): number =>
  exportBatch(store, "tracks", opts);

export const exportMarkerRegions = (store: RythmeStore, opts: BatchExportCommandOptions = {}): number =>
  exportBatch(store, "regions", opts);

export const exportSelectedClips = (store: RythmeStore, opts: BatchExportCommandOptions = {}): number =>
  exportBatch(store, "clips", opts);

// ── native plug-ins ─────────────────────────────────────────────────────────

export function nativePluginSearchRoots(
  platform: E.IO.NativeAudioPluginPlatform | "auto" = "auto",
  homeDir?: string,
): string[] {
  const resolved = platform === "auto" ? detectNativePluginPlatform() : platform;
  return E.IO.defaultNativeAudioPluginSearchRoots(resolved, homeDir);
}

export function scanNativePluginPaths(
  paths: string | readonly (string | E.IO.NativeAudioPluginCandidate | E.IO.NativeAudioPlugin)[],
  opts: E.IO.ScanNativeAudioPluginOptions = {},
): E.IO.NativeAudioPlugin[] {
  const list = typeof paths === "string" ? splitNativePluginPathList(paths) : Array.from(paths);
  return E.IO.scanNativeAudioPlugins(list, opts);
}

export async function scanNativePluginPathsWithNativeMetadata(paths: readonly string[]): Promise<E.IO.NativeAudioPlugin[]> {
  const candidates = await scanNativePluginMetadata(paths);
  return candidates ? scanNativePluginPaths(candidates, { includeUnknown: true }) : scanNativePluginPaths(paths);
}

export async function scanNativePluginRootsWithNativeMetadata(
  roots: string | readonly string[],
  maxDepth = 6,
): Promise<E.IO.NativeAudioPlugin[]> {
  const list = normalizeNativePluginPathList(roots);
  const candidates = await scanNativePluginRootMetadata(list, maxDepth);
  return candidates ? scanNativePluginPaths(candidates, { includeUnknown: true }) : scanNativePluginPaths(list);
}

export function mergeNativePluginInventory(
  current: readonly E.IO.NativeAudioPlugin[],
  next: readonly E.IO.NativeAudioPlugin[],
): E.IO.NativeAudioPlugin[] {
  return E.IO.mergeNativeAudioPluginInventories(Array.from(current), Array.from(next));
}

export async function pickNativeAudioPlugins(): Promise<E.IO.NativeAudioPlugin[]> {
  const selected = await openFile({
    title: "Add Native Audio Plug-ins",
    multiple: true,
    filters: [{ name: "Audio Plug-ins", extensions: ["vst3", "vst", "component", "dll", "so"] }],
  });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
  return scanNativePluginPathsWithNativeMetadata(paths);
}

export async function pickNativeAudioPluginRoots(): Promise<{ roots: string[]; plugins: E.IO.NativeAudioPlugin[] }> {
  const selected = await openFile({
    title: "Scan Native Audio Plug-in Folders",
    multiple: true,
    directory: true,
    recursive: true,
  });
  const roots = normalizeNativePluginPathList(Array.isArray(selected) ? selected : selected ? [selected] : []);
  return { roots, plugins: await scanNativePluginRootsWithNativeMetadata(roots) };
}

export function formatNativePluginInventory(plugins: readonly E.IO.NativeAudioPlugin[]): string {
  if (!plugins.length) return "No native audio plug-ins found";
  return plugins.map((p) => {
    const vendor = p.vendor ? ` by ${p.vendor}` : "";
    const version = p.version ? ` ${p.version}` : "";
    const validation = E.IO.nativeAudioPluginValidationLabel(p.validationStatus);
    const issues = p.validationIssues.length ? `, ${p.validationIssues.length} issue(s)` : "";
    const entryPoint = p.entryPointVerified ? ", entry point verified" : "";
    const status = p.canProcess ? "hosted" : `inventory only, ${validation}${entryPoint}${issues}`;
    return `${p.name}${version}${vendor} (${E.IO.nativeAudioPluginKindLabel(p.kind)}) - ${status} - ${p.path}`;
  }).join("\n");
}

export function managedNativePluginFromInventory(plugin: E.IO.NativeAudioPlugin, lastScannedAt = Date.now()): E.ManagedNativeAudioPlugin {
  return {
    id: plugin.id,
    kind: plugin.kind,
    name: plugin.name,
    vendor: plugin.vendor,
    version: plugin.version,
    bundleIdentifier: plugin.bundleIdentifier,
    path: plugin.path,
    extension: plugin.extension,
    canProcess: false,
    hostStatus: "inventoryOnly",
    validationStatus: plugin.validationStatus,
    entryPointVerified: plugin.entryPointVerified,
    enabled: true,
    lastScannedAt,
    validationIssues: plugin.validationIssues,
  };
}

export function addNativePluginsToProject(store: RythmeStore, plugins: readonly E.IO.NativeAudioPlugin[], scanRoots: string[] = []): number {
  if (plugins.length === 0) return 0;
  const scannedAt = Date.now();
  store.dispatch(E.upsertNativePlugins(plugins.map((plugin) => managedNativePluginFromInventory(plugin, scannedAt)), scanRoots), { label: "Update Audio Plug-In Manager" });
  return plugins.length;
}

export function scanNativePluginPathsIntoProject(store: RythmeStore, paths: string | readonly string[]): number {
  const plugins = scanNativePluginPaths(paths);
  const roots = normalizeNativePluginPathList(paths);
  return addNativePluginsToProject(store, plugins, roots);
}

export async function scanNativePluginRootsIntoProject(
  store: RythmeStore,
  roots: string | readonly string[],
  maxDepth = 6,
): Promise<number> {
  const list = normalizeNativePluginPathList(roots);
  const plugins = await scanNativePluginRootsWithNativeMetadata(list, maxDepth);
  return addNativePluginsToProject(store, plugins, list);
}

export function setManagedNativePluginEnabled(store: RythmeStore, pluginId: string, enabled: boolean): boolean {
  if (!(store.getState().project.nativePluginManager?.plugins ?? []).some((plugin) => plugin.id === pluginId)) return false;
  store.dispatch(E.setNativePluginEnabled(pluginId, enabled), { label: enabled ? "Enable Audio Plug-in" : "Disable Audio Plug-in" });
  return true;
}

export function setManagedNativePluginPresetState(store: RythmeStore, pluginId: string, presetName: string, state: Record<string, E.EffectParamValue> = {}): boolean {
  if (!(store.getState().project.nativePluginManager?.plugins ?? []).some((plugin) => plugin.id === pluginId)) return false;
  store.dispatch(E.setNativePluginPresetState(pluginId, presetName, state), { label: "Store Audio Plug-in Preset" });
  return true;
}

export type NativePluginRackTarget =
  | { kind: "clip" | "track" | "bus"; id: string }
  | { kind: "master" };

export function nativePluginRackSlot(plugin: E.ManagedNativeAudioPlugin): E.EffectSlot {
  const state = plugin.state && Object.keys(plugin.state).length ? JSON.stringify(plugin.state) : "";
  return E.newEffectSlot("nativePlugin", {
    name: plugin.name,
    enabled: plugin.enabled,
    params: {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginKind: plugin.kind,
      vendor: plugin.vendor ?? "",
      version: plugin.version ?? "",
      bundleIdentifier: plugin.bundleIdentifier ?? "",
      path: plugin.path,
      hostStatus: plugin.hostStatus,
      canProcess: false,
      validationStatus: plugin.validationStatus ?? "pathOnly",
      entryPointVerified: plugin.entryPointVerified === true,
      presetName: plugin.presetName ?? "",
      stateJson: state,
    },
  });
}

export function addNativePluginSlotToRack(store: RythmeStore, pluginId: string, target: NativePluginRackTarget): string | null {
  const plugin = (store.getState().project.nativePluginManager?.plugins ?? []).find((candidate) => candidate.id === pluginId);
  if (!plugin) return null;
  const slot = nativePluginRackSlot(plugin);
  if (target.kind === "clip") store.dispatch(E.addClipEffectSlot(target.id, slot), { label: `Add ${plugin.name} plug-in slot` });
  else if (target.kind === "track") store.dispatch(E.addTrackEffectSlot(target.id, slot), { label: `Add ${plugin.name} plug-in slot` });
  else if (target.kind === "bus") store.dispatch(E.addBusEffectSlot(target.id, slot), { label: `Add ${plugin.name} plug-in slot` });
  else store.dispatch(E.addMasterEffectSlot(slot), { label: `Add ${plugin.name} plug-in slot` });
  return slot.id;
}

export function formatManagedNativePluginInventory(plugins: readonly E.ManagedNativeAudioPlugin[]): string {
  if (!plugins.length) return "No managed native audio plug-ins";
  return plugins.map((p) => {
    const vendor = p.vendor ? ` by ${p.vendor}` : "";
    const version = p.version ? ` ${p.version}` : "";
    const enabled = p.enabled ? "enabled" : "disabled";
    const preset = p.presetName ? `, preset ${p.presetName}` : "";
    const validation = p.validationStatus ? `, ${E.IO.nativeAudioPluginValidationLabel(p.validationStatus)}` : "";
    const entryPoint = p.entryPointVerified ? ", entry point verified" : "";
    const issues = p.validationIssues?.length ? `, ${p.validationIssues.length} issue(s)` : "";
    return `${p.id}: ${p.name}${version}${vendor} (${E.IO.nativeAudioPluginKindLabel(p.kind)}) - ${enabled}, ${p.hostStatus}${validation}${entryPoint}${issues}${preset} - ${p.path}`;
  }).join("\n");
}

function splitNativePluginPathList(paths: string): string[] {
  return paths.split(/\r?\n|;/).map((p) => p.trim()).filter(Boolean);
}

function normalizeNativePluginPathList(paths: string | readonly string[]): string[] {
  return typeof paths === "string" ? splitNativePluginPathList(paths) : paths.map((p) => p.trim()).filter(Boolean);
}

function detectNativePluginPlatform(): E.IO.NativeAudioPluginPlatform {
  const proc = typeof process !== "undefined" ? process.platform : "";
  if (proc === "darwin" || proc === "win32" || proc === "linux") return proc;
  const nav = typeof navigator !== "undefined" ? `${navigator.platform} ${navigator.userAgent}`.toLowerCase() : "";
  if (nav.includes("mac")) return "darwin";
  if (nav.includes("win")) return "win32";
  return "linux";
}

async function scanNativePluginMetadata(paths: readonly string[]): Promise<E.IO.NativeAudioPluginCandidate[] | null> {
  if (!isTauriRuntime() || paths.length === 0) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<E.IO.NativeAudioPluginCandidate[]>("scan_native_audio_plugin_metadata", { paths });
  } catch {
    return null;
  }
}

async function scanNativePluginRootMetadata(roots: readonly string[], maxDepth: number): Promise<E.IO.NativeAudioPluginCandidate[] | null> {
  if (!isTauriRuntime() || roots.length === 0) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    const depth = Number.isFinite(maxDepth) ? Math.max(0, Math.min(16, Math.floor(maxDepth))) : 6;
    return await core.invoke<E.IO.NativeAudioPluginCandidate[]>("scan_native_audio_plugin_roots", {
      roots,
      maxDepth: depth,
    });
  } catch {
    return null;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

// ── generate ────────────────────────────────────────────────────────────────

export type GeneratorId = "sine" | "square" | "sawtooth" | "triangle" | "white" | "pink" | "brown" | "chirp" | "silence";

export interface GenerateParams {
  freq?: number;
  seconds?: number;
  amplitude?: number;
  endFreq?: number;
}

function generateBuffer(id: GeneratorId, sr: number, p: GenerateParams): E.AudioData {
  const seconds = p.seconds ?? 2;
  const amplitude = p.amplitude ?? 0.7;
  const freq = p.freq ?? 440;
  const opts = { sampleRate: sr, amplitude, channels: 2 };
  switch (id) {
    case "sine":
    case "square":
    case "sawtooth":
    case "triangle":
      return E.Generate.tone(id, freq, seconds, opts);
    case "white":
      return E.Generate.whiteNoise(seconds, opts);
    case "pink":
      return E.Generate.pinkNoise(seconds, opts);
    case "brown":
      return E.Generate.brownNoise(seconds, opts);
    case "chirp":
      return E.Generate.chirp(freq, p.endFreq ?? 4000, seconds, opts);
    case "silence":
      return E.Generate.generateSilence(seconds, 2, sr);
  }
}

/** Insert a generated clip at the playhead on the active track (or a new one). */
export function insertGenerated(store: RythmeStore, id: GeneratorId, params: GenerateParams = {}): void {
  const s = store.getState();
  const sr = s.project.sampleRate;
  const buffer = generateBuffer(id, sr, params);
  let trackId = s.activeTrackId;
  if (!trackId) {
    const before = s.project.tracks.length;
    store.dispatch(E.addTrack({ name: id }), { label: "Add track" });
    trackId = store.getState().project.tracks[before].id;
  }
  store.dispatch(E.insertClip(trackId, buffer, s.transport.playhead, id), { label: `Generate ${id}` });
}

/**
 * Tones generator presets (Audition Generate ▸ Tones) — a pure tone plus
 * frequency-modulated warbles and a harmonic-rich tone.
 */
export const TONES_PRESETS: { id: string; label: string; freq: number; opts: E.Generate.TonesOptions & { seconds?: number } }[] = [
  { id: "tonPure", label: "Pure 440", freq: 440, opts: { seconds: 2 } },
  { id: "tonWarble", label: "Warble (FM)", freq: 440, opts: { modDepthHz: 200, modRateHz: 6, seconds: 2 } },
  { id: "tonVibrato", label: "Vibrato", freq: 440, opts: { modDepthHz: 30, modRateHz: 5, seconds: 2 } },
  { id: "tonHarmonic", label: "Harmonic 220", freq: 220, opts: { harmonics: 4, seconds: 2 } },
  { id: "tonSiren", label: "Siren", freq: 600, opts: { modDepthHz: 500, modRateHz: 1, seconds: 2 } },
];

/** Generate a Tones clip (FM + harmonics) and insert it at the playhead on the active track. */
export function insertTones(store: RythmeStore, freq: number, opts: E.Generate.TonesOptions & { seconds?: number } = {}, label = "Generate Tones"): void {
  const s = store.getState();
  const sr = s.project.sampleRate;
  const buffer = E.Generate.tones(freq, opts.seconds ?? 2, { ...opts, sampleRate: sr, channels: opts.channels ?? 2 });
  let trackId = s.activeTrackId;
  if (!trackId) {
    const before = s.project.tracks.length;
    store.dispatch(E.addTrack({ name: "Tones" }), { label: "Add track" });
    trackId = store.getState().project.tracks[before].id;
  }
  store.dispatch(E.insertClip(trackId, buffer, s.transport.playhead, "Tones"), { label });
}

/** Dial-string presets for the DTMF Signals generator (Audition Generate ▸ DTMF). */
export const DTMF_PRESETS: { id: string; label: string; dial: string; opts: E.Generate.DtmfSequenceOptions }[] = [
  { id: "dtmf911", label: "Dial 911", dial: "911", opts: { toneMs: 120, breakMs: 80 } },
  { id: "dtmf1800", label: "Dial 1 800 555 0100", dial: "1 800 555 0100", opts: { toneMs: 100, breakMs: 60, pauseMs: 300 } },
  { id: "dtmfSeq", label: "Sweep 0–9", dial: "0123456789", opts: { toneMs: 90, breakMs: 50 } },
  { id: "dtmfStar", label: "* 0 #", dial: "*0#", opts: { toneMs: 150, breakMs: 80 } },
];

/** Generate a DTMF dial-string clip and insert it at the playhead on the active track. */
export function insertDtmfSequence(store: RythmeStore, dial: string, opts: E.Generate.DtmfSequenceOptions = {}, label = "Generate DTMF"): void {
  const s = store.getState();
  const sr = s.project.sampleRate;
  const buffer = E.Generate.dtmfSequence(dial, { ...opts, sampleRate: sr, channels: opts.channels ?? 2 });
  if (E.frameCount(buffer) === 0) return;
  let trackId = s.activeTrackId;
  if (!trackId) {
    const before = s.project.tracks.length;
    store.dispatch(E.addTrack({ name: "DTMF" }), { label: "Add track" });
    trackId = store.getState().project.tracks[before].id;
  }
  store.dispatch(E.insertClip(trackId, buffer, s.transport.playhead, "DTMF"), { label });
}

// ── mixer automation capture ───────────────────────────────────────────────

type AutomationCaptureMode = Extract<E.AutomationMode, "write" | "touch" | "latch">;

function automationCaptureMode(mode: E.AutomationMode | undefined): AutomationCaptureMode | null {
  return mode === "write" || mode === "touch" || mode === "latch" ? mode : null;
}

function dispatchMixerCommand(
  store: RythmeStore,
  base: E.Command,
  capture: E.Command | null,
  opts: { label: string; coalesceKey: string },
): void {
  store.dispatch((state) => {
    const next = base(state);
    return capture ? capture(next) : next;
  }, opts);
}

function automationCaptureLabel(scope: string, target: string, mode: AutomationCaptureMode): string {
  return `${scope} ${target} automation ${mode}`;
}

export function setTrackGainFromMixer(store: RythmeStore, trackId: string, gainDb: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(state.project.tracks.find((track) => track.id === trackId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setTrackGain(trackId, gainDb),
    mode ? E.setTrackGainAutomationPoint(trackId, state.transport.playhead, gainDb) : null,
    { coalesceKey: `gain:${trackId}`, label: mode ? automationCaptureLabel("Track", "volume", mode) : "Gain" },
  );
}

export function setTrackPanFromMixer(store: RythmeStore, trackId: string, pan: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(state.project.tracks.find((track) => track.id === trackId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setTrackPan(trackId, pan),
    mode ? E.setTrackPanAutomationPoint(trackId, state.transport.playhead, pan) : null,
    { coalesceKey: `pan:${trackId}`, label: mode ? automationCaptureLabel("Track", "pan", mode) : "Pan" },
  );
}

export function setTrackSendGainFromMixer(store: RythmeStore, trackId: string, sendId: string, gainDb: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(state.project.tracks.find((track) => track.id === trackId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setTrackSendGain(trackId, sendId, gainDb),
    mode ? E.setTrackSendGainAutomationPoint(trackId, sendId, state.transport.playhead, gainDb) : null,
    { coalesceKey: `sendgain:${sendId}`, label: mode ? automationCaptureLabel("Track send", "gain", mode) : "Send gain" },
  );
}

export function setTrackSendPanFromMixer(store: RythmeStore, trackId: string, sendId: string, pan: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(state.project.tracks.find((track) => track.id === trackId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setTrackSendPan(trackId, sendId, pan),
    mode ? E.setTrackSendPanAutomationPoint(trackId, sendId, state.transport.playhead, pan) : null,
    { coalesceKey: `sendpan:${sendId}`, label: mode ? automationCaptureLabel("Track send", "pan", mode) : "Send pan" },
  );
}

export function setBusGainFromMixer(store: RythmeStore, busId: string, gainDb: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(E.busById(state.project, busId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setBusGain(busId, gainDb),
    mode ? E.setBusGainAutomationPoint(busId, state.transport.playhead, gainDb) : null,
    { coalesceKey: `busgain:${busId}`, label: mode ? automationCaptureLabel("Bus", "volume", mode) : "Bus gain" },
  );
}

export function setBusPanFromMixer(store: RythmeStore, busId: string, pan: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(E.busById(state.project, busId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setBusPan(busId, pan),
    mode ? E.setBusPanAutomationPoint(busId, state.transport.playhead, pan) : null,
    { coalesceKey: `buspan:${busId}`, label: mode ? automationCaptureLabel("Bus", "pan", mode) : "Bus pan" },
  );
}

export function setBusSendGainFromMixer(store: RythmeStore, busId: string, sendId: string, gainDb: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(E.busById(state.project, busId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setBusSendGain(busId, sendId, gainDb),
    mode ? E.setBusSendGainAutomationPoint(busId, sendId, state.transport.playhead, gainDb) : null,
    { coalesceKey: `bussendgain:${busId}:${sendId}`, label: mode ? automationCaptureLabel("Bus send", "gain", mode) : "Bus send gain" },
  );
}

export function setBusSendPanFromMixer(store: RythmeStore, busId: string, sendId: string, pan: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(E.busById(state.project, busId)?.automationMode);
  dispatchMixerCommand(
    store,
    E.setBusSendPan(busId, sendId, pan),
    mode ? E.setBusSendPanAutomationPoint(busId, sendId, state.transport.playhead, pan) : null,
    { coalesceKey: `bussendpan:${busId}:${sendId}`, label: mode ? automationCaptureLabel("Bus send", "pan", mode) : "Bus send pan" },
  );
}

export function setMasterGainFromMixer(store: RythmeStore, gainDb: number): void {
  const state = store.getState();
  const mode = automationCaptureMode(state.project.masterAutomationMode);
  dispatchMixerCommand(
    store,
    E.setMasterGain(gainDb),
    mode ? E.setMasterGainAutomationPoint(state.transport.playhead, gainDb) : null,
    { coalesceKey: "master", label: mode ? automationCaptureLabel("Master", "volume", mode) : "Master" },
  );
}

// ── effects ────────────────────────────────────────────────────────────────

type Proc = (d: E.AudioData) => E.AudioData;

/** The effects catalogue, grouped like Audition/Audacity menus. */
export const EFFECTS: { id: string; label: string; group: string; make: (p?: Record<string, number>) => Proc }[] = [
  { id: "amplify", label: "Amplify / Gain…", group: "Amplitude", make: (p) => (d) => E.DSP.applyGainDb(d, p?.db ?? 6) },
  { id: "normalize", label: "Normalize…", group: "Amplitude", make: (p) => (d) => E.DSP.normalizePeak(d, p?.targetDb ?? -0.3) },
  { id: "normalizeRms", label: "Loudness (RMS)…", group: "Amplitude", make: (p) => (d) => E.DSP.normalizeRMS(d, p?.targetDb ?? -18) },
  { id: "removeDc", label: "Remove DC Offset", group: "Amplitude", make: () => (d) => E.DSP.removeDcOffset(d) },
  { id: "fadeIn", label: "Fade In", group: "Fades", make: (p) => (d) => E.DSP.fadeIn(d, p?.seconds ?? E.durationSeconds(d), "equalPower") },
  { id: "fadeOut", label: "Fade Out", group: "Fades", make: (p) => (d) => E.DSP.fadeOut(d, p?.seconds ?? E.durationSeconds(d), "equalPower") },
  { id: "reverse", label: "Reverse", group: "Special", make: () => (d) => E.DSP.reverse(d) },
  { id: "invert", label: "Invert", group: "Special", make: () => (d) => E.DSP.invertPolarity(d) },
  { id: "silence", label: "Silence", group: "Special", make: () => (d) => E.DSP.silence(d) },
  { id: "lowpass", label: "Low-pass Filter…", group: "Filter & EQ", make: (p) => (d) => E.DSP.lowpass(d, p?.freq ?? 2000, Math.SQRT1_2, 2) },
  { id: "highpass", label: "High-pass Filter…", group: "Filter & EQ", make: (p) => (d) => E.DSP.highpass(d, p?.freq ?? 120, Math.SQRT1_2, 2) },
  { id: "lowCut", label: "Low Cut (Rumble)", group: "Filter & EQ", make: () => (d) => E.DSP.lowCut(d) },
  { id: "highCut", label: "High Cut (Hiss)", group: "Filter & EQ", make: () => (d) => E.DSP.highCut(d) },
  { id: "compress", label: "Compressor…", group: "Dynamics", make: (p) => (d) => E.DSP.compress(d, { thresholdDb: p?.thresholdDb ?? -18, ratio: p?.ratio ?? 4 }) },
  { id: "limit", label: "Limiter", group: "Dynamics", make: (p) => (d) => E.DSP.limit(d, { thresholdDb: p?.thresholdDb ?? -1 }) },
  { id: "gate", label: "Noise Gate…", group: "Dynamics", make: (p) => (d) => E.DSP.gate(d, { thresholdDb: p?.thresholdDb ?? -45 }) },
  { id: "delay", label: "Delay / Echo…", group: "Time", make: (p) => (d) => E.DSP.delay(d, { delayMs: p?.delayMs ?? 300, feedback: p?.feedback ?? 0.4, mix: p?.mix ?? 0.35 }) },
  { id: "reverb", label: "Reverb…", group: "Time", make: (p) => (d) => E.DSP.reverb(d, { roomSize: p?.roomSize ?? 0.6, wet: p?.wet ?? 0.3, dry: 0.8 }) },
  { id: "convReverb", label: "Convolution Reverb…", group: "Time", make: (p) => (d) => E.DSP.convolutionReverb(d, { decaySeconds: (p?.decayMs ?? 800) / 1000, mix: (p?.mix ?? 30) / 100 }) },
  { id: "chorus", label: "Chorus", group: "Modulation", make: () => (d) => E.DSP.chorus(d) },
  { id: "flanger", label: "Flanger", group: "Modulation", make: () => (d) => E.DSP.flanger(d) },
  { id: "tremolo", label: "Tremolo", group: "Modulation", make: (p) => (d) => E.DSP.tremolo(d, { rateHz: p?.rateHz ?? 5, depth: p?.depth ?? 0.6 }) },
  { id: "phaser", label: "Phaser", group: "Modulation", make: (p) => (d) => E.DSP.phaser(d, { rateHz: p?.rateHz ?? 0.5, feedback: p?.feedback ?? 0.4 }) },
  { id: "distortion", label: "Distortion (Soft Clip)", group: "Distortion", make: (p) => (d) => E.DSP.softClip(d, p?.driveDb ?? 12) },
  { id: "bitcrush", label: "Bitcrusher…", group: "Distortion", make: (p) => (d) => E.DSP.bitcrush(d, p?.bits ?? 8, p?.downsample ?? 1) },
  { id: "speedUp", label: "Change Speed +25%", group: "Special", make: () => (d) => E.DSP.changeSpeed(d, 1.25) },
  { id: "speedDown", label: "Change Speed −25%", group: "Special", make: () => (d) => E.DSP.changeSpeed(d, 0.8) },
  { id: "doppler", label: "Doppler Shifter…", group: "Special", make: (p) => (d) => E.DSP.doppler(d, { speed: p?.speed ?? 30, closestDistance: p?.closest ?? 4 }) },
];

export const EFFECTS_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

export function applyEffectById(store: RythmeStore, id: string, params?: Record<string, number>): void {
  const def = EFFECTS_BY_ID.get(id);
  if (!def) return;
  store.dispatch(E.applyEffect(def.make(params)), { label: def.label.replace(/[.…]+$/, "") });
}

function cloneFavoriteParamValue(value: E.EffectParamValue): E.EffectParamValue {
  return value;
}

function favoriteStepFromSlot(slot: E.EffectSlot): E.FavoriteEffectStep {
  return {
    kind: slot.kind,
    name: slot.name,
    enabled: slot.enabled,
    params: Object.fromEntries(Object.entries(slot.params).map(([key, value]) => [key, cloneFavoriteParamValue(value)])),
  };
}

function favoriteRackSource(store: RythmeStore): { name: string; steps: E.FavoriteEffectStep[] } | undefined {
  const state = store.getState();
  const selectedClipId = state.selection.clipIds[0];
  if (selectedClipId) {
    const selected = E.clipById(state.project, selectedClipId);
    const slots = selected?.clip.effectRack?.slots ?? [];
    if (slots.length > 0) return { name: `${selected!.clip.name} Rack`, steps: slots.map(favoriteStepFromSlot) };
  }

  const activeTrack = state.project.tracks.find((track) => track.id === state.activeTrackId);
  const trackSlots = activeTrack?.effectRack?.slots ?? [];
  if (activeTrack && trackSlots.length > 0) return { name: `${activeTrack.name} Rack`, steps: trackSlots.map(favoriteStepFromSlot) };

  const masterSlots = state.project.masterEffectRack?.slots ?? [];
  if (masterSlots.length > 0) return { name: "Master Rack", steps: masterSlots.map(favoriteStepFromSlot) };
  return undefined;
}

function uniqueFavoriteName(project: E.Project, preferred: string): string {
  const base = preferred.trim() || "Favorite Effects";
  const taken = new Set((project.favoriteEffectChains ?? []).map((chain) => chain.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function rackFromFavoriteChain(chain: E.FavoriteEffectChain): E.EffectRack {
  return E.newEffectRack({
    slots: chain.steps.map((step, index) =>
      E.newEffectSlot(step.kind, {
        id: `${chain.id}-${index}`,
        name: step.name ?? step.kind,
        enabled: step.enabled ?? true,
        params: { ...(step.params ?? {}) },
      }),
    ),
  });
}

export function canSaveActiveRackAsFavorite(store: RythmeStore): boolean {
  return !!favoriteRackSource(store);
}

export function saveActiveRackAsFavorite(store: RythmeStore, name?: string): string | null {
  const source = favoriteRackSource(store);
  if (!source) return null;
  const project = store.getState().project;
  const chain: E.FavoriteEffectChain = {
    id: E.nextId("fav"),
    name: uniqueFavoriteName(project, name ?? source.name),
    steps: source.steps,
  };
  store.dispatch(E.upsertFavoriteEffectChain(chain), { label: "Save favorite effects" });
  return chain.id;
}

export function applyFavoriteEffectChain(store: RythmeStore, chainId: string): boolean {
  const chain = (store.getState().project.favoriteEffectChains ?? []).find((candidate) => candidate.id === chainId);
  if (!chain || chain.steps.length === 0) return false;
  const rack = rackFromFavoriteChain(chain);
  store.dispatch(E.applyEffect((d) => E.Ops.applyEffectRack(d, rack)), { label: `Favorite: ${chain.name}` });
  return true;
}

export interface ConvolutionReverbImpulseOptions {
  mix?: number;
  normalize?: E.DSP.ImpulseResponseNormalization;
}

/** Apply Convolution Reverb using imported impulse-response audio. */
export function applyConvolutionReverbImpulse(
  store: RythmeStore,
  impulseAudio: E.AudioData,
  opts: ConvolutionReverbImpulseOptions = {},
  label = "Convolution Reverb IR",
): boolean {
  const sampleRate = store.getState().project.sampleRate;
  const irAudio = impulseAudio.sampleRate === sampleRate ? impulseAudio : E.resampleLinear(impulseAudio, sampleRate);
  const impulse = E.DSP.impulseResponseFromAudioData(irAudio, { normalize: opts.normalize ?? "energy" });
  if (impulse.length === 0) return false;
  store.dispatch(E.applyEffect((d) => E.DSP.convolutionReverb(d, { impulse, mix: opts.mix ?? 0.3 })), { label });
  return true;
}

/** Pick a WAV/AIFF/browser-decodable impulse-response file and convolve the current scope with it. */
export async function applyConvolutionReverbFromFile(
  store: RythmeStore,
  opts: ConvolutionReverbImpulseOptions = {},
): Promise<boolean> {
  const files = await pickFiles(AUDIO_ACCEPT, false);
  if (!files.length) return false;
  try {
    const impulseAudio = await decodeImportedAudio(files[0].bytes, files[0].name);
    return applyConvolutionReverbImpulse(store, impulseAudio, opts, `Convolution Reverb - ${files[0].name}`);
  } catch (err) {
    console.error("impulse response import failed", files[0].name, err);
    return false;
  }
}

// ── Essential Sound (role presets + role-aware ducking) ─────────────────────

export const ESSENTIAL_SOUND_ROLES: { role: E.AudioRole; label: string; preset: string }[] = [
  { role: "dialogue", label: "Dialogue", preset: "Dialogue Cleanup" },
  { role: "music", label: "Music", preset: "Music Polish" },
  { role: "sfx", label: "SFX", preset: "SFX Punch" },
  { role: "ambience", label: "Ambience", preset: "Ambience Bed" },
];

const ESSENTIAL_ROLE_SET = new Set<E.AudioRole>(ESSENTIAL_SOUND_ROLES.map((r) => r.role));

function normalizeEssentialRole(role: E.AudioRole | string | null | undefined): E.AudioRole | null {
  return role && ESSENTIAL_ROLE_SET.has(role as E.AudioRole) ? (role as E.AudioRole) : null;
}

export function essentialRoleLabel(role: E.AudioRole): string {
  return ESSENTIAL_SOUND_ROLES.find((r) => r.role === role)?.label ?? role;
}

/** Set the active track's Essential Sound role. */
export function setActiveTrackAudioRole(store: RythmeStore, role: E.AudioRole | null): boolean {
  const trackId = store.getState().activeTrackId;
  if (!trackId) return false;
  store.dispatch(E.setTrackAudioRole(trackId, role), { label: "Audio role" });
  return true;
}

function hasEffectScope(s: E.EditorState): boolean {
  return !!s.selection.range || s.selection.clipIds.length > 0 || !!s.activeTrackId;
}

function essentialPresetProcessor(role: E.AudioRole): Proc {
  switch (role) {
    case "dialogue":
      return (d) => {
        let out = E.DSP.speechLeveler(d, { targetDb: -18, amount: 0.85, maxGainDb: 18, gateDb: -55, windowMs: 220 });
        out = E.DSP.vocalEnhance(out, { mode: "male" });
        out = E.DSP.deEss(out, { centerFreq: 7000, thresholdDb: -30, rangeDb: 8 });
        return E.DSP.matchLoudness(out, { targetLufs: -16, peakCeilingDb: -1 });
      };
    case "music":
      return (d) => {
        const out = E.DSP.mastering(d, { amount: 0.65, lowShelfDb: 0.8, highShelfDb: 1.4, exciteAmount: 0.12, width: 1.15, driveDb: 1.5, ceilingDb: -1 });
        return E.DSP.matchLoudness(out, { targetLufs: -18, peakCeilingDb: -1 });
      };
    case "sfx":
      return (d) => E.DSP.truePeakLimiter(E.DSP.normalizePeak(d, -1), { ceilingDb: -1, lookAheadMs: 3, releaseMs: 80 });
    case "ambience":
      return (d) => E.DSP.matchLoudness(E.DSP.highpass(d, 80, Math.SQRT1_2, 2), { targetLufs: -24, peakCeilingDb: -3 });
  }
}

/** Apply the Essential Sound preset for the supplied or active track role. */
export function applyEssentialSoundPreset(store: RythmeStore, role?: E.AudioRole | string): boolean {
  const s = store.getState();
  if (!hasEffectScope(s)) return false;
  const activeRole = s.project.tracks.find((t) => t.id === s.activeTrackId)?.audioRole;
  const normalized = normalizeEssentialRole(role) ?? activeRole ?? "dialogue";
  const label = `Essential Sound - ${essentialRoleLabel(normalized)}`;
  store.dispatch(E.applyEffect(essentialPresetProcessor(normalized)), { label });
  return true;
}

/** Auto-duck Music-role tracks under Dialogue-role tracks. Returns baked duck count. */
export function applyEssentialSoundAutoDuck(store: RythmeStore, params: E.DSP.SidechainDuckOptions = {}): number {
  let baked = 0;
  store.dispatch(
    (st) => {
      const dialogue = st.project.tracks.filter((t) => t.audioRole === "dialogue");
      const music = st.project.tracks.filter((t) => t.audioRole === "music");
      if (!dialogue.length || !music.length) return st;
      let project = st.project;
      let count = 0;
      for (const target of music) {
        for (const key of dialogue) {
          const next = E.Ops.duckTrack(project, target.id, key.id, params);
          if (next !== project) {
            project = next;
            count++;
          }
        }
      }
      baked = count;
      return project === st.project ? st : { ...st, project };
    },
    { label: "Essential Sound Ducking" },
  );
  return baked;
}

// ── noise reduction (Adobe Audition "Noise Reduction (process)") ──────────────

/** Audible PCM for the current scope, used to capture a noise print:
 *  selected clips → rendered & joined; else the selected range (or whole) of
 *  the first target/active track. Returns null when there is nothing to read. */
function scopeAudio(s: E.EditorState): E.AudioData | null {
  if (!s.selection.range && s.selection.clipIds.length) {
    const clips: E.Clip[] = [];
    for (const t of s.project.tracks) for (const c of t.clips) if (s.selection.clipIds.includes(c.id)) clips.push(c);
    if (!clips.length) return null;
    return E.concat(...clips.map((c) => E.Ops.renderClip(c)));
  }
  const sr = s.project.sampleRate;
  const trackId = s.selection.trackIds[0] ?? s.activeTrackId ?? s.project.tracks[0]?.id;
  const track = s.project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  let buf = E.Ops.renderTrack(track, sr, 2);
  if (s.selection.range) {
    const { start, end } = s.selection.range;
    buf = E.sliceFrames(buf, Math.round(start * sr), Math.round(end * sr));
  }
  return E.frameCount(buf) > 0 ? buf : null;
}

/**
 * Snap the time selection's edges to zero crossings of the active track
 * (Audition's Edit ▸ Zero Crossings). Renders the whole track — not just the
 * selection — so "outward" can search past the current edges. Returns false
 * when there is no time selection or no track to read.
 */
export function snapSelectionToZeroCrossings(store: RythmeStore, mode: E.Analysis.ZeroCrossMode): boolean {
  const s = store.getState();
  const range = s.selection.range;
  if (!range) return false;
  const sr = s.project.sampleRate;
  const trackId = s.selection.trackIds[0] ?? s.activeTrackId ?? s.project.tracks[0]?.id;
  const track = s.project.tracks.find((t) => t.id === trackId);
  if (!track) return false;
  const mono = E.mixToMono(E.Ops.renderTrack(track, sr, 2)).channels[0];
  const adjusted = E.Analysis.adjustRangeToZeroCrossings(mono, sr, range, mode);
  store.dispatch(E.selectRange(adjusted, s.selection.trackIds), { history: false });
  return true;
}

/**
 * Capture a noise print from the current selection (a noise-only region) and
 * stash it on the store for the Noise Reduction effect. Returns false when the
 * scope is empty. The FFT size is the largest power of two ≤ the selection
 * length, clamped to [512, 4096].
 */
export function captureNoisePrint(store: RythmeStore): boolean {
  const audio = scopeAudio(store.getState());
  if (!audio) return false;
  const frames = E.frameCount(audio);
  let fftSize = 4096;
  while (fftSize > 512 && fftSize > frames) fftSize >>= 1;
  store.setNoiseProfile(E.DSP.captureNoiseProfile(audio, { fftSize }));
  return true;
}

/**
 * Apply Noise Reduction over the current scope using the captured noise print.
 * Returns false when no print has been captured yet.
 */
export function applyNoiseReduction(store: RythmeStore, params: E.DSP.NoiseReductionOptions = {}): boolean {
  const profile = store.getNoiseProfile();
  if (!profile) return false;
  store.dispatch(E.applyEffect((d) => E.DSP.reduceNoise(d, profile, params)), { label: "Noise Reduction" });
  return true;
}

/**
 * Apply DeHummer over the current scope: notch out a fundamental hum frequency
 * (50/60 Hz) and its harmonics. Stateless — no noise print required.
 */
export function applyDeHummer(store: RythmeStore, params: E.DSP.DeHummerOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.deHum(d, params)), { label: "DeHummer" });
}

/** Apply the DeClicker over the current scope: detect + interpolate clicks/pops. */
export function applyDeClicker(store: RythmeStore, params: E.DSP.DeClickerOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.deClick(d, params)), { label: "DeClicker" });
}

/** Apply the Vocal Enhancer over the current scope (male/female/music mode). */
export function applyVocalEnhancer(store: RythmeStore, mode: E.DSP.VocalEnhancerMode): void {
  const label = `Vocal Enhancer (${mode})`;
  store.dispatch(E.applyEffect((d) => E.DSP.vocalEnhance(d, { mode })), { label });
}

/** Named FFT Filter response-curve presets (frequency Hz → gain dB). */
export const FFT_FILTER_PRESETS: { id: string; label: string; curve: E.DSP.FFTFilterPoint[] }[] = [
  { id: "fftLowpass", label: "Low-Pass (5 kHz)", curve: [{ freq: 0, gainDb: 0 }, { freq: 4000, gainDb: 0 }, { freq: 6000, gainDb: -48 }, { freq: 22050, gainDb: -48 }] },
  { id: "fftHighpass", label: "High-Pass (200 Hz)", curve: [{ freq: 0, gainDb: -48 }, { freq: 120, gainDb: -48 }, { freq: 300, gainDb: 0 }, { freq: 22050, gainDb: 0 }] },
  { id: "fftTelephone", label: "Telephone (300–3400 Hz)", curve: [{ freq: 0, gainDb: -48 }, { freq: 250, gainDb: -48 }, { freq: 400, gainDb: 0 }, { freq: 3000, gainDb: 0 }, { freq: 3800, gainDb: -48 }, { freq: 22050, gainDb: -48 }] },
  { id: "fftPresence", label: "Presence Boost (3 kHz)", curve: [{ freq: 0, gainDb: 0 }, { freq: 2000, gainDb: 0 }, { freq: 3500, gainDb: 6 }, { freq: 6000, gainDb: 0 }, { freq: 22050, gainDb: 0 }] },
];

/** Apply an FFT Filter response curve over the current scope. */
export function applyFFTFilter(store: RythmeStore, curve: E.DSP.FFTFilterPoint[], label = "FFT Filter"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.fftFilter(d, { curve })), { label });
}

/**
 * Apply the Center Channel Extractor over the current scope: remove (karaoke)
 * or keep (acapella) center-panned content via mid/side processing.
 */
export function applyCenterExtract(store: RythmeStore, params: E.DSP.CenterChannelOptions = {}): void {
  const label = params.mode === "keep" ? "Vocal Isolate" : "Vocal Remove";
  store.dispatch(E.applyEffect((d) => E.DSP.centerChannelExtract(d, params)), { label });
}

/** Named Channel Mixer matrix presets (percent of each input per output). */
export const CHANNEL_MIXER_PRESETS: { id: string; label: string; opts: E.DSP.ChannelMixerOptions }[] = [
  { id: "chmSwap", label: "Swap L/R", opts: { leftToLeft: 0, rightToLeft: 100, leftToRight: 100, rightToRight: 0 } },
  { id: "chmMono", label: "Sum to Mono", opts: { leftToLeft: 50, rightToLeft: 50, leftToRight: 50, rightToRight: 50 } },
  { id: "chmLeftBoth", label: "Left to Both", opts: { leftToLeft: 100, rightToLeft: 0, leftToRight: 100, rightToRight: 0 } },
  { id: "chmRightBoth", label: "Right to Both", opts: { leftToLeft: 0, rightToLeft: 100, leftToRight: 0, rightToRight: 100 } },
  { id: "chmToMS", label: "Stereo → M/S", opts: { leftToLeft: 50, rightToLeft: 50, leftToRight: 50, rightToRight: -50 } },
  { id: "chmFromMS", label: "M/S → Stereo", opts: { leftToLeft: 100, rightToLeft: 100, leftToRight: 100, rightToRight: -100 } },
];

/** Apply a Channel Mixer matrix over the current scope. */
export function applyChannelMixer(store: RythmeStore, opts: E.DSP.ChannelMixerOptions, label = "Channel Mixer"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.channelMixer(d, opts)), { label });
}

/**
 * Stereo Expander presets — width (expand: 100 = unity, 0 = mono, up to 300 =
 * ×3 wide) and centre placement, Audition's Stereo Imagery width tool.
 */
export const STEREO_EXPANDER_PRESETS: { id: string; label: string; opts: E.DSP.StereoExpanderOptions }[] = [
  { id: "stxMono", label: "Mono (Collapse)", opts: { expand: 0 } },
  { id: "stxNarrow", label: "Narrow", opts: { expand: 60 } },
  { id: "stxWide", label: "Wide", opts: { expand: 180 } },
  { id: "stxExtraWide", label: "Extra Wide", opts: { expand: 260 } },
  { id: "stxLeft", label: "Centre Left", opts: { expand: 120, centerPan: -40 } },
  { id: "stxRight", label: "Centre Right", opts: { expand: 120, centerPan: 40 } },
];

/** Apply the Stereo Expander (width + centre placement) over the current scope. */
export function applyStereoExpander(store: RythmeStore, opts: E.DSP.StereoExpanderOptions, label = "Stereo Expander"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.stereoExpander(d, opts)), { label });
}

/** Swap the left and right channels over the current scope (Audition Swap Channels). */
export function applySwapChannels(store: RythmeStore): void {
  store.dispatch(E.applyEffect((d) => E.DSP.swapStereo(d)), { label: "Swap Channels" });
}

/**
 * Graphic Phase Shifter presets — magnitude-preserving phase curves. The
 * one-channel "Simulated Stereo" zig-zag fabricates width; the flat curves are a
 * gentle 90° all-pass and a 180° polarity flip.
 */
export const GRAPHIC_PHASE_SHIFTER_PRESETS: { id: string; label: string; opts: E.DSP.GraphicPhaseShifterOptions }[] = [
  { id: "gpsSimStereo", label: "Simulated Stereo", opts: { channel: "left", curve: [{ freq: 100, phaseDeg: 0 }, { freq: 1000, phaseDeg: 90 }, { freq: 3000, phaseDeg: -90 }, { freq: 8000, phaseDeg: 180 }, { freq: 16000, phaseDeg: -180 }] } },
  { id: "gpsWide", label: "Wide Image", opts: { channel: "left", curve: [{ freq: 200, phaseDeg: 0 }, { freq: 2000, phaseDeg: 60 }, { freq: 10000, phaseDeg: 160 }] } },
  { id: "gpsInvertHi", label: "Invert Highs", opts: { curve: [{ freq: 2000, phaseDeg: 0 }, { freq: 4000, phaseDeg: 180 }] } },
  { id: "gpsQuarter", label: "Quarter Wave (90°)", opts: { curve: [{ freq: 0, phaseDeg: 90 }, { freq: 22050, phaseDeg: 90 }] } },
  { id: "gpsInvert", label: "Polarity Invert (180°)", opts: { curve: [{ freq: 0, phaseDeg: 180 }, { freq: 22050, phaseDeg: 180 }] } },
];

/** Apply the Graphic Phase Shifter (frequency-dependent all-pass) over the current scope. */
export function applyGraphicPhaseShifter(store: RythmeStore, opts: E.DSP.GraphicPhaseShifterOptions, label = "Graphic Phase Shifter"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.graphicPhaseShifter(d, opts)), { label });
}

/** Apply the DeEsser (sibilance reduction) over the current scope. */
export function applyDeEsser(store: RythmeStore, params: E.DSP.DeEsserOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.deEss(d, params)), { label: "DeEsser" });
}

/** Pitch-shift the current scope by `semitones`, preserving duration. */
export function applyPitchShift(store: RythmeStore, semitones: number): void {
  const label = `Pitch ${semitones > 0 ? "+" : ""}${semitones} st`;
  store.dispatch(E.applyEffect((d) => E.DSP.pitchShift(d, semitones)), { label });
}

/** Time-stretch the current scope by `factor` (>1 = longer), preserving pitch. */
export function applyTimeStretch(store: RythmeStore, factor: number): void {
  store.dispatch(E.applyEffect((d) => E.DSP.timeStretch(d, factor)), { label: `Stretch ${Math.round(factor * 100)}%` });
}

/** Remix the current scope to a target duration, preserving pitch and avoiding speed changes. */
export function applyRemixToDuration(store: RythmeStore, targetSeconds: number, opts: E.DSP.RemixToDurationOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.remixToDuration(d, targetSeconds, opts)), { label: `Remix to ${targetSeconds.toFixed(1)}s` });
}

/** Tape-style pitch bend over time (changes pitch + duration together). */
export function applyPitchBend(store: RythmeStore, params: E.DSP.PitchBendOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.pitchBend(d, params)), { label: "Pitch Bend" });
}

/** Hard-limit (brickwall maximize) the current scope to a ceiling, with boost. */
export function applyHardLimiter(store: RythmeStore, params: E.DSP.HardLimiterOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.hardLimiter(d, params)), { label: "Hard Limiter" });
}

/** True-peak (ISP) limit the current scope: hold the inter-sample peak under a dBTP ceiling. */
export function applyTruePeakLimiter(store: RythmeStore, params: E.DSP.TruePeakLimiterOptions = {}): void {
  store.dispatch(E.applyEffect((d) => E.DSP.truePeakLimiter(d, params)), { label: "True Peak Limiter" });
}

/**
 * Sidechain-duck the active (target) track by `keyTrackId` — or the first other
 * track — as the key, baking the result over the target track's timeline.
 */
export function applySidechainDuck(store: RythmeStore, keyTrackId?: string, params: E.DSP.SidechainDuckOptions = {}): void {
  const s = store.getState();
  const targetId = s.activeTrackId ?? s.selection.trackIds[0] ?? s.project.tracks[0]?.id;
  if (!targetId) return;
  const keyId = keyTrackId ?? s.project.tracks.find((t) => t.id !== targetId)?.id;
  if (!keyId) return;
  store.dispatch((st) => ({ ...st, project: E.Ops.duckTrack(st.project, targetId, keyId, params) }), { label: "Sidechain Duck" });
}

/**
 * Sidechain-compress the active (target) track keyed by `keyTrackId` — or the
 * first other track — baking the "pumping" result over the target's timeline.
 */
export function applySidechainCompress(store: RythmeStore, keyTrackId?: string, params: E.DSP.SidechainCompressOptions = {}): void {
  const s = store.getState();
  const targetId = s.activeTrackId ?? s.selection.trackIds[0] ?? s.project.tracks[0]?.id;
  if (!targetId) return;
  const keyId = keyTrackId ?? s.project.tracks.find((t) => t.id !== targetId)?.id;
  if (!keyId) return;
  store.dispatch((st) => ({ ...st, project: E.Ops.sidechainCompressTrack(st.project, targetId, keyId, params) }), { label: "Sidechain Compressor" });
}

/**
 * Sidechain-gate the active (target) track keyed by `keyTrackId` — or the first
 * other track — so it is audible only while the key plays, over its timeline.
 */
export function applySidechainGate(store: RythmeStore, keyTrackId?: string, params: E.DSP.SidechainGateOptions = {}): void {
  const s = store.getState();
  const targetId = s.activeTrackId ?? s.selection.trackIds[0] ?? s.project.tracks[0]?.id;
  if (!targetId) return;
  const keyId = keyTrackId ?? s.project.tracks.find((t) => t.id !== targetId)?.id;
  if (!keyId) return;
  store.dispatch((st) => ({ ...st, project: E.Ops.sidechainGateTrack(st.project, targetId, keyId, params) }), { label: "Sidechain Gate" });
}

/**
 * Multitrack crossfade: with exactly two clips selected, crossfade that pair;
 * otherwise auto-crossfade every overlapping pair on `trackId` (or the active track).
 */
export function applyAutoCrossfade(store: RythmeStore, trackId?: string, opts: E.Ops.CrossfadeOptions = {}): void {
  const s = store.getState();
  if (!trackId && s.selection.clipIds.length === 2) {
    const [a, b] = s.selection.clipIds;
    store.dispatch((st) => ({ ...st, project: E.Ops.crossfadeClips(st.project, a, b, opts) }), { label: "Crossfade" });
    return;
  }
  const id = trackId ?? s.activeTrackId ?? s.selection.trackIds[0] ?? s.project.tracks[0]?.id;
  if (!id) return;
  store.dispatch((st) => ({ ...st, project: E.Ops.autoCrossfadeTrack(st.project, id, opts) }), { label: "Auto-Crossfade" });
}

/** Match the volume of the selected clips (Peak / RMS / Loudness), to a target or the loudest. */
export function applyMatchClipVolume(store: RythmeStore, opts: E.Ops.MatchVolumeOptions = {}): void {
  const ids = store.getState().selection.clipIds;
  if (ids.length < 1) return;
  const mode = opts.mode ?? "peak";
  store.dispatch((st) => ({ ...st, project: E.Ops.matchClipVolume(st.project, ids, opts) }), { label: `Match Clip Volume (${mode})` });
}

const totalClips = (p: E.Project): number => p.tracks.reduce((n, t) => n + t.clips.length, 0);

/** Split clips at every marker (Mark Audio / Mark Beats → clip boundaries). Returns clips added. */
export function applySplitAtMarkers(store: RythmeStore, trackIds?: string[]): number {
  const before = totalClips(store.getState().project);
  store.dispatch((s) => ({ ...s, project: E.Ops.splitClipsAtMarkers(s.project, trackIds) }), { label: "Split at Markers" });
  return totalClips(store.getState().project) - before;
}

/** Merge (join) the selected clips into one rendered clip. */
export function applyMergeClips(store: RythmeStore): void {
  const ids = store.getState().selection.clipIds;
  if (ids.length < 2) return;
  store.dispatch((s) => ({ ...s, project: E.Ops.mergeClips(s.project, ids) }), { label: "Merge Clips" });
}

/** Duplicate the selected clips — each copy placed right after its original
 *  (Audition's Clip ▸ Duplicate). The copies share the source buffer, and the
 *  new copies become the selection (so they're immediately draggable). */
export function duplicateSelectedClips(store: RythmeStore): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  const clipIds = (s = store.getState()) => s.project.tracks.flatMap((t) => t.clips.map((c) => c.id));
  const before = new Set(clipIds());
  store.dispatch((s) => ({ ...s, project: ids.reduce((proj, id) => E.Ops.duplicateClip(proj, id), s.project) }), {
    label: ids.length > 1 ? "Duplicate Clips" : "Duplicate Clip",
  });
  store.dispatch(E.selectClips(clipIds().filter((id) => !before.has(id))), { history: false });
  return true;
}

/** Default clip-nudge increments, in seconds (Audition's Nudge Right/Left). */
export const NUDGE_SECONDS = 0.1;
export const NUDGE_FINE_SECONDS = 0.01;

/** Nudge the selected clips along the timeline by `deltaSeconds` (Audition's clip
 *  Nudge Left/Right). A group moves once as a unit; a locked clip stays put; starts
 *  are clamped to t≥0 by moveClip. One undo step; no-op (false) without a selection. */
export function nudgeSelectedClips(store: RythmeStore, deltaSeconds: number): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  store.dispatch((s) => {
    let p = s.project;
    const movedGroups = new Set<string>();
    for (const id of ids) {
      const found = E.clipById(p, id);
      if (!found) continue;
      const gid = found.clip.groupId;
      if (gid && movedGroups.has(gid)) continue; // a prior member already nudged this group
      p = E.Ops.moveClip(p, id, found.clip.start + deltaSeconds);
      if (gid) movedGroups.add(gid);
    }
    return p === s.project ? s : { ...s, project: p }; // nothing moved (all locked / clamped) → no undo step
  }, { label: deltaSeconds < 0 ? "Nudge Clips Left" : "Nudge Clips Right" });
  return true;
}

/** Nudge each selected clip's gain trim by `deltaDb` (Audition's Clip Gain),
 *  clamped to [−60, +24] dB. One undo step for the batch. */
export function nudgeClipGain(store: RythmeStore, deltaDb: number): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  store.dispatch(
    (s) => ({
      ...s,
      project: ids.reduce((proj, id) => {
        const found = E.clipById(proj, id);
        return found ? E.Ops.setClipGain(proj, id, E.clamp(found.clip.gainDb + deltaDb, -60, 24)) : proj;
      }, s.project),
    }),
    { label: `Clip Gain ${deltaDb >= 0 ? "+" : ""}${deltaDb} dB` },
  );
  return true;
}

/** Reset each selected clip's gain trim to 0 dB. */
export function resetClipGain(store: RythmeStore): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  store.dispatch((s) => ({ ...s, project: ids.reduce((proj, id) => E.Ops.setClipGain(proj, id, 0), s.project) }), { label: "Reset Clip Gain" });
  return true;
}

/** Move the playhead to the next marker after it (Audition marker navigation).
 *  No-op (false) when there's no later marker. */
export function goToNextMarker(store: RythmeStore): boolean {
  const s = store.getState();
  const t = E.Ops.nextMarkerTime(s.project.markers, s.transport.playhead);
  if (t === null) return false;
  store.dispatch(E.setPlayhead(t), { history: false });
  return true;
}

/** Move the playhead to the previous marker before it. No-op when there's none. */
export function goToPrevMarker(store: RythmeStore): boolean {
  const s = store.getState();
  const t = E.Ops.prevMarkerTime(s.project.markers, s.transport.playhead);
  if (t === null) return false;
  store.dispatch(E.setPlayhead(t), { history: false });
  return true;
}

/** Loop the current time selection (Audition's selection-driven transport loop).
 *  Sets the transport loop region to the selection and enables looping. No-op
 *  (false) without a time selection. Transport state — no undo step. */
export function loopSelection(store: RythmeStore): boolean {
  const r = store.getState().selection.range;
  if (!r) return false;
  store.dispatch(E.setLoop(r), { history: false }); // setLoop also flips loopEnabled on
  return true;
}

/** Toggle transport looping (the Loop button). Enabling with a time selection loops
 *  that selection; without one it just enables the flag. Disabling clears the flag. */
export function toggleLoop(store: RythmeStore): void {
  if (store.getState().transport.loopEnabled) {
    store.dispatch(E.setLoopEnabled(false), { history: false });
  } else if (!loopSelection(store)) {
    store.dispatch(E.setLoopEnabled(true), { history: false }); // no selection → just enable the flag
  }
}

/** Merge the markers inside the time selection into one region marker (Audition's
 *  Merge Markers). No-op (false) without a selection or with fewer than 2 markers. */
export function mergeMarkersInSelection(store: RythmeStore): boolean {
  const s = store.getState();
  const range = s.selection.range;
  if (!range) return false;
  if (E.Ops.markersInTimeRange(s.project.markers, range.start, range.end).length < 2) return false;
  store.dispatch((st) => ({ ...st, project: E.Ops.mergeMarkersInRange(st.project, range.start, range.end) }), { label: "Merge Markers" });
  return true;
}

/** Group the selected clips so they move together (Audition's Group Clips). */
export function groupSelectedClips(store: RythmeStore): boolean {
  const ids = store.getState().selection.clipIds;
  if (ids.length < 2) return false;
  store.dispatch((s) => ({ ...s, project: E.Ops.groupClips(s.project, ids) }), { label: "Group Clips" });
  return true;
}

/** Remove the selected clips from their group. */
export function ungroupSelectedClips(store: RythmeStore): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  store.dispatch((s) => ({ ...s, project: E.Ops.ungroupClips(s.project, ids) }), { label: "Ungroup Clips" });
  return true;
}

/** Toggle mute on the selected clips (Audition's Mute Clip(s)). If any selected
 *  clip is audible, mute them all; once all are muted, un-mute them all. Muted
 *  clips stay on the timeline but render silent. One undo step; no-op without a selection. */
export function toggleClipMute(store: RythmeStore): boolean {
  const s = store.getState();
  const ids = s.selection.clipIds;
  if (!ids.length) return false;
  const target = ids.some((id) => !E.clipById(s.project, id)?.clip.muted); // any audible → mute all; else un-mute all
  store.dispatch((st) => ({ ...st, project: ids.reduce((p, id) => E.Ops.setClipMuted(p, id, target), st.project) }), { label: target ? "Mute Clips" : "Unmute Clips" });
  return true;
}

/** Toggle the timeline lock on the selected clips (Audition's Lock in Time). If any
 *  selected clip is unlocked, lock them all; once all are locked, unlock them all.
 *  Locked clips can't be moved on the timeline. One undo step; no-op without a selection. */
export function toggleClipLock(store: RythmeStore): boolean {
  const s = store.getState();
  const ids = s.selection.clipIds;
  if (!ids.length) return false;
  const target = ids.some((id) => !E.clipById(s.project, id)?.clip.locked); // any unlocked → lock all; else unlock all
  store.dispatch((st) => ({ ...st, project: ids.reduce((p, id) => E.Ops.setClipLocked(p, id, target), st.project) }), { label: target ? "Lock Clips" : "Unlock Clips" });
  return true;
}

/** Loop the selected clips `times` repeats of their source (Audition's clip Loop);
 *  `times`=1 turns looping off. One undo step; no-op (false) without a selection. */
export function loopSelectedClips(store: RythmeStore, times: number): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  store.dispatch(
    (s) => ({ ...s, project: ids.reduce((p, id) => E.Ops.setClipLoop(p, id, times), s.project) }),
    { label: times > 1 ? `Loop Clip ×${times}` : "Clip Loop Off" },
  );
  return true;
}

/** Set non-destructive fade handles on the selected clips (Audition's clip
 *  fades). Lengths are clamped to each clip's duration by the op. One undo step. */
export function applyClipFade(store: RythmeStore, edit: E.Ops.FadeEdit, label: string): boolean {
  const ids = store.getState().selection.clipIds;
  if (!ids.length) return false;
  store.dispatch((s) => ({ ...s, project: ids.reduce((proj, id) => E.Ops.setClipFades(proj, id, edit), s.project) }), { label });
  return true;
}

/** Bounce the active track to a new consolidated track (Audition Bounce to New Track). */
export function bounceTrackToNewTrack(store: RythmeStore): boolean {
  const s = store.getState();
  const trackId = s.activeTrackId ?? s.selection.trackIds[0] ?? s.project.tracks[0]?.id;
  if (!trackId) return false;
  store.dispatch((st) => ({ ...st, project: E.Ops.bounceTrackToNewTrack(st.project, trackId) }), { label: "Bounce to New Track" });
  return true;
}

/** Bounce the entire session mix to a new track. */
export function bounceProjectToNewTrack(store: RythmeStore): boolean {
  if (store.getState().project.tracks.length === 0) return false;
  store.dispatch((st) => ({ ...st, project: E.Ops.bounceProjectToNewTrack(st.project) }), { label: "Bounce Session to New Track" });
  return true;
}

/** Normalize the current scope's integrated loudness (LUFS) to a target. */
export function applyMatchLoudness(store: RythmeStore, params: E.DSP.MatchLoudnessOptions = {}): void {
  const label = `Match ${params.targetLufs ?? -16} LUFS`;
  store.dispatch(E.applyEffect((d) => E.DSP.matchLoudness(d, params)), { label });
}

/** Default 4-band mastering preset for the multiband compressor. */
const MULTIBAND_MASTER: E.DSP.MultibandCompressorOptions = {
  bands: [
    { thresholdDb: -28, ratio: 3, makeupDb: 2 },
    { thresholdDb: -24, ratio: 2.5, makeupDb: 1.5 },
    { thresholdDb: -24, ratio: 2.5, makeupDb: 1.5 },
    { thresholdDb: -28, ratio: 3, makeupDb: 2 },
  ],
  limiter: { ceilingDb: -0.3, inputBoostDb: 0 },
};

/** Apply the multiband compressor over the current scope (default: master preset). */
export function applyMultibandCompressor(store: RythmeStore, params: E.DSP.MultibandCompressorOptions = MULTIBAND_MASTER): void {
  store.dispatch(E.applyEffect((d) => E.DSP.multibandCompress(d, params)), { label: "Multiband Compressor" });
}

/** Apply the tube-modeled compressor (warm saturation + compression) over the current scope. */
export function applyTubeCompressor(store: RythmeStore, params: E.DSP.TubeCompressorOptions = { driveDb: 9, warmth: 0.4, thresholdDb: -18, ratio: 3, makeupDb: 3 }): void {
  store.dispatch(E.applyEffect((d) => E.DSP.tubeCompress(d, params)), { label: "Tube Compressor" });
}

/**
 * Gain Envelope presets — time-varying amplitude shapes drawn as control points
 * over the selection: custom fades, a centre duck, a swell, and a tremolo shape.
 */
export const GAIN_ENVELOPE_PRESETS: { id: string; label: string; opts: E.DSP.GainEnvelopeOptions }[] = [
  { id: "genFadeIn", label: "Fade In", opts: { points: [{ time: 0, gain: 0 }, { time: 1, gain: 1 }] } },
  { id: "genFadeOut", label: "Fade Out", opts: { points: [{ time: 0, gain: 1 }, { time: 1, gain: 0 }] } },
  { id: "genFadeInOut", label: "Fade In/Out", opts: { points: [{ time: 0, gain: 0 }, { time: 0.08, gain: 1 }, { time: 0.92, gain: 1 }, { time: 1, gain: 0 }] } },
  { id: "genDuck", label: "Duck Middle", opts: { points: [{ time: 0, gain: 1 }, { time: 0.5, gain: 0.25 }, { time: 1, gain: 1 }], interpolation: "spline" } },
  { id: "genSwell", label: "Swell", opts: { points: [{ time: 0, gain: 0.2 }, { time: 0.5, gain: 1 }, { time: 1, gain: 0.2 }], interpolation: "spline" } },
  { id: "genTremolo", label: "Tremolo Shape", opts: { points: [{ time: 0, gain: 1 }, { time: 0.25, gain: 0.3 }, { time: 0.5, gain: 1 }, { time: 0.75, gain: 0.3 }, { time: 1, gain: 1 }], interpolation: "spline" } },
];

/** Apply a Gain Envelope (time-varying amplitude curve) over the current scope. */
export function applyGainEnvelope(store: RythmeStore, opts: E.DSP.GainEnvelopeOptions, label = "Gain Envelope"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.gainEnvelope(d, opts)), { label });
}

/**
 * Delete Silence presets — how aggressively to trim the gaps between phrases:
 * Tighten leaves a little breathing room, Strip removes the gaps entirely.
 */
export const DELETE_SILENCE_PRESETS: { id: string; label: string; opts: E.DSP.DeleteSilenceOptions }[] = [
  { id: "dsTighten", label: "Tighten Gaps", opts: { thresholdDb: -50, minSilenceMs: 300, keepMs: 150 } },
  { id: "dsRemove", label: "Remove Gaps", opts: { thresholdDb: -50, minSilenceMs: 200, keepMs: 75 } },
  { id: "dsStrip", label: "Strip Silence", opts: { thresholdDb: -45, minSilenceMs: 150, keepMs: 0 } },
];

/** Apply Delete Silence (trim gaps between phrases) over the current scope. */
export function applyDeleteSilence(store: RythmeStore, opts: E.DSP.DeleteSilenceOptions, label = "Delete Silence"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.deleteSilence(d, opts)), { label });
}

/**
 * Convert Sample Type presets — channel-count (mono/stereo) and bit-depth
 * conversions; the lower depths offer dithered and plain (truncated) variants.
 */
export const CONVERT_PRESETS: { id: string; label: string; opts: E.DSP.ConvertSampleTypeOptions }[] = [
  { id: "cvtMono", label: "To Mono", opts: { channels: 1 } },
  { id: "cvtStereo", label: "To Stereo", opts: { channels: 2 } },
  { id: "cvt16", label: "16-bit (Dither)", opts: { bitDepth: 16, dither: true } },
  { id: "cvt12", label: "12-bit (Dither)", opts: { bitDepth: 12, dither: true } },
  { id: "cvt8", label: "8-bit (Truncate)", opts: { bitDepth: 8, dither: false } },
];

/** Apply a Convert Sample Type (channels / bit depth) over the current scope. */
export function applyConvertSampleType(store: RythmeStore, opts: E.DSP.ConvertSampleTypeOptions, label = "Convert Sample Type"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.convertSampleType(d, opts)), { label });
}

/** Common target sample rates for the whole-session conversion. */
export const SAMPLE_RATE_PRESETS: { id: string; label: string; rate: number }[] = [
  { id: "sr22", label: "22.05 kHz", rate: 22050 },
  { id: "sr32", label: "32 kHz", rate: 32000 },
  { id: "sr44", label: "44.1 kHz", rate: 44100 },
  { id: "sr48", label: "48 kHz", rate: 48000 },
  { id: "sr96", label: "96 kHz", rate: 96000 },
];

/**
 * Convert the whole session to `newRate`: resample every clip and update the
 * project rate, in one undoable step. No-op when the rate is unchanged.
 */
export function convertProjectSampleRate(store: RythmeStore, newRate: number, label = "Convert Sample Rate"): void {
  if (newRate <= 0 || newRate === store.getState().project.sampleRate) return;
  store.dispatch((s) => ({ ...s, project: E.Ops.resampleProject(s.project, newRate) }), { label });
}

/** Frequency Band Splitter presets — crossover sets from a simple 2-band to a 5-band split. */
export const BAND_SPLIT_PRESETS: { id: string; label: string; crossovers: number[] }[] = [
  { id: "bs2", label: "2-Band (1 kHz)", crossovers: [1000] },
  { id: "bs3", label: "3-Band (800 · 3.2k)", crossovers: [800, 3200] },
  { id: "bs4", label: "4-Band", crossovers: [120, 1000, 6000] },
  { id: "bs5", label: "5-Band", crossovers: [120, 500, 2000, 8000] },
];

/**
 * Frequency Band Splitter: render the current scope, split it into N+1 frequency
 * bands and drop each band on its own new track. Returns the number of bands
 * created (0 if there is nothing to split).
 */
export function splitIntoBands(store: RythmeStore, crossovers: number[], label = "Frequency Band Splitter"): number {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return 0;
  const bands = E.DSP.frequencyBandSplit(audio, { crossovers });
  const labels = E.DSP.frequencyBandLabels(crossovers, store.getState().project.sampleRate);
  bands.forEach((band, i) => {
    const name = `Band ${i + 1} (${labels[i] ?? "Full Band"})`;
    const before = store.getState().project.tracks.length;
    store.dispatch(E.addTrack({ name }), { label });
    const trackId = store.getState().project.tracks[before].id;
    store.dispatch(E.insertClip(trackId, band, 0, name), { label });
  });
  return bands.length;
}

/** Amplitude Statistics for the current scope (null when there is nothing to measure). */
export function analyzeAmplitude(store: RythmeStore, opts?: E.Analysis.AmplitudeStatisticsOptions): E.Analysis.AmplitudeStatistics | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.amplitudeStatistics(audio, opts);
}

/** Phase Analysis (stereo correlation / width) for the current scope. */
export function analyzePhase(store: RythmeStore): E.Analysis.PhaseAnalysis | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.phaseAnalysis(audio);
}

/** Spectrogram (Spectral Frequency Display) of the current scope. */
export function analyzeSpectrogram(store: RythmeStore, opts?: E.Analysis.SpectrogramOptions): E.Analysis.SpectrogramResult | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.spectrogram(audio, opts);
}

/** Vectorscope / goniometer points (L-vs-R) for the current scope. */
export function analyzeVectorscope(store: RythmeStore, opts?: E.Analysis.VectorscopeOptions): E.Analysis.VectorscopeResult | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.vectorscope(audio, opts);
}

/** Beat / onset detection + tempo (BPM) for the current scope. */
export function analyzeTempo(store: RythmeStore, opts?: E.Analysis.BeatDetectionOptions): E.Analysis.BeatDetectionResult | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.detectBeats(audio, opts);
}

/** Fundamental-pitch / note detection (YIN) for the current scope. */
export function analyzePitch(store: RythmeStore, opts?: E.Analysis.PitchOptions): E.Analysis.PitchResult | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.detectPitch(audio, opts);
}

/** Amplitude histogram (dBFS distribution) for the current scope. */
export function analyzeHistogram(store: RythmeStore, opts?: E.Analysis.AmplitudeHistogramOptions): E.Analysis.AmplitudeHistogramResult | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.amplitudeHistogram(audio, opts);
}

/** EBU R128 / BS.1770 loudness metering plus True Peak (dBTP) for the current scope. */
export interface LoudnessReport extends E.Analysis.LoudnessResult {
  /** Maximum true peak across channels, dBTP. */
  truePeak: number;
  /** Per-channel true peak, dBTP. */
  truePeakChannels: number[];
}

/** Loudness over time (Loudness Radar) for the current scope. */
export function analyzeLoudnessSeries(store: RythmeStore): E.Analysis.LoudnessTimeSeries | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  return E.Analysis.loudnessTimeSeries(audio);
}

/** Loudness Meter (integrated/short-term/LRA + True Peak) for the current scope. */
export function analyzeLoudness(store: RythmeStore): LoudnessReport | null {
  const audio = scopeAudio(store.getState());
  if (!audio || E.frameCount(audio) === 0) return null;
  const l = E.Analysis.measureLoudness(audio);
  const tp = E.Analysis.measureTruePeak(audio);
  return { ...l, truePeak: tp.dBTP, truePeakChannels: tp.channels };
}

/**
 * Mark Audio presets — how the non-silent regions are detected: short phrases,
 * whole takes (longer gaps), or everything above a low floor.
 */
export const MARK_AUDIO_PRESETS: { id: string; label: string; opts: E.Analysis.AudioRegionOptions }[] = [
  { id: "markPhrases", label: "Mark Phrases", opts: { thresholdDb: -45, minSilenceMs: 300, minAudioMs: 150 } },
  { id: "markTakes", label: "Mark Takes", opts: { thresholdDb: -40, minSilenceMs: 800, minAudioMs: 400 } },
  { id: "markAll", label: "Mark Non-Silent", opts: { thresholdDb: -55, minSilenceMs: 150, minAudioMs: 80 } },
];

/**
 * Mark Audio: detect the non-silent regions of the whole mix and drop a range
 * marker on each (one undoable step). Returns the number of markers added.
 */
export function markAudioRegions(store: RythmeStore, opts: E.Analysis.AudioRegionOptions = {}, label = "Mark Audio"): number {
  const mix = E.Ops.renderProject(store.getState().project);
  if (E.frameCount(mix) === 0) return 0;
  const regions = E.Analysis.detectAudioRegions(mix, opts);
  if (!regions.length) return 0;
  store.dispatch((s) => {
    let state = s;
    regions.forEach((r, i) => {
      state = E.addMarker({ time: r.start, end: r.end, name: `Region ${i + 1}` })(state);
    });
    return state;
  }, { label });
  return regions.length;
}

/** Detect beats in the mix and drop a cue marker on each. Returns the detected tempo + beat count. */
export function markBeats(store: RythmeStore, opts: E.Analysis.BeatDetectionOptions = {}, label = "Mark Beats"): E.Analysis.BeatDetectionResult {
  const mix = E.Ops.renderProject(store.getState().project);
  if (E.frameCount(mix) === 0) return { beats: [], bpm: 0 };
  const result = E.Analysis.detectBeats(mix, opts);
  if (!result.beats.length) return result;
  store.dispatch((s) => {
    let state = s;
    result.beats.forEach((t, i) => {
      state = E.addMarker({ time: t, name: `Beat ${i + 1}` })(state);
    });
    return state;
  }, { label });
  return result;
}

/** The project's markers as Audition-style CSV (header + one row per marker). */
export function markersCsv(store: RythmeStore): string {
  return E.IO.exportMarkersCsv(store.getState().project.markers);
}

/** Export the project's markers as a downloadable CSV (Audition marker list). */
export function exportMarkers(store: RythmeStore): void {
  downloadText("markers.csv", markersCsv(store), "text/csv");
}

/** Add markers parsed from a CSV string to the project (one undoable step). Returns the count added. */
export function importMarkersCsv(store: RythmeStore, csv: string): number {
  const parsed = E.IO.parseMarkersCsv(csv);
  if (!parsed.length) return 0;
  store.dispatch((s) => {
    let state = s;
    for (const m of parsed) state = E.addMarker({ time: m.time, end: m.end, name: m.name })(state);
    return state;
  }, { label: "Import Markers" });
  return parsed.length;
}

/** Prompt for a CSV file and import its markers. */
export async function importMarkersFromFile(store: RythmeStore): Promise<number> {
  const files = await pickFiles(".csv,text/csv", false);
  if (!files.length) return 0;
  return importMarkersCsv(store, new TextDecoder().decode(files[0].bytes));
}

/**
 * Dynamics Processing presets — each is a transfer curve (input dB → output dB)
 * whose slope is the ratio at that level: compress, expand, gate or limit.
 */
export const DYNAMICS_PROCESSING_PRESETS: { id: string; label: string; opts: E.DSP.DynamicsProcessingOptions }[] = [
  { id: "dynCompress", label: "Compressor 4:1", opts: { curve: [{ inputDb: -60, outputDb: -60 }, { inputDb: -24, outputDb: -24 }, { inputDb: 0, outputDb: -18 }], detectorAttackMs: 5, detectorReleaseMs: 120, gainAttackMs: 5, gainReleaseMs: 120, makeupDb: 4 } },
  { id: "dynExpand", label: "Expander 2:1", opts: { curve: [{ inputDb: -60, outputDb: -80 }, { inputDb: -40, outputDb: -40 }, { inputDb: 0, outputDb: 0 }], detectorAttackMs: 5, detectorReleaseMs: 120, gainAttackMs: 10, gainReleaseMs: 150 } },
  { id: "dynGate", label: "Noise Gate", opts: { curve: [{ inputDb: -90, outputDb: -120 }, { inputDb: -50, outputDb: -120 }, { inputDb: -45, outputDb: -45 }, { inputDb: 0, outputDb: 0 }], detectorAttackMs: 1, detectorReleaseMs: 100, gainAttackMs: 1, gainReleaseMs: 100 } },
  { id: "dynLimit", label: "Limiter", opts: { curve: [{ inputDb: -60, outputDb: -60 }, { inputDb: -1, outputDb: -1 }, { inputDb: 0, outputDb: -1 }], detectorAttackMs: 1, detectorReleaseMs: 60, gainAttackMs: 1, gainReleaseMs: 50 } },
];

/** Apply a Dynamics Processing transfer curve over the current scope. */
export function applyDynamicsProcessing(store: RythmeStore, opts: E.DSP.DynamicsProcessingOptions, label = "Dynamics Processing"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.dynamicsProcessing(d, opts)), { label });
}

/** Helper: build harmonic notch bands (fundamental + N harmonics) at a depth. */
function hum(fundamental: number, count: number, gainDb: number): E.DSP.NotchBand[] {
  return Array.from({ length: count }, (_, i) => ({ frequency: fundamental * (i + 1), gainDb }));
}

/**
 * Notch Filter presets — each removes a set of independent frequencies. AC-hum
 * presets pull the fundamental + harmonics; DTMF pulls the eight touch-tones.
 */
export const NOTCH_FILTER_PRESETS: { id: string; label: string; opts: E.DSP.NotchFilterOptions }[] = [
  { id: "notch60", label: "60 Hz Hum", opts: { notches: hum(60, 6, -40), q: 30 } },
  { id: "notch50", label: "50 Hz Hum", opts: { notches: hum(50, 6, -40), q: 30 } },
  { id: "notchA440", label: "A 440 Pitch", opts: { notches: [{ frequency: 440, gainDb: -40 }], q: 60 } },
  { id: "notchDtmf", label: "DTMF Tones", opts: { notches: [697, 770, 852, 941, 1209, 1336, 1477, 1633].map((f) => ({ frequency: f, gainDb: -30 })), q: 50 } },
];

/** Apply a Notch Filter (independent multi-notch) over the current scope. */
export function applyNotchFilter(store: RythmeStore, opts: E.DSP.NotchFilterOptions, label = "Notch Filter"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.notchFilter(d, opts)), { label });
}

/**
 * Graphic Equalizer presets — one slider per 10 ISO octave bands
 * (31 Hz … 16 kHz), the classic tone-shaping EQ. Each `gainsDb` lines up with
 * E.DSP.GRAPHIC_EQ_FREQS; a flat (all-zero) curve is a transparent pass-through.
 */
export const GRAPHIC_EQ_PRESETS: { id: string; label: string; gainsDb: number[] }[] = [
  { id: "bassBoost", label: "Bass Boost", gainsDb: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: "trebleBoost", label: "Treble Boost", gainsDb: [0, 0, 0, 0, 0, 2, 4, 5, 6, 6] },
  { id: "loudness", label: "Loudness (Smile)", gainsDb: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
  { id: "vocalPresence", label: "Vocal Presence", gainsDb: [-2, -1, 0, 1, 2, 3, 3, 2, 1, 0] },
  { id: "midScoop", label: "Mid Scoop (Metal)", gainsDb: [3, 2, 0, -3, -5, -5, -3, 0, 2, 3] },
  { id: "telephone", label: "Telephone", gainsDb: [-18, -12, -3, 2, 3, 2, -3, -12, -18, -24] },
];

/** Apply a Graphic Equalizer (10-band octave EQ) over the current scope. */
export function applyGraphicEq(store: RythmeStore, gainsDb: number[], label = "Graphic Equalizer"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.graphicEQ(d, gainsDb)), { label });
}

/**
 * Parametric Equalizer presets — cascades of free-form bands (high/low-pass,
 * low/high shelves and peaking bells with their own freq/Q/gain), the surgical
 * counterpart to the fixed-band Graphic EQ.
 */
export const PARAMETRIC_EQ_PRESETS: { id: string; label: string; bands: E.DSP.EQBand[] }[] = [
  {
    id: "vocalClarity",
    label: "Vocal Clarity",
    bands: [
      { type: "highpass", freq: 80, q: 0.707 },
      { type: "peaking", freq: 300, q: 1.2, gainDb: -3 },
      { type: "peaking", freq: 4000, q: 1.0, gainDb: 3 },
      { type: "highshelf", freq: 10000, gainDb: 2 },
    ],
  },
  {
    id: "warm",
    label: "Warm",
    bands: [
      { type: "lowshelf", freq: 150, gainDb: 3 },
      { type: "peaking", freq: 3000, q: 1.0, gainDb: -2 },
      { type: "highshelf", freq: 9000, gainDb: -2 },
    ],
  },
  {
    id: "bright",
    label: "Bright / Air",
    bands: [
      { type: "peaking", freq: 3000, q: 1.0, gainDb: 2 },
      { type: "highshelf", freq: 8000, gainDb: 4 },
    ],
  },
  { id: "deMud", label: "De-Mud", bands: [{ type: "peaking", freq: 300, q: 1.4, gainDb: -5 }] },
  {
    id: "loudness",
    label: "Loudness",
    bands: [
      { type: "lowshelf", freq: 90, gainDb: 4 },
      { type: "highshelf", freq: 12000, gainDb: 3 },
    ],
  },
  {
    id: "lofi",
    label: "Lo-Fi (Telephone)",
    bands: [
      { type: "highpass", freq: 400, q: 0.707 },
      { type: "lowpass", freq: 3000, q: 0.707 },
    ],
  },
];

/** Apply a Parametric Equalizer (free-form band cascade) over the current scope. */
export function applyParametricEq(store: RythmeStore, bands: E.DSP.EQBand[], label = "Parametric Equalizer"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.parametricEQ(d, bands)), { label });
}

/**
 * Scientific Filter presets — high-order analog-prototype IIR designs
 * (Butterworth · Chebyshev · Bessel) in each response shape, the steep,
 * arbitrary-order counterpart to the second-order biquad filters.
 */
export const SCIENTIFIC_FILTER_PRESETS: { id: string; label: string; opts: E.DSP.ScientificFilterOptions }[] = [
  { id: "sciLp", label: "Butterworth Low-Pass 1 kHz", opts: { kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 1000 } },
  { id: "sciHp", label: "Butterworth High-Pass 100 Hz", opts: { kind: "butterworth", response: "highpass", order: 4, cutoffHz: 100 } },
  { id: "sciTel", label: "Telephone Band-Pass", opts: { kind: "butterworth", response: "bandpass", order: 4, cutoffHz: 300, cutoffHz2: 3400 } },
  { id: "sciSharp", label: "Chebyshev Sharp LP 5 kHz", opts: { kind: "chebyshev1", response: "lowpass", order: 8, cutoffHz: 5000, rippleDb: 0.5 } },
  { id: "sciNotch", label: "Band-Stop 800–1200 Hz", opts: { kind: "chebyshev2", response: "bandstop", order: 6, cutoffHz: 800, cutoffHz2: 1200, stopAttenDb: 48 } },
  { id: "sciBessel", label: "Bessel Low-Pass 2 kHz", opts: { kind: "bessel", response: "lowpass", order: 6, cutoffHz: 2000 } },
  { id: "sciElliptic", label: "Elliptic Brickwall LP 3 kHz", opts: { kind: "elliptic", response: "lowpass", order: 6, cutoffHz: 3000, rippleDb: 0.5, stopAttenDb: 60 } },
];

/** Apply a Scientific Filter (high-order analog-prototype IIR) over the current scope. */
export function applyScientificFilter(store: RythmeStore, opts: E.DSP.ScientificFilterOptions, label = "Scientific Filter"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.scientificFilter(d, opts)), { label });
}

/**
 * Exciter presets — parallel harmonic enhancement by character. Tape/Air are
 * smooth (odd harmonics); Retro is brighter/harder; Tube adds even harmonics.
 */
export const EXCITER_PRESETS: { id: string; label: string; opts: E.DSP.ExciterOptions }[] = [
  { id: "excTape", label: "Tape (warm)", opts: { mode: "tape", frequency: 3000, driveDb: 12, mix: 0.3 } },
  { id: "excRetro", label: "Retro (bright)", opts: { mode: "retro", frequency: 4000, driveDb: 15, mix: 0.35 } },
  { id: "excTube", label: "Tube (rich)", opts: { mode: "tube", frequency: 3000, driveDb: 12, mix: 0.3 } },
  { id: "excAir", label: "Air (sparkle)", opts: { mode: "tape", frequency: 8000, driveDb: 14, mix: 0.4 } },
];

/** Apply the harmonic Exciter over the current scope. */
export function applyExciter(store: RythmeStore, opts: E.DSP.ExciterOptions, label = "Exciter"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.exciter(d, opts)), { label });
}

/**
 * Speech Volume Leveler presets — leveling intensity (amount). Gentle keeps more
 * of the original dynamics; Strong drives everything hard toward the target.
 */
export const SPEECH_LEVELER_PRESETS: { id: string; label: string; opts: E.DSP.SpeechLevelerOptions }[] = [
  { id: "levelGentle", label: "Gentle", opts: { targetDb: -18, amount: 0.4, maxGainDb: 18 } },
  { id: "levelMedium", label: "Medium", opts: { targetDb: -18, amount: 0.7, maxGainDb: 24 } },
  { id: "levelStrong", label: "Strong", opts: { targetDb: -16, amount: 1, maxGainDb: 30 } },
];

/** Apply the Speech Volume Leveler over the current scope. */
export function applySpeechLeveler(store: RythmeStore, opts: E.DSP.SpeechLevelerOptions, label = "Speech Volume Leveler"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.speechLeveler(d, opts)), { label });
}

/**
 * Guitar Suite presets — amp/cabinet voicings by character, from a clean combo
 * to a high-gain fuzz. Each shapes drive, cabinet tone and presence together.
 */
export const GUITAR_SUITE_PRESETS: { id: string; label: string; opts: E.DSP.GuitarSuiteOptions }[] = [
  { id: "gtrClean", label: "Clean", opts: { mode: "clean", driveDb: 6, toneHz: 6000, presenceDb: 2 } },
  { id: "gtrCrunch", label: "Crunch", opts: { mode: "crunch", driveDb: 14, toneHz: 5000, presenceDb: 3 } },
  { id: "gtrLead", label: "Lead", opts: { mode: "lead", driveDb: 18, toneHz: 4500, presenceDb: 5 } },
  { id: "gtrFuzz", label: "Fuzz", opts: { mode: "lead", driveDb: 24, toneHz: 4000, presenceDb: 4 } },
];

/** Apply the Guitar Suite (amp + cabinet chain) over the current scope. */
export function applyGuitarSuite(store: RythmeStore, opts: E.DSP.GuitarSuiteOptions, label = "Guitar Suite"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.guitarSuite(d, opts)), { label });
}

/**
 * Hiss Reduction presets — strength of the adaptive broadband-hiss reduction.
 * Light is gentle/transparent; Strong removes the most floor noise.
 */
export const HISS_REDUCTION_PRESETS: { id: string; label: string; opts: E.DSP.HissReductionOptions }[] = [
  { id: "hissLight", label: "Light", opts: { reduceByDb: 10, amount: 0.6, sensitivityDb: 6 } },
  { id: "hissMedium", label: "Medium", opts: { reduceByDb: 20, amount: 0.9, sensitivityDb: 4 } },
  { id: "hissStrong", label: "Strong", opts: { reduceByDb: 30, amount: 1, sensitivityDb: 3 } },
];

/** Apply adaptive Hiss Reduction over the current scope. */
export function applyHissReduction(store: RythmeStore, opts: E.DSP.HissReductionOptions, label = "Hiss Reduction"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.hissReduction(d, opts)), { label });
}

/**
 * Studio Reverb presets — room characters from a tight room to a long hall and a
 * bright plate, varying decay, early-reflection spread, width and mix.
 */
export const STUDIO_REVERB_PRESETS: { id: string; label: string; opts: E.DSP.StudioReverbOptions }[] = [
  { id: "srvRoom", label: "Room", opts: { decay: 0.3, earlyMs: 50, earlyLevel: 0.6, width: 0.5, mix: 0.25, tailSeconds: 0.8 } },
  { id: "srvStudio", label: "Studio", opts: { decay: 0.5, earlyMs: 80, earlyLevel: 0.5, width: 0.7, mix: 0.3, tailSeconds: 1.2 } },
  { id: "srvHall", label: "Hall", opts: { decay: 0.85, earlyMs: 120, earlyLevel: 0.4, width: 0.8, mix: 0.35, tailSeconds: 2.5 } },
  { id: "srvPlate", label: "Plate", opts: { decay: 0.7, earlyMs: 30, earlyLevel: 0.3, width: 1, damping: 0.2, mix: 0.35, tailSeconds: 1.8 } },
];

/** Apply the Studio Reverb (early reflections + tail) over the current scope. */
export function applyStudioReverb(store: RythmeStore, opts: E.DSP.StudioReverbOptions, label = "Studio Reverb"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.studioReverb(d, opts)), { label });
}

/**
 * Full Reverb presets — convolution-reverb spaces of growing size (decay time +
 * perception), with the Coloration EQ shaping each room's high-frequency
 * absorption: from a damped small room to a bright cathedral.
 */
export const FULL_REVERB_PRESETS: { id: string; label: string; opts: E.DSP.FullReverbOptions }[] = [
  { id: "frvRoom", label: "Small Room", opts: { decayMs: 600, perception: 30, absorption: 0.4, coloration: { highDb: -8, highFreq: 5000 }, mix: 0.25 } },
  { id: "frvChamber", label: "Chamber", opts: { decayMs: 1200, perception: 45, absorption: 0.35, coloration: { highDb: -6, highFreq: 6000 }, mix: 0.3 } },
  { id: "frvHall", label: "Concert Hall", opts: { decayMs: 2400, perception: 70, absorption: 0.3, coloration: { lowDb: 2, lowFreq: 200, highDb: -4, highFreq: 7000 }, mix: 0.32 } },
  { id: "frvCathedral", label: "Cathedral", opts: { decayMs: 3800, perception: 85, absorption: 0.25, coloration: { highDb: -3, highFreq: 8000 }, mix: 0.35 } },
  { id: "frvDark", label: "Dark Room", opts: { decayMs: 1500, perception: 40, absorption: 0.6, coloration: { highDb: -16, highFreq: 3500 }, mix: 0.3 } },
];

/** Apply the Full Reverb (synthesized colored-IR convolution) over the current scope. */
export function applyFullReverb(store: RythmeStore, opts: E.DSP.FullReverbOptions, label = "Full Reverb"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.fullReverb(d, opts)), { label });
}

/**
 * Mastering presets — master-bus voicings: warm (low-end weight), bright (air),
 * loud (hard maximizing), wide (stereo image), and open (subtle ambience).
 */
export const MASTERING_PRESETS: { id: string; label: string; opts: E.DSP.MasteringOptions }[] = [
  { id: "masterWarm", label: "Warm", opts: { lowShelfDb: 3, highShelfDb: 1, exciteAmount: 0.15, width: 1.1, driveDb: 2, ceilingDb: -1 } },
  { id: "masterBright", label: "Bright", opts: { lowShelfDb: 0, highShelfDb: 4, exciteAmount: 0.35, width: 1.2, driveDb: 3, ceilingDb: -1 } },
  { id: "masterLoud", label: "Loud", opts: { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.1, driveDb: 8, ceilingDb: -0.3 } },
  { id: "masterWide", label: "Wide", opts: { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.6, driveDb: 3, ceilingDb: -1 } },
  { id: "masterOpen", label: "Open", opts: { lowShelfDb: 1, highShelfDb: 2.5, exciteAmount: 0.18, width: 1.25, ambience: 0.08, ambienceDecayMs: 260, ambiencePreDelayMs: 8, driveDb: 3, ceilingDb: -1 } },
];

/** Apply the Mastering rack over the current scope. */
export function applyMastering(store: RythmeStore, opts: E.DSP.MasteringOptions, label = "Mastering"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.mastering(d, opts)), { label });
}

/**
 * Analog Delay presets — vintage echo characters: tape, tube, bucket-brigade and
 * a short bright slapback. Each darkens and warms the repeats in the feedback path.
 */
export const ANALOG_DELAY_PRESETS: { id: string; label: string; opts: E.DSP.AnalogDelayOptions }[] = [
  { id: "adlTape", label: "Tape Echo", opts: { mode: "tape", delayMs: 380, feedback: 0.45, toneHz: 3000, driveDb: 6, mix: 0.4 } },
  { id: "adlTube", label: "Tube Echo", opts: { mode: "tube", delayMs: 300, feedback: 0.4, toneHz: 3500, driveDb: 9, mix: 0.4 } },
  { id: "adlBbd", label: "BBD", opts: { mode: "bbd", delayMs: 250, feedback: 0.5, toneHz: 2200, driveDb: 6, mix: 0.4 } },
  { id: "adlSlap", label: "Slapback", opts: { mode: "tape", delayMs: 110, feedback: 0.15, toneHz: 5000, driveDb: 4, mix: 0.35 } },
];

/** Apply the Analog Delay (vintage feedback echo) over the current scope. */
export function applyAnalogDelay(store: RythmeStore, opts: E.DSP.AnalogDelayOptions, label = "Analog Delay"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.analogDelay(d, opts)), { label });
}

/**
 * Adaptive Noise Reduction presets — strength of the time-adaptive reduction.
 * Light is gentle/transparent; Strong tracks and removes the most noise.
 */
export const ADAPTIVE_NR_PRESETS: { id: string; label: string; opts: E.DSP.AdaptiveNoiseReductionOptions }[] = [
  { id: "anrLight", label: "Light", opts: { reduceByDb: 9, sensitivityDb: 8 } },
  { id: "anrMedium", label: "Medium", opts: { reduceByDb: 18, sensitivityDb: 10 } },
  { id: "anrStrong", label: "Strong", opts: { reduceByDb: 30, sensitivityDb: 12, adaptMs: 600 } },
];

/** Apply adaptive (time-tracking) noise reduction over the current scope. */
export function applyAdaptiveNoiseReduction(store: RythmeStore, opts: E.DSP.AdaptiveNoiseReductionOptions, label = "Adaptive Noise Reduction"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.adaptiveNoiseReduction(d, opts)), { label });
}

/**
 * Automatic Pitch Correction presets — how hard to pull the detected pitch toward
 * the nearest semitone. Tune fully snaps; Gentle nudges it partway.
 */
export const AUTO_PITCH_PRESETS: { id: string; label: string; opts: E.DSP.AutoPitchOptions }[] = [
  { id: "tuneFull", label: "Tune", opts: { strength: 1 } },
  { id: "tuneMedium", label: "Medium", opts: { strength: 0.7 } },
  { id: "tuneGentle", label: "Gentle", opts: { strength: 0.4 } },
];

/** Apply Automatic Pitch Correction (snap to nearest semitone) over the current scope. */
export function applyAutoPitchCorrect(store: RythmeStore, opts: E.DSP.AutoPitchOptions, label = "Automatic Pitch Correction"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.autoPitchCorrect(d, opts)), { label });
}

/**
 * Waveshaper Distortion presets — Audition-style transfer-curve "distortion
 * graphs". Each maps input amplitude → output amplitude per sample, generating
 * harmonics: Hard Clip flat-tops at ±0.5; Soft Saturate is a gentle S-curve;
 * Fuzz is asymmetric (even + odd harmonics); Full-Wave Rectify folds the
 * negative half up (output = |input|).
 */
export const WAVESHAPER_PRESETS: { id: string; label: string; opts: E.DSP.WaveshaperOptions }[] = [
  {
    id: "wsHardClip",
    label: "Hard Clip",
    opts: {
      driveDb: 6,
      curve: [
        { in: -1, out: -0.5 },
        { in: -0.5, out: -0.5 },
        { in: 0.5, out: 0.5 },
        { in: 1, out: 0.5 },
      ],
    },
  },
  {
    id: "wsSoftSat",
    label: "Soft Saturate",
    opts: {
      driveDb: 3,
      curve: [
        { in: -1, out: -1 },
        { in: -0.5, out: -0.7 },
        { in: 0, out: 0 },
        { in: 0.5, out: 0.7 },
        { in: 1, out: 1 },
      ],
    },
  },
  {
    id: "wsFuzz",
    label: "Fuzz",
    opts: {
      driveDb: 9,
      curve: [
        { in: -1, out: -0.6 },
        { in: -0.5, out: -0.45 },
        { in: 0, out: 0 },
        { in: 0.4, out: 0.7 },
        { in: 1, out: 0.8 },
      ],
    },
  },
  {
    id: "wsRectify",
    label: "Full-Wave Rectify",
    opts: {
      driveDb: 0,
      curve: [
        { in: -1, out: 1 },
        { in: -0.5, out: 0.5 },
        { in: 0, out: 0 },
        { in: 0.5, out: 0.5 },
        { in: 1, out: 1 },
      ],
    },
  },
];

/** Apply Waveshaper Distortion (transfer-curve graph) over the current scope. */
export function applyWaveshaper(store: RythmeStore, opts: E.DSP.WaveshaperOptions, label = "Waveshaper Distortion"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.waveshaper(d, opts)), { label });
}

/**
 * DeReverb presets — how aggressively to suppress the reverberant tail. Light is
 * transparent; Strong tracks longer tails and attenuates them harder.
 */
export const DEREVERB_PRESETS: { id: string; label: string; opts: E.DSP.DeReverbOptions }[] = [
  { id: "drLight", label: "Light", opts: { amount: 0.4, reverbMs: 300 } },
  { id: "drMedium", label: "Medium", opts: { amount: 0.7, reverbMs: 500 } },
  { id: "drStrong", label: "Strong", opts: { amount: 0.9, reverbMs: 800, reduceByDb: 28 } },
];

/** Apply DeReverb (reverb-tail suppression) over the current scope. */
export function applyDeReverb(store: RythmeStore, opts: E.DSP.DeReverbOptions, label = "DeReverb"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.deReverb(d, opts)), { label });
}

/**
 * DeClipper presets — the amplitude threshold above which samples count as
 * clipped. Light only repairs near-full-scale flats; Strong has a lower
 * threshold so it also catches and rebuilds softer clipping.
 */
export const DECLIPPER_PRESETS: { id: string; label: string; opts: E.DSP.DeClipperOptions }[] = [
  { id: "dcLight", label: "Light", opts: { threshold: 0.97 } },
  { id: "dcMedium", label: "Medium", opts: { threshold: 0.93 } },
  { id: "dcStrong", label: "Strong", opts: { threshold: 0.88 } },
];

/** Apply DeClipper (clip restoration) over the current scope. */
export function applyDeClipper(store: RythmeStore, opts: E.DSP.DeClipperOptions, label = "DeClipper"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.deClip(d, opts)), { label });
}

/**
 * Automatic Phase Correction presets — auto-align the stereo channels by the
 * width of the lag search, plus a polarity-only fix. Larger search windows catch
 * bigger azimuth/timing errors; "Fix Polarity Only" just flips an inverted side.
 */
export const AUTO_PHASE_PRESETS: { id: string; label: string; opts: E.DSP.AutoPhaseCorrectionOptions }[] = [
  { id: "aphAuto", label: "Auto Align", opts: { mode: "auto", maxShiftMs: 5, correctPolarity: true } },
  { id: "aphTight", label: "Tight Align (2 ms)", opts: { mode: "auto", maxShiftMs: 2, correctPolarity: true } },
  { id: "aphWide", label: "Wide Align (20 ms)", opts: { mode: "auto", maxShiftMs: 20, correctPolarity: true } },
  { id: "aphPolarity", label: "Fix Polarity Only", opts: { mode: "auto", maxShiftMs: 0, correctPolarity: true } },
];

/** Apply Automatic Phase Correction (inter-channel alignment) over the current scope. */
export function applyAutoPhaseCorrect(store: RythmeStore, opts: E.DSP.AutoPhaseCorrectionOptions, label = "Auto Phase Correction"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.autoPhaseCorrect(d, opts)), { label });
}

/**
 * Echo presets — Audition-style feedback echo with successive (cumulative) EQ on
 * each repeat. Slapback is a short, bright single-ish slap; Tape Echo darkens the
 * repeats progressively; Dub is long, resonant and heavily filtered.
 */
export const ECHO_PRESETS: { id: string; label: string; opts: E.DSP.EchoOptions }[] = [
  { id: "echoSlap", label: "Slapback", opts: { delayMs: 120, feedback: 0.3, mix: 0.5, eqGainsDb: [0, 0, 0, 0, 0, 0, -1, -2, -3, -4] } },
  { id: "echoTape", label: "Tape Echo", opts: { delayMs: 300, feedback: 0.55, mix: 0.5, eqGainsDb: [0, 0, 0, 0, 0, -2, -4, -7, -10, -14] } },
  { id: "echoDub", label: "Dub", opts: { delayMs: 450, feedback: 0.7, mix: 0.6, eqGainsDb: [-6, -3, 0, 0, 0, -3, -6, -10, -14, -18] } },
];

/** Apply Echo (successive-equalization feedback echo) over the current scope. */
export function applyEcho(store: RythmeStore, opts: E.DSP.EchoOptions, label = "Echo"): void {
  store.dispatch(E.applyEffect((d) => E.DSP.echo(d, opts)), { label });
}
