// CropOverlay — on-canvas crop rectangle + straighten control for the Develop
// Crop tool. Sits over the full (uncropped) render while cropping is active; drag
// the four corner handles to set recipe.crop.rect (normalized 0..1), and use the
// straighten slider for the angle. Works in the same normalized space applyCrop
// uses, so the handles line up with the eventual crop.

import { Button, isEditableTarget, Select, Slider } from "@monet-ui/monet-react";
import { useEffect, useRef, useState } from "react";

import type { CropPanel } from "@monet-ui/monet-photo";

import { CROP_GUIDE_LABELS, cropGuideLines, cropGuideSpiral, nextCropGuide, SPIRAL_ORIENTATIONS, type CropGuide } from "../lib/cropGuides";
import { aspectCropRect, constrainRectToAspect, CROP_ASPECTS } from "../lib/cropAspect";
import { straightenAngle } from "../lib/straighten";

interface Ruler {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const MIN = 0.05; // keep the rect from collapsing / corners from crossing

export function CropOverlay({
  crop,
  onChange,
  onDone,
  aspect,
}: {
  crop: CropPanel;
  onChange: (crop: CropPanel) => void;
  onDone: () => void;
  /** The overlay's on-screen width/height (= the shown image aspect). Drives the
   *  true-angle guides (Diagonal, Triangle); the fractional guides ignore it. */
  aspect: number | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<((nx: number, ny: number) => CropPanel) | null>(null);
  // Compositional overlay drawn inside the crop rect; `O` cycles it and `⇧O`
  // cycles the Golden Spiral's orientation (Lightroom).
  const [guide, setGuide] = useState<CropGuide>("thirds");
  const [spiralOrient, setSpiralOrient] = useState(0);
  // Straighten tool: while armed, dragging a line along a horizon/wall sets the
  // crop angle to level it (Lightroom's ruler).
  const [straightenMode, setStraightenMode] = useState(false);
  const [ruler, setRuler] = useState<Ruler | null>(null);
  // Locked aspect ratio (Lightroom's crop lock): "" = free. Corner drags keep it.
  const [aspectLabel, setAspectLabel] = useState("");
  const lockedRatio = CROP_ASPECTS.find((a) => a.label === aspectLabel)?.ratio;
  const lockedNa = lockedRatio != null && aspect ? lockedRatio / aspect : null;

  // Normalized (0..1) pointer position within an inset-0 element.
  const rulerNorm = (e: React.PointerEvent<HTMLDivElement>): { nx: number; ny: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      nx: clamp01((e.clientX - r.left) / (r.width || 1)),
      ny: clamp01((e.clientY - r.top) / (r.height || 1)),
    };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "o" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) setSpiralOrient((o) => (o + 1) % SPIRAL_ORIENTATIONS);
      else setGuide((g) => nextCropGuide(g));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const r = crop.rect;
  const start = (build: (nx: number, ny: number) => CropPanel) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = build;
  };
  // Corner builders. Free drag clamps each corner against the opposite edge so
  // corners never cross; a locked aspect anchors the diagonally-opposite corner
  // and constrains the rect to the ratio.
  const locked = (fx: number, fy: number) => (nx: number, ny: number): CropPanel =>
    ({ ...crop, rect: constrainRectToAspect(fx, fy, clamp01(nx), clamp01(ny), lockedNa as number) });
  const tl = lockedNa != null
    ? locked(r.right, r.bottom)
    : (nx: number, ny: number): CropPanel => ({ ...crop, rect: { ...r, left: Math.min(nx, r.right - MIN), top: Math.min(ny, r.bottom - MIN) } });
  const tr = lockedNa != null
    ? locked(r.left, r.bottom)
    : (nx: number, ny: number): CropPanel => ({ ...crop, rect: { ...r, right: Math.max(nx, r.left + MIN), top: Math.min(ny, r.bottom - MIN) } });
  const bl = lockedNa != null
    ? locked(r.right, r.top)
    : (nx: number, ny: number): CropPanel => ({ ...crop, rect: { ...r, left: Math.min(nx, r.right - MIN), bottom: Math.max(ny, r.top + MIN) } });
  const br = lockedNa != null
    ? locked(r.left, r.top)
    : (nx: number, ny: number): CropPanel => ({ ...crop, rect: { ...r, right: Math.max(nx, r.left + MIN), bottom: Math.max(ny, r.top + MIN) } });

  const pct = (v: number): string => `${v * 100}%`;

  return (
    <div ref={rootRef} className="gal-crop-overlay">
      <svg className="gal-crop-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        <rect
          x={r.left}
          y={r.top}
          width={Math.max(0, r.right - r.left)}
          height={Math.max(0, r.bottom - r.top)}
          className="gal-crop-rect"
        />
        {cropGuideLines(guide, r, aspect ?? 1).map((ln, i) => (
          <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} className="gal-crop-guide" />
        ))}
        {guide === "goldenSpiral" && (
          <polyline
            className="gal-crop-guide"
            points={cropGuideSpiral(r, spiralOrient)
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
          />
        )}
        {ruler && (
          <line x1={ruler.x1} y1={ruler.y1} x2={ruler.x2} y2={ruler.y2} className="gal-crop-ruler" />
        )}
      </svg>
      <Handle nx={r.left} ny={r.top} onStart={start(tl)} />
      <Handle nx={r.right} ny={r.top} onStart={start(tr)} />
      <Handle nx={r.left} ny={r.bottom} onStart={start(bl)} />
      <Handle nx={r.right} ny={r.bottom} onStart={start(br)} />
      {straightenMode && (
        <div
          className="gal-crop-ruler-capture"
          onPointerDown={(e) => {
            e.preventDefault();
            const { nx, ny } = rulerNorm(e);
            setRuler({ x1: nx, y1: ny, x2: nx, y2: ny });
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!ruler) return;
            const { nx, ny } = rulerNorm(e);
            setRuler((cur) => (cur ? { ...cur, x2: nx, y2: ny } : cur));
          }}
          onPointerUp={() => {
            if (ruler) {
              const len = Math.hypot((ruler.x2 - ruler.x1) * (aspect ?? 1), ruler.y2 - ruler.y1);
              if (len > 0.02) {
                onChange({ ...crop, angle: straightenAngle(ruler.x1, ruler.y1, ruler.x2, ruler.y2, aspect ?? 1) });
              }
            }
            setRuler(null);
            setStraightenMode(false);
          }}
        />
      )}

      <div className="gal-crop-bar" style={{ left: pct(r.left), top: pct(r.bottom) }}>
        <label className="gal-crop-straighten" title="Straighten" onDoubleClick={() => onChange({ ...crop, angle: 0 })}>
          <span>Straighten</span>
          <Slider
            aria-label="Straighten"
            min={-45}
            max={45}
            step={0.1}
            value={crop.angle}
            accent="var(--accent-raster)"
            onChange={(v) => onChange({ ...crop, angle: v })}
          />
          <span className="gal-crop-val">{crop.angle.toFixed(1)}°</span>
        </label>
        <button
          type="button"
          className={"gal-crop-guide-btn" + (straightenMode ? " is-active" : "")}
          title="Straighten tool — drag a line along a horizon or wall to level it"
          onClick={() => setStraightenMode((v) => !v)}
        >
          ⤢ Level
        </button>
        <Select
          size="sm"
          aria-label="Crop aspect ratio"
          title="Lock the crop to an aspect ratio"
          value={aspectLabel}
          options={[{ value: "", label: "Free" }, ...CROP_ASPECTS.map((a) => ({ value: a.label }))]}
          onChange={(v) => {
            setAspectLabel(v); // "" = free; else lock the ratio (corner drags keep it)
            const preset = CROP_ASPECTS.find((a) => a.label === v);
            if (preset) onChange({ ...crop, rect: aspectCropRect(preset.ratio, aspect ?? 1) });
          }}
        />
        <button
          type="button"
          className="gal-crop-guide-btn"
          title="Cycle crop overlay (O) — ⇧O rotates the Golden Spiral"
          onClick={() => setGuide((g) => nextCropGuide(g))}
        >
          {CROP_GUIDE_LABELS[guide]}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...crop, rect: { top: 0, left: 0, bottom: 1, right: 1 }, angle: 0 })}
        >
          Reset
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Handle({ nx, ny, onStart }: { nx: number; ny: number; onStart: (e: React.PointerEvent) => void }) {
  return (
    <div
      className="gal-crop-handle"
      style={{ left: `${nx * 100}%`, top: `${ny * 100}%` }}
      onPointerDown={onStart}
    />
  );
}
