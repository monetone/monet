// ─────────────────────────────────────────────────────────────
// EngineClient — the TS bridge to the Rust/WASM rendering engine.
//
// Owns the wasm `Engine` instance, the document <canvas>, and the blit
// path: it copies the engine's composited RGBA buffer straight out of
// wasm linear memory into the canvas. Painting uses region blits so a
// brush dab only repaints its dirty rectangle.
// ─────────────────────────────────────────────────────────────

import init, { Engine, develop_profile_info, develop_profile_register, develop_profile_registered, develop_profile_take_missing, engine_version, type InitOutput } from "@engine";
import { DEFAULT_GAMUT_WARNING, gamutWarningPixel, iccProofSimulationMap, isCmykGamutWarning, normalizeGamutWarningPaint, proofPixel, type GamutWarningPaint, type IccProofSimulation, type ProofMode, type ProofOptions } from "@monet-ui/monet-color";
import { DISPLAY_LUT_SIZE, lutSizeFor, proofLutSizeFor, sampleDisplayLut, sampleProofLut } from "@monet-ui/monet-color";
import { channelBars, channelCounts, allChannelBars, type HistChannel } from "../state/channelHistogram";
import { IMPORTED_PHOTOSHOP_SAVE_BLOCKED, importedPhotoshopApi } from "../state/photoshopContainment";
import { photoshopVersion } from "../state/photoshopFilePolicy";
import type { Photoshop32BitImport, RawDemosaic } from "../state/webExportPrefs";
import type { PhotoshopRawLayout } from "../state/photoshopRaw";
import { assertHistorySettled, historyTransactionActive } from "./historyTransaction";

let wasm: InitOutput | null = null;

/** Preferences ▸ Transparency & Gamut ▸ Gamut Warning paint. Display-only, so
 *  it lives with the rest of the proof state here rather than in the document
 *  store, and persists across sessions like Photoshop's preference. */
const GAMUT_PAINT_KEY = "mv.gamutWarningPaint";

function loadGamutWarningPaint(): GamutWarningPaint {
  try {
    const saved = localStorage.getItem(GAMUT_PAINT_KEY);
    return saved ? normalizeGamutWarningPaint(JSON.parse(saved)) : DEFAULT_GAMUT_WARNING;
  } catch {
    return DEFAULT_GAMUT_WARNING; // storage unavailable (node/tests) or corrupt JSON
  }
}

/** Load the wasm module once. */
export async function initEngine(): Promise<void> {
  if (!wasm) wasm = await init();
}

/** A brush stroke captured for real-time collaboration: the target layer id, the
 *  brush config [size,hardness,flow,opacity,spacing,r,g,b,a,erase], and flat
 *  points [x,y,pressure,…]. Replayed verbatim on peers via applyRemoteStroke. */
export interface StrokeOp {
  layer: number;
  brush: number[];
  pts: number[];
}

/** Standard EXIF capture settings; absent fields are unknown, never guessed. */
export interface CaptureMetadata {
  make?: string;
  model?: string;
  lens?: string;
  focalLengthMm?: number;
  aperture?: number;
  focalLength35Mm?: number;
  subjectDistanceM?: number;
}

/** Cap on remote strokes buffered while they cannot be replayed (#6, #80).
 *  ponytail: a plain drop past the cap — a late-join raster snapshot (the
 *  documented collab v1 follow-up) is the real answer to long absences. */
const MAX_PENDING_REMOTE = 1024;

/** The smallest rect holding every pixel where `next` differs from `prev` (two
 *  w×h RGBA images as one u32 per pixel), or null when none does. */
export function changedRect(prev: Uint32Array, next: Uint32Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, x1 = -1, y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let a = 0;
    while (a < w && prev[row + a] === next[row + a]) a++;
    if (a === w) continue;
    let b = w - 1;
    while (b > a && prev[row + b] === next[row + b]) b--;
    if (y0 < 0) y0 = y;
    y1 = y;
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
  }
  return y0 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export class EngineClient {
  engine: Engine | null = null;
  width = 0;
  height = 0;
  /** Bumped on every document swap / resize (see afterDocChange). Long-running
   *  async jobs (ML) capture this before awaiting and bail if it changed, so
   *  they never apply results to a document the user has since replaced. */
  docGen = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** Window ▸ Arrange panes showing the active document. Every blit is copied
   *  onto them, so a second view follows the brush dab by dab at full size. */
  private mirrors = new Set<HTMLCanvasElement>();
  /** Told of every rect the document canvas takes (display transforms already
   *  applied, in `displayImage`): Window ▸ Arrange float windows stream it. */
  readonly blitListeners = new Set<(x: number, y: number, w: number, h: number) => void>();
  private imageData: ImageData | null = null;
  private imageDataFresh = false; // a reallocated blank buffer is not the float's previous frame
  /** View ▸ Proof Setup state. When proofOn, the blit path remaps each pixel
   *  through `proofPixel` on its way to the canvas (display only — the engine's
   *  real output, and thus save/export, is never touched). */
  private proofMode: ProofMode = "cmyk";
  private proofOptions: ProofOptions = {};
  private proofOn = false;
  private gamutWarningOn = false;
  private gamutWarningPaint: GamutWarningPaint = loadGamutWarningPaint();
  /** View-side display compensation: the doc-profile → sRGB LUT baked by
   *  setDisplayProfile (null = identity, i.e. an sRGB/untagged document).
   *  Applied in applyDisplayRect, so the engine composite stays raw. */
  private displayLut: Uint8Array | null = null;
  private displayLutN = 0;
  private displayLutKey = "";
  /** Color Settings ▸ Advanced ▸ Desaturate Monitor Colors By: the fraction
   *  (0..1) each on-screen pixel is pulled toward its luminance, after every
   *  other display transform. Display only, like the LUTs: the engine output
   *  that exports read never carries it. */
  private monitorDesaturation = 0;
  /** View-side ICC soft proof: doc → CMYK press profile → sRGB LUT with a
   *  gamut byte per point (null = the profile-free heuristic). Baked by the
   *  store; when active it supersedes proofPixel AND displayLut — the LUT
   *  already includes the doc→display mapping. */
  private iccProofLut: Uint8Array | null = null;
  private iccProofN = 0;
  /** Simulate Paper Color / Black Ink over the ICC LUT: affine remap of each
   *  LUT sample, rebuilt whenever the LUT or the proof options change. */
  private iccProofSim: IccProofSimulation | null = null;
  /** View ▸ 32-bit Preview Options: display-only tone map for float (32-bit)
   *  documents. When on, `blit`/`blitRegion` swap in a tone-mapped recomposite
   *  (`Engine.hdr_preview_rgba8`) instead of the raw clamped output — never
   *  `self.output`, so save/export/eyedropper/clone-stamp are untouched. Off
   *  by default, and a no-op on non-32-bit documents (the engine ignores the
   *  settings there), so every existing caller is unaffected. */
  private hdrPreviewOn = false;
  private hdrPreviewMethod = 0;
  private hdrPreviewExposure = 0;
  private hdrPreviewGamma = 1;
  /** Called after any structural change so the UI store can resync. */
  onSync: (() => void) | null = null;
  /** While true, `commit()` still repaints (blit) but skips the UI resync. Live
   *  dialog previews set this so the costly all-thumbnail `syncFromEngine` is
   *  deferred to one pass when the drag settles, not run on every slider tick. */
  syncSuspended = false;
  /** Called at the start of every content-changing `commit()` so the store can
   *  flag the active document dirty (drives the unsaved-`*` tab marker). */
  onCommit: (() => void) | null = null;
  /** Called when Rust atomically refuses an edit that cannot preserve the
   *  document's authoritative data. Rejected edits repaint/resync, but never
   *  dirty the document or create a frontend history entry. */
  onEditError: ((message: string) => void) | null = null;

  version(): string { return engine_version(); }
  /** Fired after each region repaint (a brush stamp's dirty rect), so a display
   *  overlay — the Quick Mask rubylith — can refresh the same rect live during a
   *  stroke. No-op (early-returns) when the overlay is inactive. */
  onPaintRegion: ((x: number, y: number, w: number, h: number) => void) | null = null;
  /** Set by the collab module to broadcast a completed local stroke to peers
   *  (null when collaboration is off — solo painting pays nothing). */
  onStroke: ((op: StrokeOp) => void) | null = null;
  /** Set while Allow Tool Recording is on: every finished local stroke is handed
   *  over as a replayable step, collab session or not. (#471) */
  onStrokeRecorded: ((op: StrokeOp) => void) | null = null;
  private strokeBuf: StrokeOp | null = null;
  /** The document the collab room is bound to — set once by src/collab when a
   *  session starts (0 = no session). Layer ids are a PER-Engine counter, so a
   *  peer's stroke replayed while another document is active would paint into a
   *  colliding layer id of an unrelated document. (#80) */
  collabDoc = 0;
  private docKeys = new WeakMap<Engine, number>();
  private nextDocKey = 1;
  /** Remote strokes held back because the collab document is not active (#80) or
   *  a local stroke transaction is open on the engine (#6). Flushed by
   *  flushRemoteStrokes; bounded so an unattended tab cannot grow without end. */
  private pendingRemote: StrokeOp[] = [];
  /** The last brush config pushed to the engine (set by the store's pushBrush),
   *  captured so a broadcast stroke carries the brush peers must replay with. */
  lastBrush: number[] = [];

  /** The active wasm Engine, asserted present. Throws a clear, intentional error
   *  if accessed before boot or after a document is torn down — rather than a
   *  bare TypeError at a random call site. Callers use `engine.e` in place of a
   *  raw `engine.engine` non-null assertion. */
  get e(): Engine {
    if (!this.engine) throw new Error("Engine not ready");
    return this.engine;
  }

  get mem(): WebAssembly.Memory {
    return (wasm as InitOutput).memory;
  }

  // ── collaborative painting (stroke-operation channel) ────────────────
  // Capture the active local stroke so the collab module can broadcast it, and
  // replay collaborators' strokes onto the right layer. Raster pixels never sync
  // through the document CRDT (they live in WASM memory); peers exchange the
  // strokes themselves and replay them (engine merge doc §, collab doc Vision).

  /** Stable identity for a document, keyed by its Engine (weak, so closing a
   *  document still frees it). The collab room binds to one of these. (#80) */
  docKey(eng: Engine | null = this.engine): number {
    if (!eng) return 0;
    let key = this.docKeys.get(eng);
    if (key === undefined) { key = this.nextDocKey++; this.docKeys.set(eng, key); }
    return key;
  }

  /** True while a document other than the collab room's is active. (#80) */
  private offCollabDoc(): boolean {
    return this.collabDoc !== 0 && this.docKey() !== this.collabDoc;
  }

  /** Begin recording a local stroke (no-op unless a collab session is bound). */
  strokeCaptureBegin(): void {
    if ((!this.forCollab() && !this.onStrokeRecorded) || !this.engine || this.lastBrush.length === 0) {
      this.strokeBuf = null;
      return;
    }
    this.strokeBuf = { layer: this.engine.active_layer_id(), brush: [...this.lastBrush], pts: [] };
  }
  strokeCapturePoint(x: number, y: number, pressure: number): void {
    if (this.strokeBuf) this.strokeBuf.pts.push(x, y, pressure);
  }
  strokeCaptureEnd(): void {
    const stroke = this.strokeBuf;
    this.strokeBuf = null;
    if (stroke && stroke.pts.length > 0) {
      if (this.forCollab()) this.onStroke?.(stroke);
      this.onStrokeRecorded?.(stroke); // Allow Tool Recording (#471)
    }
    this.flushRemoteStrokes(); // (#6) replay whatever arrived during the local stroke
  }

  /** True while a bound collab room wants this document's strokes. */
  private forCollab(): boolean {
    return !!this.onStroke && !this.offCollabDoc();
  }

  /** Replay a stroke an action recorded, on whatever layer is active now —
   *  Photoshop replays a tool step against the playing document. (#471) */
  replayStroke(brush: number[], pts: number[]): void {
    if (this.engine) this.applyStroke({ layer: this.engine.active_layer_id(), brush, pts });
  }

  /** Replay a collaborator's stroke on its layer, then restore the local user's
   *  active layer + brush + repaint. Ops that cannot be replayed right now are
   *  buffered rather than dropped, so the canvases stay in sync. */
  applyRemoteStroke(op: StrokeOp): void {
    if (!this.engine) return;
    // A replay opens its own stroke transaction on the engine, which has no
    // reentrancy guard: `stroke_begin` would overwrite the local stroke's base
    // and its `stroke_end` would silence every remaining local `stroke_to`. And
    // layer ids collide across documents, so a replay into a document the room
    // does not share would corrupt an unrelated one. Defer both. (#6, #80)
    if (this.strokeBuf || this.offCollabDoc()) {
      if (this.pendingRemote.length < MAX_PENDING_REMOTE) this.pendingRemote.push(op);
      return;
    }
    this.applyStroke(op);
  }

  /** Paint one captured stroke on its layer, then restore the local user's
   *  active layer + brush + repaint. Shared by collab replay and action replay. */
  private applyStroke(op: StrokeOp): void {
    if (!this.engine) return;
    const e = this.engine;
    let targetExists = false;
    for (let i = 0; i < e.layer_count(); i++) {
      if (e.layer_id_at(i) === op.layer) { targetExists = true; break; }
    }
    if (!targetExists || e.layer_locked(op.layer)) return;
    const active = e.active_layer_id();
    try {
      e.set_active_layer(op.layer);
      const b = op.brush;
      e.set_brush(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9] !== 0);
      if (!e.stroke_begin()) return;
      for (let i = 0; i + 2 < op.pts.length; i += 3) {
        e.stroke_to(op.pts[i], op.pts[i + 1], op.pts[i + 2]);
      }
      e.stroke_end();
    } finally {
      e.set_active_layer(active);
      // The replay left the peer's brush on the engine — put the local user's
      // back, or their next stroke paints with the peer's settings. (#6)
      const lb = this.lastBrush;
      if (lb.length >= 10) e.set_brush(lb[0], lb[1], lb[2], lb[3], lb[4], lb[5], lb[6], lb[7], lb[8], lb[9] !== 0);
    }
    e.composite();
    this.blit();
  }

  /** Replay buffered remote strokes (local stroke finished, or the collab
   *  document became active again). Ops still not replayable re-buffer. */
  private flushRemoteStrokes(): void {
    if (!this.pendingRemote.length) return;
    const ops = this.pendingRemote;
    this.pendingRemote = [];
    for (const op of ops) this.applyRemoteStroke(op);
  }

  setCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: false });
    this.resizeCanvasEl();
    if (this.engine) this.blit();
  }

  addMirror(canvas: HTMLCanvasElement) {
    this.mirrors.add(canvas);
    this.copyToMirrors(0, 0, this.width, this.height);
  }
  removeMirror(canvas: HTMLCanvasElement) {
    this.mirrors.delete(canvas);
  }
  /** The active document as the canvas shows it; null before the first blit. */
  displayImage(): ImageData | null {
    return this.imageData;
  }
  /** Put the rect the document canvas just took — display transforms already
   *  applied — onto every mirror; one the document outgrew is resized and
   *  filled whole. */
  private copyToMirrors(x: number, y: number, w: number, h: number) {
    const img = this.imageData;
    if (!img || !this.mirrors.size || w <= 0 || h <= 0) return;
    for (const m of this.mirrors) {
      if (m.width !== img.width || m.height !== img.height) {
        m.width = img.width;
        m.height = img.height;
        m.getContext("2d")?.putImageData(img, 0, 0);
      } else {
        m.getContext("2d")?.putImageData(img, 0, 0, x, y, w, h);
      }
    }
  }

  // ── document factories ───────────────────────────────────────
  // These *build* a wasm Engine for a new document but do NOT make it active —
  // the Store owns the open-document list and calls `activate()` to switch.
  // Multiple Engine instances coexist in the single shared wasm linear memory.
  buildNew(width: number, height: number): Engine { return new Engine(width, height); }
  /** A layered TIFF opens with its layers. One whose layers cannot be read
   *  opens flat with a notice, cleared here so the next commit does not read
   *  it as a refused edit. */
  buildImage(bytes: Uint8Array): Engine {
    const built = Engine.fromImageLayers(bytes);
    const notice = built.last_edit_error();
    if (notice) {
      built.clear_last_edit_error();
      this.onEditError?.(notice);
    }
    return built;
  }
  buildProject(bytes: Uint8Array): Engine { return Engine.loadProject(bytes); }
  buildGraphics(bytes: Uint8Array): Engine { return Engine.loadGraphicsContainer(bytes); }
  /** Import a foreign layered document into Vision's editable working format. */
  buildFormat(bytes: Uint8Array, photoshop32BitImport: Photoshop32BitImport = "auto"): Engine {
    const engine = Engine.fromFormat(bytes);
    // An import notice (a shape that opened as pixels) would be wiped by the
    // 16-bit conversion below before the new document ever drains it.
    const importWarning = engine.last_edit_error?.() ?? "";
    if (importWarning) engine.clear_last_edit_error?.();
    // Grayscale, Duotone, Lab and Multichannel files stay in their mode, so
    // they save back the way they came; every other non-RGB mode opens as RGB.
    engine.edit_imported_photoshop();
    const photoshop32 = photoshopVersion(bytes) !== null && engine.doc_depth() === 32;
    if (photoshop32 && (photoshop32BitImport === "convert16"
      || (photoshop32BitImport === "auto" && !engine.has_hdr_samples()))) {
      engine.set_depth(16);
      engine.purge();
      engine.set_history_source();
    }
    if (importWarning) this.onEditError?.(importWarning);
    return engine;
  }
  buildRaw(bytes: Uint8Array, demosaic: RawDemosaic = "adaptive"): Engine {
    return Engine.fromRawDemosaic(bytes, demosaic === "bilinear" ? 0 : 1);
  }
  captureMetadata(bytes: Uint8Array): CaptureMetadata {
    return JSON.parse(Engine.captureMetadata(bytes)) as CaptureMetadata;
  }
  /** Camera Raw ▸ Profile (#446): read a DNG camera profile (.dcp) or a DNG's
   *  embedded profile — JSON {name, model, digest, …} or {error}. */
  developProfileInfo(bytes: Uint8Array): string { return develop_profile_info(bytes); }
  /** developProfileInfo, and keep the profile's tables in the engine so a
   *  develop naming its digest renders through it (every engine instance). */
  registerDevelopProfile(bytes: Uint8Array): string { return develop_profile_register(bytes); }
  developProfileRegistered(digest: string): boolean { return develop_profile_registered(digest); }
  /** Camera Raw profiles a develop named that neither the engine nor the
   *  host (Store.developProfileBytes) could supply, so it rendered them as
   *  Camera Default. Drained on every sync. */
  onDevelopProfileMissing: ((digests: string[]) => void) | null = null;
  reportMissingDevelopProfiles() {
    if (!wasm || !this.onDevelopProfileMissing) return;
    const digests = JSON.parse(develop_profile_take_missing() || "[]") as string[];
    if (digests.length) this.onDevelopProfileMissing(digests);
  }
  /** Headerless Photoshop Raw, laid out as the Photoshop Raw Options dialog says. */
  buildPhotoshopRaw(bytes: Uint8Array, l: PhotoshopRawLayout): Engine {
    return Engine.fromPhotoshopRaw(bytes, l.width, l.height, l.channels, l.interleaved, l.depth, l.bigEndian, l.header);
  }
  /** A DICOM file's Instance Number; undefined when it has none. */
  dicomInstanceNumber(bytes: Uint8Array): number | undefined {
    return Engine.dicomInstanceNumber(bytes);
  }

  /** Authoritative project serialization boundary shared by save, snapshots,
   *  duplicate, Liquify clones, and nested Smart Object persistence. */
  projectBytes(source: Engine = this.e): Uint8Array {
    assertHistorySettled(source);
    if (importedPhotoshopApi(source).imported_photoshop_read_only?.()) {
      throw new Error(IMPORTED_PHOTOSHOP_SAVE_BLOCKED);
    }
    const guarded = source as Engine & { try_save_project?: () => Uint8Array };
    const bytes = guarded.try_save_project?.() ?? source.save_project();
    if (!bytes.length) throw new Error("The engine returned an empty project document.");
    return bytes;
  }

  /** Authoritative Monet Graphics container serialization boundary. */
  graphicsContainerBytes(source: Engine = this.e): Uint8Array {
    assertHistorySettled(source);
    if (importedPhotoshopApi(source).imported_photoshop_read_only?.()) {
      throw new Error(IMPORTED_PHOTOSHOP_SAVE_BLOCKED);
    }
    const guarded = source as Engine & {
      trySaveGraphicsContainer?: () => Uint8Array;
      saveGraphicsContainer: () => Uint8Array;
    };
    const bytes = guarded.trySaveGraphicsContainer?.() ?? guarded.saveGraphicsContainer();
    if (!bytes.length) throw new Error("The engine returned an empty graphics document.");
    return bytes;
  }

  /** Make `engine` the active document: blit it onto the shared canvas, resize
   *  and resync. Called by the Store on New/Open and on every tab switch. */
  activate(engine: Engine) {
    this.engine = engine;
    this.afterDocChange();
    this.flushRemoteStrokes(); // (#80) back on the collab document → replay what waited
  }

  /** The last document closed (#476): no engine is active, so `e` throws its
   *  clear "Engine not ready" instead of a random TypeError, and docGen moves so
   *  an in-flight async job (ML) bails rather than writing into nothing. */
  deactivate() {
    this.engine = null;
    this.docGen++;
    this.width = 0;
    this.height = 0;
  }

  /** Consume and surface a Rust-side edit refusal. Returns true when an error
   *  was handled, so alternate mutation paths can avoid dirty/history updates. */
  consumeEditError(): boolean {
    const guarded = this.engine as (Engine & {
      last_edit_error?: () => string;
      clear_last_edit_error?: () => void;
    }) | null;
    const message = guarded?.last_edit_error?.() ?? "";
    if (!message) return false;
    guarded?.clear_last_edit_error?.();
    this.blit();
    this.sync();
    this.onEditError?.(message);
    return true;
  }

  /** Re-read document dimensions, resize the canvas element, blit + sync. */
  afterDocChange(): boolean {
    if (!this.engine) return false;
    // Adopt the new geometry BEFORE draining a latched refusal: an error left on
    // a BACKGROUND document's engine is only read here, on the tab switch that
    // activates it, and returning early first left this.width/height and the
    // canvas sized for the PREVIOUS document — every blit then read the new
    // engine's buffer with the wrong stride. (#56)
    this.docGen++;
    this.width = this.engine.width();
    this.height = this.engine.height();
    this.resizeCanvasEl();
    if (this.consumeEditError()) return false;
    this.blit();
    this.sync();
    return true;
  }

  private resizeCanvasEl() {
    if (!this.canvas || !this.engine) return;
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    this.imageData = this.ctx!.createImageData(this.width, this.height);
    this.imageDataFresh = true;
  }

  /** View ▸ Proof Setup / Proof Colors: configure the display soft-proof. */
  setProof(mode: string, on: boolean, options?: ProofOptions) {
    this.proofMode = mode as ProofMode;
    this.proofOn = on;
    if (options) {
      this.proofOptions = {
        simulatePaperColor: !!options.simulatePaperColor,
        simulateBlackInk: !!options.simulateBlackInk,
      };
    }
    this.refreshIccProofSim();
  }

  /** View ▸ Gamut Warning: display-only overlay for colours outside the
   *  current proof's gamut (ICC LUT flag, else the profile-free heuristic). */
  setGamutWarning(on: boolean) {
    this.gamutWarningOn = on;
  }

  /** Preferences ▸ Transparency & Gamut: the overlay's colour and coverage. */
  setGamutWarningPaint(paint: GamutWarningPaint) {
    this.gamutWarningPaint = normalizeGamutWarningPaint(paint);
    try {
      localStorage.setItem(GAMUT_PAINT_KEY, JSON.stringify(this.gamutWarningPaint));
    } catch { /* storage may be unavailable */ }
    if (this.gamutWarningOn) this.blit();
  }

  getGamutWarningPaint(): GamutWarningPaint {
    return this.gamutWarningPaint;
  }

  /** View ▸ 32-bit Preview Options: configure the float-document preview tone
   *  map and repaint. Display-only — see the `hdrPreviewOn` field comment. */
  setHdrPreview(on: boolean, method: number, exposure: number, gamma: number) {
    this.hdrPreviewOn = on;
    this.hdrPreviewMethod = method;
    this.hdrPreviewExposure = exposure;
    this.hdrPreviewGamma = gamma;
    this.blit();
  }

  /** Current View ▸ 32-bit Preview Options state (off/identity until set). */
  getHdrPreview(): { on: boolean; method: number; exposure: number; gamma: number } {
    return {
      on: this.hdrPreviewOn,
      method: this.hdrPreviewMethod,
      exposure: this.hdrPreviewExposure,
      gamma: this.hdrPreviewGamma,
    };
  }

  /** Install (or clear) the ICC soft-proof LUT baked by the store. */
  setIccProofLut(lut: Uint8Array | null) {
    const n = lut ? proofLutSizeFor(lut) : null;
    this.iccProofLut = n ? lut : null;
    this.iccProofN = n ?? 0;
    this.refreshIccProofSim();
    this.blit();
  }

  /** Rebake the Paper Color / Black Ink remap for the ICC branch. The LUT's
   *  (0,0,0) corner is the proof's own black rendition — profile-derived. */
  private refreshIccProofSim() {
    const lut = this.iccProofLut;
    this.iccProofSim = lut ? iccProofSimulationMap([lut[0], lut[1], lut[2]], this.proofOptions) : null;
  }

  /** Sync display compensation with the active document's assigned profile:
   *  bake (or clear) the doc-profile → sRGB LUT and repaint. Untagged
   *  documents present their raw numbers (identity), like Photoshop. */
  setDisplayProfile(profile: number, assigned: boolean, iccBytes: Uint8Array | null, iccName: string | null) {
    const key = assigned ? `${profile}:${iccName ?? ""}:${iccBytes?.length ?? 0}` : "untagged";
    if (key === this.displayLutKey) return;
    this.displayLutKey = key;
    let lut: Uint8Array | null = null;
    if (assigned && (profile !== 0 || (iccBytes?.length ?? 0) > 0) && this.engine) {
      const baked = this.engine.display_lut(DISPLAY_LUT_SIZE, iccBytes ?? new Uint8Array(0));
      const n = lutSizeFor(baked);
      if (n) { this.displayLutN = n; lut = baked; }
    }
    this.displayLut = lut;
    this.blit();
  }

  /** Desaturate Monitor Colors By `percent` (0 = off). Repaints. */
  setMonitorDesaturation(percent: number) {
    const amount = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) / 100 : 0;
    if (amount === this.monitorDesaturation) return;
    this.monitorDesaturation = amount;
    this.blit();
  }

  /** Remap imageData.data[] over a pixel rect through active display-only colour
   *  transforms. Called after the wasm bytes are copied in. */
  private applyDisplayRect(x: number, y: number, w: number, h: number) {
    const lut = this.displayLut;
    const proofLut = this.iccProofLut;
    const desaturate = this.monitorDesaturation;
    if ((!this.proofOn && !this.gamutWarningOn && !lut && !desaturate) || !this.imageData) return;
    const data = this.imageData.data;
    const fullW = this.width;
    const mode = this.proofMode;
    const n = this.displayLutN;
    const pn = this.iccProofN;
    const sim = this.proofOn ? this.iccProofSim : null;
    const paint = this.gamutWarningPaint;
    for (let row = y; row < y + h; row++) {
      let i = (row * fullW + x) * 4;
      for (let col = 0; col < w; col++, i += 4) {
        const sr = data[i], sg = data[i + 1], sb = data[i + 2];
        let r = sr, g = sg, b = sb;
        let gamut = false;
        if (proofLut && (this.proofOn || this.gamutWarningOn)) {
          // Real ICC round-trip (doc → press CMYK → display) + true gamut flag.
          const [pr, pg, pb, flag] = sampleProofLut(proofLut, pn, sr, sg, sb);
          gamut = this.gamutWarningOn && flag !== 0;
          if (this.proofOn) {
            [r, g, b] = [pr, pg, pb];
            if (sim) {
              // Simulate Paper Color / Black Ink over the real ICC proof.
              r = Math.min(255, Math.max(0, Math.round(r * sim.scale[0] + sim.offset[0])));
              g = Math.min(255, Math.max(0, Math.round(g * sim.scale[1] + sim.offset[1])));
              b = Math.min(255, Math.max(0, Math.round(b * sim.scale[2] + sim.offset[2])));
            }
          } else if (lut) {
            [r, g, b] = sampleDisplayLut(lut, n, r, g, b);
          }
        } else {
          // Profile-free heuristics (no press profile available).
          gamut = this.gamutWarningOn && isCmykGamutWarning(sr, sg, sb, this.proofOptions?.press);
          if (this.proofOn) [r, g, b] = proofPixel(mode, r, g, b, this.proofOptions);
          if (lut) [r, g, b] = sampleDisplayLut(lut, n, r, g, b);
        }
        if (desaturate) {
          const l = 0.3 * r + 0.59 * g + 0.11 * b;
          r += (l - r) * desaturate; g += (l - g) * desaturate; b += (l - b) * desaturate;
        }
        // Painted over the proofed pixel, so a translucent warning blends with
        // what the user is actually looking at.
        if (gamut) [r, g, b] = gamutWarningPixel([r, g, b], paint);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }
    }
  }

  /** A copy of the composited RGBA output (w*h*4). Copied, not a view, because
   *  wasm memory can move under the caller — the same rule every blit follows. */
  compositeBytes(): Uint8Array | null {
    if (!this.engine) return null;
    this.engine.composite();
    const ptr = this.engine.output_ptr();
    return new Uint8Array(this.mem.buffer, ptr, this.width * this.height * 4).slice();
  }

  /** Color Range ▸ Out of Gamut: which pixels the current proof cannot
   *  reproduce, as document-sized coverage the selection can take. Uses the same
   *  ICC flag (or the same profile-free heuristic) View ▸ Gamut Warning paints
   *  with, so what the overlay shows is exactly what this selects — independent
   *  of whether that overlay happens to be switched on. Reads the document
   *  composite, not the canvas: the canvas has been through the display-only
   *  transforms (display LUT, proof, Desaturate Monitor Colors, the overlay). */
  outOfGamutMask(): Uint8Array {
    const engine = this.engine;
    if (!engine) return new Uint8Array();
    const data = new Uint8Array(this.mem.buffer, engine.output_ptr(), this.width * this.height * 4);
    const proofLut = this.iccProofLut;
    const pn = this.iccProofN;
    const out = new Uint8Array(this.width * this.height);
    for (let p = 0; p < out.length; p++) {
      const i = p * 4;
      const sr = data[i], sg = data[i + 1], sb = data[i + 2];
      const flagged = proofLut
        ? sampleProofLut(proofLut, pn, sr, sg, sb)[3] !== 0
        : isCmykGamutWarning(sr, sg, sb, this.proofOptions?.press);
      out[p] = flagged ? 255 : 0;
    }
    return out;
  }

  /** Full repaint of the canvas from the engine's composited output. */
  blit() {
    if (!this.engine || !this.ctx || !this.imageData) return;
    const { width: w, height: h } = this;
    let changed: { x: number; y: number; w: number; h: number } | null = { x: 0, y: 0, w, h };
    if (this.hdrPreviewOn) {
      // Display-only recomposite — never reads/writes `output_ptr`'s buffer.
      const bytes = this.engine.hdr_preview_rgba8(this.hdrPreviewMethod, this.hdrPreviewExposure, this.hdrPreviewGamma);
      this.imageData.data.set(bytes);
    } else {
      const ptr = this.engine.output_ptr();
      const buf = new Uint8Array(this.mem.buffer, ptr, w * h * 4);
      // A float window streaming this document is told only the pixels that
      // changed (a commit after a stroke is one small rect, not the document).
      // Exact only while the canvas shows the engine's pixels as they are.
      const display = this.proofOn || this.gamutWarningOn || this.displayLut;
      if (this.blitListeners.size && !this.imageDataFresh && !display && ptr % 4 === 0) {
        const old = this.imageData.data;
        changed = changedRect(new Uint32Array(old.buffer, old.byteOffset, w * h), new Uint32Array(this.mem.buffer, ptr, w * h), w, h);
      }
      this.imageData.data.set(buf);
    }
    this.applyDisplayRect(0, 0, w, h);
    this.ctx.putImageData(this.imageData, 0, 0);
    this.copyToMirrors(0, 0, w, h);
    this.imageDataFresh = false;
    if (changed) for (const f of this.blitListeners) f(changed.x, changed.y, changed.w, changed.h);
  }

  /** Copy the current composited engine output into JS-owned memory. Used by
   *  display-only workspace overlays that need a stable before-edit backdrop. */
  outputCopy(): Uint8ClampedArray | null {
    if (!this.engine) return null;
    const ptr = this.engine.output_ptr();
    const len = this.width * this.height * 4;
    return new Uint8ClampedArray(new Uint8Array(this.mem.buffer, ptr, len));
  }

  engineOutputCopy(eng: Engine): Uint8ClampedArray | null {
    const w = eng.width(), h = eng.height();
    if (!w || !h) return null;
    eng.composite();
    const ptr = eng.output_ptr();
    return new Uint8ClampedArray(new Uint8Array(this.mem.buffer, ptr, w * h * 4));
  }

  activeLayerCopy(): Uint8ClampedArray | null {
    if (!this.engine) return null;
    return new Uint8ClampedArray(this.engine.active_layer_rgba8());
  }

  /** Recomposite a dirty rect (after a brush stamp modifies a layer) and blit it. */
  paintRegion(x: number, y: number, w: number, h: number) {
    if (!this.engine || w <= 0 || h <= 0) return;
    this.engine.composite_region(x, y, x + w, y + h);
    this.blitRegion(x, y, w, h);
    this.onPaintRegion?.(x, y, w, h);
  }

  /** Repaint only a dirty rectangle (used during brush strokes). */
  blitRegion(x: number, y: number, w: number, h: number) {
    if (!this.engine || !this.ctx || !this.imageData) return;
    if (w <= 0 || h <= 0) return;
    // ponytail: HDR preview has no region-scoped recomposite, so fall back to
    // a full repaint. 32-bit float layers already refuse most per-pixel edits
    // (see enforce_float_authority), so region blits are rare on documents
    // where this branch is reachable — add a scoped variant if that changes.
    if (this.hdrPreviewOn) { this.blit(); return; }
    x = Math.max(0, Math.floor(x));
    y = Math.max(0, Math.floor(y));
    w = Math.min(this.width - x, Math.ceil(w));
    h = Math.min(this.height - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    const ptr = this.engine.output_ptr();
    const fullW = this.width;
    const buf = new Uint8Array(this.mem.buffer, ptr, fullW * this.height * 4);
    const data = this.imageData.data;
    for (let row = y; row < y + h; row++) {
      const start = (row * fullW + x) * 4;
      data.set(buf.subarray(start, start + w * 4), start);
    }
    this.applyDisplayRect(x, y, w, h);
    this.ctx.putImageData(this.imageData, 0, 0, x, y, w, h);
    this.copyToMirrors(x, y, w, h);
    for (const f of this.blitListeners) f(x, y, w, h);
  }

  /** A fresh view over the engine's selection mask (w*h bytes). */
  selectionMask(): Uint8Array | null {
    if (!this.engine || !this.engine.has_selection()) return null;
    const ptr = this.engine.selection_ptr();
    return new Uint8Array(this.mem.buffer, ptr, this.width * this.height);
  }

  /** A fresh view over the engine's Quick Mask buffer (w*h bytes, 255 = selected).
   *  Display-only — the red rubylith is drawn on the frontend from this; the
   *  engine's output is never tinted. Null unless Quick Mask is on. WASM memory can
   *  relocate on growth, so this view is rebuilt per read (never cached). */
  quickMaskBuffer(): Uint8Array | null {
    if (!this.engine || !this.engine.quick_mask_on()) return null;
    const ptr = this.engine.quick_mask_ptr();
    return new Uint8Array(this.mem.buffer, ptr, this.width * this.height);
  }

  /** A fresh view over the Liquify Freeze Mask overlay (w*h bytes, 255 = frozen).
   *  Display-only and session-only; null unless a Liquify session has at least
   *  one frozen pixel. */
  liquifyFreezeMaskBuffer(): Uint8Array | null {
    if (!this.engine || !this.engine.liquify_freeze_mask_on()) return null;
    const ptr = this.engine.liquify_freeze_mask_ptr();
    return new Uint8Array(this.mem.buffer, ptr, this.width * this.height);
  }

  /** Snapshot the live Liquify displacement mesh. The engine exposes copied
   *  Float32Arrays, so callers can safely sample them for display overlays
   *  without pinning wasm memory. Null when no Liquify session is open. */
  liquifyMesh(): { w: number; h: number; fx: Float32Array; fy: Float32Array } | null {
    if (!this.engine) return null;
    const fx = this.engine.liquify_mesh_fx();
    const fy = this.engine.liquify_mesh_fy();
    const count = this.width * this.height;
    if (count <= 0 || fx.length !== count || fy.length !== count) return null;
    return { w: this.width, h: this.height, fx, fy };
  }

  sync() {
    this.reportMissingDevelopProfiles();
    if (this.syncSuspended) return;
    this.onSync?.();
  }

  /** Repaint and resync after an engine-side cache refresh that does not create
   *  a user edit, such as late font provisioning for vector layers. */
  refreshFromEngine() {
    if (!this.engine) return;
    if (this.engine.width() !== this.width || this.engine.height() !== this.height) {
      this.afterDocChange();
      return;
    }
    this.blit();
    this.sync();
  }

  /** Repaint the canvas and resync the UI store after an op. */
  commit(): boolean {
    if (this.consumeEditError()) return false;

    // Live previews repaint through the normal commit path, but their temporary
    // transaction branch is not yet a document edit. Only the accepted outer
    // commit may advance the dirty/revision state.
    if (!historyTransactionActive(this.engine)) this.onCommit?.();
    // A history step can change the document geometry (undo/redo of crop,
    // resize, rotate) — re-adopt the dims before blitting, or the blit reads
    // the engine buffer with a stale stride into a wrong-sized canvas.
    if (this.engine && (this.engine.width() !== this.width || this.engine.height() !== this.height)) {
      this.afterDocChange();
      return true;
    }
    this.blit();
    this.sync();
    return true;
  }

  /** Repaint and resync after an op whose composite changed only inside a dirty
   *  rect (the live type re-apply path). */
  commitRegion(x: number, y: number, w: number, h: number): boolean {
    if (this.consumeEditError()) return false;
    if (!historyTransactionActive(this.engine)) this.onCommit?.();
    if (this.engine && (this.engine.width() !== this.width || this.engine.height() !== this.height)) {
      this.afterDocChange();
      return true;
    }
    this.blitRegion(x, y, w, h);
    this.sync();
    return true;
  }

  /** Image ▸ Mode ▸ Color Table: the distinct opaque colours in the composite,
   *  up to `max` (the exact palette for an indexed-mode image). */
  colorTable(max = 256): [number, number, number][] {
    if (!this.engine) return [];
    const ptr = this.engine.output_ptr();
    const buf = new Uint8Array(this.mem.buffer, ptr, this.width * this.height * 4);
    const seen = new Set<number>();
    const out: [number, number, number][] = [];
    for (let i = 0; i < buf.length && out.length < max; i += 4) {
      if (buf[i + 3] === 0) continue;
      const key = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      if (!seen.has(key)) { seen.add(key); out.push([buf[i], buf[i + 1], buf[i + 2]]); }
    }
    return out;
  }

  /** Raw 256-bin histogram (count per level) of `channel` over the composited
   *  image, for the Histogram panel curve + statistics. Returns 256 zeros when no
   *  engine. The panel downsamples it (downsampleBins) for the curve and feeds it
   *  to histogramStats for the readout. */
  channelHistogram(channel: HistChannel): number[] {
    if (!this.engine) return new Array(256).fill(0);
    const ptr = this.engine.output_ptr();
    const buf = new Uint8Array(this.mem.buffer, ptr, this.width * this.height * 4);
    return channelCounts(buf, channel);
  }

  /** Vectorscope: an n×n hue/saturation density grid (row-major, log-normalized
   *  0..1) of the composite, for the Histogram panel's Show Vectorscope mode.
   *  Computed by the SHARED engine op (packages/engine) so monet-artisan renders
   *  an identical scope. Returns zeros when no engine. */
  vectorscope(n = 128): Float32Array {
    if (!this.engine) return new Float32Array(n * n);
    return this.engine.vectorscope(n);
  }

  /** Waveform monitor: a `cols`×`rows` luma-density grid (row-major,
   *  log-normalized 0..1) of the composite, white at the top row. Computed by
   *  the SHARED engine op (packages/engine) so monet-artisan renders an
   *  identical scope. Returns zeros when no engine. */
  waveform(cols = 176, rows = 128): Float32Array {
    if (!this.engine) return new Float32Array(cols * rows);
    return this.engine.waveform(cols, rows);
  }

  /** RGB waveform: three stacked `cols`×`rows` per-channel density grids
   *  (R, G, B), each log-normalized 0..1. Shared engine op. Zeros when no
   *  engine. */
  waveformRgb(cols = 176, rows = 128): Float32Array {
    if (!this.engine) return new Float32Array(cols * rows * 3);
    return this.engine.waveform_rgb(cols, rows);
  }

  /** Down-sampled histogram bars for any RGB, Lab, or CMYK-derived channel. */
  channelHistogramBars(channel: HistChannel, bins: number): number[] {
    if (!this.engine) return new Array(bins).fill(0);
    const ptr = this.engine.output_ptr();
    const buf = new Uint8Array(this.mem.buffer, ptr, this.width * this.height * 4);
    return channelBars(buf, channel, bins);
  }

  /** R/G/B down-sampled histogram bars for the Histogram panel's All Channels View. */
  allChannelHistograms(bins: number): { r: number[]; g: number[]; b: number[] } {
    if (!this.engine) { const z = () => new Array(bins).fill(0); return { r: z(), g: z(), b: z() }; }
    const ptr = this.engine.output_ptr();
    const buf = new Uint8Array(this.mem.buffer, ptr, this.width * this.height * 4);
    return allChannelBars(buf, bins);
  }

  /** An animation-frame thumbnail as a data URL. */
  frameThumbUrl(i: number, w = 64, h = 40): string {
    if (!this.engine) return "";
    const px = this.engine.frame_thumb(i, w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d")!;
    const img = cx.createImageData(w, h);
    img.data.set(px);
    cx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  /** A composited thumbnail of an arbitrary document's engine (active or not),
   *  as a data URL. Used by the document browser. Each Engine owns its own
   *  buffers within the shared wasm memory, so we composite + read its output. */
  docThumbUrl(eng: Engine, maxW = 148, maxH = 112): string {
    try { eng.composite(); } catch { /* keep last composite */ }
    const w = eng.width(), h = eng.height();
    if (!w || !h) return "";
    const ptr = eng.output_ptr();
    const buf = new Uint8Array(this.mem.buffer, ptr, w * h * 4);
    const full = document.createElement("canvas");
    full.width = w; full.height = h;
    const fctx = full.getContext("2d")!;
    const img = fctx.createImageData(w, h);
    img.data.set(buf);
    fctx.putImageData(img, 0, 0);
    const scale = Math.min(maxW / w, maxH / h, 1);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const t = document.createElement("canvas");
    t.width = tw; t.height = th;
    const tctx = t.getContext("2d")!;
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(full, 0, 0, tw, th);
    return t.toDataURL();
  }

  /** A layer thumbnail as a data URL, generated off a small scratch canvas. */
  layerThumbUrl(id: number, w = 44, h = 44): string {
    if (!this.engine) return "";
    const px = this.engine.layer_thumb(id, w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d")!;
    const img = cx.createImageData(w, h);
    img.data.set(px);
    cx.putImageData(img, 0, 0);
    return c.toDataURL();
  }
}
