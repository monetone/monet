// ─────────────────────────────────────────────────────────────
// io/svg-path — parse an SVG path "d" into PathGeometry subpaths
// ─────────────────────────────────────────────────────────────
// SVG cubic control points are ABSOLUTE; our Anchor stores RELATIVE in/out
// handle vectors, so each command updates the previous anchor's handleOut and
// the new anchor's handleIn. Arcs (A) are converted to cubic béziers. Returns
// one PathGeometry per subpath (split on M / m).

import type { Anchor, PathGeometry } from "../geometry/path";
import type { Point } from "../geometry/vec";

type Tok = string | number;

const tokenize = (d: string): Tok[] => {
  const out: Tok[] = [];
  let i = 0;
  const n = d.length;
  const isCmd = (c: string) => "MmLlHhVvCcSsQqTtAaZz".indexOf(c) >= 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  // Arc flags are the one place SVG's grammar is not "just numbers": large-arc
  // and sweep are SINGLE characters and may abut the next coordinate with no
  // separator ("a25 25 -30 0150 -25" ⇒ flags 0,1 then x=50). Tokenizing them
  // greedily reads "0150" as one number and the arc collapses to NaN, so the
  // tokenizer tracks which parameter slot of an arc it is in.
  let cmd = "";
  let arg = 0;
  while (i < n) {
    const c = d[i];
    if (c === " " || c === "," || c === "\n" || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (isCmd(c)) {
      out.push(c);
      cmd = c;
      arg = 0;
      i++;
      continue;
    }
    const arcSlot = cmd === "A" || cmd === "a" ? arg % 7 : -1;
    if ((arcSlot === 3 || arcSlot === 4) && (c === "0" || c === "1")) {
      out.push(c === "1" ? 1 : 0);
      i++;
      arg++;
      continue;
    }
    let j = i;
    if (d[j] === "+" || d[j] === "-") j++;
    while (j < n && isDigit(d[j])) j++;
    if (d[j] === ".") {
      j++;
      while (j < n && isDigit(d[j])) j++;
    }
    if (d[j] === "e" || d[j] === "E") {
      j++;
      if (d[j] === "+" || d[j] === "-") j++;
      while (j < n && isDigit(d[j])) j++;
    }
    if (j === i) {
      i++;
      continue;
    }
    out.push(parseFloat(d.slice(i, j)));
    i = j;
    arg++;
  }
  return out;
};

const anc = (point: Point, handleIn: Point = { x: 0, y: 0 }, handleOut: Point = { x: 0, y: 0 }): Anchor => ({
  point: { ...point },
  handleIn: { ...handleIn },
  handleOut: { ...handleOut },
});

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Endpoint-parameterized elliptical arc → array of cubic segments {c1,c2,end} (absolute). */
function arcToCubics(p0: Point, rx: number, ry: number, phiDeg: number, largeArc: number, sweep: number, p1: Point): { c1: Point; c2: Point; end: Point }[] {
  if (rx === 0 || ry === 0) return [{ c1: p0, c2: p1, end: p1 }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  // correct out-of-range radii
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  if (num < 0) num = 0;
  const co = sign * Math.sqrt(num / den);
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const out: { c1: Point; c2: Point; end: Point }[] = [];
  const delta = dTheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  let th = theta1;
  let cur = p0;
  for (let s = 0; s < segs; s++) {
    const th2 = th + delta;
    const cosT1 = Math.cos(th);
    const sinT1 = Math.sin(th);
    const cosT2 = Math.cos(th2);
    const sinT2 = Math.sin(th2);
    const e2 = {
      x: cx + cosP * rx * cosT2 - sinP * ry * sinT2,
      y: cy + sinP * rx * cosT2 + cosP * ry * sinT2,
    };
    const d1 = { x: -rx * cosP * sinT1 - ry * sinP * cosT1, y: -rx * sinP * sinT1 + ry * cosP * cosT1 };
    const d2 = { x: -rx * cosP * sinT2 - ry * sinP * cosT2, y: -rx * sinP * sinT2 + ry * cosP * cosT2 };
    out.push({
      c1: { x: cur.x + t * d1.x, y: cur.y + t * d1.y },
      c2: { x: e2.x - t * d2.x, y: e2.y - t * d2.y },
      end: e2,
    });
    cur = e2;
    th = th2;
  }
  return out;
}

export function parseSvgPathD(d: string): PathGeometry[] {
  const toks = tokenize(d);
  const subpaths: PathGeometry[] = [];
  let anchors: Anchor[] = [];
  let closed = false;
  let cp: Point = { x: 0, y: 0 }; // current point
  let sp: Point = { x: 0, y: 0 }; // subpath start
  let prevCubicC2: Point | null = null; // for S/s reflection
  let prevQuadC: Point | null = null; // for T/t reflection
  let i = 0;
  let cmd = "";

  const flush = () => {
    // If the path closed back onto its start anchor, merge the duplicate.
    if (closed && anchors.length > 1 && near(anchors[anchors.length - 1].point, anchors[0].point)) {
      anchors[0].handleIn = anchors[anchors.length - 1].handleIn;
      anchors.pop();
    }
    if (anchors.length >= 2) subpaths.push({ anchors, closed });
    anchors = [];
    closed = false;
  };

  const lineTo = (p: Point) => {
    anchors.push(anc(p));
    cp = { ...p };
    prevCubicC2 = null;
    prevQuadC = null;
  };
  const cubicTo = (c1: Point, c2: Point, end: Point) => {
    const last = anchors[anchors.length - 1];
    if (last) last.handleOut = { x: c1.x - last.point.x, y: c1.y - last.point.y };
    anchors.push(anc(end, { x: c2.x - end.x, y: c2.y - end.y }));
    cp = { ...end };
    prevCubicC2 = { ...c2 };
    prevQuadC = null;
  };

  const num = () => toks[i++] as number;
  const rel = (cmdLetter: string) => cmdLetter >= "a" && cmdLetter <= "z";

  while (i < toks.length) {
    // A command letter starts a new command; bare numbers repeat the current one.
    if (typeof toks[i] === "string") {
      cmd = toks[i] as string;
      i++;
    }
    const r = rel(cmd);
    switch (cmd) {
      case "M":
      case "m": {
        const x = num();
        const y = num();
        const p = r ? { x: cp.x + x, y: cp.y + y } : { x, y };
        flush();
        anchors.push(anc(p));
        cp = { ...p };
        sp = { ...p };
        prevCubicC2 = null;
        prevQuadC = null;
        cmd = r ? "l" : "L"; // subsequent coords are implicit linetos
        break;
      }
      case "L":
      case "l": {
        const x = num();
        const y = num();
        lineTo(r ? { x: cp.x + x, y: cp.y + y } : { x, y });
        break;
      }
      case "H":
      case "h": {
        const x = num();
        lineTo(r ? { x: cp.x + x, y: cp.y } : { x, y: cp.y });
        break;
      }
      case "V":
      case "v": {
        const y = num();
        lineTo(r ? { x: cp.x, y: cp.y + y } : { x: cp.x, y });
        break;
      }
      case "C":
      case "c": {
        const c1 = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        const c2 = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        const end = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        cubicTo(c1, c2, end);
        break;
      }
      case "S":
      case "s": {
        const ref = prevCubicC2 as Point | null;
        const c1 = ref ? { x: 2 * cp.x - ref.x, y: 2 * cp.y - ref.y } : { x: cp.x, y: cp.y };
        const c2 = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        const end = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        cubicTo(c1, c2, end);
        break;
      }
      case "Q":
      case "q": {
        const qc = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        const end = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        const c1 = { x: cp.x + (2 / 3) * (qc.x - cp.x), y: cp.y + (2 / 3) * (qc.y - cp.y) };
        const c2 = { x: end.x + (2 / 3) * (qc.x - end.x), y: end.y + (2 / 3) * (qc.y - end.y) };
        cubicTo(c1, c2, end);
        prevQuadC = { ...qc };
        prevCubicC2 = null;
        break;
      }
      case "T":
      case "t": {
        const ref = prevQuadC as Point | null;
        const qc = ref ? { x: 2 * cp.x - ref.x, y: 2 * cp.y - ref.y } : { x: cp.x, y: cp.y };
        const end = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        const c1 = { x: cp.x + (2 / 3) * (qc.x - cp.x), y: cp.y + (2 / 3) * (qc.y - cp.y) };
        const c2 = { x: end.x + (2 / 3) * (qc.x - end.x), y: end.y + (2 / 3) * (qc.y - end.y) };
        cubicTo(c1, c2, end);
        prevQuadC = { ...qc };
        prevCubicC2 = null;
        break;
      }
      case "A":
      case "a": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const end = r ? { x: cp.x + num(), y: cp.y + num() } : { x: num(), y: num() };
        for (const seg of arcToCubics(cp, rx, ry, rot, large, sweep, end)) cubicTo(seg.c1, seg.c2, seg.end);
        prevCubicC2 = null;
        prevQuadC = null;
        break;
      }
      case "Z":
      case "z": {
        closed = true;
        cp = { ...sp };
        flush();
        // a subsequent draw without moveto restarts at sp
        anchors = [];
        anchors.push(anc(sp));
        cp = { ...sp };
        prevCubicC2 = null;
        prevQuadC = null;
        break;
      }
      default:
        i++; // unknown token, skip
        break;
    }
  }
  flush(); // trailing subpath (flush ignores degenerate <2-anchor runs)
  return subpaths;
}
