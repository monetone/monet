// SecondaryDisplay — Lightroom's second monitor: its own view switcher (Grid /
// Loupe / Compare / Survey / Slideshow), its own zoom steps, its own filmstrip
// and a Locked loupe that pins a reference frame while the main window keeps
// browsing. Only the SELECTION is shared (one-way, revision-stamped); every
// view decision below is local to this webview, which is how LR behaves too.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { getPhoto } from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { centerPan, clampPan, detailScale, fitScale, type Pan, zoomToPoint } from "../lib/loupeZoom";
import { loadPreview, previewTargetEdge } from "../lib/thumbnailLoader";
import { basename, GridCell } from "./GridCell";
import { PreviewImg } from "./PreviewImg";
import { useRecipeRevision } from "./useRecipeRevision";
import { useThumbnail } from "./useThumbnail";

/** Main window → this display, sent by Window ▸ Secondary Display ▸ <view>. */
export const SECONDARY_VIEW_EVENT = "galerie://secondary-view";
/** This display → main window, so a cold open still gets its requested view. */
export const SECONDARY_READY_EVENT = "galerie://secondary-ready";

export type SecondaryMode = "grid" | "loupe" | "compare" | "survey" | "slideshow";
export type SecondaryZoom = "fit" | "fill" | "1:1" | "2:1" | "4:1";

/** The switcher, in LR's order; `key` is the plain-key shortcut in this window. */
export const SECONDARY_MODES: { id: SecondaryMode; label: string; key: string }[] = [
  { id: "grid", label: "Grid", key: "g" },
  { id: "loupe", label: "Loupe", key: "e" },
  { id: "compare", label: "Compare", key: "c" },
  { id: "survey", label: "Survey", key: "n" },
  { id: "slideshow", label: "Slideshow", key: "s" },
];

// ponytail: LR goes to 11:1; these five cover the culling workflow. Add steps
// here (and a hi-res decode swap like LoupeView's) if pixel-peeping needs them.
export const SECONDARY_ZOOMS: SecondaryZoom[] = ["fit", "fill", "1:1", "2:1", "4:1"];

const SECONDARY_EDGE = 4096; // the second display's preview decode
const COMPARE_EDGE = 2048;
const SURVEY_EDGE = 1280;
const GRID_EDGE = 240;
const FILM_EDGE = 128;
const FILM_HEIGHT = 96;
const SLIDE_MS = 4000;
// ponytail: the set views render the shared selection un-windowed; cap it so a
// Select-All can't mount thousands of cells. Window it (lib/grid's
// computeGridWindow, as LibraryGrid/Filmstrip do) if that cap starts biting.
const SET_CAP = 500;

/** The proof marker reported with every observation. The two-window proof
 *  (src/secondaryProof.ts) asserts the literal "secondary:fit", so the default
 *  Loupe/Fit view must keep producing exactly that. */
export function viewportMarker(mode: SecondaryMode, zoom: SecondaryZoom): string {
  return mode === "loupe" ? `secondary:${zoom}` : `secondary:${mode}`;
}

/** Scale for a zoom step. Ratios are multiples of the Loupe's 1:1 (the largest
 *  decode the pipeline delivers), so they mean the same thing in both windows. */
export function zoomScale(
  zoom: SecondaryZoom,
  natW: number,
  natH: number,
  viewW: number,
  viewH: number,
  targetEdge: number,
): number {
  if (natW <= 0 || natH <= 0 || viewW <= 0 || viewH <= 0) return 1;
  if (zoom === "fit") return fitScale(natW, natH, viewW, viewH);
  if (zoom === "fill") return Math.max(viewW / natW, viewH / natH);
  return detailScale(natW, natH, targetEdge) * Number(zoom.slice(0, zoom.indexOf(":")));
}

/** Only the bare Loupe can work off the active photo alone; every other view
 *  (and the filmstrip) needs the whole shared set resolved. */
export function sharedSetNeeded(mode: SecondaryMode, filmstrip: boolean): boolean {
  return filmstrip || mode !== "loupe";
}

/** Local browsing / slideshow playhead: step through the shared set, wrapping.
 *  A photo that is not in the set (or an empty set) starts at the ends. */
export function stepPinned(rows: PhotoRow[], currentId: number | null, delta: number): PhotoRow | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((p) => p.id === currentId);
  if (at < 0) return rows[delta >= 0 ? 0 : rows.length - 1];
  return rows[(((at + delta) % rows.length) + rows.length) % rows.length];
}

/** Compare panes: the first shared photo is the Select, the displayed photo the
 *  Candidate (falling back to the next one when they are the same). */
export function comparePair(
  rows: PhotoRow[],
  display: PhotoRow | null,
): [PhotoRow | null, PhotoRow | null] {
  const select = rows[0] ?? display ?? null;
  if (display && select && display.id !== select.id) return [select, display];
  return [select, rows.find((p) => p.id !== select?.id) ?? null];
}

interface SharedSelection {
  catalogId: string | null;
  activePhotoId: number | null;
  selection: number[];
  revision: number;
}

interface ProofConfig {
  catalogPath: string;
  fixtures: [string, string];
}

interface PreviewIdentity {
  url: string;
  photoId: number;
  revision: number;
}

type SyncFailure = "registration" | "initial" | "event";

export function startSecondaryDisplaySession(
  loadProof: () => Promise<ProofConfig | null>,
  recordProof: (config: ProofConfig | null) => void,
  startSync: () => () => void,
  fail: (error: unknown) => void,
): () => void {
  let stopped = false;
  let stopSync: (() => void) | null = null;
  const start = () => {
    if (stopped) return;
    try {
      stopSync = startSync();
    } catch (error) {
      fail(error);
    }
  };
  void loadProof().then(
    (config) => {
      if (stopped) return;
      try {
        recordProof(config);
      } catch (error) {
        fail(error);
      }
      start();
    },
    (error) => {
      if (stopped) return;
      fail(error);
      start();
    },
  );
  return () => {
    stopped = true;
    stopSync?.();
  };
}

export function startSharedSelectionSync(
  register: (handler: (shared: SharedSelection) => void) => Promise<() => void>,
  readSnapshot: () => Promise<SharedSelection>,
  apply: (shared: SharedSelection) => Promise<void>,
  fail: (stage: SyncFailure, error: unknown) => void,
): () => void {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void register((shared) => {
    if (!stopped) void apply(shared).catch((error) => {
      if (!stopped) fail("event", error);
    });
  }).then(async (dispose) => {
    if (stopped) {
      dispose();
      return;
    }
    unlisten = dispose;
    try {
      const snapshot = await readSnapshot();
      if (!stopped) await apply(snapshot);
    } catch (error) {
      if (!stopped) fail("initial", error);
    }
  }).catch((error) => {
    if (!stopped) fail("registration", error);
  });
  return () => {
    stopped = true;
    unlisten?.();
  };
}

export function acceptSharedRevision(
  shared: SharedSelection,
  latestRevision: { current: number },
): boolean {
  if (shared.revision <= latestRevision.current) return false;
  latestRevision.current = shared.revision;
  return true;
}

export async function resolveSelectionPhoto(
  shared: SharedSelection,
  lookup: (id: number) => Promise<PhotoRow | null>,
  isCurrent: () => boolean,
  apply: (photo: PhotoRow | null) => void,
): Promise<void> {
  try {
    const photo = shared.activePhotoId == null ? null : await lookup(shared.activePhotoId);
    if (isCurrent()) apply(photo);
  } catch (error) {
    if (isCurrent()) throw error;
  }
}

export async function resolvePreview(
  photo: PhotoRow,
  revision: number,
  load: () => Promise<string | null>,
  isCurrent: () => boolean,
  apply: (preview: PreviewIdentity) => void,
  fail: (message: string) => void,
  revoke = URL.revokeObjectURL,
): Promise<void> {
  try {
    const url = await load();
    if (!url) {
      if (isCurrent()) fail(`Preview rendering failed for photo ${photo.id}`);
      return;
    }
    if (!isCurrent()) {
      revoke(url);
      return;
    }
    apply({ url, photoId: photo.id, revision });
  } catch (error) {
    if (isCurrent()) fail(`Preview rendering failed: ${String(error)}`);
  }
}

export function acceptPreview(
  preview: PreviewIdentity,
  apply: (preview: PreviewIdentity) => void,
  revoke = URL.revokeObjectURL,
): () => void {
  let owned = true;
  apply(preview);
  return () => {
    if (owned) revoke(preview.url);
    owned = false;
  };
}

export function renderedObservation(
  preview: PreviewIdentity,
  shared: SharedSelection | null,
  photo: PhotoRow | null,
  latestRevision: number,
  previewWidth: number,
  previewHeight: number,
  marker = "secondary:fit",
) {
  if (
    !shared
    || !photo
    || preview.revision !== latestRevision
    || preview.revision !== shared.revision
    || preview.photoId !== shared.activePhotoId
    || preview.photoId !== photo.id
  ) return null;
  return {
    stage: "rendered",
    catalogId: shared.catalogId,
    activePhotoId: preview.photoId,
    selection: shared.selection,
    revision: preview.revision,
    previewWidth,
    previewHeight,
    viewportMarker: marker,
  };
}

export async function observeRenderedProof(
  observe: () => Promise<unknown>,
  isCurrent: () => boolean,
  fail: (message: string) => void,
): Promise<void> {
  try {
    await observe();
  } catch (error) {
    if (isCurrent()) fail(`Proof observation failed: ${String(error)}`);
  }
}

export function SecondaryDisplay() {
  const [photo, setPhoto] = useState<PhotoRow | null>(null);
  const [preview, setPreview] = useState<PreviewIdentity | null>(null);
  const [shared, setShared] = useState<SharedSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  // Second-window view state — local to this display, exactly like Lightroom's
  // second monitor (its switcher, zoom and filmstrip are independent of the main
  // window; only the selection is shared).
  const [mode, setMode] = useState<SecondaryMode>("loupe");
  const [zoom, setZoom] = useState<SecondaryZoom>("fit");
  const [filmstrip, setFilmstrip] = useState(false);
  // Loupe Locked: a pinned frame that incoming selections no longer move.
  // Also set by clicking a tile here (local browsing without touching the main
  // window — selection sync is one-way).
  const [pinned, setPinned] = useState<PhotoRow | null>(null);
  const [rows, setRows] = useState<PhotoRow[]>([]);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [pan, setPan] = useState<Pan | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const display = pinned ?? photo;
  const recipeRevision = useRecipeRevision(display?.id);
  const latestRevision = useRef(-1);
  const currentPhoto = useRef<PhotoRow | null>(null);
  const currentDisplay = useRef<PhotoRow | null>(null);
  const currentProof = useRef<ProofConfig | null>(null);
  const currentSession = useRef<object | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const draggedRef = useRef(false);
  // Read by the proof observations, which are emitted from mount-once closures.
  const markerRef = useRef("secondary:fit");
  markerRef.current = viewportMarker(mode, zoom);
  const displayRef = useRef<PhotoRow | null>(null);
  displayRef.current = display;
  const rowsRef = useRef<PhotoRow[]>(rows);
  rowsRef.current = rows;

  useEffect(() => {
    let cancelled = false;
    const session = {};
    currentSession.current = session;
    const apply = async (shared: SharedSelection) => {
      if (!acceptSharedRevision(shared, latestRevision)) {
        if (currentProof.current) {
          await invoke("plugin:secondary|secondary_proof_observe", {
            observation: {
              stage: "stale-rejected",
              activePhotoId: currentPhoto.current?.id ?? null,
              revision: latestRevision.current,
              rejectedRevision: shared.revision,
              viewportMarker: markerRef.current,
            },
          });
        }
        return;
      }
      currentPhoto.current = null;
      setShared(shared);
      setPhoto(null);
      setError(null);
      await resolveSelectionPhoto(
        shared,
        getPhoto,
        () => !cancelled && shared.revision === latestRevision.current,
        (next) => {
          currentPhoto.current = next;
          setPhoto(next);
          setError(next || shared.activePhotoId == null ? null : `Photo ${shared.activePhotoId} was not found`);
        },
      );
      if (!cancelled && shared.revision === latestRevision.current
        && shared.activePhotoId == null && currentProof.current) {
        await invoke("plugin:secondary|secondary_proof_observe", {
          observation: {
            stage: "cleared",
            catalogId: shared.catalogId,
            activePhotoId: null,
            selection: shared.selection,
            revision: shared.revision,
            viewportMarker: markerRef.current,
          },
        });
      }
    };
    const stop = startSecondaryDisplaySession(
      () => invoke<ProofConfig | null>("plugin:secondary|secondary_proof_config"),
      (config) => {
        currentProof.current = config;
      },
      () => startSharedSelectionSync(
        async (handler) => listen<SharedSelection>("galerie://shared-selection", (event) => handler(event.payload)),
        () => invoke<SharedSelection>("plugin:secondary|shared_selection"),
        apply,
        (stage, e) => setError(stage === "registration"
          ? `Selection listener registration failed: ${String(e)}`
          : stage === "initial"
            ? `Initial selection sync failed: ${String(e)}`
            : `Selection sync failed: ${String(e)}`),
      ),
      (e) => setProofError(`Proof configuration failed: ${String(e)}`),
    );
    return () => {
      cancelled = true;
      if (currentSession.current === session) currentSession.current = null;
      stop();
    };
  }, []);

  // The main window drives this display's view from Window ▸ Secondary Display.
  // The ready ping covers a cold open: the request lands before this webview
  // exists, so the main window replays it when we announce ourselves.
  useEffect(() => {
    let stopped = false;
    let dispose: (() => void) | null = null;
    void (async () => {
      try {
        const off = await listen<string>(SECONDARY_VIEW_EVENT, (event) => {
          const next = SECONDARY_MODES.find((m) => m.id === event.payload);
          if (next) setMode(next.id);
        });
        if (stopped) off();
        else dispose = off;
        await emit(SECONDARY_READY_EVENT);
      } catch {
        // No Tauri host (browser dev): the switcher in this window still works.
      }
    })();
    return () => {
      stopped = true;
      dispose?.();
    };
  }, []);

  // The shared set backs Grid/Compare/Survey/Slideshow and the filmstrip; the
  // bare Loupe needs only the active photo, so it stays off that work entirely
  // (and the two-window proof keeps its single-lookup shape).
  const needSet = sharedSetNeeded(mode, filmstrip);
  useEffect(() => {
    if (!needSet) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const ids = (shared?.selection ?? []).slice(0, SET_CAP);
    void Promise.all(ids.map((id) => getPhoto(id).catch(() => null))).then((list) => {
      if (!cancelled) setRows(list.filter((p): p is PhotoRow => p != null));
    });
    return () => {
      cancelled = true;
    };
  }, [needSet, shared?.revision]);

  // Slideshow: walk the shared set on a timer (the pin is the playhead).
  useEffect(() => {
    if (mode !== "slideshow" || rows.length < 2) return;
    const timer = setInterval(
      () => setPinned(stepPinned(rowsRef.current, displayRef.current?.id ?? null, 1)),
      SLIDE_MS,
    );
    return () => clearInterval(timer);
  }, [mode, rows.length]);

  useEffect(() => {
    let cancelled = false;
    let releasePreview = () => {};
    setPreview(null);
    const target = display;
    currentDisplay.current = target;
    if (target && shared) {
      const revision = shared.revision;
      void resolvePreview(
        target,
        revision,
        () => loadPreview(target, "secondary", SECONDARY_EDGE),
        () => !cancelled
          && latestRevision.current === revision
          && currentDisplay.current?.id === target.id,
        (next) => {
          releasePreview = acceptPreview(next, setPreview);
          setError(null);
        },
        setError,
      );
    }
    return () => {
      cancelled = true;
      releasePreview();
    };
  }, [display?.id, display?.readPath, shared?.revision, recipeRevision]);

  // A new photo (or zoom step) drops back to the computed pan.
  useEffect(() => {
    setNat(null);
    setPan(null);
  }, [display?.id]);
  useEffect(() => setPan(null), [zoom]);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    containerRef.current = el;
    if (!el) {
      roRef.current = null;
      return;
    }
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
    measure();
  }, []);

  // Keys mirror the main window's view switcher (G/E/C/N), plus L to lock the
  // frame, F for the filmstrip and ←/→ to browse the shared set locally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const next = SECONDARY_MODES.find((m) => m.key === key);
      if (next) setMode(next.id);
      else if (key === "l") setPinned((p) => (p ? null : displayRef.current));
      else if (key === "f") setFilmstrip((v) => !v);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setPinned(stepPinned(rowsRef.current, displayRef.current?.id ?? null, e.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ready = nat != null && nat.w > 0 && view.w > 0 && view.h > 0;
  const scale = ready && display
    ? zoomScale(zoom, nat.w, nat.h, view.w, view.h, previewTargetEdge(display))
    : 1;
  const shownPan = ready
    ? clampPan(pan ?? centerPan(nat.w, nat.h, scale, view.w, view.h), nat.w, nat.h, scale, view.w, view.h)
    : { x: 0, y: 0 };
  const pannable = ready && (nat.w * scale > view.w || nat.h * scale > view.h);

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!pannable) return;
    draggedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: shownPan.x, py: shownPan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const d = dragRef.current;
    if (!d || !ready) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) draggedRef.current = true;
    setPan(clampPan(
      { x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) },
      nat.w,
      nat.h,
      scale,
      view.w,
      view.h,
    ));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  // Click toggles Fit ↔ 1:1 at the clicked point, like the main Loupe.
  const onImageClick = (e: React.PointerEvent<HTMLImageElement>) => {
    if (draggedRef.current || !ready || !display) {
      draggedRef.current = false;
      return;
    }
    if (zoom !== "fit") {
      setZoom("fit");
      setPan(null);
      return;
    }
    const r = containerRef.current?.getBoundingClientRect();
    const detail = zoomScale("1:1", nat.w, nat.h, view.w, view.h, previewTargetEdge(display));
    setZoom("1:1");
    setPan(zoomToPoint(
      e.clientX - (r?.left ?? 0),
      e.clientY - (r?.top ?? 0),
      scale,
      shownPan,
      detail,
      nat.w,
      nat.h,
      view.w,
      view.h,
    ).pan);
  };

  const toggleFullscreen = () => {
    const doc = document;
    void (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen())
      .catch((e) => setError(`Full screen failed: ${String(e)}`));
  };

  const loupe = (
    <div className={"gal-loupe" + (zoom === "fit" ? "" : " is-zoomed")}>
      {preview ? (
        <img
          className="gal-loupe-img"
          src={preview.url}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            setNat({ w: img.naturalWidth, h: img.naturalHeight });
            const session = currentSession.current;
            if (!currentProof.current || !session) return;
            const observation = renderedObservation(
              preview,
              shared,
              photo,
              latestRevision.current,
              img.naturalWidth,
              img.naturalHeight,
              markerRef.current,
            );
            if (!observation) return;
            void observeRenderedProof(
              () => invoke("plugin:secondary|secondary_proof_observe", { observation }),
              () => currentSession.current === session,
              setError,
            );
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onImageClick}
          style={ready
            ? {
                position: "absolute",
                left: 0,
                top: 0,
                width: nat.w,
                height: nat.h,
                maxWidth: "none",
                maxHeight: "none",
                transformOrigin: "0 0",
                transform: `translate(${shownPan.x}px, ${shownPan.y}px) scale(${scale})`,
              }
            : undefined}
        />
      ) : <div className="gal-cell-spinner" />}
    </div>
  );

  const empty = (title: string, sub: string) => (
    <div className="gal-empty">
      <div className="gal-empty-title">{title}</div>
      <div className="gal-empty-sub">{sub}</div>
    </div>
  );

  const [select, candidate] = comparePair(rows, display);
  const surveyed = rows.length > 0 ? rows : display ? [display] : [];

  // ponytail: the shared payload carries the SELECTION, so the set views work
  // off that rather than the main window's whole filtered grid. Widening it
  // means adding the visible ids to SharedSelection (src-tauri/src/secondary.rs
  // + state/store.ts publish it).
  const stage = mode === "grid"
    ? rows.length === 0
      ? empty("Nothing shared", "Select photos in the main window.")
      : (
        <div className="gal-grid-scroll">
          <div
            className="gal-grid"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_EDGE}px, 1fr))`,
              gridAutoRows: `${GRID_EDGE}px`,
              gap: 8,
              padding: 8,
            }}
          >
            {rows.map((p) => (
              <GridCell
                key={p.id}
                photo={p}
                edge={GRID_EDGE}
                selected
                active={p.id === display?.id}
                // Clean cells: the badge buttons cull through the main window's
                // store, which this webview does not own.
                cellStyle="clean"
                onSelect={() => setPinned(p)}
              />
            ))}
          </div>
        </div>
      )
    : mode === "compare"
      ? (
        <div className="gal-compare">
          <div className="gal-compare-pane" onClick={() => select && setPinned(select)}>
            {select ? <PreviewImg photo={select} edge={COMPARE_EDGE} className="gal-compare-img" /> : null}
            <div className="gal-compare-tag">Select{select ? ` · ${basename(select.path)}` : ""}</div>
          </div>
          <div className="gal-compare-pane" onClick={() => candidate && setPinned(candidate)}>
            {candidate
              ? <PreviewImg photo={candidate} edge={COMPARE_EDGE} className="gal-compare-img" />
              : <div className="gal-compare-empty">Select two photos to compare</div>}
            <div className="gal-compare-tag">Candidate{candidate ? ` · ${basename(candidate.path)}` : ""}</div>
          </div>
        </div>
      )
      : mode === "survey"
        ? surveyed.length === 0
          ? empty("Nothing to survey", "Select photos in the main window.")
          : (
            <div className="gal-survey">
              {surveyed.map((p) => (
                <div
                  key={p.id}
                  className={"gal-survey-cell" + (p.id === display?.id ? " is-active" : "")}
                  role="button"
                  tabIndex={0}
                  title={basename(p.path)}
                  onClick={() => setPinned(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPinned(p);
                    }
                  }}
                >
                  <PreviewImg photo={p} edge={SURVEY_EDGE} className="gal-survey-img" />
                </div>
              ))}
            </div>
          )
        : display
          ? loupe
          : empty("No shared selection", "Pick a photo in the main window.");

  return (
    <main style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div
        className="gal-filter"
        style={{
          flex: "none",
          padding: "6px 10px",
          background: "var(--surface-1, #232326)",
          borderBottom: "1px solid var(--border-1, #333)",
        }}
      >
        <span className="gal-filter-label">View</span>
        {SECONDARY_MODES.map((m) => (
          <button
            key={m.id}
            className={"gal-filter-btn" + (mode === m.id ? " is-sel" : "")}
            aria-pressed={mode === m.id}
            title={`${m.label} (${m.key.toUpperCase()})`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
        <span className="gal-filter-sep" />
        {(mode === "loupe" || mode === "slideshow") && SECONDARY_ZOOMS.map((z) => (
          <button
            key={z}
            className={"gal-filter-btn" + (zoom === z ? " is-sel" : "")}
            aria-pressed={zoom === z}
            title={`Zoom ${z}`}
            onClick={() => setZoom(z)}
          >
            {z === "fit" ? "Fit" : z === "fill" ? "Fill" : z}
          </button>
        ))}
        <span className="gal-filter-sep" />
        <button
          className={"gal-filter-btn" + (pinned ? " is-sel" : "")}
          aria-pressed={pinned != null}
          title="Lock this frame — incoming selections stop moving it (L)"
          onClick={() => setPinned((p) => (p ? null : display))}
        >
          {pinned ? "Locked" : "Normal"}
        </button>
        <button
          className={"gal-filter-btn" + (filmstrip ? " is-sel" : "")}
          aria-pressed={filmstrip}
          title="Show the shared set as a filmstrip (F)"
          onClick={() => setFilmstrip((v) => !v)}
        >
          Filmstrip
        </button>
        <button className="gal-filter-btn" title="Full screen" onClick={toggleFullscreen}>
          Full Screen
        </button>
      </div>
      <div ref={measureRef} style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {stage}
        <div className="gal-loupe-caption">
          {proofError ?? error
            ?? (display
              ? `${basename(display.path)} · ${display.width}×${display.height}${pinned ? " · Locked" : ""}`
              : "No shared selection")}
        </div>
      </div>
      {filmstrip && (
        <div
          style={{
            flex: "none",
            height: FILM_HEIGHT,
            borderTop: "1px solid var(--border-1, #333)",
          }}
        >
          {rows.length === 0
            ? <div className="gal-film-empty">No shared photos</div>
            : (
              <div className="gal-filmstrip">
                {rows.map((p) => (
                  <SecondaryFilmCell
                    key={p.id}
                    photo={p}
                    active={p.id === display?.id}
                    onPick={() => setPinned(p)}
                  />
                ))}
              </div>
            )}
        </div>
      )}
    </main>
  );
}

function SecondaryFilmCell({
  photo,
  active,
  onPick,
}: {
  photo: PhotoRow;
  active: boolean;
  onPick: () => void;
}) {
  const url = useThumbnail(photo, FILM_EDGE);
  return (
    <div
      className={"gal-film-cell" + (active ? " is-active" : "")}
      role="button"
      tabIndex={0}
      title={basename(photo.path)}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <div className="gal-cell-spinner" />}
    </div>
  );
}
