import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { commitPuppetWarp, cancelPuppetWarp, store } from "../state/app";
import { viewOf } from "../state/store";
import { docPointAt } from "../state/viewTransform";
import {
  PUPPET_GH,
  PUPPET_GW,
  endPuppetDrag,
  getPuppetRev,
  getPuppetSession,
  movePuppetPin,
  placePuppetPin,
  puppetDestinations,
  subscribePuppet,
} from "../state/puppetWarp";

function docPoint(e: ReactPointerEvent, docW: number, docH: number): { x: number; y: number } {
  const host = (e.currentTarget as HTMLElement).closest(".mv-canvas-viewport");
  if (host) {
    const view = viewOf(store.state);
    const rect = host.getBoundingClientRect();
    const par = store.state.pixelAspectCorrection ? store.state.pixelAspect : 1;
    return docPointAt(view, par, docW, docH, e.clientX - rect.left, e.clientY - rect.top);
  }
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    x: ((e.clientX - box.left) / Math.max(1, box.width)) * docW,
    y: ((e.clientY - box.top) / Math.max(1, box.height)) * docH,
  };
}

/** Mesh and pins over the document. Pixels update on Commit, not on each drag. */
export function PuppetWarpOverlay({ docW, docH }: { docW: number; docH: number }) {
  const rev = useSyncExternalStore(subscribePuppet, getPuppetRev, getPuppetRev);
  const session = getPuppetSession();
  if (!session || rev < 0) return null;
  const { dx, dy } = puppetDestinations(session.docW, session.docH, session.pins);
  const cols = PUPPET_GW + 1;
  const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (let j = 0; j <= PUPPET_GH; j++) {
    for (let i = 0; i <= PUPPET_GW; i++) {
      const v = j * cols + i;
      if (i < PUPPET_GW) {
        const n = v + 1;
        lines.push({ x1: dx[v], y1: dy[v], x2: dx[n], y2: dy[n], key: `h${v}` });
      }
      if (j < PUPPET_GH) {
        const n = v + cols;
        lines.push({ x1: dx[v], y1: dy[v], x2: dx[n], y2: dy[n], key: `v${v}` });
      }
    }
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = docPoint(e, docW, docH);
    placePuppetPin(p.x, p.y);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.stopPropagation();
    const p = docPoint(e, docW, docH);
    movePuppetPin(p.x, p.y);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endPuppetDrag();
  };
  return (
    <div
      data-mv-puppet-workspace=""
      style={{ position: "absolute", inset: 0, touchAction: "none", zIndex: 6 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg width={docW} height={docH} style={{ position: "absolute", inset: 0, width: docW, height: docH, pointerEvents: "none", overflow: "visible" }}>
        {lines.map((line) => (
          <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="rgba(255,255,255,0.85)" strokeWidth={1} />
        ))}
        {Array.from({ length: dx.length }, (_, v) => (
          <circle key={v} cx={dx[v]} cy={dy[v]} r={session.pins.some((pin) => pin.v === v) ? 5 : 2.5} fill={session.pins.some((pin) => pin.v === v) ? "#4da3ff" : "#fff"} />
        ))}
      </svg>
      <div
        style={{ position: "absolute", left: 8, top: 8, display: "flex", gap: 6, alignItems: "center", padding: "4px 6px", background: "rgba(20,22,26,0.92)", borderRadius: 6 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span style={{ color: "#ddd", fontSize: 11 }}>Puppet Warp</span>
        <button type="button" onClick={() => commitPuppetWarp()}>Commit</button>
        <button type="button" onClick={() => cancelPuppetWarp()}>Cancel</button>
      </div>
    </div>
  );
}
