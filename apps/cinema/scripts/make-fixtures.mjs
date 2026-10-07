// ─────────────────────────────────────────────────────────────
// make-fixtures.mjs — generate small, real video fixtures for the e2e suite.
//
// ffmpeg isn't required: we drive system Chrome (via Playwright) to render an
// animated canvas + an optional audio tone and record it with MediaRecorder to
// a WebM (VP8/Opus). The result decodes through the same HTMLVideoElement path
// Monet Cinema uses, so importing these in e2e exercises the real pipeline.
//
//   pnpm fixtures      # regenerate test-assets/*.webm
// ─────────────────────────────────────────────────────────────

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test-assets");

const FIXTURES = [
  { name: "bars.webm", w: 320, h: 240, durMs: 2000, audio: false },
  { name: "tone.webm", w: 320, h: 240, durMs: 1500, audio: true },
];

/** Runs in the page: render an animated canvas (+ tone) and record to WebM. */
async function recordInPage({ w, h, durMs, audio }) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const stream = canvas.captureStream(30);
  let actx;
  if (audio) {
    actx = new AudioContext();
    const osc = actx.createOscillator();
    osc.frequency.value = 440;
    const dest = actx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  const mime = audio ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const start = performance.now();
  let frame = 0;
  function draw() {
    const t = performance.now() - start;
    // sweeping hue background + moving white bar + frame counter
    ctx.fillStyle = `hsl(${(t / durMs) * 300}, 70%, 45%)`;
    ctx.fillRect(0, 0, w, h);
    const x = ((t / durMs) * (w - 40)) % (w - 40);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, 0, 40, h);
    ctx.fillStyle = "#000";
    ctx.font = "bold 48px monospace";
    ctx.fillText(String(frame).padStart(3, "0"), 20, h - 30);
    frame++;
    if (t < durMs) requestAnimationFrame(draw);
  }

  const done = new Promise((resolve) => {
    rec.onstop = async () => {
      if (actx) await actx.close();
      const blob = new Blob(chunks, { type: "video/webm" });
      const buf = await blob.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      resolve(btoa(bin));
    };
  });

  rec.start();
  requestAnimationFrame(draw);
  await new Promise((r) => setTimeout(r, durMs + 250));
  rec.stop();
  return done;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.goto("about:blank");

  for (const fx of FIXTURES) {
    const b64 = await page.evaluate(recordInPage, fx);
    const bytes = Buffer.from(b64, "base64");
    const path = join(OUT_DIR, fx.name);
    await writeFile(path, bytes);
    console.log(`wrote ${fx.name} (${bytes.length} bytes)`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
