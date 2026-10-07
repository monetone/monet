// ─────────────────────────────────────────────────────────────
// engine/analysis/fft — radix-2 Cooley–Tukey FFT
// ─────────────────────────────────────────────────────────────
// In-place iterative complex FFT plus real-signal helpers. Sizes must be powers
// of two; callers zero-pad via nextPow2 / the spectrum helpers.

/** Smallest power of two ≥ n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * In-place complex FFT (`inverse` for the IFFT, which also scales by 1/N).
 * `re` and `im` must be the same power-of-two length.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (!isPow2(n)) throw new Error(`fft: length ${n} is not a power of two`);
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Magnitude spectrum of a real signal. Returns the first N/2+1 bins (the rest
 * are mirror images). The signal is copied into a power-of-two buffer.
 */
export function magnitudes(signal: Float32Array | Float64Array, fftSize?: number): Float64Array {
  const n = fftSize ?? nextPow2(signal.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, signal.length); i++) re[i] = signal[i];
  fft(re, im, false);
  const half = n / 2 + 1;
  const out = new Float64Array(half);
  for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}
