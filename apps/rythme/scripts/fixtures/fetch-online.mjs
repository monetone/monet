// ─────────────────────────────────────────────────────────────
// scripts/fixtures/fetch-online — download public-domain audio fixtures
// ─────────────────────────────────────────────────────────────
// Best-effort fetch of small, public-domain WAV files into
// test-assets/online/ (gitignored). The deterministic synthetic fixtures from
// `pnpm fixtures` are what the test suite relies on; these real-world clips are
// an optional augmentation for manual testing. Network failures are reported,
// not fatal.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "test-assets", "online");
mkdirSync(OUT, { recursive: true });

// Small public-domain WAV clips (classic teaching corpus, public domain).
const SOURCES = [
  { name: "CantinaBand3.wav", url: "https://www2.cs.uic.edu/~i101/SoundFiles/CantinaBand3.wav" },
  { name: "PinkPanther30.wav", url: "https://www2.cs.uic.edu/~i101/SoundFiles/PinkPanther30.wav" },
  { name: "Fanfare60.wav", url: "https://www2.cs.uic.edu/~i101/SoundFiles/Fanfare60.wav" },
  { name: "taunt.wav", url: "https://www2.cs.uic.edu/~i101/SoundFiles/taunt.wav" },
];

function readWavHeader(buf) {
  const tag = (o, s) => String.fromCharCode(...buf.subarray(o, o + s.length)) === s;
  if (!tag(0, "RIFF") || !tag(8, "WAVE")) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { channels: dv.getUint16(22, true), sampleRate: dv.getUint32(24, true), bits: dv.getUint16(34, true) };
}

let ok = 0;
for (const src of SOURCES) {
  try {
    const res = await fetch(src.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log(` skip  ${src.name} (HTTP ${res.status})`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const header = readWavHeader(bytes);
    if (!header) {
      console.log(` skip  ${src.name} (not a WAV)`);
      continue;
    }
    writeFileSync(join(OUT, src.name), bytes);
    console.log(`  ok   ${src.name.padEnd(22)} ${bytes.length} bytes · ${header.channels}ch · ${header.sampleRate}Hz · ${header.bits}-bit`);
    ok++;
  } catch (err) {
    console.log(` skip  ${src.name} (${err instanceof Error ? err.message : err})`);
  }
}

console.log(`\n${ok}/${SOURCES.length} downloaded → ${OUT}`);
if (ok === 0) console.log("(no network or sources unreachable — the synthetic fixtures from `pnpm fixtures` cover the test suite)");
