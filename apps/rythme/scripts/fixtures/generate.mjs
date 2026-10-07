// ─────────────────────────────────────────────────────────────
// scripts/fixtures/generate — synthesize deterministic audio fixtures
// ─────────────────────────────────────────────────────────────
// Writes small, reproducible WAV files to test-assets/ using a SELF-CONTAINED
// encoder (deliberately not the engine's own), so the engine's decoder is
// tested against independently-authored RIFF files — including a file padded
// with extra chunks (fact/LIST) to exercise chunk skipping. Run: `pnpm fixtures`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "test-assets");
mkdirSync(OUT, { recursive: true });

// ── deterministic signal synthesis ────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sine(freq, seconds, sr, amp = 0.8) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}
function chirp(f0, f1, seconds, sr, amp = 0.8) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const f = f0 + (f1 - f0) * t;
    phase += (2 * Math.PI * f) / sr;
    out[i] = amp * Math.sin(phase);
  }
  return out;
}
function noise(seconds, sr, amp = 0.5, seed = 1) {
  const rand = mulberry32(seed);
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * (rand() * 2 - 1);
  return out;
}
function dtmf(low, high, seconds, sr, amp = 0.4) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * (Math.sin((2 * Math.PI * low * i) / sr) + Math.sin((2 * Math.PI * high * i) / sr));
  return out;
}

// ── self-contained WAV encoder ────────────────────────────────────────────────
function clampInt(x, max) {
  const v = Math.round(x < 0 ? x * (max + 1) : x * max);
  return Math.max(-(max + 1), Math.min(max, v));
}
function encodeWav(channels, sr, { bits = 16, float = false, extraChunks = false } = {}) {
  const chN = channels.length;
  const frames = channels[0].length;
  const bytesPer = bits / 8;
  const blockAlign = chN * bytesPer;
  const dataSize = frames * blockAlign;
  const extra = extraChunks ? 12 + 8 + 8 : 0; // fact(4) + LIST(stub)
  const buffer = Buffer.alloc(44 + extra + dataSize);
  let o = 0;
  const str = (s) => { buffer.write(s, o, "ascii"); o += s.length; };
  const u32 = (v) => { buffer.writeUInt32LE(v >>> 0, o); o += 4; };
  const u16 = (v) => { buffer.writeUInt16LE(v & 0xffff, o); o += 2; };

  str("RIFF");
  u32(36 + extra + dataSize);
  str("WAVE");
  str("fmt ");
  u32(16);
  u16(float ? 3 : 1);
  u16(chN);
  u32(sr);
  u32(sr * blockAlign);
  u16(blockAlign);
  u16(bits);
  if (extraChunks) {
    str("fact");
    u32(4);
    u32(frames);
    str("LIST");
    u32(4);
    str("INFO");
  }
  str("data");
  u32(dataSize);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chN; c++) {
      const s = channels[c][i] ?? 0;
      if (float) {
        buffer.writeFloatLE(s, o);
        o += 4;
      } else if (bits === 16) {
        buffer.writeInt16LE(clampInt(s, 0x7fff), o);
        o += 2;
      } else if (bits === 24) {
        const v = clampInt(s, 0x7fffff);
        buffer.writeUInt8(v & 0xff, o);
        buffer.writeUInt8((v >> 8) & 0xff, o + 1);
        buffer.writeUInt8((v >> 16) & 0xff, o + 2);
        o += 3;
      } else if (bits === 32) {
        buffer.writeInt32LE(clampInt(s, 0x7fffffff), o);
        o += 4;
      }
    }
  }
  return buffer;
}

const SR = 48000;
const fixtures = [
  { name: "tone-440-mono-16.wav", buf: () => encodeWav([sine(440, 1, SR, 0.8)], SR, { bits: 16 }), meta: { freq: 440, ch: 1, sr: SR } },
  { name: "tone-440-stereo-16.wav", buf: () => encodeWav([sine(440, 1, SR, 0.8), sine(554.37, 1, SR, 0.8)], SR, { bits: 16 }), meta: { freq: 440, ch: 2, sr: SR } },
  { name: "tone-1k-24.wav", buf: () => encodeWav([sine(1000, 0.5, SR, 0.7)], SR, { bits: 24 }), meta: { freq: 1000, ch: 1, sr: SR } },
  { name: "tone-1k-32f.wav", buf: () => encodeWav([sine(1000, 0.5, SR, 0.7)], SR, { bits: 32, float: true }), meta: { freq: 1000, ch: 1, sr: SR } },
  { name: "tone-220-44100-16.wav", buf: () => encodeWav([sine(220, 0.5, 44100, 0.6)], 44100, { bits: 16 }), meta: { freq: 220, ch: 1, sr: 44100 } },
  { name: "sweep-100-8k-16.wav", buf: () => encodeWav([chirp(100, 8000, 1, SR, 0.7)], SR, { bits: 16 }), meta: { ch: 1, sr: SR } },
  { name: "noise-16.wav", buf: () => encodeWav([noise(0.5, SR, 0.5, 7)], SR, { bits: 16 }), meta: { ch: 1, sr: SR } },
  { name: "dtmf-5-16.wav", buf: () => encodeWav([dtmf(770, 1336, 0.3, 8000, 0.4)], 8000, { bits: 16 }), meta: { ch: 1, sr: 8000 } },
  { name: "tone-extrachunks-16.wav", buf: () => encodeWav([sine(440, 0.5, SR, 0.8)], SR, { bits: 16, extraChunks: true }), meta: { freq: 440, ch: 1, sr: SR } },
];

const manifest = [];
for (const f of fixtures) {
  const bytes = f.buf();
  writeFileSync(join(OUT, f.name), bytes);
  manifest.push({ name: f.name, bytes: bytes.length, ...f.meta });
  console.log(`  wrote ${f.name.padEnd(28)} ${bytes.length} bytes`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n${fixtures.length} fixtures → ${OUT}`);
