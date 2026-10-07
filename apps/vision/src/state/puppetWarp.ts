// Edit ▸ Puppet Warp session. Pins live here; the engine mesh is applied once
// on commit. This module does not import app.ts (that module imports this one).

export const PUPPET_GW = 4;
export const PUPPET_GH = 4;

export type PuppetPin = { v: number; x: number; y: number };

type Session = {
  docW: number;
  docH: number;
  pins: PuppetPin[];
  /** Vertex index currently following the pointer. */
  drag: number | null;
};

let session: Session | null = null;
let rev = 0;
const listeners = new Set<() => void>();

function bump() {
  rev += 1;
  for (const listener of listeners) listener();
}

export function subscribePuppet(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Revision counter. useSyncExternalStore snapshots this, then reads the session. */
export function getPuppetRev(): number {
  return rev;
}

export function getPuppetSession(): Session | null {
  return session;
}

export function vertexCount(gw = PUPPET_GW, gh = PUPPET_GH): number {
  return (gw + 1) * (gh + 1);
}

/** Rest position of vertex `v` on a `docW`×`docH` canvas. */
export function vertexRest(v: number, docW: number, docH: number, gw = PUPPET_GW, gh = PUPPET_GH): { x: number; y: number } {
  const cols = gw + 1;
  const i = v % cols;
  const j = Math.floor(v / cols);
  return { x: (i * docW) / gw, y: (j * docH) / gh };
}

export function nearestVertex(x: number, y: number, docW: number, docH: number, gw = PUPPET_GW, gh = PUPPET_GH): number {
  const n = vertexCount(gw, gh);
  let best = 0;
  let bestD = Infinity;
  for (let v = 0; v < n; v++) {
    const rest = vertexRest(v, docW, docH, gw, gh);
    const d = (rest.x - x) ** 2 + (rest.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/**
 * Where each mesh vertex lands. A pin goes exactly to its point. Every other
 * vertex takes the inverse-distance-weighted average of the pin displacements
 * (weight 1/(dist²+ε) from that vertex's rest to the pin's rest). No pins is
 * the identity mesh.
 */
export function puppetDestinations(
  docW: number,
  docH: number,
  pins: readonly PuppetPin[],
  gw = PUPPET_GW,
  gh = PUPPET_GH,
): { dx: Float32Array; dy: Float32Array } {
  const n = vertexCount(gw, gh);
  const dx = new Float32Array(n);
  const dy = new Float32Array(n);
  const rests = Array.from({ length: n }, (_, v) => vertexRest(v, docW, docH, gw, gh));
  for (let v = 0; v < n; v++) {
    dx[v] = rests[v].x;
    dy[v] = rests[v].y;
  }
  if (pins.length === 0) return { dx, dy };
  const pinned = new Map(pins.map((pin) => [pin.v, pin]));
  const eps = 1e-3;
  for (let v = 0; v < n; v++) {
    const pin = pinned.get(v);
    if (pin) {
      dx[v] = pin.x;
      dy[v] = pin.y;
      continue;
    }
    let wx = 0;
    let wy = 0;
    let wsum = 0;
    const here = rests[v];
    for (const other of pins) {
      const rest = rests[other.v] ?? vertexRest(other.v, docW, docH, gw, gh);
      const dist2 = (here.x - rest.x) ** 2 + (here.y - rest.y) ** 2;
      const w = 1 / (dist2 + eps);
      wx += w * (other.x - rest.x);
      wy += w * (other.y - rest.y);
      wsum += w;
    }
    if (wsum > 0) {
      dx[v] = here.x + wx / wsum;
      dy[v] = here.y + wy / wsum;
    }
  }
  return { dx, dy };
}

/** True when some pin has left its rest position by more than half a pixel. */
export function pinsMoved(docW: number, docH: number, pins: readonly PuppetPin[], gw = PUPPET_GW, gh = PUPPET_GH): boolean {
  return pins.some((pin) => {
    const rest = vertexRest(pin.v, docW, docH, gw, gh);
    return Math.hypot(pin.x - rest.x, pin.y - rest.y) > 0.5;
  });
}

export function openPuppetSession(docW: number, docH: number) {
  session = { docW, docH, pins: [], drag: null };
  bump();
}

/** Click nearest vertex: add a pin at its rest, or grab the pin already there. */
export function placePuppetPin(x: number, y: number) {
  if (!session) return;
  const v = nearestVertex(x, y, session.docW, session.docH);
  const existing = session.pins.find((pin) => pin.v === v);
  if (!existing) {
    const rest = vertexRest(v, session.docW, session.docH);
    session.pins.push({ v, x: rest.x, y: rest.y });
  }
  session.drag = v;
  bump();
}

export function movePuppetPin(x: number, y: number) {
  if (!session || session.drag == null) return;
  const pin = session.pins.find((item) => item.v === session!.drag);
  if (!pin) return;
  pin.x = Math.min(session.docW, Math.max(0, x));
  pin.y = Math.min(session.docH, Math.max(0, y));
  bump();
}

export function endPuppetDrag() {
  if (!session || session.drag == null) return;
  session.drag = null;
  bump();
}

export function cancelPuppetSession() {
  if (!session) return;
  session = null;
  bump();
}

/**
 * Close the session. Returns the pins when one of them actually moved, so an
 * identity mesh is not resampled (that would still push undo).
 */
export function takePuppetCommit(): { docW: number; docH: number; pins: PuppetPin[] } | null {
  if (!session) return null;
  const snap = {
    docW: session.docW,
    docH: session.docH,
    pins: session.pins.map((pin) => ({ v: pin.v, x: pin.x, y: pin.y })),
  };
  session = null;
  bump();
  if (!pinsMoved(snap.docW, snap.docH, snap.pins)) return null;
  return snap;
}
