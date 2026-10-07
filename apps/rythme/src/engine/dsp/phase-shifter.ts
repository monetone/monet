// ─────────────────────────────────────────────────────────────
// engine/dsp/phase-shifter — Adobe Audition–style Graphic Phase Shifter
// ─────────────────────────────────────────────────────────────
// Audition's Stereo Imagery ▸ Graphic Phase Shifter: draw a phase-vs-frequency
// curve (x = frequency, y = degrees of phase shift) and it rotates each
// frequency's phase by that amount while leaving its *magnitude* untouched — a
// true all-pass. Unlike the Phaser (an LFO sweeping spectral notches, which
// changes magnitude) this is a static, magnitude-preserving phase warp; phase-
// shifting just one channel of a stereo pair (a zig-zag that grows toward the
// high end) fabricates a wider, "simulated stereo" image.
//
// Realized by the same STFT as the FFT Filter, but instead of scaling each bin
// it multiplies bin k by e^{jφ(f_k)} and its conjugate mirror by e^{−jφ(f_k)} so
// the inverse stays real; DC and Nyquist (self-conjugate bins) are left alone. A
// flat 0° curve is therefore an exact reconstruction, and energy is preserved for
// any curve. Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft, isPow2 } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";

/** One control point of the phase curve: a phase shift (degrees) at a frequency. */
export interface PhaseShiftPoint {
  freq: number;
  phaseDeg: number;
}

export interface GraphicPhaseShifterOptions {
  /** Phase curve as {freq, phaseDeg} control points (any order). Empty = no shift. */
  curve?: PhaseShiftPoint[];
  /** FFT size (power of two), default 2048. */
  fftSize?: number;
  /** Which channels to shift — "both" (default), or just "left"/"right" for simulated stereo. */
  channel?: "both" | "left" | "right";
}

const DEFAULT_FFT = 2048;

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/** Interpolate the curve's phase (degrees) at `freq`, clamped to the end points. */
function phaseDegAt(curve: PhaseShiftPoint[], freq: number): number {
  if (curve.length === 0) return 0;
  if (freq <= curve[0].freq) return curve[0].phaseDeg;
  const last = curve[curve.length - 1];
  if (freq >= last.freq) return last.phaseDeg;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (freq >= a.freq && freq <= b.freq) {
      const t = b.freq === a.freq ? 0 : (freq - a.freq) / (b.freq - a.freq);
      return a.phaseDeg * (1 - t) + b.phaseDeg * t;
    }
  }
  return last.phaseDeg;
}

/** Channel indices to phase-shift; the rest pass through untouched. */
function targetChannels(mode: "both" | "left" | "right", ch: number): Set<number> {
  if (mode === "left") return new Set([0]);
  if (mode === "right") return new Set(ch > 1 ? [1] : []);
  return new Set(Array.from({ length: ch }, (_, i) => i));
}

/**
 * Apply a frequency-dependent phase shift via STFT. Output keeps the input's
 * channel and frame count; the input is not mutated.
 */
export function graphicPhaseShifter(d: AudioData, opts: GraphicPhaseShifterOptions = {}): AudioData {
  const fftSize = opts.fftSize ?? DEFAULT_FFT;
  if (!isPow2(fftSize)) throw new Error(`graphicPhaseShifter: fftSize ${fftSize} must be a power of two`);
  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const half = fftSize / 2 + 1;
  const curve = [...(opts.curve ?? [])].sort((a, b) => a.freq - b.freq);
  // Per-bin rotation factor e^{jφ}. DC (k=0) and Nyquist (k=half-1) stay real → φ=0.
  const cosT = new Float64Array(half);
  const sinT = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const phi = k === 0 || k === half - 1 ? 0 : (phaseDegAt(curve, (k * d.sampleRate) / fftSize) * Math.PI) / 180;
    cosT[k] = Math.cos(phi);
    sinT[k] = Math.sin(phi);
  }

  const targets = targetChannels(opts.channel ?? "both", ch);
  const w = hann(fftSize);
  const hop = Math.max(1, fftSize >> 2); // 75% overlap
  const pad = fftSize;
  const plen = n + pad * 2;
  const out = createAudioData(ch, n, d.sampleRate);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    if (!targets.has(c)) {
      out.channels[c].set(src);
      continue;
    }
    const acc = new Float64Array(plen);
    const norm = new Float64Array(plen);

    for (let start = 0; start + fftSize <= plen; start += hop) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i - pad;
        re[i] = (idx >= 0 && idx < n ? src[idx] : 0) * w[i];
      }
      fft(re, im, false);
      for (let k = 1; k < half - 1; k++) {
        const cphi = cosT[k];
        const sphi = sinT[k];
        const rk = re[k];
        const ik = im[k];
        re[k] = rk * cphi - ik * sphi; // ·e^{jφ}
        im[k] = rk * sphi + ik * cphi;
        const mk = fftSize - k; // conjugate mirror bin ·e^{−jφ} keeps the inverse real
        const rm = re[mk];
        const imm = im[mk];
        re[mk] = rm * cphi + imm * sphi;
        im[mk] = -rm * sphi + imm * cphi;
      }
      fft(re, im, true);
      for (let i = 0; i < fftSize; i++) {
        acc[start + i] += re[i] * w[i];
        norm[start + i] += w[i] * w[i];
      }
    }

    const dst = out.channels[c];
    for (let i = 0; i < n; i++) {
      const p = i + pad;
      dst[i] = norm[p] > 1e-8 ? acc[p] / norm[p] : 0;
    }
  }
  return out;
}
