export type SkyOutput = "newLayer" | "currentLayer";

export interface SkyReplacementOptions {
  top: [number, number, number];
  bottom: [number, number, number];
  opacity?: number;
  horizon?: number;
  tolerance?: number;
  shiftEdge?: number; // -1..1
  fadeEdge?: number; // 0..1
  brightness?: number; // -1..1
  temperature?: number; // -1..1
  scale?: number; // 0.5..2
  flip?: boolean;
  output?: SkyOutput;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const byte = (v: number) => Math.round(clamp(v, 0, 255));

export function adjustedSkyColor(rgb: [number, number, number], brightness = 0, temperature = 0): [number, number, number] {
  const b = clamp(brightness, -1, 1);
  const t = clamp(temperature, -1, 1);
  const gain = 1 + b * 0.55;
  const lift = b * 24;
  return [
    byte(rgb[0] * gain + lift + t * 42),
    byte(rgb[1] * gain + lift + t * 8),
    byte(rgb[2] * gain + lift - t * 46),
  ];
}

export function skyGradientStops(opts: SkyReplacementOptions): Float32Array {
  const opacity = clamp01(opts.opacity ?? 1);
  let top = adjustedSkyColor(opts.top, opts.brightness, opts.temperature);
  let bottom = adjustedSkyColor(opts.bottom, opts.brightness, opts.temperature);
  if (opts.flip) [top, bottom] = [bottom, top];
  return new Float32Array([
    0, top[0] / 255, top[1] / 255, top[2] / 255, opacity,
    1, bottom[0] / 255, bottom[1] / 255, bottom[2] / 255, opacity,
  ]);
}

export function skyGradientLine(height: number, horizon = 0.45, scale = 1): [number, number, number, number] {
  const h = Math.max(1, Math.round(height));
  const hz = clamp(horizon, 0.05, 0.95);
  const sc = clamp(scale, 0.5, 2);
  const span = h / sc;
  const y0 = h * hz - span * hz;
  return [0, y0, 0, y0 + span];
}

export function skyEdgePixels(width: number, height: number, shiftEdge = 0, fadeEdge = 0): { shift: number; fade: number } {
  const base = Math.max(1, Math.min(width, height));
  return {
    shift: Math.round(clamp(shiftEdge, -1, 1) * base * 0.08),
    fade: Math.round(clamp01(fadeEdge) * base * 0.08),
  };
}
