// MaskOverlay — on-canvas geometry handles for the selected gradient mask. Sits
// exactly over the develop canvas (its wrapper is sized to the canvas box) and
// works in normalized 0..1 image space, the same space computeMaskCoverage uses
// — so a radial "circle" reads elliptical on a non-square image in both the
// handle and the render, staying consistent. Drag updates the base component's
// geometry via onChange (which flows into the recipe → re-render).
//
// Linear gradients draw LR's three control lines (perpendiculars at the start,
// midpoint and end of the axis) with a grip on the middle one that translates
// the whole gradient; the endpoints still rotate/scale it. Radial gradients draw
// their ellipse rotated by `angle`, with the two radius handles on the rotated
// axes and a rotation grip just past the rx one. Edits whichever component is
// selected (componentIndex), so a stacked gradient is draggable too, not just
// the base.
//
// Coverage tint (LR's Show Overlay): a canvas under the handles paints the
// mask's actual coverage — red tint by default — so brush/range/AI masks are
// no longer authored blind. `O` cycles Color Overlay → White on Black → off,
// `Shift+O` cycles the tint colour. The frame to sample comes from
// maskComposite's overlay-frame cache, published on every develop render.

import { useEffect, useRef, useState } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";

import type {
  LinearGradientComponent,
  Mask,
  RadialGradientComponent,
} from "@monet-ui/monet-photo";

import {
  getOverlayFrame,
  maskCoverage,
  onOverlayFrame,
  tintCoverage,
  type OverlayMode,
} from "../lib/maskComposite";
import { needsBaseImage } from "../lib/maskEdit";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// Overlay display modes cycled by `O`; tint colours cycled by `Shift+O`.
const OVERLAY_MODES = ["color", "whiteOnBlack", "off"] as const;
const OVERLAY_TINTS: readonly (readonly [number, number, number])[] = [
  [255, 60, 60], // red (LR default)
  [60, 255, 60],
  [255, 255, 255],
];
// Parametric masks paint at a capped raster the browser scales up; range masks
// must sample the base frame pixel-for-pixel, so they paint at frame size.
const TINT_CAP = 480;
// Half-length of a linear guide line: the viewBox is 0..1, so 1.5 runs well past
// the frame and the SVG clips it — LR draws the lines edge to edge.
const GUIDE_HALF = 1.5;
// Gap between the rx handle and the rotation grip, in normalized units.
const ROT_GAP = 0.06;
// Smallest radius a drag can leave, so an ellipse can't collapse to nothing.
const MIN_RADIUS = 0.02;

/** A drawn guide segment in normalized (0..1) image space. */
interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** LR's three linear-gradient control lines: perpendiculars at the start, the
 *  midpoint (the translate grip's line) and the end of the axis. */
export function linearGuides(c: LinearGradientComponent): Guide[] {
  const dx = c.x2 - c.x1;
  const dy = c.y2 - c.y1;
  const len = Math.hypot(dx, dy) || 1; // degenerate axis → arbitrary perpendicular
  const px = (-dy / len) * GUIDE_HALF;
  const py = (dx / len) * GUIDE_HALF;
  return [0, 0.5, 1].map((t) => {
    const x = c.x1 + dx * t;
    const y = c.y1 + dy * t;
    return { x1: x - px, y1: y - py, x2: x + px, y2: y + py };
  });
}

/** Translate the whole axis so its midpoint lands on (nx,ny) — absolute, so it
 *  stays correct as the drag closure is replayed against the captured base. */
export function linearTranslate(
  c: LinearGradientComponent,
  nx: number,
  ny: number,
): Pick<LinearGradientComponent, "x1" | "y1" | "x2" | "y2"> {
  const ox = nx - (c.x1 + c.x2) / 2;
  const oy = ny - (c.y1 + c.y2) / 2;
  return { x1: c.x1 + ox, y1: c.y1 + oy, x2: c.x2 + ox, y2: c.y2 + oy };
}

/** Radial handle positions on the component's own rotated axes: the two radius
 *  handles and the rotation grip just past the rx one. Same normalized-space
 *  rotation maskRender's coverage uses, so the handles sit on the drawn edge. */
export function radialHandles(
  c: RadialGradientComponent,
): Record<"rx" | "ry" | "rot", { x: number; y: number }> {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  return {
    rx: { x: c.cx + c.rx * cos, y: c.cy + c.rx * sin },
    ry: { x: c.cx - c.ry * sin, y: c.cy + c.ry * cos },
    rot: { x: c.cx + (c.rx + ROT_GAP) * cos, y: c.cy + (c.rx + ROT_GAP) * sin },
  };
}

/** Geometry patch for dragging one radial handle to (nx,ny). Radii project onto
 *  the rotated axes, so resizing after a rotation stays on-axis. */
export function radialPatch(
  c: RadialGradientComponent,
  handle: "rx" | "ry" | "rot",
  nx: number,
  ny: number,
): Partial<RadialGradientComponent> {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  if (handle === "rot") return { angle: Math.atan2(dy, dx) };
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const along = handle === "rx" ? dx * cos + dy * sin : -dx * sin + dy * cos;
  const r = Math.max(MIN_RADIUS, Math.abs(along));
  return handle === "rx" ? { rx: r } : { ry: r };
}

export function MaskOverlay({
  mask,
  componentIndex = 0,
  onChange,
}: {
  mask: Mask;
  /** Which component's geometry the handles edit (default the base). */
  componentIndex?: number;
  onChange: (mask: Mask) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Active drag: maps the current pointer (normalized) to an updated mask.
  const dragRef = useRef<((nx: number, ny: number) => Mask) | null>(null);
  const tintRef = useRef<HTMLCanvasElement>(null);
  const [modeIdx, setModeIdx] = useState(0); // Color Overlay by default, like LR
  const [tintIdx, setTintIdx] = useState(0);
  // Bumped when a develop render publishes a fresh frame, so range/AI coverage
  // repaints against the pixels it will actually blend over.
  const [frameRev, setFrameRev] = useState(0);
  useEffect(() => onOverlayFrame(() => setFrameRev((r) => r + 1)), []);

  // O / Shift+O — overlay mode / tint colour, ignored while typing (same guard
  // as DevelopView's Before/After keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "o" && e.key !== "O") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.shiftKey) setTintIdx((i) => (i + 1) % OVERLAY_TINTS.length);
      else setModeIdx((i) => (i + 1) % OVERLAY_MODES.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Paint the coverage tint whenever the mask, mode, colour or frame changes.
  const mode = OVERLAY_MODES[modeIdx];
  useEffect(() => {
    const cv = tintRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const f = getOverlayFrame();
    if (mode === "off" || !f) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    const scale = needsBaseImage([mask]) ? 1 : Math.min(1, TINT_CAP / Math.max(f.width, f.height));
    const w = Math.max(1, Math.round(f.width * scale));
    const h = Math.max(1, Math.round(f.height * scale));
    const cov = maskCoverage(mask, w, h, scale === 1 ? f.base : undefined);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    if (!cov) {
      ctx.clearRect(0, 0, w, h); // AI mask awaiting its Select Subject pass
      return;
    }
    ctx.putImageData(new ImageData(tintCoverage(cov, mode, OVERLAY_TINTS[tintIdx]), w, h), 0, 0);
  }, [mask, mode, tintIdx, frameRev]);

  useEffect(() => {
    const norm = (e: PointerEvent) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return null;
      return { nx: clamp01((e.clientX - r.left) / r.width), ny: clamp01((e.clientY - r.top) / r.height) };
    };
    const move = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const p = norm(e);
      if (p) onChange(dragRef.current(p.nx, p.ny));
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onChange]);

  const base = mask.components[componentIndex];
  if (!base) return null;

  // Replace the edited component with a geometry patch, keeping the rest.
  const patchBase = <T extends object>(patch: T): Mask => ({
    ...mask,
    components: mask.components.map((c, i) =>
      i === componentIndex ? ({ ...c, ...patch } as typeof c) : c,
    ),
  });

  const startDrag = (build: (nx: number, ny: number) => Mask) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = build;
  };

  const rh = base.kind === "radialGradient" ? radialHandles(base) : null;

  return (
    <div ref={rootRef} className="gal-mask-overlay">
      {/* Coverage tint sits under the geometry/handles; inline-styled because
          it is inert full-bleed like the wrapper itself. */}
      <canvas
        ref={tintRef}
        className="gal-mask-tint"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      <svg className="gal-mask-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {base.kind === "linearGradient" && (
          <>
            <line x1={base.x1} y1={base.y1} x2={base.x2} y2={base.y2} className="gal-mask-line" />
            {linearGuides(base).map((g, i) => (
              <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="gal-mask-line" />
            ))}
          </>
        )}
        {base.kind === "radialGradient" && (
          <ellipse
            cx={base.cx}
            cy={base.cy}
            rx={base.rx}
            ry={base.ry}
            transform={`rotate(${(base.angle * 180) / Math.PI} ${base.cx} ${base.cy})`}
            className="gal-mask-ellipse"
          />
        )}
      </svg>

      {base.kind === "linearGradient" && (
        <>
          <Handle nx={base.x1} ny={base.y1} onStart={startDrag((nx, ny) => patchBase({ x1: nx, y1: ny }))} />
          {/* Grip on the middle control line: translates the whole gradient. */}
          <Handle
            nx={clamp01((base.x1 + base.x2) / 2)}
            ny={clamp01((base.y1 + base.y2) / 2)}
            onStart={startDrag((nx, ny) => patchBase(linearTranslate(base, nx, ny)))}
          />
          <Handle nx={base.x2} ny={base.y2} onStart={startDrag((nx, ny) => patchBase({ x2: nx, y2: ny }))} />
        </>
      )}

      {base.kind === "radialGradient" && rh && (
        <>
          <Handle nx={base.cx} ny={base.cy} onStart={startDrag((nx, ny) => patchBase({ cx: nx, cy: ny }))} />
          <Handle
            nx={clamp01(rh.rx.x)}
            ny={clamp01(rh.rx.y)}
            onStart={startDrag((nx, ny) => patchBase(radialPatch(base, "rx", nx, ny)))}
          />
          <Handle
            nx={clamp01(rh.ry.x)}
            ny={clamp01(rh.ry.y)}
            onStart={startDrag((nx, ny) => patchBase(radialPatch(base, "ry", nx, ny)))}
          />
          {/* Rotation grip, outside the ellipse on its rx axis. */}
          <Handle
            nx={clamp01(rh.rot.x)}
            ny={clamp01(rh.rot.y)}
            onStart={startDrag((nx, ny) => patchBase(radialPatch(base, "rot", nx, ny)))}
          />
        </>
      )}
    </div>
  );
}

function Handle({
  nx,
  ny,
  onStart,
}: {
  nx: number;
  ny: number;
  onStart: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className="gal-mask-handle"
      style={{ left: `${nx * 100}%`, top: `${ny * 100}%` }}
      onPointerDown={onStart}
    />
  );
}
