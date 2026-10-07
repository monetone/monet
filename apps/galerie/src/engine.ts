// engine — Galerie's bridge to the shared Rust/WASM render engine
// (packages/engine, built into engine/pkg by `pnpm engine:build`, aliased
// `@engine`). This is the SAME engine Vision and Artisan use; Galerie consumes
// it for image/RAW decode and the non-destructive Develop pipeline.
//
// Develop rides the engine's Camera Raw ABI: a DevelopRecipeV2 is serialized to
// the flat 1086-float param array by `recipeToParams` and applied via
// `camera_raw_develop` — the exact path Vision's Camera Raw workspace uses.
//
// RAW on desktop decodes natively (`decodeRawPath` → oriented scene-linear
// RGBA16 carrying the recipe's white-balance/decode intent + provenance, already
// proxied to maxEdge), fed to the engine via `Engine.fromRgba16`. Elsewhere the
// engine's own byte decoders (`fromRaw`/`fromImage`) run, downscaled to a
// bounded `proxy_engine`. Either way `proxyScale` (≤ 1) lets the engine scale
// proxy-dependent effects (grain/sharpen) back to full resolution.
//
// Color management: Galerie's working space is sRGB — every downstream consumer
// (canvas blit in the Loupe/grid, the PNG/JPEG encoders in exportImage) treats
// the RGBA8 it gets as sRGB. So a byte-decoded source that carries a wider
// embedded profile is converted to sRGB right here, once, through the engine's
// moxcms ICC path (the same color-management feature Vision uses). Without it an
// Adobe RGB or Display P3 photo's raw numbers are presented as sRGB and read
// oversaturated. Native RAW already lands in the working profile.

import init, { Engine, type InitOutput } from "@engine";
import { detectEmbeddedRgbProfile, DISPLAY_LUT_SIZE } from "@monet-ui/monet-color";
import {
  foldLocalAdjustments,
  recipeToParams,
  type DevelopRecipeV2,
  type Mask,
} from "@monet-ui/monet-photo";
import { isTauri } from "@tauri-apps/api/core";

import type { DevelopWorkerRequest, DevelopWorkerResponse } from "./developWorker";
import { applyCrop, isIdentityCrop } from "./lib/cropTransform";
import { compositeMasks, hasActiveMasks, type RenderedFrame } from "./lib/maskComposite";
import { renderableMasks } from "./lib/maskEdit";
import { getSubjectCoverage } from "./lib/subjectMask";
import { decodeRawPath, decodeRawPathCached, RAW_PROXY_MAX_EDGE } from "./rawDecode";
import type { NativeRawImage } from "./rawDecode";

let wasm: InitOutput | null = null;
type NativeRawProvenance = Omit<NativeRawImage, "pixels">;

/** Load the wasm module once (idempotent). */
export async function loadEngine(): Promise<void> {
  if (!wasm) wasm = await init();
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Tightly-packed RGBA8, width*height*4 bytes. */
  rgba: Uint8Array;
  /** Native-decode provenance (desktop RAW only); unset for byte-decoded sources. */
  decodedRaw?: NativeRawProvenance;
}

interface EngineHandle {
  engine: Engine;
  proxyScale: number;
  decodedRaw?: NativeRawProvenance;
}

/**
 * Decode into a develop-ready Engine. Desktop RAW uses the native decoder
 * (white-balance/decode intent + provenance, pixels already bounded to
 * `maxEdge`); other sources use the engine's byte decoders, downscaled to a
 * `maxEdge` proxy here (`maxEdge <= 0` keeps full resolution). Returns the
 * engine, the develop ABI's `proxyScale` (proxy ÷ full, ≤ 1), and native
 * provenance when present. Exported for the develop worker's byte path
 * (developWorker.ts) — there sourcePath is always undefined, so the Tauri
 * branch can never run off the main thread.
 * `cacheRaw` routes the native decode through the Camera Raw cache (PERF-12):
 * on for session opens, which are re-opened photo after photo, off for the
 * one-shot thumbnail/import decodes that would only evict them.
 */
export async function createEngine(
  bytes: Uint8Array,
  raw: boolean,
  sourcePath: string | undefined,
  maxEdge: number,
  recipe: DevelopRecipeV2 | undefined,
  cacheRaw = false,
): Promise<EngineHandle> {
  await loadEngine();
  if (raw && sourcePath && isTauri()) {
    // Native decode is capped at RAW_PROXY_MAX_EDGE; full-res requests (maxEdge
    // 0, e.g. export) take the largest native proxy.
    const nativeEdge = maxEdge >= 1 && maxEdge <= RAW_PROXY_MAX_EDGE ? maxEdge : RAW_PROXY_MAX_EDGE;
    const decode = cacheRaw ? decodeRawPathCached : decodeRawPath;
    const decoded = await decode(sourcePath, nativeEdge, recipe?.rawDecode);
    const { pixels, ...decodedRaw } = decoded;
    const engine = Engine.fromRgba16(decoded.width, decoded.height, pixels, true);
    const proxyScale = decoded.scaleDenominator > 0
      ? decoded.scaleNumerator / decoded.scaleDenominator
      : 1;
    return { engine, proxyScale, decodedRaw };
  }
  const full = raw ? Engine.fromRaw(bytes) : Engine.fromImage(bytes);
  const w = full.width();
  const h = full.height();
  const long = Math.max(w, h);
  if (maxEdge <= 0 || long <= maxEdge) {
    normalizeToWorkingProfile(full, bytes);
    return { engine: full, proxyScale: 1 };
  }
  // Bounded proxy for fast interactive/thumbnail develop; drop the full-res engine.
  const proxy = full.proxy_engine(0, 0, w, h, maxEdge);
  full.free();
  // Convert on the proxy, not `full`: proxy_engine inherits the profile id and
  // the ICC transform then runs over far fewer pixels.
  normalizeToWorkingProfile(proxy, bytes);
  return { engine: proxy, proxyScale: Math.min(1, maxEdge / long) };
}

/** Same bytes, typed as Uint8Array — a clamped buffer needs no copy to re-view. */
const asBytes = (b: Uint8Array | Uint8ClampedArray): Uint8Array =>
  b instanceof Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

const NO_ICC = new Uint8Array(0);
/** Relative Colorimetric — the default intent for image→working-space conversion. */
const RELATIVE_COLORIMETRIC = 1;

/**
 * Convert a byte-decoded engine from its embedded RGB profile to Galerie's sRGB
 * working space, in place. No-op for untagged/sRGB sources and for formats whose
 * profile we cannot read — those keep today's behaviour (numbers shown as sRGB).
 *
 * ponytail: two ceilings, both cheap to lift when they bite. (1) Recognition is
 * `detectEmbeddedRgbProfile`'s — PNG cICP/iCCP, JPEG APP2 name match, PSD ICC
 * bytes; a ProPhoto JPEG or a TIFF's ICC is not seen yet, so extend that shared
 * detector (it is Vision's too) rather than adding a Galerie-local parser.
 * (2) `assign_profile` + the convert each snapshot the document for undo, so the
 * full-res export path pays two extra clones on a wide-gamut source; give the
 * engine a snapshot-free assign/convert if that shows up in a profile.
 */
function normalizeToWorkingProfile(engine: Engine, bytes: Uint8Array): void {
  const embedded = detectEmbeddedRgbProfile(bytes);
  if (!embedded) return;
  const icc = embedded.iccProfileBytes ?? NO_ICC;
  if (embedded.profile === 0 && icc.length === 0) return; // already sRGB
  // `convert_profile_with_icc` requires source == the document's assigned
  // profile, and `fromImage`/`fromRaw` leave every decode assigned sRGB.
  engine.assign_profile(embedded.profile);
  try {
    engine.convert_profile_with_icc(embedded.profile, icc, 0, NO_ICC, RELATIVE_COLORIMETRIC, false, false, "");
  } catch (e) {
    // A broken/unsupported profile must not lose the photo: keep the raw numbers
    // (what shipped before) and say so rather than failing the decode.
    console.warn(`galerie: ignoring embedded profile "${embedded.name}" —`, e);
  }
}

/**
 * One develop pass over a live session engine: undo the previous pass, apply
 * the recipe through the frozen 1086-float ABI, composite, copy the RGBA8 out.
 * The ONE place that sequence lives — the sync session, decodeImage's preview
 * loop and the develop worker all run exactly this.
 */
export function developPass(
  engine: Engine,
  state: { applied: boolean },
  recipe: DevelopRecipeV2,
  proxyScale: number,
): DecodedImage {
  if (state.applied) engine.undo();
  engine.camera_raw_develop(recipeToParams(recipe, proxyScale));
  state.applied = true;
  engine.composite();
  return { width: engine.width(), height: engine.height(), rgba: engine.active_layer_rgba8() };
}

export async function decodeImage(
  bytes: Uint8Array,
  raw = false,
  sourcePath?: string,
  maxEdge = 0,
  recipeJson?: string,
  _scaleNumerator = 1,
  _scaleDenominator = 1,
): Promise<DecodedImage> {
  const recipe = recipeJson ? (JSON.parse(recipeJson) as DevelopRecipeV2) : undefined;
  const { engine, proxyScale, decodedRaw } = await createEngine(bytes, raw, sourcePath, maxEdge, recipe);
  if (!recipe) {
    engine.composite();
    const decoded = {
      width: engine.width(),
      height: engine.height(),
      rgba: engine.active_layer_rgba8(),
      decodedRaw,
    };
    engine.free();
    return decoded;
  }
  // Keep the engine alive across the develop so masks can re-render through it —
  // same undo/re-apply loop as openDevelopSession, which is what compositeMasks
  // expects.
  const state = { applied: false };
  const render = (r: DevelopRecipeV2): RenderedFrame => developPass(engine, state, r, proxyScale);
  const frame = render(recipe);
  // Local (masked) adjustments, the same composite the Loupe and every export
  // route use — without it the grid shows a globally-developed photo the Loupe
  // then re-renders with masks.
  // ponytail: AI (Select Subject) masks are dropped here — their coverage is a
  // session-only cache, so the same preview identity would key a subject-masked
  // thumbnail in one session and an unmasked one in the next. Parametric masks
  // are fully derivable from the recipe; make AI coverage persist (catalog-side)
  // and this filter can go.
  const parametric = { ...recipe, masks: { ...recipe.masks, masks: renderableMasks(recipe.masks) } };
  const masked = hasActiveMasks(parametric)
    ? compositeMasks(render, parametric, frame)
    : frame.rgba;
  engine.free();
  // Crop is the app-side viewport step (the engine renders full-frame), so a
  // thumbnail/preview must apply it too or the grid shows an uncropped photo
  // the Loupe and every export route crop. Same shared applyCrop as those, and
  // it runs after the composite — masks are authored in full-image space.
  // `applyCrop` always allocates a fresh full-size buffer, so skip it outright
  // on the identity crop most photos have — at thumbnail volume that copy is
  // the difference between a snappy grid and a stuttering one. `masked` is
  // already an owned buffer (active_layer_rgba8 copies out of wasm memory, and
  // compositeMasks returns its own), so it is safe to hand back after free().
  if (isIdentityCrop(recipe.crop)) {
    return { width: frame.width, height: frame.height, rgba: asBytes(masked), decodedRaw };
  }
  const cropped = applyCrop({ rgba: masked, width: frame.width, height: frame.height }, recipe.crop);
  return { width: cropped.width, height: cropped.height, rgba: asBytes(cropped.rgba), decodedRaw };
}

/**
 * A live Develop session over one decoded photo. Holds the engine so `render`
 * can re-apply the develop cheaply (undo the previous op, apply the new params)
 * instead of re-decoding — mirrors Vision's Camera-Raw workspace.
 * `free()` when done (the engine pins wasm memory).
 */
export interface DevelopSession {
  readonly width: number;
  readonly height: number;
  render(recipe: DevelopRecipeV2): DecodedImage;
  free(): void;
  decodedRaw?: NativeRawProvenance;
}

/**
 * Decode `bytes` into a reusable engine for iterative Develop recipes.
 * `maxEdge` bounds the working proxy — the default keeps interactive previews
 * fast on large RAWs; pass `0` (e.g. from export) for full resolution (RAW is
 * still capped at the native decoder's max edge).
 */
export async function openDevelopSession(
  bytes: Uint8Array,
  raw = false,
  sourcePath?: string,
  initialRecipe?: DevelopRecipeV2,
  maxEdge = RAW_PROXY_MAX_EDGE,
): Promise<DevelopSession> {
  const { engine, proxyScale, decodedRaw } = await createEngine(
    bytes,
    raw,
    sourcePath,
    maxEdge,
    initialRecipe,
    true, // sessions re-open the same photos — cache the decode
  );
  const state = { applied: false };
  let freed = false;
  return {
    decodedRaw,
    width: engine.width(),
    height: engine.height(),
    render: (recipe: DevelopRecipeV2): DecodedImage => developPass(engine, state, recipe, proxyScale),
    free(): void {
      if (!freed) {
        engine.free();
        freed = true;
      }
    },
  };
}

// ── Off-main-thread Develop (PERF-03) ───────────────────────────────────────
// The interactive Develop loop renders through a Web Worker hosting its own
// engine instance (developWorker.ts), so a slider drag never blocks the UI
// thread on the scalar CPU develop pass. Export keeps the sync session above.
// ponytail: this is the off-thread CPU renderer, not a GPU one — LR's "Use
// Graphics Processor" needs a wgpu path in packages/engine (Cargo change).

/**
 * The exact recipes `compositeMasks` will ask its render callback for, in call
 * order: one fold per contributing parametric mask, then one per contributing
 * AI mask whose subject coverage is cached this session. Lets the async loop
 * pre-render every mask pass in ONE worker batch and replay them into the
 * unchanged sync compositeMasks (which keeps publishing the overlay frame on
 * the main thread). Guarded against drift by engine.worker.test.ts.
 */
export function maskRenderJobs(recipe: DevelopRecipeV2): DevelopRecipeV2[] {
  // "Would compositeMasks blend this mask?" via its own exported predicate.
  const contributes = (m: Mask) => hasActiveMasks({ ...recipe, masks: { masks: [m] } });
  const jobs: DevelopRecipeV2[] = [];
  for (const m of renderableMasks(recipe.masks)) {
    if (contributes(m)) jobs.push(foldLocalAdjustments(recipe, m.adjustments));
  }
  for (const m of recipe.masks.masks) {
    const c0 = m.components[0];
    if (c0?.kind !== "aiSubject" || !contributes(m)) continue;
    if (!c0.cacheId || !getSubjectCoverage(c0.cacheId)) continue; // coverage never computed → skipped
    jobs.push(foldLocalAdjustments(recipe, m.adjustments));
  }
  return jobs;
}

/** Sync render callback for `compositeMasks` that replays frames pre-rendered
 *  from `maskRenderJobs`, in order. If the prediction ever drifts short, the
 *  base frame stands in — a mask visibly loses its effect instead of blending
 *  garbage. */
export function replayFrames(
  frames: readonly DecodedImage[],
  base: DecodedImage,
): (recipe: DevelopRecipeV2) => RenderedFrame {
  let i = 0;
  return () => frames[i++] ?? base;
}

/** A DevelopSession whose renders run off the main thread (or, in fallback,
 *  wrap the sync session behind the same promise API). */
export interface AsyncDevelopSession {
  readonly width: number;
  readonly height: number;
  /** Render several recipes in one worker round trip, in order. */
  renderBatch(recipes: DevelopRecipeV2[]): Promise<DecodedImage[]>;
  render(recipe: DevelopRecipeV2): Promise<DecodedImage>;
  free(): void;
  decodedRaw?: NativeRawProvenance;
}

/** The sync session behind the async API — no-Worker environments (unit
 *  tests) and the runtime fallback when the worker fails to come up. */
async function openSyncFallbackSession(
  bytes: Uint8Array,
  raw: boolean,
  sourcePath: string | undefined,
  initialRecipe: DevelopRecipeV2 | undefined,
  maxEdge: number,
): Promise<AsyncDevelopSession> {
  const s = await openDevelopSession(bytes, raw, sourcePath, initialRecipe, maxEdge);
  return {
    width: s.width,
    height: s.height,
    decodedRaw: s.decodedRaw,
    render: async (recipe) => s.render(recipe),
    renderBatch: async (recipes) => recipes.map((r) => s.render(r)),
    free: () => s.free(),
  };
}

async function openInWorker(
  bytes: Uint8Array,
  raw: boolean,
  sourcePath: string | undefined,
  initialRecipe: DevelopRecipeV2 | undefined,
  maxEdge: number,
): Promise<AsyncDevelopSession> {
  const worker = new Worker(new URL("./developWorker.ts", import.meta.url), { type: "module" });
  try {
    let decodedRaw: NativeRawProvenance | undefined;
    let open: DevelopWorkerRequest;
    const transfer: Transferable[] = [];
    if (raw && sourcePath && isTauri()) {
      // Native RAW: decode on the main thread (Tauri IPC — the pixels come from
      // the native process, this await doesn't block) and transfer the RGBA16.
      // Mirrors createEngine's native branch; keep the two in step.
      const nativeEdge = maxEdge >= 1 && maxEdge <= RAW_PROXY_MAX_EDGE ? maxEdge : RAW_PROXY_MAX_EDGE;
      const decoded = await decodeRawPathCached(sourcePath, nativeEdge, initialRecipe?.rawDecode);
      const { pixels, ...rest } = decoded;
      decodedRaw = rest;
      const proxyScale = decoded.scaleDenominator > 0
        ? decoded.scaleNumerator / decoded.scaleDenominator
        : 1;
      open = { t: "openPixels", width: decoded.width, height: decoded.height, pixels, proxyScale };
      transfer.push(pixels.buffer as ArrayBuffer);
    } else {
      // Clone (don't transfer) the bytes: the sync fallback still needs them
      // if this open fails, and byte sources are small next to RGBA16.
      open = { t: "openBytes", bytes, raw, maxEdge };
    }
    const ready = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const d = e.data as DevelopWorkerResponse;
        if (d.t === "ready") resolve(d);
        else reject(new Error(d.t === "error" ? d.message : "develop worker: unexpected reply"));
      };
      worker.onerror = (e) => reject(new Error(e.message || "develop worker failed to load"));
      worker.postMessage(open, transfer);
    });

    // Steady state: match replies to requests by seq. A worker crash or free()
    // rejects everything in flight so no render awaits forever.
    const pending = new Map<number, { resolve: (f: DecodedImage[]) => void; reject: (e: Error) => void }>();
    let seq = 0;
    let freed = false;
    const rejectAll = (err: Error) => {
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data as DevelopWorkerResponse;
      if (d.t === "ready" || d.seq == null) return;
      const p = pending.get(d.seq);
      if (!p) return;
      pending.delete(d.seq);
      if (d.t === "frames") p.resolve(d.frames);
      else p.reject(new Error(d.message));
    };
    worker.onerror = (e) => rejectAll(new Error(e.message || "develop worker crashed"));
    const renderBatch = (recipes: DevelopRecipeV2[]): Promise<DecodedImage[]> => {
      if (freed) return Promise.reject(new Error("develop session freed"));
      const s = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(s, { resolve, reject });
        worker.postMessage({ t: "render", seq: s, recipes } satisfies DevelopWorkerRequest);
      });
    };
    return {
      width: ready.width,
      height: ready.height,
      decodedRaw,
      renderBatch,
      render: async (recipe: DevelopRecipeV2): Promise<DecodedImage> => (await renderBatch([recipe]))[0],
      free(): void {
        if (freed) return;
        freed = true;
        rejectAll(new Error("develop session freed"));
        worker.terminate(); // engine memory dies with the worker
      },
    };
  } catch (e) {
    worker.terminate();
    throw e;
  }
}

/**
 * Open a Develop session whose renders run in a dedicated worker — same decode
 * semantics as openDevelopSession, async render API. Falls back to the sync
 * session (main-thread renders, as before PERF-03) when Workers are missing or
 * the worker fails to open, so develop never breaks outright.
 * ponytail: one worker per session, wasm re-inits per photo open — a pooled
 * persistent worker would shave open latency if photo switching shows it.
 */
export async function openDevelopWorkerSession(
  bytes: Uint8Array,
  raw = false,
  sourcePath?: string,
  initialRecipe?: DevelopRecipeV2,
  maxEdge = RAW_PROXY_MAX_EDGE,
): Promise<AsyncDevelopSession> {
  if (typeof Worker === "undefined") {
    return openSyncFallbackSession(bytes, raw, sourcePath, initialRecipe, maxEdge);
  }
  try {
    return await openInWorker(bytes, raw, sourcePath, initialRecipe, maxEdge);
  } catch (e) {
    console.warn("galerie develop: worker unavailable — rendering on the main thread", e);
    return openSyncFallbackSession(bytes, raw, sourcePath, initialRecipe, maxEdge);
  }
}

// ── Draft → refine tiers (PERF-11) ──────────────────────────────────────────
// Lightroom develops the preview at the image area's display resolution while
// a slider moves and refines to the full preview once the drag stops. Same
// here: a second, canvas-sized session takes the drag frames and the full
// proxy takes the idle refine, so interactivity costs a small develop instead
// of a 4096px one. Both tiers are ordinary worker sessions — the tiering is
// only which one a `renderBatch` goes to.

/** A draft must be at least this much smaller on the long edge to earn its own
 *  decode + engine (1.5× edge ≈ 2.25× fewer pixels per develop pass). */
const DRAFT_MIN_GAIN = 1.5;

/**
 * Long edge for the draft tier, given the develop stage's size in device
 * pixels and the full session's actual long edge. `0` = render everything at
 * full: an unmeasured or tiny stage, or a draft too close to `fullEdge` to be
 * worth a second decode (already-small photos never get a draft tier).
 */
export function draftMaxEdge(viewEdge: number, fullEdge: number): number {
  if (!Number.isFinite(viewEdge) || !Number.isFinite(fullEdge)) return 0;
  const edge = Math.round(viewEdge);
  if (edge < 64) return 0;
  return edge * DRAFT_MIN_GAIN <= fullEdge ? edge : 0;
}

/** A two-tier Develop session: `renderBatch(recipes, "draft")` renders on the
 *  canvas-sized tier when it is up, everything else on the full proxy. */
export interface ProgressiveDevelopSession extends AsyncDevelopSession {
  renderBatch(recipes: DevelopRecipeV2[], quality?: "draft" | "full"): Promise<DecodedImage[]>;
  /** Resolves once the draft tier is open — or has been ruled out / failed, in
   *  which case draft renders keep landing on the full proxy. Renders are
   *  correct either way; this exists so tests can await the tier. */
  readonly draftReady: Promise<void>;
}

/**
 * Open a Develop session with LR's interactive draft tier. `viewEdge` is the
 * develop stage's long edge in DEVICE pixels; pass 0 to disable drafting.
 * The full tier opens first (its real long edge decides whether a draft pays)
 * and the draft opens behind it, so the photo shows as soon as it always did.
 * ponytail: the draft is a second decode of the same source — cheap next to
 * the develop passes it saves, but a worker able to hold two engines (one
 * `proxy_engine` of the other) would halve the open cost; that needs the
 * develop-worker protocol to carry a tier.
 */
export async function openProgressiveDevelopSession(
  bytes: Uint8Array,
  raw = false,
  sourcePath?: string,
  initialRecipe?: DevelopRecipeV2,
  viewEdge = 0,
): Promise<ProgressiveDevelopSession> {
  const full = await openDevelopWorkerSession(bytes, raw, sourcePath, initialRecipe);
  const edge = draftMaxEdge(viewEdge, Math.max(full.width, full.height));
  let draft: AsyncDevelopSession | null = null;
  let freed = false;
  const draftReady =
    edge === 0
      ? Promise.resolve()
      : openDevelopWorkerSession(bytes, raw, sourcePath, initialRecipe, edge).then(
          (s) => {
            // Freed while the draft was decoding: it owns a worker, so drop it.
            if (freed) s.free();
            else draft = s;
          },
          (e) => {
            console.warn("galerie develop: draft tier unavailable — rendering full-size", e);
          },
        );
  return {
    width: full.width,
    height: full.height,
    decodedRaw: full.decodedRaw,
    draftReady,
    // Single renders feed pixel analysis (Select Subject, dust detect, heal
    // source), never the canvas — those always want true proxy pixels.
    render: (recipe) => full.render(recipe),
    renderBatch: (recipes, quality) =>
      (quality === "draft" && draft ? draft : full).renderBatch(recipes),
    free(): void {
      if (freed) return;
      freed = true;
      full.free();
      draft?.free();
      draft = null;
    },
  };
}

/** Wide-gamut export color spaces the JPEG/PNG route can produce, as engine
 *  built-in profile ids. sRGB is absent on purpose: it is the working space, so
 *  it encodes app-side (canvas) and stays untagged — the engine's own export
 *  policy ("every reader already assumes it"). ProPhoto has no engine built-in
 *  (the ids stop at BT.2020), so it rides the custom-ICC lane instead. */
const EXPORT_PROFILE_IDS = { displayP3: 1, adobeRGB: 2 } as const;
export type WideExportProfile = keyof typeof EXPORT_PROFILE_IDS | "prophoto";

/** LR's Export → Color Space list. The union every export surface shares. */
export type ExportColorSpace = "srgb" | WideExportProfile;

/** ProPhoto RGB (ROMM) as ICC bytes — moxcms's own
 *  `new_pro_photo_rgb().encode()` output (524 bytes) captured verbatim, so the
 *  engine's ICC parser accepts it by construction. Decoded once, lazily. */
const PROPHOTO_ICC_B64 =
  "AAACDAAAAAAEQAAAbW50clJHQiBYWVogB+oABwAbAAgAIgAFYWNzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbDAAEAAAAA0yMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKclhZWgAAAPwAAAAUZ1hZWgAAARAAAAAUYlhZWgAAASQAAAAUY2hhZAAAATgAAAAsclRSQwAAAWQAAAAOZ1RSQwAAAXIAAAAOYlRSQwAAAYAAAAAOd3RwdAAAAY4AAAAUZGVzYwAAAaIAAAA0Y3BydAAAAdYAAAA2WFlaIAAAAAAAAMwqAABJuwAAAABYWVogAAAAAAAAIqMAALY+/////lhZWiAAAAAAAAAICQAAAAcAANNBc2YzMgAAAAAAAOUlAABEM///1q7//z/zAAG2qAAACWUAAAn1///udwABB5RjdXJ2AAAAAAAAAAEBzWN1cnYAAAAAAAAAAQHNY3VydgAAAAAAAAABAc1YWVogAAAAAAAA9sMAAQAAAADTI21sdWMAAAAAAAAAAQAAAAxlblVTAAAAGAAAABwAUAByAG8AUABoAG8AdABvACAAUgBHAEJtbHVjAAAAAAAAAAEAAAAMZW5VUwAAABoAAAAcAFAAdQBiAGwAaQBjACAARABvAG0AYQBpAG4=";
let prophotoIccCache: Uint8Array | null = null;
export function prophotoIcc(): Uint8Array {
  return (prophotoIccCache ??= Uint8Array.from(atob(PROPHOTO_ICC_B64), (c) => c.charCodeAt(0)));
}

/**
 * Bake the Develop soft-proof LUT (GAL-DEV-15): working sRGB → `proofIcc` →
 * sRGB as an n³ RGBA8 lattice with the gamut flag in alpha (see the engine's
 * `proof_lut`). Galerie's develop output is sRGB, so a 1×1 throwaway engine
 * (fromRgba16 documents land assigned sRGB) supplies the document side. BPC is
 * always on — the Photoshop/LR proof-setup default; Simulate Paper & Ink is a
 * display-side remap (applySoftProof), not a bake flag. Empty result =
 * unusable profile / color management unavailable.
 */
export async function bakeProofLut(proofIcc: Uint8Array, intent: number): Promise<Uint8Array> {
  await loadEngine();
  const engine = Engine.fromRgba16(1, 1, new Uint16Array(4), false);
  try {
    return engine.proof_lut(NO_ICC, proofIcc, intent, DISPLAY_LUT_SIZE, true);
  } finally {
    engine.free();
  }
}

/**
 * Encode final export RGBA8 (sRGB working space) as a JPEG/PNG converted to
 * `profile` with that profile's ICC embedded (APP2 / iCCP). Rides the engine
 * end to end: moxcms converts the pixels — the same color-management path
 * `normalizeToWorkingProfile` uses inbound — and the tagged encoders write the
 * ICC chunk, so no app-side codec or color math. `quality` is 0–1 (JPEG only).
 */
export async function encodeRgbaInProfile(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  profile: WideExportProfile,
  format: "jpeg" | "png",
  quality: number,
): Promise<Uint8Array> {
  await loadEngine();
  // Widen 8→16 (v × 257 maps 0xff → 0xffff): the engine's ICC transform runs
  // over 16-bit documents, and the extra depth keeps the conversion loss-free.
  const wide = new Uint16Array(rgba.length);
  for (let i = 0; i < rgba.length; i++) wide[i] = rgba[i] * 257;
  const engine = Engine.fromRgba16(width, height, wide, false);
  try {
    // fromRgba16 documents land assigned sRGB (0) — exactly what the develop
    // pipeline hands us — so convert straight to the destination profile.
    // Built-ins convert by id and self-tag from the document profile; ProPhoto
    // converts through its ICC bytes, which the tagged encoder then embeds.
    const icc = profile === "prophoto" ? prophotoIcc() : NO_ICC;
    const dstId = profile === "prophoto" ? 0 : EXPORT_PROFILE_IDS[profile];
    engine.convert_profile_with_icc(0, NO_ICC, dstId, icc, RELATIVE_COLORIMETRIC, false, false, "");
    // scale 1 = unscaled (the engine has no unscaled JPEG export); the encoder
    // clamps quality to 1–100 itself. Empty `icc` = tag the built-in profile.
    return format === "png"
      ? engine.export_png_with_icc(icc)
      : engine.export_scaled_jpeg_with_icc(1, Math.round(quality * 100), icc);
  } finally {
    engine.free();
  }
}
