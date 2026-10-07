// Reusable multi-stop gradient editor. Used by the Gradient tool's options bar
// (store-backed) and the Gradient Map adjustment-layer dialog (controlled).
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@monet-ui/monet-react";
import { store, useStore } from "../state/app";
import { hsvToRgba, type GradientStop } from "../state/store";

// Interpolate the ramp colour at a position (for inserting a new stop / building a LUT).
export function gradientSample(stops: GradientStop[], pos: number): { r: number; g: number; b: number; a: number } {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (pos <= s[0].pos) return s[0];
  if (pos >= s[s.length - 1].pos) return s[s.length - 1];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (pos >= a.pos && pos <= b.pos) {
      const t = (pos - a.pos) / (b.pos - a.pos || 1);
      return { r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t), a: Math.round(a.a + (b.a - a.a) * t) };
    }
  }
  return s[0];
}
const hex2 = (x: number) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0");

// `stops`/`onChange` make it controlled; omitted, it edits store.gradientStops.
export function GradientBar({ stops: cStops, onChange }: { stops?: GradientStop[]; onChange?: (s: GradientStop[]) => void } = {}) {
  const storeStops = useStore((s) => s.gradientStops);
  const stops = cStops ?? storeStops;
  const setStops = (next: GradientStop[]) => (onChange ? onChange(next) : store.setOptions({ gradientStops: next }));
  const [sel, setSel] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const idx = Math.min(sel, stops.length - 1);
  const cur = stops[idx];
  const css = `linear-gradient(to right, ${[...stops].sort((a, b) => a.pos - b.pos).map((s) => `rgba(${s.r},${s.g},${s.b},${s.a / 255}) ${(s.pos * 100).toFixed(1)}%`).join(", ")})`;
  const fg = hsvToRgba(store.state.fg), bg = hsvToRgba(store.state.bg);

  const posFromX = (clientX: number) => {
    const rect = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const addStop = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pos = posFromX(e.clientX);
    const next = [...stops, { pos, ...gradientSample(stops, pos) }];
    setStops(next); setSel(next.length - 1);
  };
  const onStopDown = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    e.stopPropagation(); setSel(i); dragRef.current = i;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A cancelled drag (touch scroll takeover, pen out of proximity) fires
    // pointercancel, not pointerup; without both guards a stale dragRef would
    // teleport that stop on the next plain hover over any handle. (#106)
    if (dragRef.current == null || (e.buttons & 1) === 0) return;
    const i = dragRef.current;
    setStops(stops.map((s, j) => (j === i ? { ...s, pos: posFromX(e.clientX) } : s)));
  };
  const updateCur = (patch: Partial<GradientStop>) => setStops(stops.map((s, j) => (j === idx ? { ...s, ...patch } : s)));
  const preset = (next: GradientStop[]) => { setStops(next); setSel(0); };

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 170, height: 24 }}>
        <div ref={barRef} onPointerDown={addStop}
          style={{ width: "100%", height: 14, borderRadius: 3, cursor: "copy",
            background: `${css}, repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%) 0 0 / 8px 8px`, border: "1px solid var(--stroke-2)" }} />
        {stops.map((s, i) => (
          <div key={i} title="Drag to move; select to edit"
            onPointerDown={(e) => onStopDown(e, i)} onPointerMove={onMove}
            onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}
            style={{ position: "absolute", top: 13, left: `calc(${s.pos * 100}% - 5px)`, width: 10, height: 10, borderRadius: "50%",
              background: `rgb(${s.r},${s.g},${s.b})`, border: i === idx ? "2px solid var(--accent-raster)" : "1px solid #fff", boxShadow: "0 0 2px #000", cursor: "grab" }} />
        ))}
      </div>
      {cur && (
        <>
          <input type="color" aria-label="Stop color" value={`#${hex2(cur.r)}${hex2(cur.g)}${hex2(cur.b)}`}
            onChange={(e) => { const n = parseInt(e.target.value.slice(1), 16); updateCur({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }); }}
            style={{ width: 26, height: 22, padding: 0, border: "none", background: "none" }} />
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Opacity</span>
          <input type="number" min={0} max={100} aria-label="Stop opacity" value={Math.round((cur.a / 255) * 100)}
            onChange={(e) => updateCur({ a: Math.round((Number(e.target.value) || 0) / 100 * 255) })}
            style={{ width: 46, height: 22, fontSize: 11, borderRadius: 4, border: "1px solid var(--stroke-2)", background: "var(--surface-2)", color: "var(--text-1)", padding: "0 6px" }} />
          <Button size="sm" variant="ghost" disabled={stops.length <= 2} onClick={() => { setStops(stops.filter((_, j) => j !== idx)); setSel(0); }}>Delete</Button>
        </>
      )}
      <span style={{ width: 1, height: 18, background: "var(--stroke-2)" }} />
      <Button size="sm" variant="ghost" onClick={() => preset([{ pos: 0, r: fg[0], g: fg[1], b: fg[2], a: fg[3] }, { pos: 1, r: bg[0], g: bg[1], b: bg[2], a: bg[3] }])}>FG→BG</Button>
      <Button size="sm" variant="ghost" onClick={() => preset([{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }])}>B→W</Button>
      <Button size="sm" variant="ghost" onClick={() => preset([{ pos: 0, r: fg[0], g: fg[1], b: fg[2], a: 255 }, { pos: 1, r: fg[0], g: fg[1], b: fg[2], a: 0 }])}>FG→Transp</Button>
    </span>
  );
}
