// ─────────────────────────────────────────────────────────────
// Filter ▸ Adaptive Wide Angle — pure geometry for the constraint-driven
// wide-angle correction. Engine-free so it unit-tests in node; the workspace
// feeds the grid to the engine's mesh_warp, the same destination-grid
// convention warpMesh.ts uses.
//
// Two stages. A projection model (Fisheye / Perspective / Full Spherical, or
// Auto picking one) undoes the lens' barrel or panoramic mapping; then the
// constraints the user drew say which lines must end up straight — a polygon
// constraint rectifies its quad (homography), a line constraint snaps to the
// nearest axis (rotation). Scale re-frames whatever the warp pushed out.
//
//   https://helpx.adobe.com/photoshop/using/adaptive-wide-angle-filter.html
// ─────────────────────────────────────────────────────────────

export const ADAPTIVE_WIDE_MODELS = ["fisheye", "perspective", "auto", "spherical"] as const;
export type AdaptiveWideModel = (typeof ADAPTIVE_WIDE_MODELS)[number];
/** Auto resolves to one of these before any geometry runs. */
export type AdaptiveWideProjection = Exclude<AdaptiveWideModel, "auto">;

export const ADAPTIVE_WIDE_MODEL_LABELS: Record<AdaptiveWideModel, string> = {
  fisheye: "Fisheye",
  perspective: "Perspective",
  auto: "Auto",
  spherical: "Full Spherical",
};

export interface AdaptiveWideConstraint {
  /** `line` = 2 points that must become straight and axis-aligned.
   *  `polygon` = 4 points, in draw order, that must become a rectangle. */
  kind: "line" | "polygon";
  /** Normalized 0..1 image coordinates, so a constraint drawn on the scaled
   *  preview still means the same thing at full document resolution. */
  pts: [number, number][];
}

export interface AdaptiveWideOptions {
  model: AdaptiveWideModel;
  /** Focal length in mm, as engraved on the lens. */
  focalLength: number;
  /** Sensor crop factor (1 = full frame). */
  cropFactor: number;
  /** Re-framing zoom applied after the correction; 1 = leave as corrected. */
  scale: number;
  constraints: AdaptiveWideConstraint[];
}

export const ADAPTIVE_WIDE_DEFAULTS: AdaptiveWideOptions = {
  model: "auto",
  focalLength: 16,
  cropFactor: 1,
  scale: 1,
  constraints: [],
};

/** Half-diagonal of the 36×24mm 35mm frame — turns a 35mm-equivalent focal
 *  length into the half-diagonal field of view. */
const FRAME_HALF_DIAG_MM = 21.633;
/** ~83°. Past this tan() runs away and the corners fly off the canvas. */
const MAX_THETA = 1.45;
/** 35mm-equivalent focal below which Auto assumes a barrelling wide/fisheye. */
const AUTO_FISHEYE_MM = 24;

type Pt = [number, number];

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function cleanConstraint(c: AdaptiveWideConstraint | undefined): AdaptiveWideConstraint[] {
  const kind = c?.kind === "polygon" ? "polygon" : "line";
  const need = kind === "polygon" ? 4 : 2;
  const pts = Array.isArray(c?.pts) ? c.pts.slice(0, need) : [];
  if (pts.length < need) return []; // half-drawn constraint: drop it rather than guess
  return [{ kind, pts: pts.map((p) => [clampNum(p?.[0], 0, 1, 0), clampNum(p?.[1], 0, 1, 0)] as Pt) }];
}

/** Clamp/normalize whatever the UI (or a replayed action) hands us. A NaN here
 *  would reach wasm as a NaN mesh vertex and silently shred the layer, so this
 *  is the one place the values are made safe. */
export function sanitizeAdaptiveWide(opts: Partial<AdaptiveWideOptions> | undefined): AdaptiveWideOptions {
  const o = opts ?? {};
  return {
    model: ADAPTIVE_WIDE_MODELS.includes(o.model as AdaptiveWideModel) ? (o.model as AdaptiveWideModel) : ADAPTIVE_WIDE_DEFAULTS.model,
    focalLength: clampNum(o.focalLength, 1, 400, ADAPTIVE_WIDE_DEFAULTS.focalLength),
    cropFactor: clampNum(o.cropFactor, 0.1, 10, ADAPTIVE_WIDE_DEFAULTS.cropFactor),
    scale: clampNum(o.scale, 0.2, 5, ADAPTIVE_WIDE_DEFAULTS.scale),
    constraints: (Array.isArray(o.constraints) ? o.constraints : []).flatMap(cleanConstraint),
  };
}

/** Which projection Auto lands on. Auto has no lens EXIF to read here, so it
 *  goes by the 35mm-equivalent focal length the user dialled in.
 *  ponytail: metadata-free heuristic — read the EXIF lens model once documents
 *  carry it, so Auto can tell a real fisheye from a wide rectilinear. */
export function resolveAdaptiveWideModel(opts: Partial<AdaptiveWideOptions> | undefined): AdaptiveWideProjection {
  const o = sanitizeAdaptiveWide(opts);
  if (o.model !== "auto") return o.model;
  return o.focalLength * o.cropFactor < AUTO_FISHEYE_MM ? "fisheye" : "perspective";
}

interface Lens {
  /** Rectilinear focal length in pixels (the corrected projection). */
  fRect: number;
  /** Equidistant focal length in pixels (arc length per pixel of the source). */
  fArc: number;
}

/** Source offset from centre → corrected offset, before normalization. */
function projectRaw(dx: number, dy: number, l: Lens, p: AdaptiveWideProjection): Pt {
  if (p === "perspective") return [dx, dy]; // rectilinear already; constraints do the work
  if (p === "fisheye") {
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return [0, 0];
    const theta = Math.min(r / l.fArc, MAX_THETA);
    const k = (l.fRect * Math.tan(theta)) / r;
    return [dx * k, dy * k];
  }
  // Full Spherical: the frame is equirectangular — x is longitude, y latitude —
  // re-projected gnomonically onto the flat rectilinear plane.
  const lon = Math.max(-MAX_THETA, Math.min(MAX_THETA, dx / l.fArc));
  const lat = Math.max(-MAX_THETA, Math.min(MAX_THETA, dy / l.fArc));
  return [l.fRect * Math.tan(lon), (l.fRect * Math.tan(lat)) / Math.cos(lon)];
}

/** Inverse of projectRaw — closed form for every model, so hit-testing a
 *  pointer on the warped preview is exact rather than a mesh search. */
function unprojectRaw(dx: number, dy: number, l: Lens, p: AdaptiveWideProjection): Pt {
  if (p === "perspective") return [dx, dy];
  if (p === "fisheye") {
    const rd = Math.hypot(dx, dy);
    if (rd < 1e-6) return [0, 0];
    const r = l.fArc * Math.atan(rd / l.fRect);
    return [(dx * r) / rd, (dy * r) / rd];
  }
  const lon = Math.atan(dx / l.fRect);
  const lat = Math.atan((dy * Math.cos(lon)) / l.fRect);
  return [l.fArc * lon, l.fArc * lat];
}

/** Solve the 3×3 homography taking the four `src` points to the four `dst`
 *  points (h8 pinned to 1). Null when the quad is degenerate. */
export function solveHomography(src: Pt[], dst: Pt[]): number[] | null {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    m.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    m.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-9) return null; // degenerate quad — skip the rectify
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= 8; k++) m[r][k] -= f * m[c][k];
    }
  }
  const h = m.map((row, i) => row[8] / m[i][i]);
  h.push(1);
  return h.every((n) => Number.isFinite(n)) ? h : null;
}

export function applyH(h: number[], [x, y]: Pt): Pt {
  const d = h[6] * x + h[7] * y + h[8];
  if (Math.abs(d) < 1e-9) return [x, y];
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

/** The axis-aligned rectangle a polygon constraint is asking for: the quad's
 *  own bounding box, each corner keeping the side of centre it was drawn on. */
function targetRect(q: Pt[]): Pt[] {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return q.map(([x, y]) => [x < cx ? minX : maxX, y < cy ? minY : maxY] as Pt);
}

const POLYGON_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];

/** The corrected transform for a document of `w`×`h`, both directions.
 *  `forward` takes a source pixel to where it lands; `inverse` undoes it. */
export function adaptiveWideTransform(
  opts: Partial<AdaptiveWideOptions> | undefined,
  w: number,
  h: number,
): { forward: (x: number, y: number) => Pt; inverse: (x: number, y: number) => Pt } {
  const o = sanitizeAdaptiveWide(opts);
  const projection = resolveAdaptiveWideModel(o);
  const halfDiag = Math.hypot(w, h) / 2 || 1;
  const halfFov = Math.atan(FRAME_HALF_DIAG_MM / (o.focalLength * o.cropFactor));
  const l: Lens = { fRect: halfDiag / Math.tan(halfFov), fArc: halfDiag / halfFov };
  const cx = w / 2;
  const cy = h / 2;
  // Keep the frame's half-diagonal fixed so the correction redistributes pixels
  // instead of blowing the image up; Scale is the user's knob for the framing.
  const cornerR = Math.hypot(...projectRaw(cx, cy, l, projection));
  const norm = halfDiag / (cornerR || halfDiag);

  const project = ([nx, ny]: Pt): Pt => {
    const [px, py] = projectRaw(nx * w - cx, ny * h - cy, l, projection);
    return [px * norm, py * norm];
  };

  // Rectify the first polygon constraint, then measure how far the line
  // constraints still are from their nearest axis.
  // ponytail: one global homography from the first polygon; Photoshop blends a
  // local mesh per constraint — upgrade when multi-plane shots need it.
  const poly = o.constraints.find((c) => c.kind === "polygon");
  const polySrc = poly ? poly.pts.map(project) : null;
  const polyDst = polySrc ? targetRect(polySrc) : null;
  const hom = polySrc && polyDst ? solveHomography(polySrc, polyDst) : null;
  const homInv = hom && polySrc && polyDst ? solveHomography(polyDst, polySrc) : null;

  let weight = 0;
  let turn = 0;
  for (const c of o.constraints) {
    const pts = c.pts.map((p) => (hom ? applyH(hom, project(p)) : project(p)));
    for (const [a, b] of c.kind === "polygon" ? POLYGON_EDGES : [[0, 1] as [number, number]]) {
      const dx = pts[b][0] - pts[a][0];
      const dy = pts[b][1] - pts[a][1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ang = Math.atan2(dy, dx);
      const snapped = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      weight += len;
      turn += len * (snapped - ang);
    }
  }
  const angle = weight > 0 ? turn / weight : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const s = o.scale;

  return {
    forward: (x, y) => {
      const [rx, ry] = projectRaw(x - cx, y - cy, l, projection);
      let px = rx * norm;
      let py = ry * norm;
      if (hom) [px, py] = applyH(hom, [px, py]);
      return [cx + (px * cos - py * sin) * s, cy + (px * sin + py * cos) * s];
    },
    inverse: (x, y) => {
      const ux = (x - cx) / s;
      const uy = (y - cy) / s;
      let px = ux * cos + uy * sin;
      let py = -ux * sin + uy * cos;
      if (homInv) [px, py] = applyH(homInv, [px, py]);
      const [sx, sy] = unprojectRaw(px / norm, py / norm, l, projection);
      return [sx + cx, sy + cy];
    },
  };
}

/** Sample the correction over a (gw+1)×(gh+1) control grid. `dst[idx]` is where
 *  the regular grid vertex (i*w/gw, j*h/gh) lands — the destination-grid
 *  convention engine.mesh_warp expects. */
export function adaptiveWideGrid(
  opts: Partial<AdaptiveWideOptions> | undefined,
  gw: number,
  gh: number,
  w: number,
  h: number,
): { dstX: Float32Array; dstY: Float32Array } {
  const { forward } = adaptiveWideTransform(opts, w, h);
  const n = (gw + 1) * (gh + 1);
  const dstX = new Float32Array(n);
  const dstY = new Float32Array(n);
  for (let j = 0; j <= gh; j++) {
    for (let i = 0; i <= gw; i++) {
      const [x, y] = forward((i * w) / gw, (j * h) / gh);
      const idx = j * (gw + 1) + i;
      dstX[idx] = x;
      dstY[idx] = y;
    }
  }
  return { dstX, dstY };
}

/** True when applying would be a no-op — the workspace disables OK so an empty
 *  warp never costs an undo step. */
export function isAdaptiveWideIdentity(opts: Partial<AdaptiveWideOptions> | undefined): boolean {
  const o = sanitizeAdaptiveWide(opts);
  return resolveAdaptiveWideModel(o) === "perspective" && o.scale === 1 && o.constraints.length === 0;
}
