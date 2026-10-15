// ─────────────────────────────────────────────────────────────
// render/canvas-view — the editing viewport
// ─────────────────────────────────────────────────────────────
// Owns the world↔screen transform, dispatches pointer/keyboard input to the
// active tool, and composes the document SVG with rulers, grid and overlays.

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";
import { CollabCursors } from "@monet-ui/monet-collab/react";
import { type Point, Query, Vec } from "../engine";
import { useCollab, useEditorState, useStore } from "../state/store-context";
import { getTool } from "../tools/registry";
import { snapPoint } from "../tools/snap";
import { clampZoom, zoomAt } from "../tools/view";
import { shouldDispatchPointerMove, type ToolContext, type ToolPointer } from "../tools/types";
import { ArtboardBackgrounds, DocumentContent } from "./document-content";
import { SelectionHandles, SelectionOutlines } from "./overlay";
import { RULER_SIZE, Ruler } from "./rulers";
import { Guides } from "./guides";
import { rasterRendererEnabled } from "./raster-flag";
import { FallbackOverlay } from "./text-overlay";

// Lazy so the Rust/WASM engine chunk only loads when the raster renderer is on.
const RasterDocument = lazy(() => import("./raster-document").then((m) => ({ default: m.RasterDocument })));

export function CanvasView() {
  const store = useStore();
  const collab = useCollab();
  const state = useEditorState();
  const { doc, view, selection, tool: toolId, rulers, grid, outlineMode } = state;

  const svgRef = useRef<SVGSVGElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const guideDragRef = useRef<"h" | "v" | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [, forceTick] = useReducer((x) => x + 1, 0);
  const [cursorWorld, setCursorWorld] = useState<Point | null>(null);
  const spaceRef = useRef(false);
  const panRef = useRef<{ startScreen: Point; tx: number; ty: number } | null>(null);
  const didFit = useRef(false);

  const activeTool = getTool(toolId);
  // When on, the Rust/WASM engine paints the document onto a <canvas> and the SVG
  // layer carries only editing chrome (grid, outlines, handles, guides, overlays).
  const useRaster = useMemo(() => rasterRendererEnabled(), []);

  const center = { x: size.width / 2, y: size.height / 2 };
  const worldToScreen = useCallback(
    (p: Point): Point => {
      const base = { x: p.x * view.zoom + view.tx, y: p.y * view.zoom + view.ty };
      return view.angle ? Vec.rotateAround(base, { x: size.width / 2, y: size.height / 2 }, view.angle) : base;
    },
    [view.zoom, view.tx, view.ty, view.angle, size.width, size.height],
  );
  const screenToWorld = useCallback(
    (p: Point): Point => {
      const s = view.angle ? Vec.rotateAround(p, { x: size.width / 2, y: size.height / 2 }, -view.angle) : p;
      return { x: (s.x - view.tx) / view.zoom, y: (s.y - view.ty) / view.zoom };
    },
    [view.zoom, view.tx, view.ty, view.angle, size.width, size.height],
  );

  // Collaboration presence: publish this user's cursor (in world coords, so it
  // stays correct under each peer's own pan/zoom) and their selection.
  useEffect(() => collab?.setCursor(cursorWorld), [collab, cursorWorld]);
  useEffect(() => collab?.setSelection(selection), [collab, selection]);

  const ctx: ToolContext = {
    store,
    state,
    worldToScreen,
    screenToWorld,
    requestRender: forceTick,
    zoom: view.zoom,
    viewport: size,
  };

  // Latest tool + context for the global key listener (registered once).
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const viewRef = useRef(view);
  viewRef.current = view;

  // Tool activate/deactivate lifecycle (lets a tool finalize on switch).
  const prevToolRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevToolRef.current;
    if (prev && prev !== toolId) {
      getTool(prev).onDeactivate?.(ctxRef.current);
      // AR-H5: a drag tool that opened a transaction but has no teardown of its
      // own would otherwise leak it into the next tool's first edit, corrupting
      // the undo boundary. Tools that finalize their own tx (selection/pen/type)
      // leave none open, so this is a no-op for them.
      if (store.transactionBase !== null) store.cancelTransaction();
    }
    getTool(toolId).onActivate?.(ctxRef.current);
    prevToolRef.current = toolId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  // ── Measure the canvas cell ────────────────────────────────
  useLayoutEffect(() => {
    const el = cellRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
      store.setViewport({ width: r.width, height: r.height });
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, [store]);

  // ── Fit the first artboard on first valid measurement ──────
  useEffect(() => {
    if (didFit.current || size.width < 50) return;
    const ab = doc.artboards[doc.activeArtboard] ?? doc.artboards[0];
    if (!ab) return;
    const z = clampZoom(Math.min((size.width * 0.85) / ab.width, (size.height * 0.85) / ab.height));
    store.setView({
      zoom: z,
      tx: size.width / 2 - (ab.x + ab.width / 2) * z,
      ty: size.height / 2 - (ab.y + ab.height / 2) * z,
    });
    didFit.current = true;
  }, [size, doc, store]);

  // ── Space-to-pan + non-passive wheel ───────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !spaceRef.current && !isEditableTarget(e.target)) {
        spaceRef.current = true;
        forceTick();
        e.preventDefault();
        return;
      }
      if (isEditableTarget(e.target)) return;
      // Give the active tool first crack (it may stopImmediatePropagation to
      // pre-empt the global shortcut handler — e.g. pen Esc/Enter).
      toolRef.current.onKeyDown?.(e, ctxRef.current);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        forceTick();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Register the non-passive wheel listener ONCE; read the live view/ctx through
  // refs so panning/zooming doesn't tear down and re-add the listener every frame.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0125);
        zoomAt(ctxRef.current, v.zoom * factor, anchor);
      } else {
        store.setView({ tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [store]);

  // ── Pointer plumbing ───────────────────────────────────────
  const toScreen = (e: React.MouseEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const makePointer = (e: React.MouseEvent, button: number): ToolPointer => {
    const screen = toScreen(e);
    const rawWorld = screenToWorld(screen);
    const world = snapPoint(state, rawWorld);
    return {
      screen,
      rawWorld,
      world,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.ctrlKey || e.metaKey,
      button,
      detail: e.detail,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (spaceRef.current || e.button === 1) {
      panRef.current = { startScreen: toScreen(e), tx: view.tx, ty: view.ty };
      forceTick();
      return;
    }
    if (e.button !== 0) return;
    activeTool.onPointerDown?.(makePointer(e, e.button), ctx);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const screen = toScreen(e);
    setCursorWorld(screenToWorld(screen));
    if (panRef.current) {
      const p = panRef.current;
      let d = { x: screen.x - p.startScreen.x, y: screen.y - p.startScreen.y };
      if (view.angle) d = Vec.rotate(d, -view.angle);
      store.setView({ tx: p.tx + d.x, ty: p.ty + d.y });
      return;
    }
    if (shouldDispatchPointerMove(activeTool, e.buttons)) {
      activeTool.onPointerMove?.(makePointer(e, e.buttons ? 0 : -1), ctx);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (panRef.current) {
      panRef.current = null;
      forceTick();
      return;
    }
    activeTool.onPointerUp?.(makePointer(e, e.button), ctx);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    activeTool.onDoubleClick?.(makePointer(e, 0), ctx);
  };

  // ── Grid (memoized — only rebuilds when the grid or viewport changes) ──
  const gridLines = useMemo(() => {
    if (!grid.show || grid.size <= 0) return null;
    const corners = [
      screenToWorld({ x: 0, y: 0 }),
      screenToWorld({ x: size.width, y: 0 }),
      screenToWorld({ x: size.width, y: size.height }),
      screenToWorld({ x: 0, y: size.height }),
    ];
    const tl = { x: Math.min(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) };
    const br = { x: Math.max(...corners.map((c) => c.x)), y: Math.max(...corners.map((c) => c.y)) };
    const step = grid.size;
    const lines: React.ReactNode[] = [];
    const startX = Math.floor(tl.x / step) * step;
    const startY = Math.floor(tl.y / step) * step;
    for (let x = startX; x <= br.x; x += step) {
      lines.push(<line key={`gx${x}`} x1={x} y1={tl.y} x2={x} y2={br.y} stroke="rgba(110,125,160,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    }
    for (let y = startY; y <= br.y; y += step) {
      lines.push(<line key={`gy${y}`} x1={tl.x} y1={y} x2={br.x} y2={y} stroke="rgba(110,125,160,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    }
    return <g className="artisan-grid">{lines}</g>;
  }, [grid.show, grid.size, screenToWorld, size.width, size.height]);

  // Never draw bounding-box handles over an item being inline-edited — the inline
  // editor's own box is its chrome. Today this also holds because editing runs under
  // the "type" tool, but the explicit guard keeps the invariant from depending on that.
  const showHandles = toolId === "selection" && selection.length > 0 && !state.editingTextId && !state.hideEdges && state.showBoundingBox && !state.trimView;
  // Memoized so panning/hover (which don't touch doc or selection) skip the
  // selectionBounds recompute (each one walks the tree via findItem).
  const selBounds = useMemo(
    () => (showHandles ? Query.selectionBounds(doc, selection) : null),
    [showHandles, doc, selection],
  );
  const toolOverlay = activeTool.renderOverlay?.(ctx) ?? null;
  const cursor = panRef.current || spaceRef.current ? "grabbing" : activeTool.cursor ?? "default";
  // View ▸ Trim View clips the artwork to the artboards (and hides editing chrome).
  const trimClip = state.trimView && doc.artboards.length > 0;

  // Drag out a ruler guide: press a ruler, release over the canvas. Pointer
  // capture keeps the up event on the ruler even as the cursor crosses the canvas.
  const onRulerDown = (orientation: "h" | "v") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    guideDragRef.current = orientation;
    e.preventDefault();
  };
  const onRulerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const orientation = guideDragRef.current;
    guideDragRef.current = null;
    const svg = svgRef.current;
    if (!orientation || !svg) return;
    const r = svg.getBoundingClientRect();
    const w = screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    store.addGuide(orientation, orientation === "h" ? w.y : w.x);
  };

  return (
    <div className={`artisan-viewport${rulers ? "" : " no-rulers"}`} style={{ ["--artisan-ruler-size" as string]: `${rulers ? RULER_SIZE : 0}px` }}>
      <div className="artisan-corner" />
      <div className="artisan-ruler-top" onPointerDown={onRulerDown("h")} onPointerUp={onRulerUp}>{rulers && <Ruler orientation="h" size={size.width} view={view} cursor={cursorWorld?.x ?? null} />}</div>
      <div className="artisan-ruler-left" onPointerDown={onRulerDown("v")} onPointerUp={onRulerUp}>{rulers && <Ruler orientation="v" size={size.height} view={view} cursor={cursorWorld?.y ?? null} />}</div>
      <div className="artisan-canvas-cell" ref={cellRef}>
        {state.transparencyGrid && <div className="artisan-transparency-grid" />}
        {useRaster && (
          <Suspense fallback={null}>
            <RasterDocument width={size.width} height={size.height} />
          </Suspense>
        )}
        <svg
          ref={svgRef}
          className="artisan-canvas"
          width={size.width}
          height={size.height}
          style={useRaster ? { cursor, touchAction: "none", position: "relative", zIndex: 1, background: "transparent" } : { cursor, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursorWorld(null)}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          <g transform={`${view.angle ? `rotate(${(view.angle * 180) / Math.PI} ${center.x} ${center.y})` : ""} translate(${view.tx} ${view.ty}) scale(${view.zoom})`}>
            {/* Trim View clips the artwork to the union of the artboard rects. */}
            {trimClip && (
              <defs>
                <clipPath id="artisan-trim-clip" clipPathUnits="userSpaceOnUse">
                  {doc.artboards.map((ab) => (
                    <rect key={ab.id} x={ab.x} y={ab.y} width={ab.width} height={ab.height} />
                  ))}
                </clipPath>
              </defs>
            )}
            <g clipPath={trimClip ? "url(#artisan-trim-clip)" : undefined} data-trim-clip={trimClip ? "on" : undefined}>
              {!useRaster && <ArtboardBackgrounds artboards={doc.artboards} outline={outlineMode} />}
              {!state.trimView && gridLines}
              {!useRaster && <DocumentContent doc={doc} outline={outlineMode} hideId={state.editingTextId} selectedSlice={state.selectedSlice} />}
              {/* Hybrid: Rust paints the scene. SVG here is only what that rasterizer cannot decode. */}
              {useRaster && <FallbackOverlay doc={doc} hideId={state.editingTextId} />}
            </g>
            {!state.hideEdges && !state.trimView && <SelectionOutlines doc={doc} selection={selection} hideId={state.editingTextId} keyId={state.keyObjectId} />}
          </g>
        </svg>
        <svg className="artisan-overlay" width={size.width} height={size.height}>
          <Guides guides={state.guides} show={state.showGuides && !state.trimView} worldToScreen={worldToScreen} width={size.width} height={size.height} />
          {state.perspectiveGrid && <PerspectiveGrid width={size.width} height={size.height} />}
          {selBounds && <SelectionHandles bounds={selBounds} worldToScreen={worldToScreen} rotatable />}
          {toolOverlay}
        </svg>
        <div className="artisan-html-overlay">{activeTool.renderHtmlOverlay?.(ctx)}</div>
        <CollabCursors session={collab} toScreen={worldToScreen} />
      </div>
    </div>
  );
}

/** A 1-point perspective grid guide (screen space). */
function PerspectiveGrid({ width, height }: { width: number; height: number }) {
  const vp = { x: width / 2, y: height * 0.42 };
  const horizon = vp.y;
  const lines: React.ReactNode[] = [];
  const stroke = "rgba(120,180,255,0.35)";
  // Horizon
  lines.push(<line key="h" x1={0} y1={horizon} x2={width} y2={horizon} stroke="rgba(120,180,255,0.6)" strokeWidth={1} />);
  // Converging floor lines from the bottom edge to the vanishing point.
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const x = (width * i) / n;
    lines.push(<line key={`c${i}`} x1={x} y1={height} x2={vp.x} y2={vp.y} stroke={stroke} strokeWidth={0.75} />);
  }
  // Receding horizontal lines (denser toward the horizon).
  for (let k = 1; k <= 8; k++) {
    const t = k / 9;
    const y = horizon + (height - horizon) * (1 - t) ** 1.8;
    lines.push(<line key={`r${k}`} x1={0} y1={y} x2={width} y2={y} stroke={stroke} strokeWidth={0.5} />);
  }
  lines.push(<circle key="vp" cx={vp.x} cy={vp.y} r={4} fill="none" stroke="rgba(120,180,255,0.9)" strokeWidth={1.25} />);
  return <g pointerEvents="none">{lines}</g>;
}
