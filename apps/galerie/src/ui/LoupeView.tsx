// LoupeView — the active photo through the native preview cache (task #8): a
// "standard" preview is read from disk when present and decoded+cached on a miss,
// so revisiting a photo is instant across views and restarts. Click toggles
// Fit ↔ 1:1 at the clicked point (Lightroom's Loupe zoom); drag pans when zoomed.

import { useCallback, useEffect, useRef, useState } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";

import { centerPan, clampPan, detailScale, fitScale, type Pan, rescaleZoom, zoomToPoint } from "../lib/loupeZoom";
import { loadPreview, previewTargetEdge } from "../lib/thumbnailLoader";
import { useCatalog } from "../state/store";
import { basename } from "./GridCell";
import { KeywordsBar } from "./KeywordsBar";
import { MetadataOverlay } from "./MetadataOverlay";
import { useRecipeRevision } from "./useRecipeRevision";

const LOUPE_EDGE = 2560; // fit-to-screen preview resolution
const LOUPE_KIND = "standard"; // LR's standard preview (distinct from grid thumbnails)

export function LoupeView() {
  const st = useCatalog();
  const active = st.activeId != null ? st.photos.find((p) => p.id === st.activeId) : undefined;
  const [url, setUrl] = useState<string | null>(null);
  // Loupe Info overlay: LR's `I` cycles Info 1 → Info 2 → off.
  const [infoMode, setInfoMode] = useState<0 | 1 | 2>(1);
  const recipeRevision = useRecipeRevision(active?.id);

  // Zoom/pan: `zoom` null = fit-to-screen; else an explicit scale + pan.
  const [zoom, setZoom] = useState<{ scale: number; pan: Pan } | null>(null);
  // True 1:1 (LR parity): while zoomed, a native-edge decode loads lazily and
  // swaps over the fit-sized one; onLoad rescales the transform so the swap
  // is seamless, then snaps to exact 1:1 of the new decode.
  const [hiUrl, setHiUrl] = useState<string | null>(null);
  const hiUrlRef = useRef<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const draggedRef = useRef(false);
  // Space/Z toggle (assigned below, after the geometry is computed): a ref so
  // the mount-once key listener always sees the current geometry. Declared
  // HERE — a hook after the `!active` early return crashes when the active
  // photo disappears while the view is mounted.
  const zoomToggleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "i") setInfoMode((m) => (m === 1 ? 2 : m === 2 ? 0 : 1));
      else if (k === " " || k === "z") {
        // Space/Z: Fit ↔ 1:1 (the App-level handler already routed us to Loupe).
        e.preventDefault();
        zoomToggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A new photo resets to fit.
  useEffect(() => {
    setZoom(null);
    setNat(null);
  }, [active?.id]);

  // The 1:1 decode is per photo+recipe: free it when either changes.
  useEffect(() => {
    return () => {
      if (hiUrlRef.current) URL.revokeObjectURL(hiUrlRef.current);
      hiUrlRef.current = null;
      setHiUrl(null);
    };
  }, [active?.id, recipeRevision]);

  // Load the native-edge decode on first zoom (not during culling passes —
  // full-resolution decodes are expensive, LR builds 1:1 on demand too).
  const zoomed = zoom != null;
  useEffect(() => {
    if (!active || !zoomed || hiUrlRef.current != null) return;
    const fullEdge = previewTargetEdge(active); // RAW caps at the proxy ceiling
    if (fullEdge <= 0) return; // unknown dims — keep the standard decode
    if (nat != null && Math.max(nat.w, nat.h) >= fullEdge) return; // already native
    let cancelled = false;
    void (async () => {
      const u = await loadPreview(active, LOUPE_KIND, fullEdge);
      if (!u) return;
      if (cancelled || hiUrlRef.current != null) {
        URL.revokeObjectURL(u);
        return;
      }
      hiUrlRef.current = u;
      setHiUrl(u);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, zoomed, nat, recipeRevision]);

  useEffect(() => {
    if (!active) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objUrl: string | null = null;
    setUrl(null);
    (async () => {
      const u = await loadPreview(active, LOUPE_KIND, LOUPE_EDGE);
      objUrl = u;
      if (cancelled) {
        if (objUrl) URL.revokeObjectURL(objUrl);
        return;
      }
      setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [active?.id, active?.readPath, recipeRevision]);

  // Measure the container (viewport) via a ResizeObserver attached on mount.
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

  if (!active) {
    return (
      <div className="gal-empty">
        <div className="gal-empty-title">No photo selected</div>
        <div className="gal-empty-sub">Select a photo, or press G for the grid.</div>
      </div>
    );
  }

  const ready = nat != null && nat.w > 0 && view.w > 0 && view.h > 0;
  const sDetail = ready ? detailScale(nat.w, nat.h, previewTargetEdge(active)) : 1;
  const sFit = ready ? fitScale(nat.w, nat.h, view.w, view.h) : 1;
  const fitPan = ready ? centerPan(nat.w, nat.h, sFit, view.w, view.h) : { x: 0, y: 0 };
  const scale = zoom ? zoom.scale : sFit;
  const pan = zoom ? zoom.pan : fitPan;

  // Space/Z toggle Fit ↔ 1:1 at the view centre (LR's loupe zoom keys).
  zoomToggleRef.current = () => {
    if (!ready) return;
    if (zoom) {
      setZoom(null);
      return;
    }
    setZoom(zoomToPoint(view.w / 2, view.h / 2, sFit, fitPan, sDetail, nat.w, nat.h, view.w, view.h));
  };

  const viewPoint = (e: React.PointerEvent): Pan => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!ready || !zoom) return; // pan only when zoomed; fit-mode is click-to-zoom
    draggedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: zoom.pan.x, py: zoom.pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const d = dragRef.current;
    if (!d || !ready || !zoom) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) draggedRef.current = true;
    const next = { x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) };
    setZoom({ scale: zoom.scale, pan: clampPan(next, nat.w, nat.h, zoom.scale, view.w, view.h) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onClick = (e: React.PointerEvent<HTMLImageElement>) => {
    if (draggedRef.current || !ready) {
      draggedRef.current = false;
      return;
    }
    if (zoom) {
      setZoom(null); // back to fit
      return;
    }
    const { x, y } = viewPoint(e);
    setZoom(zoomToPoint(x, y, sFit, fitPan, sDetail, nat.w, nat.h, view.w, view.h));
  };

  return (
    <div ref={measureRef} className={"gal-loupe" + (zoom ? " is-zoomed" : "")}>
      {url ? (
        <img
          className="gal-loupe-img"
          src={hiUrl ?? url}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const w = e.currentTarget.naturalWidth;
            const h = e.currentTarget.naturalHeight;
            if (nat && zoom && ready && (nat.w !== w || nat.h !== h)) {
              // 1:1 upgrade swap: keep the content where it was, then snap to
              // exact 1:1 of the new decode around the view centre.
              const r = rescaleZoom(zoom, nat.w, w, h, view.w, view.h);
              setZoom(zoomToPoint(view.w / 2, view.h / 2, r.scale, r.pan, 1, w, h, view.w, view.h));
            }
            setNat({ w, h });
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onClick}
          style={
            ready
              ? {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: nat.w,
                  height: nat.h,
                  maxWidth: "none",
                  maxHeight: "none",
                  transformOrigin: "0 0",
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                }
              : undefined
          }
        />
      ) : (
        <div className="gal-cell-spinner" />
      )}
      {infoMode !== 0 && <MetadataOverlay photo={active} variant={infoMode} />}
      <div className="gal-kw-dock">
        <KeywordsBar photoId={active.id} />
      </div>
      <div className="gal-loupe-caption">
        {basename(active.path)} · {active.width}×{active.height}
        {active.rating > 0 && <span className="gal-stars"> {"★".repeat(active.rating)}</span>}
        {active.flag === 1 && <span className="gal-flag is-pick"> ⚑</span>}
        {active.flag === -1 && <span className="gal-flag is-reject"> ⚑</span>}
      </div>
    </div>
  );
}
