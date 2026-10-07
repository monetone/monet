// Scopes: luma histogram, luma waveform, and vectorscope, read from the engine
// (computed off the last composited program frame) and redrawn whenever the
// program changes (store rev / playhead).

import { useEffect, useRef } from "react";
import { engine, useStore } from "../../state/app";

const accent = "var(--accent-motion)";

export function ScopesPanel() {
  const rev = useStore((s) => s.rev);
  const playhead = useStore((s) => s.playhead);

  const histRef = useRef<HTMLCanvasElement | null>(null);
  const waveRef = useRef<HTMLCanvasElement | null>(null);
  const vecRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    drawHistogram(histRef.current, engine.histogram(64));
    drawWaveform(waveRef.current, engine.waveform(256));
    drawVectorscope(vecRef.current, engine.vectorscope(64), 64);
  }, [rev, playhead]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="monet-section-label">Histogram</div>
      <canvas ref={histRef} width={256} height={90} style={{ width: "100%", height: 90, background: "#000", borderRadius: 3, boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }} />
      <div className="monet-section-label">Waveform (Luma)</div>
      <canvas ref={waveRef} width={256} height={90} style={{ width: "100%", height: 90, background: "#000", borderRadius: 3, boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }} />
      <div className="monet-section-label">Vectorscope</div>
      <canvas ref={vecRef} width={128} height={128} style={{ width: 128, height: 128, alignSelf: "center", background: "#000", borderRadius: "50%", boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }} />
    </div>
  );
}

function drawHistogram(c: HTMLCanvasElement | null, bins: Float32Array) {
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = accent;
  const bw = c.width / bins.length;
  for (let i = 0; i < bins.length; i++) {
    const h = bins[i] * c.height;
    ctx.fillRect(i * bw, c.height - h, Math.max(1, bw - 0.5), h);
  }
}

function drawWaveform(c: HTMLCanvasElement | null, cols: Float32Array) {
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "oklch(0.85 0.16 145)";
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  const cw = c.width / cols.length;
  for (let i = 0; i < cols.length; i++) {
    const y = c.height - cols[i] * c.height;
    const x = i * cw;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawVectorscope(c: HTMLCanvasElement | null, grid: Float32Array, n: number) {
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  const sx = c.width / n;
  const sy = c.height / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const v = grid[gy * n + gx];
      if (v <= 0.02) continue;
      ctx.fillStyle = `oklch(0.8 0.2 ${(gx / n) * 360} / ${v})`;
      ctx.fillRect(gx * sx, gy * sy, sx + 0.5, sy + 0.5);
    }
  }
}
