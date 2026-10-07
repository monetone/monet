// ─────────────────────────────────────────────────────────────
// Shared dialog scaffolding — the dialog context, the live-preview wrapper,
// the scratch adjustment-layer hook, and the small primitives every dialog
// reuses. Extracted from the Dialogs monolith (review Arch AM5). One-directional:
// the dialog components import from here; nothing here imports them.
// ─────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Dialog, Button, Slider, BLEND_MODES } from "@monet-ui/monet-react";
import { engine, store, actions, useStore, type HistoryTransactionEngine } from "../../state/app";
import { LAYER_KIND } from "../../state/engineContracts";

export const ACCENT = "var(--accent-raster)";

// Group blend dropdown: Photoshop's group-only "Pass Through" (their default) at
// the top, then the standard blend modes. Shared by the Layers panel + the New
// Group dialog so the option list lives in one place.
export const GROUP_BLEND_OPTIONS = [{ value: "pass-through", label: "Pass Through" }, ...BLEND_MODES];

// kebab id → "Title Case" label (blend-mode ids, etc.).
export const titleCase = (k: string) => k.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// Shared number-input style (width/flex added per use). Was copy-pasted into a
// dozen-plus dialogs (review Quality M1).
export const INP_BASE = { height: 26, fontSize: 12, padding: "0 6px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" };

export type DialogName =
  | "customizeToolbar"
  | "new" | "imageSize" | "canvasSize"
  | "brightnessContrast" | "levels" | "curves" | "hueSaturation" | "blackWhite" | "exposure"
  | "colorBalance" | "posterize" | "threshold" | "vibrance" | "photoFilter" | "channelMixer" | "gradientMap"
  | "shadowsHighlights" | "selectiveColor" | "hdrToning" | "rotateCanvas" | "matchColor" | "renameLayer" | "newLayer" | "duplicateLayer" | "newGroup" | "lockLayers" | "contourEditor"
  | "gaussianBlur" | "boxBlur" | "unsharp" | "addNoise" | "median" | "motionBlur" | "pathBlur" | "emboss"
  | "highPass" | "mosaic" | "vignette" | "oil" | "pinch" | "spherize" | "twirl" | "polar" | "ripple" | "zigzag" | "shear" | "wave" | "diffuseGlow" | "radialBlur" | "lensFlare" | "script" | "neuralAI"
  | "alBrightness" | "alLevels" | "alHueSat" | "alVibrance" | "alExposure" | "alBlackWhite"
  | "alPosterize" | "alThreshold" | "alColorBalance" | "alPhotoFilter" | "alGradientMap" | "alChannelMixer" | "alSelectiveColor" | "alColorLookup" | "alCurves"
    | "colorLookup" | "solidFill" | "gradientFill" | "patternFill" | "cameraRaw" | "filterGallery" | "fileInfo" | "colorSettings" | "assignProfile" | "convertToProfile" | "contentAwareScale" | "globalLight" | "scaleEffects" | "preferences" | "keyboardShortcuts" | "about" | "fitImage" | "newGuideLayout" | "newGuide"
  | "type" | "layerStyle" | "docBrowser" | "expandContract" | "feather" | "selectandmask" | "border" | "smooth" | "stroke" | "fill" | "trim" | "offset" | "maximum" | "minimum" | "custom" | "duplicateImage" | "dustScratches" | "surfaceBlur" | "smartBlur" | "lensBlur" | "smartSharpen" | "shakeReduction" | "reduceNoise" | "deblock" | "hsbHsl" | "mezzotint" | "deinterlace" | "shapeBlur" | "extrudeFilter" | "fieldBlur" | "irisBlur" | "tiltShift" | "spinBlur" | "pictureFrame" | "bitmapMode" | "duotone" | "indexedColor" | "lensCorrection" | "displace" | "tree" | "flame" | "freeTransform" | "skew" | "transformPath" | "perspective" | "perspectiveCrop" | "warp" | "diffuse" | "transformSelection" | "glowingEdges" | "fade" | "replaceColor" | "traceContour" | "colorRange" | "wind" | "posterEdges" | "cutout" | "coloredPencil" | "smudgeStick" | "sponge" | "paletteKnife" | "paintDaubs" | "fresco" | "roughPastels" | "underpainting" | "dryBrush" | "watercolor" | "filmGrain" | "neonGlow" | "plasticWrap" | "crosshatch" | "spatter" | "angledStrokes" | "darkStrokes" | "sprayedStrokes" | "sumiE" | "accentedEdges" | "inkOutlines" | "texturizer" | "graphicPen" | "charcoal" | "halftonePattern" | "basRelief" | "chrome" | "oceanRipple" | "glass" | "fibers" | "lightingEffects" | "photocopy" | "stamp" | "notePaper" | "tornEdges" | "waterPaper" | "chalkCharcoal" | "conteCrayon" | "reticulation" | "plaster" | "tiles" | "colorHalftone" | "crystallize" | "stainedGlass" | "mosaicTiles" | "patchwork" | "craquelure" | "grain" | "pointillize" | "saveSelection" | "loadSelection" | "defringe" | "applyImage" | "calculations" | "spellCheck" | "findReplace" | "statistics" | "presetManager"
 | "customPixelAspect" | "deletePixelAspect" | "resetPixelAspects" | "proofSetupCustom" | "print" | "showExtrasOptions" | "trap" | "newArtboard" | "conditionalMode" | "imageProcessor" | "variablesDefine" | "dataSets"
 | "measurementScale" | "placeScaleMarker" | "focusArea" | "contentAwareFill" | "glyphs" | "selectDataPoints" | "colorTable" | "commandSearch" | "typeStyles" | "exportPrefs" | "saveForWeb" | "layerCleanup" | "removeDistractions" | "removeReflections" | "skyReplacement" | "matchFont" | "smartStackMode" | "pdfPage" | "tiffOptions" | "jpeg2000Options" | "photoshopRawSave" | "photoshopRawOpen" | "modelManager" | "aiDenoise" | "renderVideo" | "batch" | "hdrPreview" | "createDroplet" | "dropletRun" | "scriptEvents" | "onPathOptions";

interface DialogCtx { open: (name: DialogName, arg?: unknown) => void; close: () => void; current: DialogName | null; arg: unknown; }
export const Ctx = createContext<DialogCtx>({ open: () => {}, close: () => {}, current: null, arg: null });
export const useDialogs = () => useContext(Ctx);

export interface LayerContentArg {
  layerId: number;
  layerKind: typeof LAYER_KIND.adjustment | typeof LAYER_KIND.fill;
  subtype: number;
  params: number[];
}

export function layerContentArg(value: unknown, kind: LayerContentArg["layerKind"], subtype: number): LayerContentArg | null {
  if (!value || typeof value !== "object") return null;
  const arg = value as Partial<LayerContentArg>;
  return arg.layerKind === kind && arg.subtype === subtype && typeof arg.layerId === "number" && Array.isArray(arg.params)
    ? arg as LayerContentArg
    : null;
}

// ── shared rows ────────────────────────────────────────────────
export function Row({ label, value, min, max, decimals = 0, step = 10 ** -decimals, onChange, onChangeEnd, suffix = "", format, labelWidth = 96, disabled }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
  step?: number;
  onChangeEnd?: (v: number) => void;
  suffix?: string; decimals?: number; format?: (v: number) => string;
  /** Narrower than a dialog's 96px when the row lives in a dock panel. */
  labelWidth?: number;
  /** The control has nothing to act on right now. */
  disabled?: boolean;
}) {
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8, opacity: disabled ? 0.5 : undefined }}>
      <span className="lbl" style={{ width: labelWidth }}>{label}</span>
      <Slider aria-label={label} value={value} min={min} max={max} step={step} accent={ACCENT} onChange={onChange} onChangeEnd={onChangeEnd} disabled={disabled} style={{ flex: 1 }} />
      <span className="val" style={{ width: 52, textAlign: "right", fontFamily: "var(--font-mono)" }}>
        {format ? format(value) : `${value.toFixed(decimals)}${suffix}`}
      </span>
    </div>
  );
}

function mutatePinnedEngine(
  docId: number,
  target: HistoryTransactionEngine,
  mutate: (engine: HistoryTransactionEngine) => boolean,
  refreshActive = true,
) {
  if (store.state.activeDocId === docId && engine.engine === target) {
    const changed = mutate(target);
    if (changed && refreshActive) engine.refreshFromEngine();
    return changed;
  }
  return store.mutateDocEngine(docId, (candidate) =>
    candidate === target && mutate(candidate as HistoryTransactionEngine));
}

// Create-on-mount / cancel-on-dismiss scratch layer for the non-destructive
// adjustment-layer dialogs. The engine transaction keeps previews outside the
// user's redo branch and defers History States cap eviction until OK.
function useScratchEditableLayer(create: () => number, existingId?: number) {
  const idRef = useRef<number | null>(existingId ?? null);
  const editedRef = useRef(false);
  const doneRef = useRef(false);
  const transactionRef = useRef(false);
  const actionMark = useRef(actions.mark()).current;
  const actionDoneRef = useRef(false);
  const invalidRef = useRef(false);
  const targetDocId = useRef(store.state.activeDocId).current;
  const targetLayerRef = useRef(existingId ?? store.state.activeLayerId);
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const keptHistoryRef = useRef(false);
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const dropExtraHistory = (before: number) => {
    let pushed = Math.max(0, Math.round(targetEngine.undo_pushes() - before));
    if (!keptHistoryRef.current && pushed > 0) { keptHistoryRef.current = true; pushed--; }
    while (pushed-- > 0) targetEngine.drop_last_undo();
  };
  const onTarget = () => !invalidRef.current
    && store.state.activeDocId === targetDocId
    && store.state.activeLayerId === targetLayerRef.current
    && engine.engine === targetEngine;
  const rollback = () => {
    if (transactionRef.current) {
      mutatePinnedEngine(targetDocId, targetEngine, (e) => e.cancel_history_transaction());
      transactionRef.current = false;
    }
    if (!actionDoneRef.current) {
      actions.rollback(actionMark);
      actionDoneRef.current = true;
    }
  };
  useEffect(() => {
    if (!onTarget() || !targetEngine.begin_history_transaction()) {
      invalidRef.current = true;
      return;
    }
    transactionRef.current = true;
    if (existingId == null) {
      try {
        const before = targetEngine.undo_pushes();
        const id = create();
        dropExtraHistory(before);
        idRef.current = id || null;
        if (id) targetLayerRef.current = id;
        else { invalidRef.current = true; rollback(); }
      } catch (error) {
        invalidRef.current = true;
        rollback();
        throw error;
      }
    }
    // A dialog can be force-unmounted with neither OK nor Cancel: opening any
    // other dialog (a ⌘L-style menu shortcut fires straight through a dialog
    // that isn't focused on an input) replaces the mounted one. Without this
    // the scratch layer and its param edits survive as an unlabeled commit
    // nobody asked for. (#96)
    return () => { if (!doneRef.current) rollback(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // The create effect above can synchronously select a new scratch layer;
    // inspect the live store so this same effect pass does not mistake that
    // intended selection for an external target switch.
    if (store.state.activeDocId !== targetDocId || store.state.activeLayerId !== targetLayerRef.current
      || engine.engine !== targetEngine) {
      invalidRef.current = true;
      rollback();
    }
    // The captured target and mutable refs intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, activeLayerId]);
  const mutate = (edit: (id: number) => boolean | void) => {
    if (transactionRef.current && onTarget() && idRef.current != null) {
      const before = targetEngine.undo_pushes();
      const changed = edit(idRef.current);
      dropExtraHistory(before);
      if (changed !== false) editedRef.current = true;
    }
  };
  const cancel = (close: () => void) => {
    doneRef.current = true;
    rollback();
    close();
  };
  const finish = (close: () => void) => {
    if (!transactionRef.current || !onTarget()) {
      invalidRef.current = true;
      rollback();
      close();
      return;
    }
    doneRef.current = true;
    if (editedRef.current) targetEngine.end_prop_edit();
    const committed = targetEngine.commit_history_transaction();
    transactionRef.current = false;
    if (committed) {
      actionDoneRef.current = true;
      engine.commit();
    } else {
      actions.rollback(actionMark);
      actionDoneRef.current = true;
      engine.refreshFromEngine();
    }
    close();
  };
  return { mutate, cancel, finish };
}

export function useScratchAdjustmentLayer(create: () => number, existingId?: number) {
  const scratch = useScratchEditableLayer(create, existingId);
  return {
    applyParams: (params: Float32Array) => scratch.mutate((id) => {
      store.setAdjustmentParams(id, params);
      return true;
    }),
    cancel: scratch.cancel,
    finish: scratch.finish,
  };
}

export function useScratchFillLayer(create: () => number, existingId?: number) {
  const scratch = useScratchEditableLayer(create, existingId);
  const applyParams = (params: Float32Array) => scratch.mutate((id) => {
    const current = store.adjParams(id);
    if (current.length === params.length && current.every((value, i) => value === params[i])) return false;
    store.setFillParams(id, params);
    return true;
  });
  return {
    applyParams,
    applyPatternScale: (scale: number) => scratch.mutate((id) => {
      const params = store.adjParams(id);
      if (params.length < 3 || params[2] === scale) return false;
      params[2] = scale;
      store.setFillParams(id, params);
      return true;
    }),
    replacePattern: () => scratch.mutate((id) => {
      store.replacePatternFill(id);
      return true;
    }),
    cancel: scratch.cancel,
    finish: scratch.finish,
  };
}

// ── live-preview wrapper ───────────────────────────────────────
export function PreviewDialog({ title, apply, deps, children, width = 380, onOk }: {
  title: string; apply: () => void; deps: unknown[]; children: ReactNode; width?: number;
  /** After OK commits the edit — where a dialog remembers its values. */
  onOk?: () => void;
}) {
  const { close } = useDialogs();
  const targetDocId = useRef(store.state.activeDocId).current;
  const targetLayerId = useRef(store.state.activeLayerId).current;
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const transactionRef = useRef(false);
  const actionMark = useRef(actions.mark()).current;
  const actionDoneRef = useRef(false);
  const invalidRef = useRef(false);
  const wrongTarget = invalidRef.current || activeDocId !== targetDocId
    || activeLayerId !== targetLayerId || engine.engine !== targetEngine;
  const onTarget = () => !invalidRef.current
    && store.state.activeDocId === targetDocId
    && store.state.activeLayerId === targetLayerId
    && engine.engine === targetEngine;
  // Track the latest apply closure so OK can record exactly the final values.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const rafRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | 0>(0);

  // Apply the latest values once: reset the previous preview, re-apply (suspended
  // from macro recording — one drag would otherwise record N cumulative steps),
  // with the engine resync suspended so the costly all-thumbnail sync is deferred.
  // The op's own commit still blits, so the canvas stays live.
  // The transaction parks redo and defers cap eviction, so reset/cancel never
  // consume a real user state even when history is already at its cap.
  const applyFrame = () => {
    if (!onTarget()) return false;
    if (transactionRef.current) {
      if (!mutatePinnedEngine(targetDocId, targetEngine, (e) => e.reset_history_transaction(), false)) {
        invalidRef.current = true;
        transactionRef.current = false;
        rollbackAction();
        return false;
      }
    } else {
      transactionRef.current = targetEngine.begin_history_transaction();
      if (!transactionRef.current) return false;
    }
    engine.syncSuspended = true;
    actions.suspend(true);
    try { applyRef.current(); }
    catch (error) {
      mutatePinnedEngine(targetDocId, targetEngine, (e) => e.cancel_history_transaction());
      transactionRef.current = false;
      rollbackAction();
      throw error;
    } finally { actions.suspend(false); engine.syncSuspended = false; }
    return true;
  };
  const clearPending = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (settleRef.current) { clearTimeout(settleRef.current); settleRef.current = 0; }
  };

  const cancelPreview = () => {
    if (!transactionRef.current) return;
    mutatePinnedEngine(targetDocId, targetEngine, (e) => e.cancel_history_transaction());
    transactionRef.current = false;
  };
  const rollbackAction = () => {
    if (actionDoneRef.current) return;
    actions.rollback(actionMark);
    actionDoneRef.current = true;
  };

  useEffect(() => {
    if (activeDocId !== targetDocId || activeLayerId !== targetLayerId
      || engine.engine !== targetEngine) {
      invalidRef.current = true;
      clearPending();
      engine.syncSuspended = false;
      cancelPreview();
      rollbackAction();
    }
    // The captured target and mutable refs intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, activeLayerId]);

  useEffect(() => {
    // Coalesce preview re-applies to one whole-document op + blit per animation
    // frame and defer the full UI sync until the drag settles. Without this,
    // every slider pointermove ran undo + a full-document op + a 96 MB blit + a
    // per-layer toDataURL sync, which is unusable on large docs (review Perf C1).
    if (wrongTarget) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; applyFrame(); });
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => { settleRef.current = 0; engine.sync(); }, 140);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, activeDocId, activeLayerId]);

  // A queued frame must not fire after the dialog unmounts — and an unmount that
  // ran neither OK nor Cancel has to roll the preview back the way cancel() does.
  // Opening any other dialog replaces the mounted one (a ⌘L-style menu shortcut
  // fires straight through a dialog that isn't focused on an input), which would
  // otherwise leave the un-OK'd preview applied as an unlabeled commit that was
  // never recorded as an action. The transaction flag is cleared before
  // close(), so the unmount cleanup can never double-cancel. (#96)
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (settleRef.current) clearTimeout(settleRef.current);
    engine.syncSuspended = false;
    cancelPreview();
    rollbackAction();
    // The captured target and mutable refs intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    clearPending();
    engine.syncSuspended = false;
    cancelPreview();
    rollbackAction();
    close();
  };
  const ok = () => {
    if (!onTarget()) {
      invalidRef.current = true;
      cancelPreview();
      rollbackAction();
      close();
      return;
    }
    // Apply the latest values if a frame is still queued, then run one full sync
    // and record exactly the final thunk as a single history + macro step.
    const pending = rafRef.current !== 0;
    clearPending();
    if (pending) applyFrame();
    if (!transactionRef.current) { rollbackAction(); close(); return; }
    const committed = targetEngine.commit_history_transaction();
    transactionRef.current = false;
    if (committed) {
      engine.commit();
      actions.commit(actionMark, applyRef.current);
      onOk?.();
    } else {
      engine.refreshFromEngine();
      rollbackAction();
    }
    actionDoneRef.current = true;
    close();
  };
  return (
    <Dialog open onClose={cancel} title={title} width={width}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" disabled={wrongTarget} onClick={ok}>OK</Button></>}>
      {children}
    </Dialog>
  );
}
