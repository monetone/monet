// ─────────────────────────────────────────────────────────────
// engine/dsp/scientific-filter — Adobe Audition–style Scientific Filter
// ─────────────────────────────────────────────────────────────
// A high-order analog-prototype IIR filter — the classic textbook designs
// (Butterworth · Chebyshev I · Chebyshev II · Bessel) in four responses
// (low-pass · high-pass · band-pass · band-stop). Unlike the fixed second-order
// RBJ biquads (the EQ / low-cut tools), the order is arbitrary, so the roll-off
// can be made as steep as desired: a single Butterworth stays maximally flat,
// Chebyshev trades passband ripple for a sharper knee, Chebyshev II puts the
// ripple in the stopband (flat passband + nulls), and Bessel keeps the phase
// (group delay) flat for the most natural transient response.
//
// The design pipeline mirrors the standard analog → digital flow used by SciPy's
// `iirfilter`: build a normalized analog low-pass prototype (poles + zeros), run
// the requested frequency transform at the *pre-warped* analog corner(s),
// bilinear-transform the whole pole/zero/gain set into the z-plane, then realize
// it as a cascade of second-order sections (biquads). Pole magnitudes only ever
// set the *shape*; the overall gain is fixed last by normalizing the passband
// peak to 0 dB, exactly as Audition draws its response. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import type { AudioData } from "../audio/types";
import { biquadMagnitude, processBiquadChannel, type BiquadCoeffs } from "./biquad";

export type ScientificFilterKind = "butterworth" | "chebyshev1" | "chebyshev2" | "bessel" | "elliptic";
export type ScientificFilterResponse = "lowpass" | "highpass" | "bandpass" | "bandstop";

export interface ScientificFilterOptions {
  /** Analog prototype family. Default `butterworth`. */
  kind?: ScientificFilterKind;
  /** Frequency response shape. Default `lowpass`. */
  response?: ScientificFilterResponse;
  /** Prototype order (band-pass / band-stop realize twice this). 1..12, default 4. */
  order?: number;
  /** Corner frequency (Hz). For band-pass/stop this is the LOWER edge. Default 1000. */
  cutoffHz?: number;
  /** Upper edge (Hz) for band-pass / band-stop. Default 4000. */
  cutoffHz2?: number;
  /** Chebyshev I passband ripple, dB. Default 1. */
  rippleDb?: number;
  /** Chebyshev II stopband attenuation, dB. Default 40. */
  stopAttenDb?: number;
}

const MAX_ORDER = 12;

// ── complex arithmetic (plain {re, im}) ───────────────────────────────────────

interface Complex {
  re: number;
  im: number;
}

const cx = (re: number, im = 0): Complex => ({ re, im });
const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });

function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);

/** Principal complex square root. */
function cSqrt(a: Complex): Complex {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  let im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  if (a.im < 0) im = -im;
  return { re, im };
}

/** Evaluate Σ coeffs[k]·z^k (coeffs ascending) at a complex point. */
function cPolyval(coeffs: number[], z: Complex): Complex {
  let acc = cx(0);
  for (let k = coeffs.length - 1; k >= 0; k--) acc = cAdd(cMul(acc, z), cx(coeffs[k]));
  return acc;
}

// ── Durand–Kerner: all complex roots of a real, monic polynomial ──────────────
// Deterministic (fixed seeds + iteration cap), good for the modest orders here.
// Used only for the Bessel prototype (Butterworth/Chebyshev poles are closed-form).

function polyRoots(coeffsAsc: number[]): Complex[] {
  // Strip a leading-zero high coefficient, then make monic.
  let n = coeffsAsc.length - 1;
  while (n > 0 && Math.abs(coeffsAsc[n]) < 1e-300) n--;
  const lead = coeffsAsc[n];
  const c = coeffsAsc.slice(0, n + 1).map((v) => v / lead);
  if (n === 0) return [];
  const roots: Complex[] = [];
  const seed = cx(0.4, 0.9);
  let p = cx(1, 0);
  for (let i = 0; i < n; i++) {
    p = cMul(p, seed);
    roots.push({ re: p.re, im: p.im });
  }
  for (let iter = 0; iter < 500; iter++) {
    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      const num = cPolyval(c, roots[i]);
      let den = cx(1, 0);
      for (let j = 0; j < n; j++) if (j !== i) den = cMul(den, cSub(roots[i], roots[j]));
      const step = cDiv(num, den);
      roots[i] = cSub(roots[i], step);
      maxStep = Math.max(maxStep, cAbs(step));
    }
    if (maxStep < 1e-14) break;
  }
  return roots;
}

// ── normalized analog low-pass prototypes (corner / band-edge at ω = 1) ───────

interface ZPK {
  zeros: Complex[];
  poles: Complex[];
}

function butterworthProto(n: number): ZPK {
  const poles: Complex[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (Math.PI * (2 * k + 1 + n)) / (2 * n);
    poles.push(cx(Math.cos(theta), Math.sin(theta)));
  }
  return { zeros: [], poles };
}

function chebyshev1Proto(n: number, rippleDb: number): ZPK {
  const eps = Math.sqrt(Math.pow(10, rippleDb / 10) - 1);
  const a = Math.asinh(1 / eps) / n;
  const sinhA = Math.sinh(a);
  const coshA = Math.cosh(a);
  const poles: Complex[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (Math.PI * (2 * k + 1)) / (2 * n);
    poles.push(cx(-sinhA * Math.sin(theta), coshA * Math.cos(theta)));
  }
  return { zeros: [], poles };
}

function chebyshev2Proto(n: number, stopDb: number): ZPK {
  const eps = 1 / Math.sqrt(Math.pow(10, stopDb / 10) - 1);
  const a = Math.asinh(1 / eps) / n;
  const sinhA = Math.sinh(a);
  const coshA = Math.cosh(a);
  const poles: Complex[] = [];
  const zeros: Complex[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (Math.PI * (2 * k + 1)) / (2 * n);
    // Type II poles are the reciprocals of the Type I poles (stopband edge → ω=1).
    const p1 = cx(-sinhA * Math.sin(theta), coshA * Math.cos(theta));
    poles.push(cDiv(cx(1, 0), p1));
    // Imaginary-axis zeros at ±j/cos(θ); the middle (cos θ = 0, odd n) is at ∞.
    const cosT = Math.cos(theta);
    if (Math.abs(cosT) > 1e-12) zeros.push(cx(0, 1 / cosT));
  }
  return { zeros, poles };
}

// ── elliptic (Cauer) prototype — Jacobi elliptic functions via Landen ─────────
// The steepest filter for a given order: equiripple in BOTH the passband (to
// −rippleDb) and the stopband (nulls reaching ≥ stopAttenDb). Designed with the
// Orfanidis method; the Jacobi cd / sn are evaluated by the descending-Landen
// recursion (works for complex arguments), and the auxiliary v0 is found by
// bisecting sn on the imaginary axis instead of an inverse-sn.

function cCos(z: Complex): Complex {
  return cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
}
function cSin(z: Complex): Complex {
  return cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
}

/** Complete elliptic integral K(k) via the arithmetic-geometric mean. */
function ellipK(k: number): number {
  let a = 1;
  let b = Math.sqrt(Math.max(0, 1 - k * k));
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-15; i++) {
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
  }
  return Math.PI / (2 * a);
}

/** Descending Landen moduli k₁, k₂, … (until ≈ 0). */
function landen(k: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < 60 && k > 1e-15; i++) {
    const kp = Math.sqrt(Math.max(0, 1 - k * k));
    k = (k / (1 + kp)) ** 2;
    v.push(k);
  }
  return v;
}

/** Jacobi cd(u·K, k) for K-normalized (possibly complex) `u`, via ascending Landen. */
function jacobiCd(u: Complex, k: number): Complex {
  const v = landen(k);
  let w = cCos(cMul(u, cx(Math.PI / 2, 0)));
  for (let n = v.length - 1; n >= 0; n--) {
    const vn = v[n];
    w = cDiv(cMul(cx(1 + vn, 0), w), cAdd(cx(1, 0), cMul(cx(vn, 0), cMul(w, w))));
  }
  return w;
}

/** Jacobi sn(u·K, k) for K-normalized (possibly complex) `u`, via ascending Landen. */
function jacobiSn(u: Complex, k: number): Complex {
  const v = landen(k);
  let w = cSin(cMul(u, cx(Math.PI / 2, 0)));
  for (let n = v.length - 1; n >= 0; n--) {
    const vn = v[n];
    w = cDiv(cMul(cx(1 + vn, 0), w), cAdd(cx(1, 0), cMul(cx(vn, 0), cMul(w, w))));
  }
  return w;
}

/** Solve the elliptic degree equation for the modulus k given selectivity k1 and order N. */
function ellipDeg(n: number, k1: number): number {
  const K1 = ellipK(k1);
  const K1p = ellipK(Math.sqrt(Math.max(0, 1 - k1 * k1)));
  const q = Math.pow(Math.exp(-Math.PI * (K1p / K1)), 1 / n); // nome of k
  let num = 0;
  let den = 0;
  for (let m = 0; m <= 20; m++) num += Math.pow(q, m * (m + 1));
  for (let m = 1; m <= 20; m++) den += Math.pow(q, m * m);
  const ratio = num / (1 + 2 * den);
  return 4 * Math.sqrt(q) * ratio * ratio;
}

function ellipticProto(n: number, rippleDb: number, stopDb: number): ZPK {
  const ep = Math.sqrt(Math.pow(10, rippleDb / 10) - 1);
  const es = Math.sqrt(Math.pow(10, stopDb / 10) - 1);
  const k = ellipDeg(n, ep / es); // passband edge ω=1, stopband edge ω=1/k

  // v0 = asne(j/ep, k1)/N, found by bisecting sn(j·t, k1) on the imaginary axis.
  const k1 = ep / es;
  const K1 = ellipK(k1);
  const K1p = ellipK(Math.sqrt(Math.max(0, 1 - k1 * k1)));
  const tMax = (K1p / K1) * (1 - 1e-9); // imaginary quarter-period (K-normalized)
  let lo = 0;
  let hi = tMax;
  const target = 1 / ep;
  for (let it = 0; it < 120; it++) {
    const mid = (lo + hi) / 2;
    if (jacobiSn(cx(0, mid), k1).im < target) lo = mid;
    else hi = mid;
  }
  const v0 = (lo + hi) / 2 / n;

  const L = Math.floor(n / 2);
  const zeros: Complex[] = [];
  const poles: Complex[] = [];
  for (let i = 1; i <= L; i++) {
    const ui = (2 * i - 1) / n;
    const za = cDiv(cx(0, 1), cMul(cx(k, 0), jacobiCd(cx(ui, 0), k))); // j / (k·cd)
    zeros.push(za, cx(za.re, -za.im));
    let pa = cMul(cx(0, 1), jacobiCd(cx(ui, -v0), k)); // j·cd(ui − j·v0)
    pa = cx(-Math.abs(pa.re), pa.im); // force the left half-plane (stability)
    poles.push(pa, cx(pa.re, -pa.im));
  }
  if (n % 2 === 1) {
    const pa0 = cMul(cx(0, 1), jacobiSn(cx(0, v0), k)); // real pole
    poles.push(cx(-Math.abs(pa0.re), 0));
  }
  return { zeros, poles };
}

function besselProto(n: number): ZPK {
  // Reverse Bessel polynomial coefficients a_k = (2n-k)! / (2^(n-k) · k! · (n-k)!).
  const coeffs: number[] = [];
  for (let k = 0; k <= n; k++) {
    coeffs.push(Math.exp(lnFact(2 * n - k) - (n - k) * Math.LN2 - lnFact(k) - lnFact(n - k)));
  }
  const poles = polyRoots(coeffs);
  // The raw roots are delay-normalized; rescale so the −3 dB point sits at ω = 1.
  const a0 = coeffs[0];
  const target = 2 * a0 * a0; // |poly(jω)|² at the half-power point
  let hi = 1;
  while (magSqPoly(coeffs, hi) < target && hi < 1e6) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (magSqPoly(coeffs, mid) < target) lo = mid;
    else hi = mid;
  }
  const w3 = (lo + hi) / 2;
  return { zeros: [], poles: poles.map((p) => cDiv(p, cx(w3, 0))) };
}

/** ln(k!) via lgamma, stable for the factorials in the Bessel coefficients. */
function lnFact(k: number): number {
  return lgamma(k + 1);
}

/** Lanczos approximation of ln Γ(x), x > 0. */
function lgamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const xx = x - 1;
  let a = 0.99999999999980993;
  const t = xx + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (xx + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** |Σ coeffs[k] (jω)^k|² for a real-coefficient polynomial. */
function magSqPoly(coeffs: number[], w: number): number {
  let re = 0;
  let im = 0;
  let p = cx(1, 0);
  const jw = cx(0, w);
  for (let k = 0; k < coeffs.length; k++) {
    re += coeffs[k] * p.re;
    im += coeffs[k] * p.im;
    p = cMul(p, jw);
  }
  return re * re + im * im;
}

function makeProto(opts: Required<Pick<ScientificFilterOptions, "kind" | "order" | "rippleDb" | "stopAttenDb">>): ZPK {
  switch (opts.kind) {
    case "chebyshev1":
      return chebyshev1Proto(opts.order, opts.rippleDb);
    case "chebyshev2":
      return chebyshev2Proto(opts.order, opts.stopAttenDb);
    case "bessel":
      return besselProto(opts.order);
    case "elliptic":
      return ellipticProto(opts.order, opts.rippleDb, opts.stopAttenDb);
    case "butterworth":
    default:
      return butterworthProto(opts.order);
  }
}

// ── analog frequency transforms (operate on the normalized prototype) ─────────

function lp2lp(zpk: ZPK, wc: number): ZPK {
  const k = cx(wc, 0);
  return { zeros: zpk.zeros.map((z) => cMul(z, k)), poles: zpk.poles.map((p) => cMul(p, k)) };
}

function lp2hp(zpk: ZPK, wc: number): ZPK {
  const k = cx(wc, 0);
  const degree = zpk.poles.length - zpk.zeros.length;
  const zeros = zpk.zeros.map((z) => cDiv(k, z));
  const poles = zpk.poles.map((p) => cDiv(k, p));
  for (let i = 0; i < degree; i++) zeros.push(cx(0, 0)); // zeros at the origin
  return { zeros, poles };
}

/** Split one prototype root into a band-pass pair: r·bw/2 ± sqrt((r·bw/2)² − wo²). */
function bpPair(r: Complex, wo: number, bw: number): [Complex, Complex] {
  const rl = cMul(r, cx(bw / 2, 0));
  const disc = cSqrt(cSub(cMul(rl, rl), cx(wo * wo, 0)));
  return [cAdd(rl, disc), cSub(rl, disc)];
}

function lp2bp(zpk: ZPK, wo: number, bw: number): ZPK {
  const degree = zpk.poles.length - zpk.zeros.length;
  const zeros: Complex[] = [];
  const poles: Complex[] = [];
  for (const z of zpk.zeros) zeros.push(...bpPair(z, wo, bw));
  for (const p of zpk.poles) poles.push(...bpPair(p, wo, bw));
  for (let i = 0; i < degree; i++) zeros.push(cx(0, 0)); // band-pass adds zeros at the origin
  return { zeros, poles };
}

/** Split one prototype root into a band-stop pair: r'/2 ± sqrt((r'/2)² − wo²), r' = bw/(2r). */
function bsPair(r: Complex, wo: number, bw: number): [Complex, Complex] {
  const rh = cDiv(cx(bw / 2, 0), r);
  const disc = cSqrt(cSub(cMul(rh, rh), cx(wo * wo, 0)));
  return [cAdd(rh, disc), cSub(rh, disc)];
}

function lp2bs(zpk: ZPK, wo: number, bw: number): ZPK {
  const degree = zpk.poles.length - zpk.zeros.length;
  const zeros: Complex[] = [];
  const poles: Complex[] = [];
  for (const z of zpk.zeros) zeros.push(...bsPair(z, wo, bw));
  for (const p of zpk.poles) poles.push(...bsPair(p, wo, bw));
  for (let i = 0; i < degree; i++) {
    zeros.push(cx(0, wo)); // band-stop adds zero pairs on the imaginary axis at ±j·wo
    zeros.push(cx(0, -wo));
  }
  return { zeros, poles };
}

// ── bilinear transform: s-plane → z-plane ─────────────────────────────────────

function bilinear(zpk: ZPK, fs: number): ZPK {
  const fs2 = cx(2 * fs, 0);
  const map = (r: Complex) => cDiv(cAdd(fs2, r), cSub(fs2, r));
  const degree = zpk.poles.length - zpk.zeros.length;
  const zeros = zpk.zeros.map(map);
  const poles = zpk.poles.map(map);
  for (let i = 0; i < degree; i++) zeros.push(cx(-1, 0)); // s = ∞ maps to z = −1
  return { zeros, poles };
}

// ── realize z-plane poles/zeros as a cascade of biquads ───────────────────────

/** Group roots into monic real quadratics (and one first-order term if odd). */
function rootsToSections(roots: Complex[]): Array<[number, number, number]> {
  const used = new Array(roots.length).fill(false);
  const sections: Array<[number, number, number]> = [];
  const reals: number[] = [];
  for (let i = 0; i < roots.length; i++) {
    if (used[i]) continue;
    if (Math.abs(roots[i].im) < 1e-9) {
      used[i] = true;
      reals.push(roots[i].re);
      continue;
    }
    // Pair with the conjugate: (1 − 2·Re·z⁻¹ … ) → [1, −2Re, |r|²].
    let j = -1;
    for (let k = i + 1; k < roots.length; k++) {
      if (used[k] || Math.abs(roots[k].im) < 1e-9) continue;
      if (Math.abs(roots[k].re - roots[i].re) < 1e-6 && Math.abs(roots[k].im + roots[i].im) < 1e-6) {
        j = k;
        break;
      }
    }
    used[i] = true;
    if (j >= 0) used[j] = true;
    const re = roots[i].re;
    const magSq = re * re + roots[i].im * roots[i].im;
    sections.push([1, -2 * re, magSq]);
  }
  reals.sort((a, b) => a - b);
  for (let i = 0; i < reals.length; i += 2) {
    if (i + 1 < reals.length) sections.push([1, -(reals[i] + reals[i + 1]), reals[i] * reals[i + 1]]);
    else sections.push([1, -reals[i], 0]); // lone real → first-order
  }
  return sections;
}

interface DesignedFilter {
  sections: BiquadCoeffs[];
  gain: number;
}

function resolved(opts: ScientificFilterOptions) {
  const kind = opts.kind ?? "butterworth";
  const response = opts.response ?? "lowpass";
  const order = Math.min(MAX_ORDER, Math.max(1, Math.round(opts.order ?? 4)));
  return { kind, response, order, rippleDb: opts.rippleDb ?? 1, stopAttenDb: opts.stopAttenDb ?? 40 };
}

/** Design the digital biquad cascade + 0 dB-passband normalization gain. */
export function designScientificFilter(opts: ScientificFilterOptions, sampleRate: number): DesignedFilter {
  const r = resolved(opts);
  const nyq = sampleRate / 2;
  const clampF = (f: number) => Math.min(nyq - 1, Math.max(1, f));
  const proto = makeProto(r);

  // Pre-warp the requested digital corner(s) to analog: Ω = 2·fs·tan(π·f/fs).
  const warp = (f: number) => 2 * sampleRate * Math.tan((Math.PI * clampF(f)) / sampleRate);

  let analog: ZPK;
  if (r.response === "lowpass") analog = lp2lp(proto, warp(opts.cutoffHz ?? 1000));
  else if (r.response === "highpass") analog = lp2hp(proto, warp(opts.cutoffHz ?? 1000));
  else {
    let f1 = clampF(opts.cutoffHz ?? 1000);
    let f2 = clampF(opts.cutoffHz2 ?? 4000);
    if (f2 < f1) [f1, f2] = [f2, f1];
    const w1 = warp(f1);
    const w2 = warp(f2);
    const wo = Math.sqrt(w1 * w2);
    const bw = w2 - w1;
    analog = r.response === "bandpass" ? lp2bp(proto, wo, bw) : lp2bs(proto, wo, bw);
  }

  const digital = bilinear(analog, sampleRate);
  const numer = rootsToSections(digital.zeros);
  const denom = rootsToSections(digital.poles);
  const count = Math.max(numer.length, denom.length);
  const sections: BiquadCoeffs[] = [];
  for (let i = 0; i < count; i++) {
    const nseg = numer[i] ?? [1, 0, 0];
    const dseg = denom[i] ?? [1, 0, 0];
    sections.push({ b0: nseg[0], b1: nseg[1], b2: nseg[2], a1: dseg[1], a2: dseg[2] });
  }

  return { sections, gain: passbandGain(sections, r.response, opts, sampleRate) };
}

/** Product of section magnitudes at one frequency (unity overall gain). */
function rawMagnitude(sections: BiquadCoeffs[], f: number, sampleRate: number): number {
  let m = 1;
  for (const s of sections) m *= biquadMagnitude(s, f, sampleRate);
  return m;
}

/** Scan the passband and scale so its peak magnitude is exactly 0 dB. */
function passbandGain(sections: BiquadCoeffs[], response: ScientificFilterResponse, opts: ScientificFilterOptions, sampleRate: number): number {
  const nyq = sampleRate / 2;
  const clampF = (f: number) => Math.min(nyq - 1, Math.max(1, f));
  const f1 = clampF(opts.cutoffHz ?? 1000);
  const f2 = clampF(opts.cutoffHz2 ?? 4000);
  const lo = Math.min(f1, f2);
  const hi = Math.max(f1, f2);
  const bands: Array<[number, number]> =
    response === "lowpass" ? [[0, lo]]
    : response === "highpass" ? [[f1, nyq]]
    : response === "bandpass" ? [[lo, hi]]
    : [[0, lo], [hi, nyq]]; // band-stop: both passbands
  let peak = 0;
  const steps = 256;
  for (const [a, b] of bands) {
    for (let i = 0; i <= steps; i++) {
      const f = a + ((b - a) * i) / steps;
      peak = Math.max(peak, rawMagnitude(sections, f, sampleRate));
    }
  }
  return peak > 0 ? 1 / peak : 1;
}

// ── public API ────────────────────────────────────────────────────────────────

/** Combined magnitude response of the designed filter at `freq`, in dB. */
export function scientificFilterResponseDb(opts: ScientificFilterOptions, freq: number, sampleRate: number): number {
  const { sections, gain } = designScientificFilter(opts, sampleRate);
  return gainToDb(gain * rawMagnitude(sections, freq, sampleRate));
}

/**
 * Apply a Scientific Filter. The cascade is designed once, then every channel is
 * filtered through each biquad section and scaled by the passband-normalizing
 * gain. Frame count is preserved and the input is not mutated.
 */
export function scientificFilter(d: AudioData, opts: ScientificFilterOptions = {}): AudioData {
  const { sections, gain } = designScientificFilter(opts, d.sampleRate);
  const out = cloneAudioData(d);
  for (const ch of out.channels) {
    for (const s of sections) processBiquadChannel(ch, s);
    if (gain !== 1) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  }
  return out;
}
