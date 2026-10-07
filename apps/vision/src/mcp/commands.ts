// Monet Vision — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a new
// command is added without regenerating. To add a feature to the MCP surface,
// add a typed, `@mcp`-tagged exported function here that calls into the app's
// existing action layer (state/app.ts).
//
// Keep these thin: they delegate to the same `adj`/`fil`/`xform`/store/engine
// actions the UI uses, so MCP automation and the UI stay in lockstep.

import { isTauri } from "@tauri-apps/api/core";
import type { McpImageResult } from "@monet-ui/monet-mcp";
import { BLEND_GAMMA_MAX, BLEND_GAMMA_MIN, colorModeName, documentProfileName } from "@monet-ui/monet-color";

import { adj, fil, xform, store, engine, openPath, openPhotoshopRawPath, loadDicomPaths, removeDistractions, removeReflections, splitReflections, adaptiveWideAngle, ml, actions, batchProcess, runDroplet, saveDropletFile, runScript, bytesForExt, smart, preparePrintJob, cascadeFloats } from "../state/app";
import { printPng } from "../print";
import { PRINT_MEDIA, loadPrintSettings, printLayout, printSettingsError, savePrintSettings, type PrintSettings } from "../state/printSettings";
import { DROPLET_MAX_BYTES, parseDroplet } from "../state/batchIo";
import { readNativeFileBounded } from "../state/nativeBoundedRead";
import { assertHistorySettled } from "../engine/historyTransaction";
import { atomicWriteBytes } from "../state/atomicWrite";
import { extOf, FLAT_SAVE_EXTENSIONS, isProjectSaveExtension } from "../state/nativeIoPolicy";
import { normalizeWorkingRecipe } from "../state/visionDevelopRecipe";
import { cameraRawProfileMenu, MAX_CAMERA_PROFILE_BYTES } from "../state/cameraRawProfiles";
import { LENS_PROFILES, resolveLensProfile, type LensCorrectionSettings } from "@monet-ui/monet-photo";
import { applyLensProfileCorrection } from "../state/app";
import { LAYER_KIND } from "../state/engineContracts";
import { resolveSdBase } from "../ml/modelSource";
import { documentSizeToPixels } from "../state/docPresets";
import { MAX_SCRIPT_IMPORT_BYTES } from "../state/scriptLimits";
import { atnToActionsFile, MAX_ATN_IMPORT_BYTES } from "../state/actionSets";
import { sanitizeAdaptiveWide, type AdaptiveWideConstraint } from "../state/adaptiveWideAngle";
import { HS_RANGES, packHueSaturation } from "../state/hueSaturation";
import { packBlackWhite } from "../state/blackWhite";
import { beginMlJob, cancelMlJob, isMlCancel } from "../ml/mlJob";
import { PANEL_THUMBNAIL_SIZES } from "../state/panelOptions";
import { runScriptEventBindings } from "../state/scriptEvents";
import { commandPalette } from "../state/app";
import {
  DEFAULT_SHORTCUT_SET_NAME, loadShortcutSets, loadShortcutSetSelection, saveShortcutSets,
  parseShortcutSet, serializeShortcutSet, putShortcutSet, sameShortcuts,
} from "../state/shortcutSets";

const MAX_CAMERA_RAW_RECIPE_JSON_LENGTH = 1_048_576;
const MAX_ADAPTIVE_WIDE_CONSTRAINTS_JSON_LENGTH = 65_536;

// ── Document ────────────────────────────────────────────────────────────────

/**
 * Open a new tab with a blank document. Oversized requests are scaled to the engine's safe pixel budget. The reported name is the tab title after de-duplication.
 * @mcp doc.new
 * @param width Canvas width in the selected unit (0.00001..32767).
 * @param height Canvas height in the selected unit (0.00001..32767).
 * @param name Document name shown in the title.
 * @param resolutionPpi Physical resolution in pixels per inch (1..100000).
 * @param colorMode Document color mode.
 * @param colorProfile Built-in RGB color profile; ignored for non-RGB documents.
 * @param sizeUnit Unit for width and height.
 */
export function newDocument(width: number, height: number, name = "Untitled", resolutionPpi = 72, colorMode: "rgb" | "grayscale" | "cmyk" | "lab" | "multichannel" = "rgb", colorProfile: "srgb" | "display-p3" | "adobe-rgb" | "rec-2020" = "srgb", sizeUnit: "px" | "in" | "cm" | "mm" | "pt" | "pc" = "px"): string {
  const size = documentSizeToPixels(width, height, sizeUnit, resolutionPpi);
  store.newDocument(size.w, size.h, name, "white", 1, {
    resolutionPpi,
    colorMode: ["rgb", "grayscale", "cmyk", "lab", "multichannel"].indexOf(colorMode),
    colorProfile: ["srgb", "display-p3", "adobe-rgb", "rec-2020"].indexOf(colorProfile),
  });
  return `Created ${size.w}×${size.h} document "${store.activeName()}"`;
}

/**
 * Edit ▸ Color Settings: the Black Point Compensation default profile conversions start from, and the Advanced options. The two blend gammas change how layers composite (and so exports and Flatten); Desaturate Monitor Colors changes only the screen. Omitted options keep their current value.
 * @mcp doc.setColorSettings
 * @param blackPointCompensation Use Black Point Compensation by default in Convert to Profile and the open/paste profile conversions.
 * @param desaturateMonitorColors Desaturate Monitor Colors By this percent (0..100); 0 turns it off.
 * @param blendRgbGamma Blend RGB Colors Using this gamma, between 1 and 3 (1 blends in linear light); 0 turns it off.
 * @param blendTextGamma Blend Text Colors Using this gamma for type layers, between 1 and 3; 0 turns it off.
 */
export function setColorSettings(blackPointCompensation?: boolean, desaturateMonitorColors?: number, blendRgbGamma?: number, blendTextGamma?: number): string {
  const range = (name: string, v: number | undefined, lo: number, hi: number) => {
    if (v !== undefined && v !== 0 && !(v >= lo && v <= hi)) throw new Error(`${name} must be 0 (off) or between ${lo} and ${hi}; got ${v}`);
  };
  range("desaturateMonitorColors", desaturateMonitorColors, 0, 100);
  range("blendRgbGamma", blendRgbGamma, BLEND_GAMMA_MIN, BLEND_GAMMA_MAX);
  range("blendTextGamma", blendTextGamma, BLEND_GAMMA_MIN, BLEND_GAMMA_MAX);
  const patch: Partial<typeof store.state.colorPolicyPrefs> = {};
  if (blackPointCompensation !== undefined) patch.blackPointCompensation = blackPointCompensation;
  if (desaturateMonitorColors !== undefined) {
    patch.desaturateMonitorColors = desaturateMonitorColors > 0;
    if (desaturateMonitorColors > 0) patch.desaturateMonitorAmount = desaturateMonitorColors;
  }
  if (blendRgbGamma !== undefined) {
    patch.blendRgbColorsUsingGamma = blendRgbGamma > 0;
    if (blendRgbGamma > 0) patch.blendRgbGamma = blendRgbGamma;
  }
  if (blendTextGamma !== undefined) {
    patch.blendTextColorsUsingGamma = blendTextGamma > 0;
    if (blendTextGamma > 0) patch.blendTextGamma = blendTextGamma;
  }
  store.setColorPolicyPrefs(patch);
  const p = store.state.colorPolicyPrefs;
  return JSON.stringify({
    blackPointCompensation: p.blackPointCompensation,
    desaturateMonitorColors: p.desaturateMonitorColors ? p.desaturateMonitorAmount : 0,
    blendRgbGamma: p.blendRgbColorsUsingGamma ? p.blendRgbGamma : 0,
    blendTextGamma: p.blendTextColorsUsingGamma ? p.blendTextGamma : 0,
  });
}

const MCP_RGB_PROFILES = ["srgb", "display-p3", "adobe-rgb", "rec-2020"] as const;
const MCP_INTENTS = ["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"] as const;

/**
 * Edit ▸ Convert to Profile: convert the document into a built-in RGB profile (an RGB document), or separate it through the bundled working CMYK press profile (ISO Coated v2 300%, FOGRA39), which makes it a CMYK document whose plates come from that profile. 8/16-bit only for the CMYK destination.
 * @mcp doc.convertToProfile
 * @param destination Destination profile.
 * @param intent Rendering intent.
 * @param blackPointCompensation Map the source black point onto the destination's, keeping shadow detail. Defaults to Color Settings' Use Black Point Compensation.
 * @param dither Dither the converted 8-bit values instead of rounding them (no effect on 16/32-bit documents).
 */
export async function convertToProfile(
  destination: "srgb" | "display-p3" | "adobe-rgb" | "rec-2020" | "working-cmyk" = "srgb",
  intent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric" = "relative-colorimetric",
  blackPointCompensation?: boolean,
  dither = false,
): Promise<string> {
  blackPointCompensation ??= store.state.colorPolicyPrefs.blackPointCompensation;
  const rendering = MCP_INTENTS.indexOf(intent);
  if (rendering < 0) throw new Error(`Unknown rendering intent "${intent}"`);
  if (destination === "working-cmyk") {
    const icc = await store.workingCmykProfile();
    if (!icc) throw new Error("The working CMYK press profile could not be loaded.");
    store.convertToProfile(store.state.colorProfile, rendering, blackPointCompensation, icc, "ISO Coated v2 300% (ECI)", dither);
  } else {
    const profile = MCP_RGB_PROFILES.indexOf(destination);
    if (profile < 0) throw new Error(`Unknown destination profile "${destination}"`);
    store.convertToProfile(profile, rendering, blackPointCompensation, null, null, dither);
  }
  const { mode, colorProfile, colorProfileAssigned, iccProfileName, modeProfileName } = store.state;
  return `Document is ${colorModeName(mode)} / ${documentProfileName(colorProfile, colorProfileAssigned, iccProfileName, mode, modeProfileName)}`;
}

/**
 * File ▸ Print… settings, which Print One Copy (print.oneCopy) prints with: media and orientation, position, scale and Color Management. Omitted options keep their saved value; invalid ones are refused and nothing is saved. Returns the resulting layout.
 * @mcp print.setSettings
 * @param media Media size.
 * @param landscape Landscape page orientation.
 * @param center Center the image on the media; false places it at top/left.
 * @param top Inches from the page's top edge to the image, when not centered.
 * @param left Inches from the page's left edge to the image, when not centered.
 * @param scaleToFit Scale to Fit Media; false prints at scale.
 * @param scale Percent of the document's print size, its pixels at its ppi (1..1000).
 * @param colorHandling photoshop converts through the printer profile before spooling; printer sends the document's own tagged pixels.
 * @param printerProfile The bundled working CMYK press profile, or the one last loaded in the Print dialog.
 * @param intent Rendering intent of the printer-profile conversion.
 * @param blackPointCompensation Black Point Compensation for the printer-profile conversion.
 * @param matchPrintColors Soft-proof the Print dialog preview through the printer profile.
 * @param showPaperWhite Simulate the paper white in the Match Print Colors preview.
 */
export function setPrintSettings(
  media?: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" | "4x6" | "5x7" | "8x10",
  landscape?: boolean,
  center?: boolean,
  top?: number,
  left?: number,
  scaleToFit?: boolean,
  scale?: number,
  colorHandling?: "photoshop" | "printer",
  printerProfile?: "working-cmyk" | "loaded",
  intent?: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric",
  blackPointCompensation?: boolean,
  matchPrintColors?: boolean,
  showPaperWhite?: boolean,
): string {
  if (media !== undefined && !PRINT_MEDIA.some((m) => m.id === media)) throw new Error(`Unknown media "${media}"`);
  if (intent !== undefined && !MCP_INTENTS.includes(intent)) throw new Error(`Unknown rendering intent "${intent}"`);
  const patch: Partial<PrintSettings> = {
    media, landscape, center, top, left, fit: scaleToFit, scale, colorHandling,
    profile: printerProfile && (printerProfile === "loaded" ? "icc" : "cmyk"),
    intent: intent && MCP_INTENTS.indexOf(intent) as PrintSettings["intent"],
    bpc: blackPointCompensation, matchPrintColors, showPaperWhite,
  };
  const next = { ...loadPrintSettings() };
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) Object.assign(next, { [key]: value });
  const layout = printLayout(next, store.state.doc.width, store.state.doc.height, store.state.resolutionPpi);
  const problem = printSettingsError(next, layout);
  if (problem) throw new Error(problem);
  savePrintSettings(next);
  return JSON.stringify({ ...layout, colorHandling: next.colorHandling });
}

/**
 * File ▸ Print One Copy: print the document with the saved File ▸ Print… settings, without the Print dialog. The OS print dialog still opens.
 * @mcp print.oneCopy
 */
export async function printOneCopy(): Promise<string> {
  const job = await preparePrintJob(loadPrintSettings());
  // Not the File menu's spoolPrintJob: that toasts a failure and resolves, and
  // this caller would be told "sent" for a job that never opened.
  // ponytail: where print() blocks the webview (Chromium family) the answer
  // waits for the OS dialog, up to the bridge's 60 s. Split printPng into
  // load-then-spool if that ever bites.
  await printPng(job.png, job.css);
  return "Sent the document to the print dialog";
}

/**
 * Open an existing file from disk as a new document tab — the same loader File ▸ Open uses (PSD/PSB/XCF, RAW, PDF, SVG, JPEG 2000, Cineon/DPX, IFF, DICOM, .mvision, .monetgfx, .artisan and the common image formats). A headerless Photoshop Raw file needs doc.openPhotoshopRaw. Native desktop only.
 * @mcp doc.open
 * @param path Absolute path of the file to open.
 */
export async function openDocument(path: string): Promise<string> {
  // No catch: a failed open must reach the client as a tool error, not as an
  // "Opened …" string in front of an unchanged document.
  await openPath(path);
  return `Opened ${path}`;
}

/**
 * Open a headerless Photoshop Raw file with the layout File ▸ Open's Photoshop Raw Options dialog asks for. Native desktop only.
 * @mcp doc.openPhotoshopRaw
 * @param path Absolute path of the raw file.
 * @param width Image width in pixels.
 * @param height Image height in pixels.
 * @param channels 1 grey, 2 grey + alpha, 3 RGB, 4 RGBA.
 * @param depth Bits per channel: 8 or 16.
 * @param interleaved True when each pixel's channels are stored together; false for one channel plane after another.
 * @param byteOrder Byte order of 16-bit samples.
 * @param header Bytes to skip before the samples.
 */
export async function openPhotoshopRawDocument(
  path: string,
  width: number,
  height: number,
  channels = 3,
  depth = 8,
  interleaved = true,
  byteOrder: "mac" | "ibm" = "mac",
  header = 0,
): Promise<string> {
  requireNative("Opening a Photoshop Raw file");
  if (depth !== 8 && depth !== 16) throw new Error("depth must be 8 or 16.");
  await openPhotoshopRawPath(path, { width, height, channels, depth, interleaved, bigEndian: byteOrder === "mac", header });
  return `Opened ${path} as ${width} × ${height} Photoshop Raw`;
}

/**
 * File ▸ Scripts ▸ Load Multiple DICOM Files: open a DICOM series as one document with a layer per file, in Instance Number order. Native desktop only.
 * @mcp doc.loadDicomSeries
 * @param paths Absolute paths of the DICOM files.
 */
export async function loadDicomSeries(paths: string[]): Promise<string> {
  requireNative("Loading DICOM files");
  if (!paths.length) throw new Error("Pass at least one DICOM file.");
  const before = store.state.documents.length;
  const loaded = await loadDicomPaths(paths);
  if (store.state.documents.length === before) throw new Error("None of the DICOM files could be opened.");
  const skipped = paths.length - loaded;
  return `Loaded ${loaded} DICOM file${loaded === 1 ? "" : "s"} as layers${skipped ? `; ${skipped} could not be opened` : ""}`;
}

/**
 * Add a new empty layer above the active layer.
 * @mcp doc.addLayer
 */
export function addLayer(): string {
  store.addLayer();
  return "Added a new layer";
}

/**
 * Export the composited document as PNG image content for the MCP client.
 * @mcp doc.exportPngBase64
 */
export function exportPngBase64(): McpImageResult {
  assertHistorySettled(engine.engine);
  return { image: engine.e.export_png(), mimeType: "image/png" };
}

// ── Save / Export to a path ─────────────────────────────────────────────────
// The app's own Save As / Export As are picker-driven (and download in the
// browser build), so neither can be handed a destination. These are the
// path-taking forms: same byte producers, written through the same atomic
// write the app uses. Native desktop only, like doc.open's loader.

function requireNative(what: string): void {
  if (!isTauri()) throw new Error(`${what} is only available in the desktop app.`);
}

/**
 * Save the active document to an absolute path, choosing the format from the extension (JPEG 2000 is written lossless; Photoshop Raw interleaved, Mac byte order, no header). Native desktop only.
 * @mcp doc.saveAs
 * @param path Absolute destination path ending in a format supported by File > Save As.
 */
export async function saveDocumentToPath(path: string): Promise<string> {
  requireNative("Saving to a path");
  const ext = extOf(path);
  const docId = store.state.activeDocId;
  const contentRevision = store.docContentRevision(docId);
  const { bytes } = await bytesForExt(ext, { docId, quality: 92 });
  await atomicWriteBytes(path, bytes);
  // Only a lossless project format carries the whole document, so only one may
  // re-target the tab and clear its unsaved state. A flattened PSD/PNG copy that
  // marked the tab clean is exactly how layered work gets lost. (#237)
  if (contentRevision !== null && isProjectSaveExtension(ext)) store.setDocPathAfterSave(docId, path, contentRevision);
  void runScriptEventBindings("saveDocument");
  return `Saved ${path}`;
}

/**
 * Export the flattened composite to an absolute path using any flat format supported by File > Save As (JPEG 2000 is written lossless; Photoshop Raw interleaved, Mac byte order, no header). Leaves the document's own path and unsaved state untouched. Native desktop only.
 * @mcp doc.exportAs
 * @param path Absolute destination path ending in a supported flat export format.
 * @param quality JPEG quality; ignored by non-JPEG formats (1..100).
 */
export async function exportDocumentToPath(path: string, quality = 92): Promise<string> {
  requireNative("Exporting to a path");
  const ext = extOf(path);
  if (!FLAT_SAVE_EXTENSIONS.has(ext)) {
    throw new Error("doc.exportAs writes flat export formats — use doc.saveAs for .mvision/.mvis/.psd/.psb.");
  }
  const docId = store.state.activeDocId;
  const { bytes } = await bytesForExt(ext, { docId, quality: Math.max(1, Math.min(100, Math.round(quality))) });
  await atomicWriteBytes(path, bytes);
  void runScriptEventBindings("exportDocument");
  return `Exported ${path}`;
}

// ── Actions (Photoshop's Actions panel) ──────────────────────────────────────

function requireAction(actionId: number) {
  const meta = actions.list().find((a) => a.id === actionId);
  // `playNamed`/`batchProcess` silently no-op on an unknown id, so without this
  // the agent gets "Played …" for an action that does not exist.
  if (!meta) throw new Error(`No such action #${actionId} — call action.list first.`);
  return meta;
}

/**
 * List the saved actions as JSON (id, name, set, stepCount, favorite, lastPlayedAt).
 * @mcp action.list
 * @param query Case-insensitive filter over action and set names; empty lists everything.
 * @param favoritesOnly List only actions marked as favorites.
 */
export function listActions(query = "", favoritesOnly = false): string {
  return JSON.stringify(actions.filter(query, favoritesOnly));
}

/**
 * Play a saved action on the active document, honoring disabled steps, stops and conditionals. Photoshop's Play / Play From Here.
 * @mcp action.play
 * @param actionId Action id from action.list.
 * @param fromStep Zero-based step index to start from (Play From Here).
 */
export async function playAction(actionId: number, fromStep = 0): Promise<string> {
  const meta = requireAction(actionId);
  if (await actions.playNamed(actionId, fromStep) === false) {
    throw new Error(`Action "${meta.name}" stopped before it finished.`);
  }
  return `Played "${meta.name}"${fromStep ? ` from step ${fromStep}` : ""}`;
}

/**
 * File ▸ Automate ▸ Batch over every open document: play a saved action on each and write the results. Uses the open documents as the source, so it needs no file picker.
 * @mcp action.batch
 * @param actionId Action id from action.list.
 * @param destDir Absolute destination folder (native desktop only); omit to download each result instead.
 * @param format Output format for each processed document.
 * @param template File Naming template, e.g. "{name}_{serial}_processed"; empty uses the default.
 */
export async function batchAction(actionId: number, destDir?: string, format: "png" | "jpeg" | "tiff" = "png", template = ""): Promise<string> {
  const meta = requireAction(actionId);
  if (destDir) requireNative("Batching to a destination folder");
  const result = await batchProcess({ source: "opened", actionId, destDir, format, template });
  if (!result) throw new Error("Batch had nothing to run — open the documents to process first.");
  return JSON.stringify({ action: meta.name, processed: result.processed, errors: result.errors });
}

/**
 * File ▸ Automate ▸ Create Droplet: save a saved action and Batch settings as a droplet. A path ending in .app builds a droplet app (macOS, signed for this Mac only) that runs when images or folders are dropped on it in Finder; any other path saves the .json descriptor. Native desktop only.
 * @mcp action.saveDroplet
 * @param path Absolute destination path ending in .app or .json.
 * @param actionId Action id from action.list.
 * @param format Output format for each processed image.
 * @param template File Naming template, e.g. "{name}_{serial}_processed"; empty uses the default.
 * @param destDir Absolute folder the droplet writes to; omit to write to Downloads.
 * @param stopOnError Stop at the first image that fails instead of logging it and going on.
 */
export async function saveDroplet(path: string, actionId: number, format: "png" | "jpeg" | "tiff" = "png", template = "", destDir?: string, stopOnError = false): Promise<string> {
  if (!/\.(json|app)$/i.test(path)) throw new Error("A droplet must be saved as .json or .app.");
  requireNative("Saving a droplet");
  const meta = requireAction(actionId);
  await saveDropletFile(path, { actionId, actionName: meta.name, format, template, destDir, stopOnError });
  return `Saved droplet ${path}`;
}

/**
 * Run a droplet saved by File ▸ Automate ▸ Create Droplet over image files or folders, as dropping them on the droplet does: its action, File Naming, format and destination folder (Downloads when it has none). Native desktop only.
 * @mcp action.runDroplet
 * @param dropletPath Absolute path of the droplet's .json descriptor (a droplet app keeps it at Contents/Resources/droplet.json).
 * @param paths Absolute paths of the images or folders to process.
 */
export async function runDropletOn(dropletPath: string, paths: string[]): Promise<string> {
  requireNative("Running a droplet");
  const bytes = await readNativeFileBounded(dropletPath, () => ({ maxBytes: DROPLET_MAX_BYTES, label: "Droplet" }));
  const droplet = parseDroplet(new TextDecoder().decode(bytes));
  if (!droplet) throw new Error(`${dropletPath} is not a Monet droplet.`);
  const result = await runDroplet(droplet, paths);
  return JSON.stringify({ processed: result.processed, errors: result.errors });
}

/** The steps of an action, or a clear error — every step tool needs both. */
function requireSteps(actionId: number) {
  requireAction(actionId);
  return actions.getSteps(actionId);
}
function requireStep(actionId: number, stepIndex: number) {
  const steps = requireSteps(actionId);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
    throw new Error(`No step ${stepIndex} in action #${actionId} — it has ${steps.length}. Call action.steps first.`);
  }
  return steps;
}

/**
 * Begin or end recording. While recording, every command Photoshop would record becomes a step — MCP tools included, so an agent authors an action by running the tools it wants replayed. Photoshop's Begin/Stop Recording.
 * @mcp action.record
 * @param recording True to begin a new recording (discarding an unsaved one), false to stop.
 */
export function recordAction(recording: boolean): string {
  if (recording) {
    actions.start();
    return "Recording — run the commands to capture, then call action.record false and action.save";
  }
  actions.stop();
  const n = actions.count();
  return n
    ? `Stopped recording with ${n} step${n === 1 ? "" : "s"} — call action.save to keep them`
    : "Stopped recording — nothing was captured";
}

/**
 * Save what was just recorded as a named action, so it shows up in the Actions panel and replays with action.play.
 * @mcp action.save
 * @param name Name for the saved action; empty takes the next default ("Action 3").
 */
export function saveAction(name = ""): string {
  // The panel disables Save while recording for the same reason: the recording
  // is still growing, so what got saved would be arbitrary.
  if (actions.isRecording()) throw new Error("Still recording — call action.record false first.");
  const id = actions.save(name);
  if (!id) throw new Error("Nothing recorded — call action.record true, run the commands to capture, then save.");
  return JSON.stringify(actions.list().find((a) => a.id === id));
}

/**
 * Rename a saved action.
 * @mcp action.rename
 * @param actionId Action id from action.list.
 * @param name The new name.
 */
export function renameAction(actionId: number, name: string): string {
  const meta = requireAction(actionId);
  if (!name.trim()) throw new Error("An action needs a name.");
  actions.rename(actionId, name);
  return `Renamed "${meta.name}" to "${actions.list().find((a) => a.id === actionId)?.name ?? name}"`;
}

/**
 * Delete a saved action.
 * @mcp action.delete
 * @param actionId Action id from action.list.
 */
export function deleteAction(actionId: number): string {
  const meta = requireAction(actionId);
  actions.delete(actionId);
  return `Deleted "${meta.name}"`;
}

/**
 * List an action's steps as JSON (index, label, args, enabled, dialog, volatile) — the indices every other step tool takes.
 * @mcp action.steps
 * @param actionId Action id from action.list.
 */
export function listActionSteps(actionId: number): string {
  return JSON.stringify(requireSteps(actionId));
}

/**
 * Set a step's flags: whether it runs at all, and whether playback pauses on it to confirm. Photoshop's step checkbox and modal-dialog toggle.
 * @mcp action.setStep
 * @param actionId Action id from action.list.
 * @param stepIndex Zero-based step index from action.steps.
 * @param enabled False skips the step on playback.
 * @param dialog True pauses playback on the step to confirm it.
 */
export function setActionStep(actionId: number, stepIndex: number, enabled = true, dialog = false): string {
  requireStep(actionId, stepIndex);
  actions.setStepEnabled(actionId, stepIndex, enabled);
  actions.setStepDialog(actionId, stepIndex, dialog);
  return `Step ${stepIndex} is now ${enabled ? "enabled" : "disabled"}${dialog ? " and pauses to confirm" : ""}`;
}

/**
 * Move a step within an action, which is how a recorded sequence is reordered.
 * @mcp action.moveStep
 * @param actionId Action id from action.list.
 * @param fromIndex Zero-based index of the step to move.
 * @param toIndex Zero-based index to move it to.
 */
export function moveActionStep(actionId: number, fromIndex: number, toIndex: number): string {
  requireStep(actionId, fromIndex);
  requireStep(actionId, toIndex);
  actions.moveStep(actionId, fromIndex, toIndex);
  return `Moved step ${fromIndex} to ${toIndex}`;
}

/**
 * Delete one step from an action.
 * @mcp action.deleteStep
 * @param actionId Action id from action.list.
 * @param stepIndex Zero-based step index from action.steps.
 */
export function deleteActionStep(actionId: number, stepIndex: number): string {
  const steps = requireStep(actionId, stepIndex);
  actions.deleteStep(actionId, stepIndex);
  return `Deleted step ${stepIndex} (${steps[stepIndex].label})`;
}

/**
 * Import actions from a .mvactions payload or an Adobe .atn pack. Steps whose command this build cannot replay are rejected (.mvactions) or imported as Stops naming them (.atn), never replaced with something else.
 * @mcp action.import
 * @param data Vision's own mvactions JSON text, or — for format "atn" — the Adobe pack's bytes as base64. (maxLength 1048576)
 * @param format Payload format.
 */
export function importActions(data: string, format: "mvactions" | "atn" = "mvactions"): string {
  if (typeof data !== "string" || data.length > MAX_SCRIPT_IMPORT_BYTES) {
    throw new Error("Action payload exceeds the 1 MiB limit");
  }
  let json = data;
  let atnError: string | null = null;
  if (format === "atn") {
    let bytes: Uint8Array;
    try {
      const binary = atob(data.trim());
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    } catch {
      throw new Error("The .atn payload is not valid base64.");
    }
    if (bytes.length > MAX_ATN_IMPORT_BYTES) throw new Error("The .atn pack is too large");
    ({ json, error: atnError } = atnToActionsFile(bytes));
  }
  const { imported, rejected } = actions.importJson(json);
  // A payload that imported nothing is a refusal, not a quiet success (#58) —
  // the reasons the parser gave are what the agent needs to fix it.
  if (!imported) {
    const why = rejected.map((r) => `${r.name} (${r.reason})`).join(", ") || atnError;
    throw new Error(`Imported nothing${why ? `: ${why}` : " — the payload holds no actions."}`);
  }
  return JSON.stringify({ imported, rejected, ...(atnError ? { error: atnError } : {}) });
}

// ── Scripting ────────────────────────────────────────────────────────────────

/**
 * Run JavaScript in the sandboxed scripting console — the whole recorded command surface as `vision.*` ops plus `await vision.read.*` queries, with the console's op budget and timeouts. Use `vision.log(…)` to return values.
 * @mcp script.run
 * @param code JavaScript source to execute against the `vision` scripting API. (maxLength 1048576)
 */
export async function scriptRun(code: string): Promise<string> {
  if (typeof code !== "string" || code.length > MAX_SCRIPT_IMPORT_BYTES) {
    throw new Error("Script exceeds the 1 MiB limit");
  }
  // runScript RESOLVES its failures ("Disallowed op: …", "Script timed out …")
  // so the Scripting Console can print them; "" is success and "✓ …" is the
  // script's log. Anything else must reach the client as isError, not as output
  // an agent then builds on. (#60)
  const out = await runScript(code);
  if (out && !out.startsWith("✓")) throw new Error(out);
  return out || "Script ran (no output — call vision.log to return values)";
}

// The engine refuses destructive edits on locked / text / adjustment / vector /
// fill / group / smart-object layers (it sets last_edit_error and does nothing)
// and silently no-ops geometry edits with out-of-range dimensions. EngineClient
// and runGeometryEdit both detect that, but the `adj`/`fil`/`xform` action
// wrappers in state/app.ts drop the boolean — so a tool used to answer
// "Applied …" while the document never changed, and the agent kept building on
// a fiction. Watch the two signals the app itself trusts and turn a refusal into
// a tool error the MCP client sees as isError. (#58)
function applied<T>(run: () => T): T {
  const sink = engine.onEditError;
  let refusal = "";
  engine.onEditError = (message) => { refusal ||= message; sink?.(message); };
  // `undo_pushes()` is monotonic, unlike `undo_depth()`: at the History States
  // cap a push evicts an older entry, so the depth would not move for a real
  // edit. Absent on engine stubs, in which case only the error channel counts.
  const before = typeof engine.e.undo_pushes === "function" ? engine.e.undo_pushes() : null;
  try {
    const out = run();
    if (refusal) throw new Error(refusal);
    if (before !== null && engine.e.undo_pushes() === before) {
      throw new Error("The engine refused the edit — the document is unchanged.");
    }
    return out;
  } finally {
    engine.onEditError = sink;
  }
}

// ── Adjustments (destructive, selection-masked) ──────────────────────────────

/**
 * Adjust brightness and contrast of the active layer.
 * @mcp adj.brightnessContrast
 * @param brightness Brightness (-150..150).
 * @param contrast Contrast (-100..100).
 */
export function brightnessContrast(brightness: number, contrast: number): string {
  applied(() => adj.brightnessContrast(brightness, contrast));
  return "Applied brightness/contrast";
}

/**
 * Adjust hue, saturation and lightness of the active layer, optionally targeting six color ranges or colorizing the result.
 * @mcp adj.hueSaturation
 * @param hue Hue shift in degrees, or the target hue while colorizing (-180..360).
 * @param saturation Saturation, or the target saturation while colorizing (-100..100).
 * @param lightness Lightness (-100..100).
 * @param colorize Map every pixel to the target hue and saturation.
 * @param ranges Optional 18 numbers: hue, saturation, lightness triples for Reds, Yellows, Greens, Cyans, Blues, and Magentas. Hue values run from -180 to 180; saturation and lightness from -100 to 100.
 */
export function hueSaturation(hue: number, saturation: number, lightness: number, colorize = false, ranges: number[] = []): string {
  if (typeof colorize !== "boolean" || !Number.isFinite(hue) || !Number.isFinite(saturation) || !Number.isFinite(lightness)
    || saturation < (colorize ? 0 : -100) || saturation > 100 || lightness < -100 || lightness > 100
    || hue < (colorize ? 0 : -180) || hue > (colorize ? 360 : 180)) {
    throw new Error("Hue/Saturation values are out of bounds");
  }
  if (!Array.isArray(ranges) || (ranges.length !== 0 && ranges.length !== HS_RANGES.length * 3)) {
    throw new Error("Hue/Saturation ranges must contain exactly 18 numbers");
  }
  for (let i = 0; i < ranges.length; i += 3) {
    const [rangeHue, rangeSaturation, rangeLightness] = ranges.slice(i, i + 3);
    if (!Number.isFinite(rangeHue) || rangeHue < -180 || rangeHue > 180
      || !Number.isFinite(rangeSaturation) || rangeSaturation < -100 || rangeSaturation > 100
      || !Number.isFinite(rangeLightness) || rangeLightness < -100 || rangeLightness > 100) {
      throw new Error("Hue/Saturation range values are out of bounds");
    }
  }
  applied(() => adj.hueSaturationParams(packHueSaturation({
    hue,
    saturation,
    lightness,
    colorize,
    ranges: ranges.length ? HS_RANGES.map((_, i) => ranges.slice(i * 3, i * 3 + 3)) : undefined,
  })));
  return "Applied hue/saturation";
}

/**
 * Convert the active layer to black and white using Photoshop-style color-band mixing and optional tinting.
 * @mcp adj.blackWhite
 * @param reds Red contribution (-200..300).
 * @param yellows Yellow contribution (-200..300).
 * @param greens Green contribution (-200..300).
 * @param cyans Cyan contribution (-200..300).
 * @param blues Blue contribution (-200..300).
 * @param magentas Magenta contribution (-200..300).
 * @param tint Apply the selected tint to the grayscale result.
 * @param tintHue Tint hue in degrees (0..360).
 * @param tintSaturation Tint saturation (0..100).
 */
export function blackWhite(reds = 40, yellows = 60, greens = 40, cyans = 60, blues = 20, magentas = 80, tint = false, tintHue = 40, tintSaturation = 20): string {
  const bands = [reds, yellows, greens, cyans, blues, magentas];
  if (bands.some((value) => !Number.isFinite(value) || value < -200 || value > 300)
    || typeof tint !== "boolean" || !Number.isFinite(tintHue) || tintHue < 0 || tintHue > 360
    || !Number.isFinite(tintSaturation) || tintSaturation < 0 || tintSaturation > 100) {
    throw new Error("Black & White values are out of bounds");
  }
  applied(() => adj.blackWhiteParams(packBlackWhite({
    neutral: 1,
    bands,
    tint,
    tintHue,
    tintSaturation,
  })));
  return "Applied black & white";
}

/**
 * Adjust exposure of the active layer.
 * @mcp adj.exposure
 * @param exposure Exposure in stops (-20..20).
 * @param offset Offset (-0.5..0.5).
 * @param gamma Gamma correction (0.01..9.99).
 */
export function exposure(exposure: number, offset: number, gamma: number): string {
  applied(() => adj.exposure(exposure, offset, gamma));
  return "Applied exposure";
}

/**
 * Boost less-saturated colors while protecting skin tones.
 * @mcp adj.vibrance
 * @param vibrance Vibrance (-100..100).
 * @param saturation Saturation (-100..100).
 */
export function vibrance(vibrance: number, saturation: number): string {
  applied(() => adj.vibrance(vibrance, saturation));
  return "Applied vibrance";
}

/**
 * Apply or update a complete canonical Camera Raw recipe on the active layer. Smart Objects retain it as editable fid-17 data. Super Resolution is only supported while opening a RAW source and is rejected here.
 * @mcp adj.cameraRawRecipe
 * @param recipeJson JSON object matching the Camera Raw recipe schema, including optional profile, crop, healing, masks, and Enhance fields; enhance.superResolution must be false. (maxLength 1048576)
 */
export function cameraRawRecipe(recipeJson: string): string {
  if (typeof recipeJson !== "string" || recipeJson.length > MAX_CAMERA_RAW_RECIPE_JSON_LENGTH) {
    throw new Error("Camera Raw recipe JSON exceeds the 1 MiB limit");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(recipeJson); }
  catch { throw new Error("Camera Raw recipe must be valid JSON"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Camera Raw recipe is invalid or unsupported");
  }
  // Working V2 recipe; normalizeWorkingRecipe clamps every field and accepts both
  // the old Canonical schema-2 (migrated) and the new V2 shape.
  const recipe = normalizeWorkingRecipe(parsed);
  if (recipe.enhance?.superResolution) {
    throw new Error("Camera Raw Super Resolution is only supported while opening a RAW source");
  }

  const docId = store.state.activeDocId;
  const layerId = store.state.activeLayerId;
  const current = engine.e;
  if (recipe.optics.enableProfileCorrections) {
    const requested = (parsed as { optics?: Record<string, unknown> }).optics ?? {};
    lensSettings(
      (requested.profileId ?? recipe.optics.profileId ?? "") as string,
      (requested.profileDistortionAmount === undefined ? 1 : requested.profileDistortionAmount as number) * 100,
      (requested.profileVignettingAmount === undefined ? 1 : requested.profileVignettingAmount as number) * 100,
      requested.profileFocalLengthMm as number | undefined,
      requested.profileAperture as number | undefined,
      requested.profileCropFactor as number | undefined,
    );
    const lens = resolveLensProfile(store.lensMetadata({ documentId: docId, layerId }), recipe.optics);
    if (lens.status === "missing") throw new Error(lens.message);
  }
  let smartIndex: number | undefined;
  if (current.layer_kind(layerId) === LAYER_KIND.smartObject) {
    const typed = current as typeof current & { smart_filter_id?: (id: number, index: number) => number };
    if (typed.smart_filter_id) {
      for (let index = 0; index < current.smart_filter_count(layerId); index++) {
        if (typed.smart_filter_id(layerId, index) === 17) { smartIndex = index; break; }
      }
    }
  }
  if (!applied(() => store.cameraRawDevelopTarget(docId, layerId, recipe, smartIndex))) {
    throw new Error("Camera Raw could not be applied to the active layer");
  }
  return smartIndex === undefined ? "Applied Camera Raw recipe" : "Updated Camera Raw recipe";
}

/**
 * Invert the colors of the active layer.
 * @mcp adj.invert
 */
export function invert(): string {
  applied(() => adj.invert());
  return "Inverted colors";
}

/**
 * Reduce the number of tonal levels (posterize) the active layer.
 * @mcp adj.posterize
 * @param levels Number of levels per channel (2..255).
 */
export function posterize(levels: number): string {
  applied(() => adj.posterize(levels));
  return `Posterized to ${levels} levels`;
}

/**
 * Convert the active layer to high-contrast black and white at a threshold.
 * @mcp adj.threshold
 * @param level Threshold level (0..255).
 */
export function threshold(level: number): string {
  applied(() => adj.threshold(level));
  return `Thresholded at ${level}`;
}

// ── Filters ──────────────────────────────────────────────────────────────────

/**
 * Apply a Gaussian blur to the active layer.
 * @mcp fil.gaussian
 * @param radius Blur radius in pixels (0..250).
 */
export function gaussian(radius: number): string {
  applied(() => fil.gaussian(radius));
  return `Gaussian blur r=${radius}`;
}

/**
 * Apply a box blur to the active layer.
 * @mcp fil.box
 * @param radius Blur radius in pixels (0..250).
 */
export function boxBlur(radius: number): string {
  applied(() => fil.box(radius));
  return `Box blur r=${radius}`;
}

/**
 * Sharpen the active layer.
 * @mcp fil.sharpen
 * @param amount Sharpen amount (0..500).
 */
export function sharpen(amount: number): string {
  applied(() => fil.sharpen(amount));
  return `Sharpen ${amount}`;
}

/**
 * Unsharp mask the active layer.
 * @mcp fil.unsharp
 * @param radius Radius in pixels (0.1..250).
 * @param amount Amount percent (1..500).
 * @param threshold Threshold levels (0..255).
 */
export function unsharp(radius: number, amount: number, threshold: number): string {
  applied(() => fil.unsharp(radius, amount, threshold));
  return "Unsharp mask applied";
}

/**
 * Apply a median filter (noise reduction) to the active layer.
 * @mcp fil.median
 * @param radius Radius in pixels (1..100).
 */
export function median(radius: number): string {
  applied(() => fil.median(radius));
  return `Median r=${radius}`;
}

/**
 * Apply the Artistic Sponge filter to the active layer.
 * @mcp fil.sponge
 * @param brushSize Sponge dab size (0..10).
 * @param definition Tonal separation (0..25).
 * @param smoothness Edge smoothness (1..15).
 */
export function sponge(brushSize: number, definition: number, smoothness: number): string {
  applied(() => fil.sponge(brushSize, definition, smoothness));
  return "Sponge filter applied";
}

/**
 * Remove small high-contrast distractions from the active layer with local cleanup.
 * @mcp fil.removeDistractions
 * @param strength Cleanup strength (0..1).
 */
export function mcpRemoveDistractions(strength = 0.75): string {
  applied(() => removeDistractions(strength));
  return `Removed distractions strength=${strength}`;
}

/**
 * Reduce bright reflection or glare streaks from the active layer with local cleanup.
 * @mcp fil.removeReflections
 * @param strength Cleanup strength (0..1).
 * @param split Split into Underlying + Reflections layers (recompose to the original) instead of editing in place.
 */
export function mcpRemoveReflections(strength = 0.65, split = false): string {
  applied(() => (split ? splitReflections : removeReflections)(strength));
  return `${split ? "Split" : "Removed"} reflections strength=${strength}`;
}

/**
 * Correct lens barrel/perspective distortion on the active layer — pick a projection model, then optionally give constraint lines/polygons that must end up straight/rectangular. Photoshop's Adaptive Wide Angle filter.
 * @mcp fil.adaptiveWideAngle
 * @param model Correction model; auto picks Fisheye or Perspective from focalLength/cropFactor.
 * @param focalLength Focal length in mm, as engraved on the lens (1..400).
 * @param cropFactor Sensor crop factor; 1 = full frame (0.1..10).
 * @param scale Re-framing zoom applied after the correction; 1 = leave as corrected (0.2..5).
 * @param constraintsJson JSON array of constraints, each `{kind:"line"|"polygon",pts:[number,number][]}` in normalized 0..1 image coordinates; lines need 2 points, polygons need 4. (maxLength 65536)
 */
export function mcpAdaptiveWideAngle(model: "fisheye" | "perspective" | "auto" | "spherical" = "auto", focalLength = 16, cropFactor = 1, scale = 1, constraintsJson = "[]"): string {
  if (typeof constraintsJson !== "string" || constraintsJson.length > MAX_ADAPTIVE_WIDE_CONSTRAINTS_JSON_LENGTH) {
    throw new Error("Adaptive Wide Angle constraints JSON exceeds the 64 KiB limit");
  }
  let constraints: unknown;
  try { constraints = JSON.parse(constraintsJson); }
  catch { throw new Error("Adaptive Wide Angle constraints must be valid JSON"); }
  if (!Array.isArray(constraints)) throw new Error("Adaptive Wide Angle constraints must be a JSON array");
  const opts = sanitizeAdaptiveWide({ model, focalLength, cropFactor, scale, constraints: constraints as AdaptiveWideConstraint[] });
  applied(() => adaptiveWideAngle(opts));
  return `Applied Adaptive Wide Angle (${opts.model}, ${opts.constraints.length} constraint${opts.constraints.length === 1 ? "" : "s"})`;
}

/**
 * Delete empty layers and auto-name the layer stack.
 * @mcp layer.cleanup
 * @param deleteEmpty Delete empty pixel layers.
 * @param autoName Rename layers by kind/state.
 * @param onlyGeneric Rename only generic layer names.
 */
export function cleanupLayers(deleteEmpty = true, autoName = true, onlyGeneric = true): string {
  const r = store.cleanupLayers({ deleteEmpty, autoName, onlyGeneric });
  return `Layer cleanup deleted=${r.deleted} renamed=${r.renamed}`;
}

/**
 * Layer ▸ Vector Mask ▸ Current Path: clip the active layer to the Pen tool's current work path. Omit `op` to replace the mask outright (default); pass an op to fold the path into any existing vector mask instead.
 * @mcp layer.vectorMaskFromPath
 * @param op Path operation folded into an existing vector mask: 0 Combine, 1 Subtract Front, 2 Intersect, 3 Exclude Overlapping. Omit to replace the mask.
 */
export function vectorMaskFromPath(op?: number): string {
  if (store.state.penPath.length < 6 && store.state.penAnchors.length < 18) {
    throw new Error("No pen work path set — draw a path with the Pen tool first (need at least 3 points).");
  }
  store.addVectorMaskFromPath(op);
  return op === undefined ? "Replaced the vector mask with the current work path" : `Folded the current work path into the vector mask (op ${op})`;
}

/**
 * Layer ▸ Smart Objects ▸ Edit Contents: open the active Smart Object's contents as a new document tab. A Smart Object whose source is a Photoshop document (placed from a PSD/PSB, or embedded in an opened PSD/PSB) opens with its own layers; any other opens as its rendered pixels. Edit that tab, then call layer.updateSmartObjectContents.
 * @mcp layer.editSmartObjectContents
 */
export function editSmartObjectContents(): string {
  if (engine.e.layer_kind(store.state.activeLayerId) !== LAYER_KIND.smartObject) {
    throw new Error("The active layer is not a Smart Object. Select one in the Layers panel first.");
  }
  const docId = smart.editContents();
  if (docId === null) throw new Error("This Smart Object has no contents to open.");
  return JSON.stringify({ docId, name: store.activeName(), layers: store.state.layers.map((layer) => layer.name) });
}

/**
 * Layer ▸ Smart Objects ▸ Update Edited Contents: send the active contents tab back into the Smart Object it was opened from. The Smart Object re-renders through its smart filters, and every instance of it updates.
 * @mcp layer.updateSmartObjectContents
 */
export function updateSmartObjectContents(): string {
  if (!smart.editedContentsBinding()) {
    throw new Error("The active document is not Smart Object contents. Open them with layer.editSmartObjectContents first.");
  }
  if (!smart.updateEditedContents()) {
    throw new Error("The Smart Object did not take these contents: its document or layer is gone, or it refused them (Vision shows why). The contents tab stays open.");
  }
  return `Updated the Smart Object; document ${store.state.activeDocId} is active`;
}

/**
 * Set a proof setup mode and enable Proof Colors.
 * @mcp view.setProof
 * @param mode Proof mode id such as cmyk, acescg, aces2065, hdr-pq, or hdr-hlg.
 * @param bpc Black Point Compensation for the CMYK proof LUT (default on, matching Photoshop).
 */
export function setProofMode(mode: string, bpc = true): string {
  store.setProof(mode, {
    simulatePaperColor: store.state.proofSimulatePaperColor,
    simulateBlackInk: store.state.proofSimulateBlackInk,
    blackPointCompensation: bpc,
  });
  return `Proof mode set to ${mode} bpc=${bpc}`;
}

/**
 * Window ▸ Arrange: float documents out of the tab bar into their own windows, cascade those windows, or consolidate every document back into tabs. Desktop app only. Returns the floated document ids.
 * @mcp view.floatWindows
 * @param action float: the active document; floatAll: every open document; cascade: float every document and line the windows up diagonally; consolidate: all back into tabs.
 */
export async function floatWindows(action: "float" | "floatAll" | "cascade" | "consolidate"): Promise<string> {
  if (!isTauri()) throw new Error("Float windows need the desktop app; in a browser, Window ▸ Arrange opens in-app views instead");
  if (action === "float") store.floatDoc(store.state.activeDocId);
  else if (action === "floatAll") store.floatAllDocs();
  else if (action === "cascade") await cascadeFloats();
  else store.consolidateFloats();
  return JSON.stringify(store.state.floatDocs);
}

// ── Scopes ────────────────────────────────────────────────────────────────────

/**
 * Collapse a dock to panel icons or restore its expanded panels. Saved workspace layouts retain this setting.
 * @mcp view.collapseDock
 * @param side Workspace dock edge.
 * @param collapsed True for the icon rail; false for expanded panels.
 */
export function collapseDock(side: "left" | "right" | "top" | "bottom", collapsed: boolean): string {
  const workspace = store.getWorkspace();
  if (!workspace) throw new Error("The workspace is not mounted");
  if (!workspace.getLayout()[side]) throw new Error(`There is no ${side} dock to ${collapsed ? "collapse" : "expand"}; dock a panel on that side first`);
  workspace.setDockCollapsed(side, collapsed);
  return `${side} dock ${collapsed ? "collapsed" : "expanded"}`;
}

/**
 * Change a panel's thumbnail size or the Swatches grid/list view, using the same persisted options as its flyout menu.
 * @mcp view.setPanelOptions
 * @param panel Panel whose view to configure.
 * @param thumbnailSize Thumbnail size: Layers 24/40/64, Channels 26/40/64, Swatches 16/24/40 pixels.
 * @param swatchView Swatches preset view; ignored for other panels, and kept as it is when omitted.
 */
export function setPanelOptions(panel: "layers" | "channels" | "swatches", thumbnailSize: number, swatchView?: "grid" | "list"): string {
  const key = panel === "layers" ? "layerThumbnailSize" : panel === "channels" ? "channelThumbnailSize" : "swatchThumbnailSize";
  if (!(PANEL_THUMBNAIL_SIZES[key] as readonly number[]).includes(thumbnailSize)) throw new Error(`Unsupported thumbnail size ${thumbnailSize} for ${panel}; use ${PANEL_THUMBNAIL_SIZES[key].join(", ")}`);
  if (!store.setPanelOptions({ [key]: thumbnailSize, ...(panel === "swatches" && swatchView ? { swatchView } : {}) })) throw new Error("Could not save panel options");
  return JSON.stringify(store.state.panelOptions);
}

/**
 * Set the Histogram panel scope mode.
 * @mcp view.setScope
 * @param mode Scope mode: histogram, vectorscope, waveform, waveform-rgb, or waveform-parade.
 */
export function setScope(mode: "histogram" | "vectorscope" | "waveform" | "waveform-rgb" | "waveform-parade"): string {
  store.setOptions({ histScope: mode });
  return `Scope set to ${mode}`;
}

/**
 * Summarize a scope's live density grid as JSON stats (dimensions + occupancy), without returning the raw grid.
 * @mcp view.scope
 * @param kind Which scope to sample: vectorscope, waveform, or waveform-rgb (default vectorscope).
 */
export function scope(kind: "vectorscope" | "waveform" | "waveform-rgb" = "vectorscope"): string {
  const dims =
    kind === "vectorscope" ? { width: 128, height: 128 } :
    kind === "waveform-rgb" ? { width: 176, height: 128, channels: 3 } :
    { width: 176, height: 128 };
  const grid =
    kind === "vectorscope" ? engine.vectorscope() :
    kind === "waveform-rgb" ? engine.waveformRgb() :
    engine.waveform();
  let nonZero = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v !== 0) nonZero++;
    if (v > max) max = v;
    sum += v;
  }
  const cells = grid.length;
  return JSON.stringify({ kind, ...dims, cells, nonZero, max, mean: sum / cells });
}

/**
 * List the pending Camera Raw sessions shown in the workspace filmstrip (active session first).
 * @mcp cameraRaw.sessions
 */
export function cameraRawSessions(): string {
  const sessions = store.pendingCameraRawSessions();
  return JSON.stringify(sessions);
}

/**
 * Switch the open Camera Raw workspace to a pending session (filmstrip navigation).
 * @mcp cameraRaw.selectSession
 * @param sessionId The session id to activate (from cameraRaw.sessions).
 */
export function selectCameraRawSession(sessionId: string): string {
  const ok = store.selectCameraRawSession(sessionId);
  return ok ? `Selected Camera Raw session ${sessionId}` : `No pending Camera Raw session ${sessionId}`;
}

/**
 * Set Camera Raw's RAW import options. Both persist as import preferences; a new demosaic also re-decodes the RAW the open Camera Raw workspace is showing.
 * @mcp cameraRaw.setImportOptions
 * @param demosaic Mosaic (Bayer) demosaic: "adaptive" (PPG, edge-directed, fewer colour fringes) or "bilinear" (the fast 3×3 average). Omit to keep.
 * @param depth Bits per channel of the document Open makes: 16, or 32 for a float document on the Image ▸ Mode ▸ 32 Bits scale that keeps highlights above white. Omit to keep.
 */
export function setCameraRawImportOptions(demosaic?: "adaptive" | "bilinear", depth?: number): string {
  if (demosaic !== undefined && demosaic !== "adaptive" && demosaic !== "bilinear") {
    throw new Error(`Unknown demosaic "${String(demosaic)}". Use "adaptive" or "bilinear".`);
  }
  if (depth !== undefined && depth !== 16 && depth !== 32) {
    throw new Error(`Unsupported Open depth ${depth}. Use 16 or 32.`);
  }
  if (demosaic !== undefined) {
    const active = store.activeCameraRawSession();
    if (!active || !store.setCameraRawSessionDemosaic(active, demosaic)) store.setFilePrefs({ rawDemosaic: demosaic });
  }
  if (depth !== undefined) store.setFilePrefs({ rawDepth: depth });
  const { rawDemosaic, rawDepth } = store.state.filePrefs;
  return JSON.stringify({ demosaic: rawDemosaic, depth: rawDepth });
}

/**
 * List Camera Raw's DNG camera profile library and, when the workspace shows a RAW, the Profile menu for it: the built-in looks, its embedded profile and the library profiles made for its camera. Choose one by setting a recipe's profile to an entry's `profile` (with adj.cameraRawRecipe, or in the workspace).
 * @mcp cameraRaw.profiles
 */
export function cameraRawProfiles(): string {
  const sessionId = store.activeCameraRawSession();
  const recipe = sessionId ? store.cameraRawSessionWorking(sessionId) : null;
  const menu = sessionId && recipe
    ? cameraRawProfileMenu(store.state.cameraRawProfiles, store.cameraRawProfileMetadata({ sessionId }), recipe.profile)
    : null;
  return JSON.stringify({ library: store.state.cameraRawProfiles, ...(menu ? { menu } : {}) });
}

/**
 * Load a DNG camera profile (.dcp) into Camera Raw's profile library, as Profile ▸ Load Profile… does. It is offered for RAWs from the camera it was made for (its UniqueCameraModel).
 * @mcp cameraRaw.loadProfile
 * @param data The DNG camera profile file's bytes, as base64. (maxLength 11184812)
 * @param name The file name, used when the profile carries no ProfileName.
 */
export function loadCameraRawProfile(data: string, name = "Custom.dcp"): string {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(String(data).trim()), (c) => c.charCodeAt(0)); }
  catch { throw new Error("The camera profile payload is not valid base64."); }
  if (bytes.length > MAX_CAMERA_PROFILE_BYTES) throw new Error("The camera profile is too large.");
  return JSON.stringify(store.importCameraRawProfile(name, bytes));
}

function lensSettings(profileId: string, distortionAmount: number, vignettingAmount: number, focalLengthMm?: number, aperture?: number, cropFactor?: number): LensCorrectionSettings {
  if (typeof profileId !== "string" || (profileId !== "" && !/^[a-f0-9]{32}$/i.test(profileId))) throw new Error("profileId must be a catalog id or empty for Automatic.");
  for (const [name, value, min, max] of [
    ["distortionAmount", distortionAmount, 0, 200], ["vignettingAmount", vignettingAmount, 0, 200],
    ["focalLengthMm", focalLengthMm, 0.1, 100000], ["aperture", aperture, 0.1, 1024], ["cropFactor", cropFactor, 0.1, 20],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`${name} must be ${min} to ${max}.`);
  }
  return { enableProfileCorrections: true, profileName: null, profileId: profileId || undefined,
    profileDistortionAmount: distortionAmount / 100, profileVignettingAmount: vignettingAmount / 100,
    profileFocalLengthMm: focalLengthMm, profileAperture: aperture, profileCropFactor: cropFactor };
}

/**
 * Inspect the offline lens catalog and automatic/manual lookup for the active Camera Raw session or document. Missing matches include an actionable explanation.
 * @mcp lens.profiles
 * @param query Filter catalog names; empty returns the first 100 entries and the total count.
 * @param profileId Explicit catalog id; empty selects Automatic.
 * @param focalLengthMm Optional physical focal-length override.
 * @param aperture Optional f-number override.
 * @param cropFactor Optional sensor crop-factor override.
 */
export function inspectLensProfiles(query = "", profileId = "", focalLengthMm?: number, aperture?: number, cropFactor?: number): string {
  const sessionId = store.activeCameraRawSession();
  const metadata = store.lensMetadata(sessionId ? { sessionId } : {});
  const profiles = LENS_PROFILES.filter((p) => `${p.name} ${p.maker} ${p.model}`.toLowerCase().includes(query.toLowerCase()));
  const resolution = resolveLensProfile(metadata, lensSettings(profileId, 100, 100, focalLengthMm, aperture, cropFactor));
  return JSON.stringify({ metadata, total: profiles.length, profiles: profiles.slice(0, 100).map(({ id, name, maker, model, cropFactor }) => ({ id, name, maker, model, cropFactor })), resolution });
}

/**
 * Apply calibrated lens correction to the active layer as one undoable filter; Smart Objects retain an editable filter. Missing calibration fails without changing pixels.
 * @mcp lens.apply
 * @param profileId Explicit catalog id; empty selects Automatic from this photo's metadata.
 * @param distortionAmount Profile distortion strength, percent (0..200).
 * @param vignettingAmount Profile vignetting strength, percent (0..200).
 * @param focalLengthMm Optional physical focal-length override.
 * @param aperture Optional f-number override.
 * @param cropFactor Optional sensor crop-factor override.
 */
export function applyLensProfile(profileId = "", distortionAmount = 100, vignettingAmount = 100, focalLengthMm?: number, aperture?: number, cropFactor?: number): string {
  const settings = lensSettings(profileId, distortionAmount, vignettingAmount, focalLengthMm, aperture, cropFactor);
  const result = applied(() => applyLensProfileCorrection(settings));
  return JSON.stringify({ applied: result.profile.name, warnings: result.warnings });
}

// ── Brushes ─────────────────────────────────────────────────────────────────

/**
 * Select a Paint Symmetry preset. Changing presets resets its path to the document centre.
 * @mcp brush.setSymmetry
 * @param mode Preset index: 0 Off, 1 Vertical, 2 Horizontal, 3 Dual Axis, 4 Diagonal, 5 Wavy, 6 Circle, 7 Spiral, 8 Parallel Lines, 9 Radial, 10 Mandala.
 * @param segments Radial segments (2..12) or Mandala segments (3..10).
 */
export function setPaintSymmetry(mode: number, segments = 6): string {
  store.setPaintSymmetry(mode, segments);
  return `Paint symmetry preset=${store.state.paintSymmetry} segments=${store.state.paintSymmetrySegments}`;
}

/**
 * Transform the active Paint Symmetry path in document coordinates.
 * @mcp brush.transformSymmetry
 * @param axisX Path centre X in pixels.
 * @param axisY Path centre Y in pixels.
 * @param angle Rotation in degrees (-180..<180).
 * @param scale Uniform path scale (0.01..100).
 */
export function transformPaintSymmetry(axisX: number, axisY: number, angle = 0, scale = 1): string {
  if (store.state.paintSymmetry === 0) throw new Error("Select a Paint Symmetry preset first");
  store.beginPaintSymmetryTransform();
  store.movePaintSymmetryPath(axisX, axisY, angle, scale);
  store.commitPaintSymmetryTransform();
  const s = store.state;
  return `Transformed symmetry centre=(${s.paintSymmetryAxisX},${s.paintSymmetryAxisY}) angle=${s.paintSymmetryAngle} scale=${s.paintSymmetryScale}`;
}

// ── Transforms ───────────────────────────────────────────────────────────────

/**
 * Resize the whole image (resamples all layers).
 * @mcp xform.resizeImage
 * @param width New width in pixels (1..16384).
 * @param height New height in pixels (1..16384).
 */
export function resizeImage(width: number, height: number): string {
  applied(() => xform.resizeImage(width, height));
  return `Resized image to ${width}×${height}`;
}

/**
 * Crop the document to a rectangle.
 * @mcp xform.crop
 * @param x Left edge in pixels.
 * @param y Top edge in pixels.
 * @param width Crop width in pixels (1..16384).
 * @param height Crop height in pixels (1..16384).
 */
export function crop(x: number, y: number, width: number, height: number): string {
  applied(() => xform.crop(x, y, width, height));
  return `Cropped to ${width}×${height} at (${x},${y})`;
}

/**
 * Flip the canvas horizontally.
 * @mcp xform.flipHorizontal
 */
export function flipHorizontal(): string {
  applied(() => xform.flipH());
  return "Flipped horizontally";
}

/**
 * Flip the canvas vertically.
 * @mcp xform.flipVertical
 */
export function flipVertical(): string {
  applied(() => xform.flipV());
  return "Flipped vertically";
}

/**
 * Rotate the canvas 90 degrees.
 * @mcp xform.rotate90
 * @param clockwise Rotate clockwise when true, counter-clockwise when false.
 */
export function rotate90(clockwise = true): string {
  applied(() => xform.rotate90(clockwise));
  return `Rotated 90° ${clockwise ? "CW" : "CCW"}`;
}

/**
 * Rotate the canvas 180 degrees.
 * @mcp xform.rotate180
 */
export function rotate180(): string {
  applied(() => xform.rotate180());
  return "Rotated 180°";
}

// ── ML neural filters (on-device ONNX / diffusion) ───────────────────────────
// Thin wrappers over the app's `ml` namespace (state/app.ts). Design decision B1:
// bounded ONNX ops run synchronously (await + throw on failure); unbounded
// diffusion/denoise work runs as an async job so a poll-based client never trips
// the Rust bridge's hard 60 s BRIDGE_TIMEOUT (crates/monet-mcp/src/lib.rs:56).

type MlJob = {
  id: number;
  kind: string;
  state: "running" | "cancelling" | "done" | "cancelled" | "error";
  msgs: string[];
  startedAt: number;
  result?: unknown;
  error?: string;
};
const _jobs = new Map<number, MlJob>(); // ponytail: single-flight job table; upgrade to a queue if agents ever need parallel jobs
let _nextJob = 1;

// Start a background ML job. Single-flight: the engine is single-document and the
// ONNX ops mutate it, so a second concurrent job would corrupt the first.
function startJob(kind: string, run: (p: (m: string) => void) => Promise<unknown>): string {
  const end = beginMlJob();
  const id = _nextJob++;
  const job: MlJob = { id, kind, state: "running", msgs: [], startedAt: Date.now() };
  _jobs.set(id, job);
  try {
    run((m) => job.msgs.push(m)).then(
      (result) => { end(); job.state = "done"; job.result = result; },
      (e) => {
        end();
        if (isMlCancel(e)) job.state = "cancelled";
        else { job.state = "error"; job.error = e instanceof Error ? e.message : String(e); }
      },
    );
  } catch (e) {
    end();
    _jobs.delete(id);
    throw e;
  }
  return JSON.stringify({ jobId: id, kind, poll: "ml.jobStatus" });
}

// ── Stable-Diffusion weight probe ────────────────────────────────────────────
// Resolves the SD weight set through modelSource.resolveSdBase() (same as the UI),
// so it prefers the real /models/sd15 set over the /models/sd demo placeholder.
const SD_CORE = ["text_encoder/model.onnx", "unet/model.onnx", "vae_decoder/model.onnx", "tokenizer/vocab.json", "tokenizer/merges.txt"];

// Presence probe that also works on the Tauri asset protocol: HEAD first, and on
// a 405 (HEAD unsupported) fall back to a 1-byte ranged GET whose body we cancel.
async function filePresent(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    if (r.status === 405) {
      const g = await fetch(url, { headers: { Range: "bytes=0-0" } });
      g.body?.cancel();
      return g.ok;
    }
    return r.ok;
  } catch {
    return false;
  }
}

// Throw a structured error naming the missing files if any SD weight is absent.
// NEVER silently fall back to MI-GAN (design B3) — an agent that asked for a
// prompted result must not get a prompt-ignoring one.
async function requireSd(extra: string[] = []): Promise<void> {
  // Resolve through the same resolver the UI uses — prefers the real /models/sd15
  // set over the /models/sd demo placeholder — instead of hard-coding SD_BASE.
  const base = (await resolveSdBase()).base;
  const files = [...SD_CORE, ...extra];
  const present = await Promise.all(files.map((f) => filePresent(`${base}/${f}`)));
  const missing = files.filter((_, i) => !present[i]);
  if (missing.length) {
    throw new Error(
      `Stable Diffusion weights not installed — missing ${missing.join(", ")} under ${base} ` +
        `(see public/models/MODELS.md). For prompt-free inpainting use ml.generativeFill.`,
    );
  }
}

// Per-feature weight inventory for ml.models (paths relative to /models).
const ML_FEATURES: { feature: string; files: string[] }[] = [
  { feature: "styles", files: ["candy.onnx", "mosaic.onnx", "rain.onnx", "udnie.onnx", "pointilism.onnx"] },
  { feature: "u2netp", files: ["u2netp.onnx"] },
  { feature: "super-res", files: ["super-res.onnx"] },
  { feature: "migan", files: ["migan.onnx"] },
  { feature: "drunet", files: ["drunet_color.onnx"] },
  { feature: "sd-core", files: SD_CORE.map((f) => `sd/${f}`) },
  { feature: "sd-vae_encoder", files: ["sd/vae_encoder/model.onnx"] },
];

// ── Sync tools (bounded ONNX ops; await + throw on failure) ──────────────────

/**
 * Select the main subject via U²-Net and load it as the active selection.
 * @mcp ml.selectSubject
 */
export async function mlSelectSubject(): Promise<string> {
  const r = await ml.selectSubject();
  if (!r.ok) throw new Error("Select Subject failed — u2netp.onnx missing/unreadable or the document changed (see public/models/MODELS.md).");
  return `Selected subject (coverage ${(r.coverage * 100).toFixed(1)}%)`;
}

/**
 * Isolate the main subject onto a new transparent layer (U²-Net alpha matte).
 * @mcp ml.removeBackground
 */
export async function mlRemoveBackground(): Promise<string> {
  const r = await ml.removeBackground();
  if (!r.ok) throw new Error("Remove Background failed — u2netp.onnx missing/unreadable or the document changed (see public/models/MODELS.md).");
  return "Removed background onto a new layer";
}

/**
 * Apply a neural style-transfer network to the active document, stamping the result on a new layer.
 * @mcp ml.styleTransfer
 * @param style Style network to apply.
 */
export async function mlStyleTransfer(style: "candy" | "mosaic" | "rain-princess" | "udnie" | "pointilism"): Promise<string> {
  const r = await ml.styleTransfer(style);
  if (!r.ok) throw new Error(`Style transfer (${style}) failed — the style model is missing or the document changed (see public/models/MODELS.md).`);
  return `Applied ${style} style (${r.w}×${r.h})`;
}

/**
 * Upscale the document 3× with the ESPCN super-resolution network, opening the result as a new document.
 * @mcp ml.superResolution
 */
export async function mlSuperResolution(): Promise<string> {
  const r = await ml.superResolution();
  if (!r.ok) throw new Error("Super-Resolution failed — super-res.onnx missing/unreadable or the document changed (see public/models/MODELS.md).");
  return `Super-resolved ${r.inW}×${r.inH} → ${r.outW}×${r.outH}`;
}

/**
 * Prompt-free Generative Fill of the current selection. Requires an active selection and a licensed local MI-GAN model.
 * @mcp ml.generativeFill
 */
export async function mlGenerativeFill(): Promise<string> {
  if (!(await filePresent("/models/migan.onnx")))
    throw new Error("MI-GAN is not installed; add a licensed local model (see public/models/MODELS.md).");
  const r = await ml.generativeFill();
  if (!r.ok) throw new Error("Generative Fill was cancelled — the document changed.");
  return `Filled selection (${r.holePx}px) onto a new layer`;
}

/**
 * Generative Expand: grow the canvas and synthesize the new border from surrounding content. Requires a licensed local MI-GAN model.
 * @mcp ml.generativeExpand
 * @param newWidth New canvas width in pixels.
 * @param newHeight New canvas height in pixels.
 * @param offsetX Left offset of the original image in the new canvas.
 * @param offsetY Top offset of the original image in the new canvas.
 */
export async function mlGenerativeExpand(newWidth: number, newHeight: number, offsetX = 0, offsetY = 0): Promise<string> {
  if (!(await filePresent("/models/migan.onnx")))
    throw new Error("MI-GAN is not installed; add a licensed local model (see public/models/MODELS.md).");
  const r = await ml.generativeExpand(newWidth, newHeight, offsetX, offsetY);
  if (!r.ok) throw new Error("Generative Expand was cancelled — the document changed.");
  return `Expanded canvas and filled the new border (${r.holePx}px) onto a new layer`;
}

/**
 * Skin Smoothing (Featured Neural Filter): soften skin texture while keeping eyes, lips and hair detail. Skin-tone chroma gate, restricted to detected faces when the face-landmark model is installed.
 * @mcp ml.skinSmoothing
 * @param blur Blur strength 0..100.
 * @param smoothness Texture smoothness 0..100.
 */
export async function mlSkinSmoothing(blur = 50, smoothness = 50): Promise<string> {
  const r = await ml.skinSmoothing(blur, smoothness);
  if (!r.ok) throw new Error("Skin Smoothing did not run — raise Blur above 0, or the document changed mid-run.");
  return r.faces
    ? `Smoothed skin across ${r.faces} face${r.faces === 1 ? "" : "s"}`
    : "Smoothed skin-toned areas (no face model installed — chroma gate only)";
}

// ── Job tools (unbounded diffusion/denoise; start → poll ml.jobStatus) ───────

/**
 * Start an AI Denoise pass (DRUNet, tiled) over the document. Long-running: poll ml.jobStatus.
 * @mcp ml.aiDenoise
 */
export function mlAiDenoise(): string {
  return startJob("aiDenoise", (p) => ml.aiDenoise(p));
}

/**
 * Start a prompted Generative Fill of the current selection (blended latent diffusion). Long-running: poll ml.jobStatus.
 * @mcp ml.generativeFillPrompt
 * @param prompt What to paint into the selection.
 * @param steps Diffusion steps (1..50).
 */
export async function mlGenerativeFillPrompt(prompt: string, steps = 8): Promise<string> {
  await requireSd(["vae_encoder/model.onnx"]); // structured error — NEVER the UI's silent MI-GAN downgrade
  return startJob("generativeFillPrompt", (p) => ml.generativeFillPrompt(prompt, steps, p));
}

/**
 * Start a text-to-image generation, opening the result as a new document. Long-running: poll ml.jobStatus.
 * @mcp ml.generateImage
 * @param prompt Description of the image to generate.
 * @param steps Diffusion steps (1..50).
 */
export async function mlGenerateImage(prompt: string, steps = 12): Promise<string> {
  await requireSd();
  return startJob("generateImage", (p) => ml.generateImage(prompt, steps, p));
}

/**
 * Start a Generate Background pass: keep the subject, synthesize a new backdrop from the prompt. Long-running: poll ml.jobStatus.
 * @mcp ml.generateBackground
 * @param prompt Description of the new background scene.
 * @param steps Diffusion steps (1..50).
 */
export async function mlGenerateBackground(prompt: string, steps = 8): Promise<string> {
  await requireSd();
  return startJob("generateBackground", (p) => ml.generateBackground(prompt, steps, p));
}

// ── Introspection ────────────────────────────────────────────────────────────

/**
 * Poll a long-running ML job started by a diffusion or denoise tool.
 * @mcp ml.jobStatus
 * @param jobId Job id returned by the tool that started the job.
 */
export function mlJobStatus(jobId: number): string {
  const job = _jobs.get(jobId);
  if (!job) throw new Error(`No such ML job #${jobId}.`);
  return JSON.stringify({
    state: job.state,
    kind: job.kind,
    elapsedMs: Date.now() - job.startedAt,
    lastMessage: job.msgs.length ? job.msgs[job.msgs.length - 1] : null,
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
  });
}

/**
 * Cancel a running long-lived ML job started through MCP. Poll ml.jobStatus until it reports cancelled.
 * @mcp ml.jobCancel
 * @param jobId Job id returned by the tool that started the job.
 */
export function mlJobCancel(jobId: number): string {
  const job = _jobs.get(jobId);
  if (!job) throw new Error(`No such ML job #${jobId}.`);
  if (job.state !== "running") return JSON.stringify({ jobId, state: job.state });
  if (!cancelMlJob()) throw new Error(`ML job #${jobId} is not cancellable.`);
  job.state = "cancelling";
  return JSON.stringify({ jobId, state: "cancelling" });
}

/**
 * Report on-device ML weight availability per feature: which model files are present and whether each feature is ready.
 * @mcp ml.models
 */
export async function mlModels(): Promise<string> {
  const sd = await resolveSdBase(true); // introspection re-probes installs; prefers /models/sd15
  const out = await Promise.all(
    ML_FEATURES.map(async (feat) => {
      const files = await Promise.all(feat.files.map(async (p) => {
        const url = p.startsWith("sd/") ? `${sd.base}/${p.slice(3)}` : `/models/${p}`;
        return { path: p, present: await filePresent(url) };
      }));
      const ready = files.every((f) => f.present);
      const entry: { feature: string; files: typeof files; ready: boolean; note?: string } = { feature: feat.feature, files, ready };
      // The resolver already distinguishes the real SD-1.5 set from the demo
      // placeholder by kind — no size heuristic needed.
      if (feat.feature === "sd-core" && ready && sd.kind === "demo") entry.note = "demo/placeholder weights";
      return entry;
    }),
  );
  return JSON.stringify(out);
}

// ── Keyboard shortcut sets ──────────────────────────────────────────────────

function shortcutSetCatalog() {
  return [...(commandPalette.catalog.length ? commandPalette.catalog : commandPalette.items), ...commandPalette.toolItems];
}

function namedShortcutSet(name: string) {
  if (name === DEFAULT_SHORTCUT_SET_NAME) return { name, shortcuts: {} };
  const set = loadShortcutSets().find((set) => set.name === name);
  if (!set) throw new Error(`No shortcut set named “${name}”. Use shortcuts.listSets to list available sets.`);
  return set;
}

// MCP has no Save button, so a name clash points at the flag that overrides it.
function refuseExistingShortcutSet(name: string, replace: boolean) {
  const existing = !replace && loadShortcutSets().find((set) => set.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) throw new Error(`A shortcut set named “${existing.name}” already exists. Pass replace: true to overwrite it, or use a different name.`);
}

/** List Monet Defaults, saved shortcut sets, and the current effective overrides.
 * @mcp shortcuts.listSets
 */
export function listShortcutSets(): string {
  return JSON.stringify({ selected: loadShortcutSetSelection(), current: store.state.keyboardShortcuts,
    sets: [{ name: DEFAULT_SHORTCUT_SET_NAME, shortcuts: {} }, ...loadShortcutSets()] });
}

/** Save current shortcuts as a named set. Monet Defaults cannot be overwritten.
 * @mcp shortcuts.saveSet
 * @param name Name for the saved set (1–80 characters).
 * @param replace Explicitly replace an existing set with this name.
 */
export function saveKeyboardShortcutSet(name: string, replace = false): string {
  refuseExistingShortcutSet(name, replace);
  const sets = putShortcutSet(loadShortcutSets(), name, store.state.keyboardShortcuts, replace, shortcutSetCatalog());
  saveShortcutSets(sets, name.trim());
  return `Saved shortcut set “${name.trim()}”.`;
}

/** Activate a saved shortcut set or Monet Defaults and persist its bindings.
 * @mcp shortcuts.selectSet
 * @param name Saved set name, or Monet Defaults.
 */
export function selectKeyboardShortcutSet(name: string): string {
  const set = namedShortcutSet(name);
  saveShortcutSets(loadShortcutSets(), name === DEFAULT_SHORTCUT_SET_NAME ? "" : name);
  store.setKeyboardShortcuts(set.shortcuts);
  return `Selected shortcut set “${name}”.`;
}

/** Delete a saved set; deleting the active, unmodified set restores Monet Defaults.
 * @mcp shortcuts.deleteSet
 * @param name Saved set name; Monet Defaults cannot be deleted.
 */
export function deleteKeyboardShortcutSet(name: string): string {
  if (name === DEFAULT_SHORTCUT_SET_NAME) throw new Error("Monet Defaults cannot be deleted.");
  const set = namedShortcutSet(name);
  const selected = loadShortcutSetSelection();
  const reset = selected === name && sameShortcuts(store.state.keyboardShortcuts, set.shortcuts);
  saveShortcutSets(loadShortcutSets().filter((item) => item.name !== name), reset ? "" : selected === name ? null : selected);
  if (reset) store.setKeyboardShortcuts({});
  return `Deleted shortcut set “${name}”.`;
}

/** Import and activate a validated Monet .monetkeys JSON file, preserving other saved sets.
 * @mcp shortcuts.importSet
 * @param json Contents of an exported .monetkeys file.
 * @param replace Explicitly replace an existing set with the imported name.
 */
export function importKeyboardShortcutSet(json: string, replace = false): string {
  const set = parseShortcutSet(json, shortcutSetCatalog());
  const name = set.name.toLowerCase() === DEFAULT_SHORTCUT_SET_NAME.toLowerCase() ? "Monet Defaults Copy" : set.name;
  refuseExistingShortcutSet(name, replace);
  saveShortcutSets(putShortcutSet(loadShortcutSets(), name, set.shortcuts, replace), name);
  store.setKeyboardShortcuts(set.shortcuts);
  return `Imported shortcut set “${name}”.`;
}

/** Export a shortcut set as portable .monetkeys JSON. Omit name to export current shortcuts, including workspace overrides.
 * @mcp shortcuts.exportSet
 * @param name Saved set name, Monet Defaults, or empty for current shortcuts.
 */
export function exportKeyboardShortcutSet(name = ""): string {
  return serializeShortcutSet(name ? namedShortcutSet(name) : {
    name: loadShortcutSetSelection() || (Object.keys(store.state.keyboardShortcuts).length ? "My Shortcuts" : DEFAULT_SHORTCUT_SET_NAME),
    shortcuts: store.state.keyboardShortcuts,
  });
}
