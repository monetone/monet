// ─────────────────────────────────────────────────────────────
// Filter ▸ Adaptive Wide Angle — the constraint workspace.
//
// Photoshop's defining interaction: pick a correction model, then draw
// Constraints (a line that must become straight) and Polygon Constraints (a
// quad that must become a rectangle) over the image, and watch it warp to obey
// them. The geometry lives in state/adaptiveWideAngle.ts; this file is the
// canvas, the tools and the controls, and hands the final mesh to the engine.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Button, Slider, NumberField, Checkbox, Select } from "@monet-ui/monet-react";
import { engine, adaptiveWideAngle } from "../state/app";
import {
  ADAPTIVE_WIDE_DEFAULTS, ADAPTIVE_WIDE_MODELS, ADAPTIVE_WIDE_MODEL_LABELS,
  adaptiveWideGrid, adaptiveWideTransform, isAdaptiveWideIdentity, sanitizeAdaptiveWide,
  type AdaptiveWideConstraint, type AdaptiveWideModel,
} from "../state/adaptiveWideAngle";

/** Preview mesh density. Fine enough that the per-cell affine reads as a smooth
 *  warp, coarse enough to redraw on every slider tick.
 *  ponytail: one affine per cell (not two triangles) — bump to triangles if the
 *  cell seams ever show on a stronger correction. */
const PREVIEW_GRID = 18;
const PREVIEW_MAX_W = 620;
const PREVIEW_MAX_H = 440;

type Pt = [number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The composited document, downscaled once so the mesh preview stays cheap. */
function usePreviewSource() {
  return useMemo(() => {
    const px = engine.outputCopy();
    const w = engine.width;
    const h = engine.height;
    if (!px || !w || !h) return null;
    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    full.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    const k = Math.min(1, PREVIEW_MAX_W / w, PREVIEW_MAX_H / h);
    const pw = Math.max(1, Math.round(w * k));
    const ph = Math.max(1, Math.round(h * k));
    const small = document.createElement("canvas");
    small.width = pw;
    small.height = ph;
    small.getContext("2d")?.drawImage(full, 0, 0, pw, ph);
    return { canvas: small, w: pw, h: ph };
  }, []);
}

export function AdaptiveWideAngle({ onClose }: { onClose: () => void }) {
  const [model, setModel] = useState<AdaptiveWideModel>(ADAPTIVE_WIDE_DEFAULTS.model);
  const [focalLength, setFocalLength] = useState(ADAPTIVE_WIDE_DEFAULTS.focalLength);
  const [cropFactor, setCropFactor] = useState(ADAPTIVE_WIDE_DEFAULTS.cropFactor);
  const [scalePct, setScalePct] = useState(100);
  const [constraints, setConstraints] = useState<AdaptiveWideConstraint[]>([]);
  const [tool, setTool] = useState<"line" | "polygon">("line");
  const [showGrid, setShowGrid] = useState(true);
  // Points of the constraint being placed, in normalized source coords.
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const src = usePreviewSource();

  const opts = useMemo(
    () => sanitizeAdaptiveWide({ model, focalLength, cropFactor, scale: scalePct / 100, constraints }),
    [model, focalLength, cropFactor, scalePct, constraints],
  );
  // Constraints are declared on the *source* image but drawn on the corrected
  // preview, so both directions of the transform are needed.
  const xf = useMemo(() => adaptiveWideTransform(opts, src?.w ?? 1, src?.h ?? 1), [opts, src]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx || !src) return;
    const { w: pw, h: ph } = src;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);

    // 1. The image, pushed through the correction mesh cell by cell.
    const { dstX, dstY } = adaptiveWideGrid(opts, PREVIEW_GRID, PREVIEW_GRID, pw, ph);
    const at = (i: number, j: number): Pt => {
      const k = j * (PREVIEW_GRID + 1) + i;
      return [dstX[k], dstY[k]];
    };
    const cw = pw / PREVIEW_GRID;
    const ch = ph / PREVIEW_GRID;
    for (let j = 0; j < PREVIEW_GRID; j++) {
      for (let i = 0; i < PREVIEW_GRID; i++) {
        const tl = at(i, j);
        const tr = at(i + 1, j);
        const br = at(i + 1, j + 1);
        const bl = at(i, j + 1);
        const sx = i * cw;
        const sy = j * ch;
        const a = (tr[0] - tl[0]) / cw;
        const b = (tr[1] - tl[1]) / cw;
        const c = (bl[0] - tl[0]) / ch;
        const d = (bl[1] - tl[1]) / ch;
        if (!Number.isFinite(a * b * c * d) || a * d - b * c === 0) continue; // collapsed cell
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tl[0], tl[1]);
        ctx.lineTo(tr[0], tr[1]);
        ctx.lineTo(br[0], br[1]);
        ctx.lineTo(bl[0], bl[1]);
        ctx.closePath();
        ctx.clip();
        ctx.transform(a, b, c, d, tl[0] - a * sx - c * sy, tl[1] - b * sx - d * sy);
        ctx.drawImage(src.canvas, 0, 0);
        ctx.restore();
      }
    }

    // 2. The alignment grid — straight, so a correct correction lines up with it.
    if (showGrid) {
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 8; i++) {
        ctx.moveTo(Math.round((i * pw) / 8) + 0.5, 0);
        ctx.lineTo(Math.round((i * pw) / 8) + 0.5, ph);
        ctx.moveTo(0, Math.round((i * ph) / 8) + 0.5);
        ctx.lineTo(pw, Math.round((i * ph) / 8) + 0.5);
      }
      ctx.stroke();
    }

    // 3. The constraints themselves, carried through the same warp.
    const toView = ([nx, ny]: Pt): Pt => xf.forward(nx * pw, ny * ph);
    const stroke = (pts: Pt[], closed: boolean, color: string) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (closed) ctx.closePath();
      ctx.stroke();
    };
    const dots = (pts: Pt[], color: string) => {
      ctx.fillStyle = color;
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const c of constraints) {
      const pts = c.pts.map(toView);
      stroke(pts, c.kind === "polygon", c.kind === "polygon" ? "#ffd166" : "#6cb2ff");
      dots(pts, "#ffffff");
    }
    if (draft.length) {
      const pts = draft.map(toView);
      const live = hover ? [...pts, toView(hover)] : pts;
      ctx.setLineDash([4, 3]);
      stroke(live, false, tool === "polygon" ? "#ffd166" : "#6cb2ff");
      ctx.setLineDash([]);
      dots(pts, "#ffffff");
    }
  }, [opts, src, xf, showGrid, constraints, draft, hover, tool]);

  if (!src) {
    return (
      <Dialog open onClose={onClose} title="Adaptive Wide Angle" width={380}
        footer={<Button variant="primary" onClick={onClose}>OK</Button>}>
        <div className="lbl">No image to correct.</div>
      </Dialog>
    );
  }

  /** Pointer position → normalized coords in the *source* image. */
  const toSource = (ev: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = ev.currentTarget.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / (r.width || 1)) * src.w;
    const vy = ((ev.clientY - r.top) / (r.height || 1)) * src.h;
    const [sx, sy] = xf.inverse(vx, vy);
    return [clamp01(sx / src.w), clamp01(sy / src.h)];
  };

  // ponytail: constraints are click-to-place (2 clicks for a line, 4 for a
  // polygon) rather than click-drag — one code path, and it keeps the in-flight
  // point list the single source of truth. Add drag if it ever feels slow.
  const place = (p: Pt) => {
    const need = tool === "polygon" ? 4 : 2;
    const next = [...draft, p];
    if (next.length < need) {
      setDraft(next);
      return;
    }
    setDraft([]);
    setConstraints((cur) => [...cur, { kind: tool === "polygon" ? "polygon" : "line", pts: next }]);
  };

  const removeAt = (i: number) => setConstraints((cur) => cur.filter((_, j) => j !== i));

  const applyWarp = () => {
    adaptiveWideAngle(opts);
    onClose();
  };

  const toolBtn = (id: "line" | "polygon", label: string, hint: string) => (
    <Button size="sm" variant={tool === id ? "primary" : "ghost"} aria-pressed={tool === id} title={hint}
      onClick={() => { setTool(id); setDraft([]); }}>{label}</Button>
  );
  const row = (label: string, node: React.ReactNode) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
      <span className="lbl" style={{ width: 96 }}>{label}</span>
      {node}
    </div>
  );

  return (
    <Dialog open onClose={onClose} title="Adaptive Wide Angle" width={Math.min(980, src.w + 320)}
      footer={<>
        <Button variant="ghost" onClick={() => { setConstraints([]); setDraft([]); }} disabled={!constraints.length && !draft.length}>Remove All Constraints</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={applyWarp} disabled={isAdaptiveWideIdentity(opts)}>OK</Button>
      </>}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="monet-row" role="toolbar" aria-label="Adaptive Wide Angle tools" style={{ gap: 6 }}>
            {toolBtn("line", "Constraint", "Click two points on a line that should be straight")}
            {toolBtn("polygon", "Polygon Constraint", "Click four corners of a shape that should be rectangular")}
          </div>
          <canvas
            ref={canvasRef}
            width={src.w}
            height={src.h}
            role="img"
            aria-label={`Adaptive Wide Angle preview with ${constraints.length} constraint${constraints.length === 1 ? "" : "s"}`}
            style={{ width: src.w, height: src.h, maxWidth: "100%", background: "var(--bg-2)", borderRadius: 6, cursor: "crosshair", touchAction: "none" }}
            onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); place(toSource(ev)); }}
            onPointerMove={(ev) => setHover(draft.length ? toSource(ev) : null)}
            onPointerLeave={() => setHover(null)}
          />
        </div>
        <div style={{ width: 280, flex: "0 0 auto" }}>
          {row("Correction", (
            <Select value={model} onChange={(v) => setModel(v as AdaptiveWideModel)}
              options={ADAPTIVE_WIDE_MODELS.map((m) => ({ value: m, label: ADAPTIVE_WIDE_MODEL_LABELS[m] }))} />
          ))}
          {row("Scale", <NumberField value={scalePct} min={20} max={500} onChange={setScalePct} suffix="%" />)}
          {row("Focal Length", <NumberField value={focalLength} min={1} max={400} onChange={setFocalLength} suffix="mm" />)}
          {row("Crop Factor", <Slider min={0.1} max={4} step={0.05} value={cropFactor} onChange={setCropFactor} />)}
          <div className="monet-row" style={{ gap: 10, marginBottom: 12, justifyContent: "space-between" }}>
            <Checkbox checked={showGrid} onChange={setShowGrid}>Show Alignment Grid</Checkbox>
            <span className="lbl" style={{ color: "var(--text-3)", fontSize: 11 }}>{cropFactor.toFixed(2)}×</span>
          </div>
          <div className="lbl" style={{ marginBottom: 6 }}>Constraints</div>
          {constraints.length === 0
            ? <div style={{ color: "var(--text-3)", fontSize: 11 }}>Click along a line that should be straight, or four corners that should form a rectangle.</div>
            : constraints.map((c, i) => (
              <div key={i} className="monet-row" style={{ gap: 8, marginBottom: 4, alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--text-2)" }}>{c.kind === "polygon" ? "Polygon" : "Line"} {i + 1}</span>
                <Button size="sm" variant="ghost" aria-label={`Remove constraint ${i + 1}`} onClick={() => removeAt(i)}>Remove</Button>
              </div>
            ))}
        </div>
      </div>
    </Dialog>
  );
}
