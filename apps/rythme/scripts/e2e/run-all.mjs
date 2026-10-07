// ─────────────────────────────────────────────────────────────
// scripts/e2e/run-all — headless smoke test of the running app
// ─────────────────────────────────────────────────────────────
// Boots the Vite dev server, drives the app in a headless browser against the
// dev-only `window.__rythme` store, and exercises the full stack: the demo
// project loads, effects apply + undo, generators insert clips, and a WAV
// fixture imports & decodes correctly. Exits non-zero on any failure or
// uncaught page error.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const PORT = 1424;
const URL = `http://127.0.0.1:${PORT}/`;

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(` FAIL  ${name} ${detail}`);
  }
}

async function waitForServer(url, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error("dev server did not start in time");
}

// Pick `value` in a Monet Select: open its trigger, then click the option in the
// portalled listbox (the popup lives under #monet-overlay-root, not the trigger).
async function chooseOption(page, trigger, value) {
  await page.click(trigger);
  await page.click(`.monet-listbox [role="option"][data-value="${value}"]`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true, channel: "chrome" });
  }
}

const server = spawn("pnpm", ["dev", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

let browser;
try {
  await waitForServer(URL);
  browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  const benign = /favicon\.ico|Failed to load resource/i;
  page.on("console", (m) => {
    if (m.type() === "error" && !benign.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() === 404 && !/favicon\.ico/i.test(r.url())) errors.push(`404 ${r.url()}`);
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__rythme && window.__engine", null, { timeout: 20000 });

  console.log("• app boot");
  const trackCount = await page.evaluate(() => window.__rythme.getState().project.tracks.length);
  check("demo project has tracks", trackCount >= 4, `(got ${trackCount})`);

  // the timeline canvas is present
  const hasCanvas = await page.evaluate(() => !!document.querySelector(".rh-canvas"));
  check("timeline canvas rendered", hasCanvas);

  console.log("• video references");
  const videoReference = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const asset = E.newVideoAsset({
      id: "e2e-video-asset",
      name: "picture-lock.mp4",
      sourceName: "picture-lock.mp4",
      mimeType: "video/mp4",
      duration: 5,
      width: 1920,
      height: 1080,
      frameRate: 24,
      hasAudio: true,
    });
    s.dispatch(E.addVideoReference(asset, { start: 3, duration: 5 }), { label: "Video Reference Fixture" });
    const project = s.getState().project;
    const active = E.activeVideoClipAt(project, 3.5);
    const roundTrip = E.IO.deserializeProject(E.IO.serializeProject(project));
    return {
      videoAssets: project.videoAssets?.length ?? 0,
      videoTracks: project.videoTracks?.length ?? 0,
      clipStart: project.videoTracks?.[0]?.clips[0]?.start,
      activeClipId: active?.clip?.id,
      roundTripVideoAssets: roundTrip.videoAssets?.length ?? 0,
      roundTripClipStart: roundTrip.videoTracks?.[0]?.clips[0]?.start,
      canUndo: s.canUndo(),
    };
  });
  check(
    "Video reference import path creates a persisted picture clip",
    videoReference.videoAssets === 1 &&
      videoReference.videoTracks === 1 &&
      videoReference.clipStart === 3 &&
      !!videoReference.activeClipId &&
      videoReference.roundTripVideoAssets === 1 &&
      videoReference.roundTripClipStart === 3 &&
      videoReference.canUndo,
    JSON.stringify(videoReference),
  );
  await page.waitForFunction(() => document.querySelectorAll("[data-video-track-header]").length > 0, null, { timeout: 5000 });
  const videoTimelineLane = await page.evaluate(() => {
    const header = document.querySelector("[data-video-track-header]");
    const rect = header?.getBoundingClientRect();
    const text = header?.textContent ?? "";
    return {
      headerCount: document.querySelectorAll("[data-video-track-header]").length,
      headerHeight: rect?.height ?? 0,
      text,
      canvasPresent: !!document.querySelector(".rh-canvas"),
    };
  });
  check(
    "Video reference appears as a picture lane in the main timeline",
    videoTimelineLane.headerCount === 1 &&
      videoTimelineLane.headerHeight >= 40 &&
      videoTimelineLane.text.includes("Video") &&
      videoTimelineLane.text.includes("V1") &&
      videoTimelineLane.canvasPresent,
    JSON.stringify(videoTimelineLane),
  );
  const thumbnailSource = await page.evaluate(async () => {
    if (!window.__videoPreview || !window.__videoThumbnails) return { ready: false, error: "thumbnail dev bridge unavailable" };
    if (!window.MediaRecorder) return { ready: false, error: "MediaRecorder unavailable" };
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 54;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.captureStream) return { ready: false, error: "canvas stream unavailable" };
    const paint = (frame) => {
      ctx.fillStyle = frame % 2 ? "#2dd4bf" : "#f97316";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111827";
      ctx.fillRect(8 + (frame % 10) * 6, 10, 20, 30);
      ctx.fillStyle = frame % 3 ? "#fde68a" : "#38bdf8";
      ctx.fillRect(58 - (frame % 6) * 3, 6 + (frame % 5) * 4, 28, 18);
    };
    paint(0);
    const stream = canvas.captureStream(12);
    if (!stream) return { ready: false, error: "canvas stream unavailable" };
    const videoTrack = stream.getVideoTracks()[0];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const recording = await new Promise((resolve) => {
      recorder.onerror = (event) => resolve({ error: event.error?.message ?? "MediaRecorder failed" });
      recorder.onstop = () => setTimeout(() => resolve({}), 150);
      recorder.start(100);
      let frame = 0;
      let timer = 0;
      const stop = () => {
        clearInterval(timer);
        setTimeout(() => {
          try {
            recorder.requestData?.();
          } catch {
            /* recorder may already be inactive */
          }
          if (recorder.state !== "inactive") recorder.stop();
          stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        }, 180);
      };
      const tick = () => {
        paint(frame);
        videoTrack?.requestFrame?.();
        frame += 1;
        if (frame >= 30) {
          stop();
        }
      };
      timer = setInterval(tick, 67);
      tick();
    });
    if (recording.error) return { ready: false, error: recording.error, chunks: chunks.length };
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    window.__videoThumbnails.clearVideoThumbnailStrips("e2e-video-asset");
    window.__videoPreview.registerVideoPreviewUrl("e2e-video-asset", url);
    window.__rythme.dispatch(window.__engine.setPlayhead(3.25), { history: false });
    return { ready: blob.size > 512, size: blob.size, chunks: chunks.length, mimeType };
  });
  await page.waitForFunction(() => {
    const stats = window.__videoThumbnails?.videoThumbnailStats("e2e-video-asset");
    return stats && stats.ready > 0 && stats.frames > 0;
  }, null, { timeout: 10000 }).catch(() => undefined);
  const thumbnailStats = await page.evaluate(() => window.__videoThumbnails.videoThumbnailStats("e2e-video-asset"));
  check(
    "Video timeline decodes linked media into thumbnail frames",
    thumbnailSource.ready && thumbnailStats.ready > 0 && thumbnailStats.frames > 0,
    JSON.stringify({ source: thumbnailSource, stats: thumbnailStats }),
  );
  const videoPictureLock = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const clipId = s.getState().project.videoTracks?.[0]?.clips[0]?.id;
    s.dispatch(E.setVideoClipLocked(clipId, true), { label: "Picture Lock Fixture" });
    const clip = s.getState().project.videoTracks?.[0]?.clips[0];
    return { clipId, locked: clip?.locked, canUndo: s.canUndo() };
  });
  await page.waitForFunction(() => (document.querySelector("[data-video-track-header]")?.textContent ?? "").includes("LOCK"), null, { timeout: 5000 });
  check(
    "Picture lock marks the video lane as locked",
    !!videoPictureLock.clipId && videoPictureLock.locked === true && videoPictureLock.canUndo,
    JSON.stringify(videoPictureLock),
  );
  const videoPictureUnlock = await page.evaluate(() => {
    window.__rythme.undo();
    const clip = window.__rythme.getState().project.videoTracks?.[0]?.clips[0];
    return { locked: clip?.locked };
  });
  check("Picture lock undoes cleanly", videoPictureUnlock.locked !== true, JSON.stringify(videoPictureUnlock));
  const videoRelink = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(
      E.updateVideoAsset("e2e-video-asset", {
        sourceName: "picture-lock-relinked.mov",
        mimeType: "video/quicktime",
        duration: 6.5,
        width: 1280,
        height: 720,
        frameRate: 23.976,
      }),
      { label: "Relink Video Fixture" },
    );
    const project = s.getState().project;
    const asset = project.videoAssets?.find((a) => a.id === "e2e-video-asset");
    const clip = project.videoTracks?.[0]?.clips[0];
    const roundTrip = E.IO.deserializeProject(E.IO.serializeProject(project));
    const backAsset = roundTrip.videoAssets?.find((a) => a.id === "e2e-video-asset");
    return {
      sourceName: asset?.sourceName,
      mimeType: asset?.mimeType,
      duration: asset?.duration,
      width: asset?.width,
      height: asset?.height,
      frameRate: asset?.frameRate,
      clipStart: clip?.start,
      clipDuration: clip?.duration,
      roundTripSourceName: backAsset?.sourceName,
      roundTripDuration: backAsset?.duration,
      canUndo: s.canUndo(),
    };
  });
  check(
    "Video media relink updates persisted asset metadata without moving the picture clip",
    videoRelink.sourceName === "picture-lock-relinked.mov" &&
      videoRelink.mimeType === "video/quicktime" &&
      videoRelink.duration === 6.5 &&
      videoRelink.width === 1280 &&
      videoRelink.height === 720 &&
      videoRelink.frameRate === 23.976 &&
      videoRelink.clipStart === 3 &&
      videoRelink.clipDuration === 5 &&
      videoRelink.roundTripSourceName === "picture-lock-relinked.mov" &&
      videoRelink.roundTripDuration === 6.5 &&
      videoRelink.canUndo,
    JSON.stringify(videoRelink),
  );
  const videoRelinkUndo = await page.evaluate(() => {
    window.__rythme.undo();
    const p = window.__rythme.getState().project;
    const asset = p.videoAssets?.find((a) => a.id === "e2e-video-asset");
    return { sourceName: asset?.sourceName, duration: asset?.duration, videoAssets: p.videoAssets?.length ?? 0 };
  });
  check("Video media relink undoes cleanly", videoRelinkUndo.sourceName === "picture-lock.mp4" && videoRelinkUndo.duration === 5 && videoRelinkUndo.videoAssets === 1, JSON.stringify(videoRelinkUndo));
  const videoUndo = await page.evaluate(() => {
    window.__rythme.undo();
    const p = window.__rythme.getState().project;
    return { videoAssets: p.videoAssets?.length ?? 0, videoTracks: p.videoTracks?.length ?? 0 };
  });
  check("Video reference import undoes cleanly", videoUndo.videoAssets === 0 && videoUndo.videoTracks === 0, JSON.stringify(videoUndo));
  const videoAudioImport = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const beforeTracks = s.getState().project.tracks.length;
    const sr = s.getState().project.sampleRate;
    const audio = E.Generate.sine(440, 2, { sampleRate: sr, channels: 2, amplitude: 0.25 });
    const asset = E.newVideoAsset({
      id: "e2e-video-audio-asset",
      name: "dialogue-scene.mov",
      sourceName: "dialogue-scene.mov",
      mimeType: "video/quicktime",
      duration: 2.5,
      width: 1280,
      height: 720,
      frameRate: 24,
      hasAudio: true,
    });
    s.dispatch(E.addVideoReferenceWithExtractedAudio(asset, audio, { start: 9, duration: 2.5, audioTrackName: "Extracted Dialogue" }), {
      label: "Video Audio Fixture",
    });
    const p = s.getState().project;
    const track = p.tracks[p.tracks.length - 1];
    const clip = track?.clips[0];
    return {
      beforeTracks,
      afterTracks: p.tracks.length,
      videoAssets: p.videoAssets?.length ?? 0,
      videoTracks: p.videoTracks?.length ?? 0,
      videoStart: p.videoTracks?.[0]?.clips[0]?.start,
      audioTrackName: track?.name,
      audioClipStart: clip?.start,
      audioClipDuration: clip?.duration,
      activeTrackId: s.getState().activeTrackId,
      audioTrackId: track?.id,
      canUndo: s.canUndo(),
    };
  });
  check(
    "Video + extracted audio import creates aligned picture and audio clips in one edit",
    videoAudioImport.afterTracks === videoAudioImport.beforeTracks + 1 &&
      videoAudioImport.videoAssets === 1 &&
      videoAudioImport.videoTracks === 1 &&
      videoAudioImport.videoStart === 9 &&
      videoAudioImport.audioTrackName === "Extracted Dialogue" &&
      videoAudioImport.audioClipStart === 9 &&
      videoAudioImport.audioClipDuration === 2 &&
      videoAudioImport.activeTrackId === videoAudioImport.audioTrackId &&
      videoAudioImport.canUndo,
    JSON.stringify(videoAudioImport),
  );
  const videoAudioUndo = await page.evaluate(() => {
    window.__rythme.undo();
    const p = window.__rythme.getState().project;
    return { tracks: p.tracks.length, videoAssets: p.videoAssets?.length ?? 0, videoTracks: p.videoTracks?.length ?? 0 };
  });
  check(
    "Video + extracted audio import undoes as one operation",
    videoAudioUndo.tracks === videoAudioImport.beforeTracks && videoAudioUndo.videoAssets === 0 && videoAudioUndo.videoTracks === 0,
    JSON.stringify(videoAudioUndo),
  );

  console.log("• timeline automation lanes");
  await page.locator('.rh-auto-toggle', { hasText: "PAN" }).first().click();
  await page.locator('[aria-label="Envelope (E)"]').click();
  const timelineAutomationBox = {
    canvas: await page.locator(".rh-canvas").boundingBox(),
    header: await page.locator(".rh-track-head:not(.rh-video-track-head)").first().boundingBox(),
  };
  if (timelineAutomationBox.canvas && timelineAutomationBox.header) {
    const x0 = timelineAutomationBox.canvas.x + 230;
    const x1 = timelineAutomationBox.canvas.x + 330;
    const y0 = timelineAutomationBox.header.y + timelineAutomationBox.header.height * 0.18;
    const y1 = timelineAutomationBox.header.y + timelineAutomationBox.header.height * 0.82;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
  }
  const panAutomation = await page.evaluate(() => {
    const s = window.__rythme.getState();
    const lane = s.project.tracks[0].automation?.find((automation) => automation.target.kind === "pan");
    const volumeLane = s.project.tracks[0].automation?.find((automation) => automation.target.kind === "gainDb");
    return {
      tool: s.tool,
      laneName: lane?.name,
      points: lane?.points ?? [],
      volumePoints: volumeLane?.points.length ?? 0,
    };
  });
  check(
    "Timeline envelope tool draws pan automation when PAN is selected",
    panAutomation.tool === "envelope" &&
      panAutomation.laneName === "Pan" &&
      panAutomation.points.length >= 2 &&
      panAutomation.points.some((p) => p.value > 0.5) &&
      panAutomation.points.some((p) => p.value < -0.5) &&
      panAutomation.volumePoints === 0,
    JSON.stringify(panAutomation),
  );
  const clipLaneFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks[0];
    if (!track) return { ready: false, error: "no track" };
    const sr = s.getState().project.sampleRate;
    const audio = E.createAudioData(1, sr * 2, sr);
    for (let i = 0; i < audio.channels[0].length; i++) audio.channels[0][i] = Math.sin((i / sr) * Math.PI * 2 * 330) * 0.25;
    s.dispatch(E.insertClip(track.id, audio, 1, "e2e-clip-lane"), { history: false });
    s.dispatch(E.setZoom(180), { history: false });
    s.dispatch(E.setScroll(0, 0), { history: false });
    const clip = s.getState().project.tracks[0].clips.find((item) => item.name === "e2e-clip-lane");
    return { ready: !!clip, trackId: track.id, clipId: clip?.id, start: clip?.start, duration: clip?.duration, pxPerSecond: s.getState().view.pxPerSecond };
  });
  if (clipLaneFixture.ready) {
    await page.waitForSelector('[data-action="timeline-clip-gain-automation"]', { timeout: 5000 });
    await page.click('[data-action="timeline-clip-gain-automation"]');
    const clipLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator(".rh-track-head:not(.rh-video-track-head)").first().boundingBox(),
    };
    if (clipLaneBox.canvas && clipLaneBox.header) {
      const x0 = clipLaneBox.canvas.x + 170 + (clipLaneFixture.start ?? 1) * (clipLaneFixture.pxPerSecond ?? 180) + 24;
      const x1 = clipLaneBox.canvas.x + 170 + ((clipLaneFixture.start ?? 1) + 0.75) * (clipLaneFixture.pxPerSecond ?? 180);
      const y0 = clipLaneBox.header.y + clipLaneBox.header.height * 0.80;
      const y1 = clipLaneBox.header.y + clipLaneBox.header.height * 0.20;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const clipLaneAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const clip = track?.clips.find((item) => item.id === fixture.clipId);
    const lane = clip?.automation?.find((automation) => automation.target.kind === "gainDb");
    const pressed = document.querySelector('[data-action="timeline-clip-gain-automation"]')?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      clipDuration: clip?.duration,
      trackVolumePoints: track?.automation?.find((automation) => automation.target.kind === "gainDb")?.points.length ?? 0,
      clipPanPoints: clip?.automation?.find((automation) => automation.target.kind === "pan")?.points.length ?? 0,
    };
    if (lane) s.undo();
    if (fixture.clipId) s.dispatch(E.deleteClipCmd(fixture.clipId), { history: false });
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, clipLaneFixture);
  check(
    "Timeline envelope tool draws clip volume automation inside a clip",
    clipLaneAutomation.ready &&
      clipLaneAutomation.tool === "envelope" &&
      clipLaneAutomation.pressed === "true" &&
      clipLaneAutomation.laneName === "Clip Volume" &&
      clipLaneAutomation.target?.kind === "gainDb" &&
      clipLaneAutomation.points.length >= 2 &&
      clipLaneAutomation.points.every((p) => p.time >= 0 && p.time <= clipLaneAutomation.clipDuration) &&
      clipLaneAutomation.points.some((p) => p.value > -3) &&
      clipLaneAutomation.points.some((p) => p.value < -40) &&
      clipLaneAutomation.trackVolumePoints === 0 &&
      clipLaneAutomation.clipPanPoints === 0,
    JSON.stringify(clipLaneAutomation),
  );
  const clipRackLaneFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks[0];
    if (!track) return { ready: false, error: "no track" };
    const slotId = "e2e-clip-rack-gain";
    const sr = s.getState().project.sampleRate;
    const audio = E.createAudioData(1, sr * 2, sr);
    for (let i = 0; i < audio.channels[0].length; i++) audio.channels[0][i] = Math.sin((i / sr) * Math.PI * 2 * 440) * 0.2;
    s.dispatch(E.insertClip(track.id, audio, 1.25, "e2e-clip-rack-lane"), { history: false });
    const clip = s.getState().project.tracks[0].clips.find((item) => item.name === "e2e-clip-rack-lane");
    if (!clip) return { ready: false, error: "clip not inserted" };
    s.dispatch(E.addClipEffectSlot(clip.id, E.newEffectSlot("gain", { id: slotId, name: "E2E Clip Gain", params: { gainDb: -6 } })), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    s.dispatch(E.setZoom(180), { history: false });
    s.dispatch(E.setScroll(0, 0), { history: false });
    const selected = s.getState().project.tracks[0].clips.find((item) => item.id === clip.id);
    return { ready: true, trackId: track.id, clipId: clip.id, slotId, start: selected?.start, duration: selected?.duration, pxPerSecond: s.getState().view.pxPerSecond };
  });
  if (clipRackLaneFixture.ready) {
    await page.waitForSelector(
      '[data-action="timeline-clip-rack-gain-automation"][data-clip-id="' + clipRackLaneFixture.clipId + '"][data-effect-slot-id="e2e-clip-rack-gain"]',
      { timeout: 5000 },
    );
    await page.click('[data-action="timeline-clip-rack-gain-automation"][data-clip-id="' + clipRackLaneFixture.clipId + '"][data-effect-slot-id="e2e-clip-rack-gain"]');
    const clipRackLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator(".rh-track-head:not(.rh-video-track-head)").first().boundingBox(),
    };
    if (clipRackLaneBox.canvas && clipRackLaneBox.header) {
      const x0 = clipRackLaneBox.canvas.x + 170 + (clipRackLaneFixture.start ?? 1.25) * (clipRackLaneFixture.pxPerSecond ?? 180) + 24;
      const x1 = clipRackLaneBox.canvas.x + 170 + ((clipRackLaneFixture.start ?? 1.25) + 0.75) * (clipRackLaneFixture.pxPerSecond ?? 180);
      const y0 = clipRackLaneBox.header.y + clipRackLaneBox.header.height * 0.82;
      const y1 = clipRackLaneBox.header.y + clipRackLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const clipRackLaneAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const clip = track?.clips.find((item) => item.id === fixture.clipId);
    const lane = clip?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === fixture.slotId);
    const pressed = document
      .querySelector(`[data-action="timeline-clip-rack-gain-automation"][data-clip-id="${fixture.clipId}"][data-effect-slot-id="${fixture.slotId}"]`)
      ?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      clipDuration: clip?.duration,
      clipVolumePoints: clip?.automation?.find((automation) => automation.target.kind === "gainDb")?.points.length ?? 0,
      trackEffectParamPoints: track?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === fixture.slotId)?.points.length ?? 0,
    };
    if (lane) s.undo();
    if (fixture.clipId) s.dispatch(E.deleteClipCmd(fixture.clipId), { history: false });
    s.dispatch(E.clearSelection(), { history: false });
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, clipRackLaneFixture);
  check(
    "Timeline envelope tool draws clip rack gain automation inside a selected clip",
    clipRackLaneAutomation.ready &&
      clipRackLaneAutomation.tool === "envelope" &&
      clipRackLaneAutomation.pressed === "true" &&
      clipRackLaneAutomation.laneName === "E2E Clip Gain gainDb" &&
      clipRackLaneAutomation.target?.kind === "effectParam" &&
      clipRackLaneAutomation.target?.effectSlotId === "e2e-clip-rack-gain" &&
      clipRackLaneAutomation.target?.param === "gainDb" &&
      clipRackLaneAutomation.points.length >= 2 &&
      clipRackLaneAutomation.points.every((p) => p.time >= 0 && p.time <= clipRackLaneAutomation.clipDuration) &&
      clipRackLaneAutomation.points.some((p) => p.value > 6) &&
      clipRackLaneAutomation.points.some((p) => p.value < -40) &&
      clipRackLaneAutomation.clipVolumePoints === 0 &&
      clipRackLaneAutomation.trackEffectParamPoints === 0,
    JSON.stringify(clipRackLaneAutomation),
  );
  const sendLaneFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks[0];
    if (!track) return { ready: false, error: "no track" };
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-lane-send-bus")) {
      s.dispatch(E.addBus({ id: "e2e-lane-send-bus", name: "E2E Lane Send Bus" }), { history: false });
    }
    const nextTrack = s.getState().project.tracks.find((item) => item.id === track.id);
    if (!nextTrack?.sends?.some((send) => send.id === "e2e-lane-send")) {
      s.dispatch(E.addTrackSend(track.id, "e2e-lane-send-bus", { id: "e2e-lane-send", name: "E2E Lane Send", gainDb: -12 }), { history: false });
    }
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    return { ready: true, trackId: track.id, sendId: "e2e-lane-send" };
  });
  if (sendLaneFixture.ready) {
    await page.waitForSelector('[data-action="timeline-send-gain-automation"][data-send-id="e2e-lane-send"]', { timeout: 5000 });
    await page.click('[data-action="timeline-send-gain-automation"][data-send-id="e2e-lane-send"]');
    const sendLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator(".rh-track-head:not(.rh-video-track-head)").first().boundingBox(),
    };
    if (sendLaneBox.canvas && sendLaneBox.header) {
      const x0 = sendLaneBox.canvas.x + 250;
      const x1 = sendLaneBox.canvas.x + 370;
      const y0 = sendLaneBox.header.y + sendLaneBox.header.height * 0.82;
      const y1 = sendLaneBox.header.y + sendLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const sendLaneAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const lane = track?.automation?.find((automation) => automation.target.kind === "sendGainDb" && automation.target.sendId === fixture.sendId);
    const pressed = document.querySelector(`[data-action="timeline-send-gain-automation"][data-send-id="${fixture.sendId}"]`)?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      panPoints: track?.automation?.find((automation) => automation.target.kind === "sendPan" && automation.target.sendId === fixture.sendId)?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeTrackSend(fixture.trackId, fixture.sendId), { history: false });
    s.dispatch(E.removeBus("e2e-lane-send-bus"), { history: false });
    return result;
  }, sendLaneFixture);
  check(
    "Timeline envelope tool draws track send gain automation when a send lane is selected",
    sendLaneAutomation.ready &&
      sendLaneAutomation.tool === "envelope" &&
      sendLaneAutomation.pressed === "true" &&
      sendLaneAutomation.laneName === "E2E Lane Send Send Gain" &&
      sendLaneAutomation.target?.kind === "sendGainDb" &&
      sendLaneAutomation.target?.sendId === "e2e-lane-send" &&
      sendLaneAutomation.points.length >= 2 &&
      sendLaneAutomation.points.some((p) => p.value > -2) &&
      sendLaneAutomation.points.some((p) => p.value < -40) &&
      sendLaneAutomation.panPoints === 0,
    JSON.stringify(sendLaneAutomation),
  );
  const busLaneFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-lane-bus")) {
      s.dispatch(E.addBus({ id: "e2e-lane-bus", name: "E2E Lane Bus" }), { history: false });
    }
    const trackHeight = s.getState().project.tracks.reduce((sum, track) => sum + (track.height ?? 96), 0);
    s.dispatch(E.setScroll(s.getState().view.scrollSec, Math.max(0, trackHeight - 96)), { history: false });
    return { ready: true, busId: "e2e-lane-bus" };
  });
  if (busLaneFixture.ready) {
    await page.waitForSelector('[data-action="timeline-bus-gain-automation"][data-bus-id="e2e-lane-bus"]', { timeout: 5000 });
    await page.click('[data-action="timeline-bus-gain-automation"][data-bus-id="e2e-lane-bus"]');
    const busLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator('[data-bus-lane-header="e2e-lane-bus"]').boundingBox(),
    };
    if (busLaneBox.canvas && busLaneBox.header) {
      const x0 = busLaneBox.canvas.x + 260;
      const x1 = busLaneBox.canvas.x + 380;
      const y0 = busLaneBox.header.y + busLaneBox.header.height * 0.80;
      const y1 = busLaneBox.header.y + busLaneBox.header.height * 0.20;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const busLaneAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const bus = s.getState().project.buses?.find((item) => item.id === fixture.busId);
    const lane = bus?.automation?.find((automation) => automation.target.kind === "gainDb");
    const pressed = document.querySelector(`[data-action="timeline-bus-gain-automation"][data-bus-id="${fixture.busId}"]`)?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      panPoints: bus?.automation?.find((automation) => automation.target.kind === "pan")?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeBus(fixture.busId), { history: false });
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, busLaneFixture);
  check(
    "Timeline envelope tool draws bus volume automation on a visible bus lane",
    busLaneAutomation.ready &&
      busLaneAutomation.tool === "envelope" &&
      busLaneAutomation.pressed === "true" &&
      busLaneAutomation.laneName === "Bus Volume" &&
      busLaneAutomation.target?.kind === "gainDb" &&
      busLaneAutomation.points.length >= 2 &&
      busLaneAutomation.points.some((p) => p.value > -3) &&
      busLaneAutomation.points.some((p) => p.value < -40) &&
      busLaneAutomation.panPoints === 0,
    JSON.stringify(busLaneAutomation),
  );
  const busSendLaneFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-lane-bus-source")) {
      s.dispatch(E.addBus({ id: "e2e-lane-bus-source", name: "E2E Lane Bus Source" }), { history: false });
    }
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-lane-bus-target")) {
      s.dispatch(E.addBus({ id: "e2e-lane-bus-target", name: "E2E Lane Bus Target" }), { history: false });
    }
    const source = s.getState().project.buses?.find((bus) => bus.id === "e2e-lane-bus-source");
    if (!source?.sends?.some((send) => send.id === "e2e-lane-bus-send")) {
      s.dispatch(E.addBusSend("e2e-lane-bus-source", "e2e-lane-bus-target", { id: "e2e-lane-bus-send", name: "E2E Lane Bus Send" }), {
        history: false,
      });
    }
    const trackHeight = s.getState().project.tracks.reduce((sum, track) => sum + (track.height ?? 96), 0);
    s.dispatch(E.setScroll(s.getState().view.scrollSec, Math.max(0, trackHeight - 96)), { history: false });
    return { ready: true, busId: "e2e-lane-bus-source", sendId: "e2e-lane-bus-send" };
  });
  if (busSendLaneFixture.ready) {
    await page.waitForSelector('[data-action="timeline-bus-send-gain-automation"][data-send-id="e2e-lane-bus-send"]', { timeout: 5000 });
    await page.click('[data-action="timeline-bus-send-gain-automation"][data-send-id="e2e-lane-bus-send"]');
    const busSendLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator('[data-bus-lane-header="e2e-lane-bus-source"]').boundingBox(),
    };
    if (busSendLaneBox.canvas && busSendLaneBox.header) {
      const x0 = busSendLaneBox.canvas.x + 270;
      const x1 = busSendLaneBox.canvas.x + 390;
      const y0 = busSendLaneBox.header.y + busSendLaneBox.header.height * 0.82;
      const y1 = busSendLaneBox.header.y + busSendLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const busSendLaneAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const bus = s.getState().project.buses?.find((item) => item.id === fixture.busId);
    const lane = bus?.automation?.find((automation) => automation.target.kind === "sendGainDb" && automation.target.sendId === fixture.sendId);
    const pressed = document.querySelector(`[data-action="timeline-bus-send-gain-automation"][data-send-id="${fixture.sendId}"]`)?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      panPoints: bus?.automation?.find((automation) => automation.target.kind === "sendPan" && automation.target.sendId === fixture.sendId)?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeBusSend(fixture.busId, fixture.sendId), { history: false });
    s.dispatch(E.removeBus("e2e-lane-bus-source"), { history: false });
    s.dispatch(E.removeBus("e2e-lane-bus-target"), { history: false });
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, busSendLaneFixture);
  check(
    "Timeline envelope tool draws bus send gain automation when a bus send lane is selected",
    busSendLaneAutomation.ready &&
      busSendLaneAutomation.tool === "envelope" &&
      busSendLaneAutomation.pressed === "true" &&
      busSendLaneAutomation.laneName === "E2E Lane Bus Send Send Gain" &&
      busSendLaneAutomation.target?.kind === "sendGainDb" &&
      busSendLaneAutomation.target?.sendId === "e2e-lane-bus-send" &&
      busSendLaneAutomation.points.length >= 2 &&
      busSendLaneAutomation.points.some((p) => p.value > -2) &&
      busSendLaneAutomation.points.some((p) => p.value < -40) &&
      busSendLaneAutomation.panPoints === 0,
    JSON.stringify(busSendLaneAutomation),
  );
  const masterLaneFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const st = s.getState();
    const videoHeight = (st.project.videoTracks ?? []).filter((track) => track.visible !== false).reduce((sum, track) => sum + (track.height ?? 72), 0);
    const trackHeight = st.project.tracks.reduce((sum, track) => sum + (track.height ?? 96), 0);
    const busHeight = (st.project.buses ?? []).length * 72;
    s.dispatch(E.setScroll(st.view.scrollSec, Math.max(0, videoHeight + trackHeight + busHeight)), { history: false });
    return { ready: true };
  });
  if (masterLaneFixture.ready) {
    await page.waitForSelector('[data-action="timeline-master-gain-automation"]', { timeout: 5000 });
    await page.click('[data-action="timeline-master-gain-automation"]');
    const masterLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator("[data-master-lane-header]").boundingBox(),
    };
    if (masterLaneBox.canvas && masterLaneBox.header) {
      const x0 = masterLaneBox.canvas.x + 280;
      const x1 = masterLaneBox.canvas.x + 400;
      const y0 = masterLaneBox.header.y + masterLaneBox.header.height * 0.82;
      const y1 = masterLaneBox.header.y + masterLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const masterLaneAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const lane = s.getState().project.masterAutomation?.find((automation) => automation.target.kind === "gainDb");
    const pressed = document.querySelector('[data-action="timeline-master-gain-automation"]')?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      panPoints: s.getState().project.masterAutomation?.find((automation) => automation.target.kind === "pan")?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, masterLaneFixture);
  check(
    "Timeline envelope tool draws master volume automation on the master lane",
    masterLaneAutomation.ready &&
      masterLaneAutomation.tool === "envelope" &&
      masterLaneAutomation.pressed === "true" &&
      masterLaneAutomation.laneName === "Master Volume" &&
      masterLaneAutomation.target?.kind === "gainDb" &&
      masterLaneAutomation.points.length >= 2 &&
      masterLaneAutomation.points.some((p) => p.value > -3) &&
      masterLaneAutomation.points.some((p) => p.value < -40) &&
      masterLaneAutomation.panPoints === 0,
    JSON.stringify(masterLaneAutomation),
  );
  await page.locator('[aria-label="Selection (V)"]').click();

  console.log("• editor modes");
  await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const firstClip = s.getState().project.tracks.find((t) => t.clips.length > 0)?.clips[0];
    if (firstClip) s.dispatch(E.selectClips([firstClip.id]), { history: false });
    s.dispatch(E.setEditorMode("waveform"), { history: false });
  });
  await page.waitForSelector(".rh-waveform-canvas", { timeout: 5000 });
  const waveformRendered = await page.evaluate(() => {
    const canvas = document.querySelector(".rh-waveform-canvas");
    return {
      mode: window.__rythme.getState().mode,
      hasCanvas: !!canvas,
      width: canvas?.clientWidth ?? 0,
      height: canvas?.clientHeight ?? 0,
    };
  });
  check("Waveform editor mode state is active", waveformRendered.mode === "waveform", JSON.stringify(waveformRendered));
  check("waveform canvas rendered", waveformRendered.hasCanvas && waveformRendered.width > 0 && waveformRendered.height > 0, JSON.stringify(waveformRendered));
  const waveformBox = await page.locator(".rh-waveform-canvas").boundingBox();
  if (waveformBox) {
    await page.mouse.move(waveformBox.x + waveformBox.width * 0.25, waveformBox.y + waveformBox.height * 0.76);
    await page.mouse.down();
    await page.mouse.move(waveformBox.x + waveformBox.width * 0.55, waveformBox.y + waveformBox.height * 0.92, { steps: 4 });
    await page.mouse.up();
  }
  const spectralSelection = await page.evaluate(() => window.__rythme.getState().selection.spectral);
  check(
    "Waveform spectral lane creates a time-frequency selection",
    !!spectralSelection &&
      spectralSelection.time.end > spectralSelection.time.start &&
      spectralSelection.frequency.maxHz > spectralSelection.frequency.minHz,
    JSON.stringify(spectralSelection),
  );
  const spectralEditBefore = await page.evaluate(() => {
    const s = window.__rythme.getState();
    const tid = s.activeTrackId;
    const track = s.project.tracks.find((t) => t.id === tid);
    return { trackId: tid, clipCount: track?.clips.length ?? 0 };
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="spectral-silence"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="spectral-silence"]');
  const spectralEditAfter = await page.evaluate((before) => {
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === before.trackId);
    return { clipCount: track?.clips.length ?? 0, canUndo: window.__rythme.canUndo() };
  }, spectralEditBefore);
  check(
    "Waveform spectral silence applies through the main editor",
    spectralEditAfter.clipCount > spectralEditBefore.clipCount && spectralEditAfter.canUndo,
    JSON.stringify({ before: spectralEditBefore, after: spectralEditAfter }),
  );
  await page.evaluate(() => window.__rythme.undo());
  const spectralUndo = await page.evaluate((before) => {
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === before.trackId);
    return { clipCount: track?.clips.length ?? 0 };
  }, spectralEditBefore);
  check("Waveform spectral silence undoes cleanly", spectralUndo.clipCount === spectralEditBefore.clipCount, JSON.stringify(spectralUndo));
  const harmonicSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const tones = [440, 880, 1320, 3000].map((hz) => E.Generate.sine(hz, 0.8, { sampleRate: sr, amplitude: 0.2, channels: 1 }));
    const audio = E.createAudioData(1, E.frameCount(tones[0]), sr);
    for (let i = 0; i < E.frameCount(audio); i++) {
      for (const tone of tones) audio.channels[0][i] += tone.channels[0][i];
    }
    s.dispatch(E.insertClip(track.id, audio, 14, "spectral-harmonics"), { label: "Spectral Harmonics Fixture" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "spectral-harmonics");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    s.dispatch(E.selectSpectralRange({ time: { start: clip.start, end: clip.start + clip.duration }, frequency: { minHz: 420, maxHz: 460 }, channel: "all" }), {
      history: false,
    });
    const binDb = (d, hz) => {
      const spec = E.Analysis.spectrum(d, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = E.Ops.renderClip(clip);
    return {
      trackId: track.id,
      clipId: clip.id,
      before: {
        h1: binDb(rendered, 440),
        h2: binDb(rendered, 880),
        h3: binDb(rendered, 1320),
        off: binDb(rendered, 3000),
      },
    };
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="spectral-harmonics-silence"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="spectral-harmonics-silence"]');
  const harmonicAfter = await page.evaluate((setup) => {
    const E = window.__engine;
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === setup.trackId);
    const clip = track?.clips.find((c) => c.id === setup.clipId || c.name === "spectral-harmonics");
    const binDb = (d, hz) => {
      const spec = E.Analysis.spectrum(d, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = clip ? E.Ops.renderClip(clip) : null;
    return rendered
      ? {
          h1: binDb(rendered, 440),
          h2: binDb(rendered, 880),
          h3: binDb(rendered, 1320),
          off: binDb(rendered, 3000),
          canUndo: window.__rythme.canUndo(),
        }
      : { missing: true };
  }, harmonicSetup);
  check(
    "Waveform harmonic spectral silence attenuates the harmonic stack",
    harmonicAfter.h1 < harmonicSetup.before.h1 - 15 &&
      harmonicAfter.h2 < harmonicSetup.before.h2 - 15 &&
      harmonicAfter.h3 < harmonicSetup.before.h3 - 15 &&
      Math.abs(harmonicAfter.off - harmonicSetup.before.off) < 4 &&
      harmonicAfter.canUndo,
    JSON.stringify({ before: harmonicSetup.before, after: harmonicAfter }),
  );
  const harmonicUndo = await page.evaluate((setup) => {
    const E = window.__engine;
    window.__rythme.undo();
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === setup.trackId);
    const clip = track?.clips.find((c) => c.id === setup.clipId || c.name === "spectral-harmonics");
    const binDb = (d, hz) => {
      const spec = E.Analysis.spectrum(d, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = clip ? E.Ops.renderClip(clip) : null;
    const restored = rendered
      ? {
          h1: binDb(rendered, 440),
          h2: binDb(rendered, 880),
          h3: binDb(rendered, 1320),
          off: binDb(rendered, 3000),
        }
      : { missing: true };
    window.__rythme.undo();
    return restored;
  }, harmonicSetup);
  check(
    "Waveform harmonic spectral silence undoes cleanly",
    Math.abs(harmonicUndo.h1 - harmonicSetup.before.h1) < 3 &&
      Math.abs(harmonicUndo.h2 - harmonicSetup.before.h2) < 3 &&
      Math.abs(harmonicUndo.h3 - harmonicSetup.before.h3) < 3 &&
      Math.abs(harmonicUndo.off - harmonicSetup.before.off) < 3,
    JSON.stringify({ before: harmonicSetup.before, undo: harmonicUndo }),
  );
  const brushSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const low = E.Generate.sine(500, 1, { sampleRate: sr, amplitude: 0.35, channels: 1 });
    const high = E.Generate.sine(4000, 1, { sampleRate: sr, amplitude: 0.25, channels: 1 });
    const edge = E.Generate.sine(4400, 1, { sampleRate: sr, amplitude: 0.25, channels: 1 });
    const audio = E.createAudioData(1, E.frameCount(low), sr);
    for (let i = 0; i < E.frameCount(audio); i++) audio.channels[0][i] = low.channels[0][i] + high.channels[0][i] + edge.channels[0][i];
    s.dispatch(E.insertClip(track.id, audio, 15, "spectral-brush"), { label: "Spectral Brush Fixture" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "spectral-brush");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    s.dispatch(E.selectSpectralRange({ time: { start: clip.start, end: clip.start + clip.duration }, frequency: { minHz: 3500, maxHz: 4500 }, channel: "all" }), {
      history: false,
    });
    const segmentDb = (d, hz, startSeconds, endSeconds) => {
      const slice = E.sliceFrames(d, Math.round(startSeconds * d.sampleRate), Math.round(endSeconds * d.sampleRate));
      const spec = E.Analysis.spectrum(slice, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = E.Ops.renderClip(clip);
    return {
      trackId: track.id,
      clipId: clip.id,
      before: {
        edgeHigh: segmentDb(rendered, 4000, 0, 0.1),
        centerHigh: segmentDb(rendered, 4000, 0.45, 0.55),
        frequencyEdge: segmentDb(rendered, 4400, 0.45, 0.55),
        centerLow: segmentDb(rendered, 500, 0.45, 0.55),
      },
    };
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="spectral-brush-silence"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="spectral-brush-silence"]');
  const brushAfter = await page.evaluate((setup) => {
    const E = window.__engine;
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === setup.trackId);
    const clip = track?.clips.find((c) => c.id === setup.clipId || c.name === "spectral-brush");
    const segmentDb = (d, hz, startSeconds, endSeconds) => {
      const slice = E.sliceFrames(d, Math.round(startSeconds * d.sampleRate), Math.round(endSeconds * d.sampleRate));
      const spec = E.Analysis.spectrum(slice, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = clip ? E.Ops.renderClip(clip) : null;
    return rendered
      ? {
          edgeHigh: segmentDb(rendered, 4000, 0, 0.1),
          centerHigh: segmentDb(rendered, 4000, 0.45, 0.55),
          frequencyEdge: segmentDb(rendered, 4400, 0.45, 0.55),
          centerLow: segmentDb(rendered, 500, 0.45, 0.55),
          canUndo: window.__rythme.canUndo(),
        }
      : { missing: true };
  }, brushSetup);
  check(
    "Waveform spectral brush silence is strongest at the brush center",
    brushAfter.centerHigh < brushSetup.before.centerHigh - 12 &&
      Math.abs(brushAfter.edgeHigh - brushSetup.before.edgeHigh) < 6 &&
      Math.abs(brushAfter.frequencyEdge - brushSetup.before.frequencyEdge) < 6 &&
      Math.abs(brushAfter.centerLow - brushSetup.before.centerLow) < 4 &&
      brushAfter.canUndo,
    JSON.stringify({ before: brushSetup.before, after: brushAfter }),
  );
  const brushUndo = await page.evaluate((setup) => {
    const E = window.__engine;
    window.__rythme.undo();
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === setup.trackId);
    const clip = track?.clips.find((c) => c.id === setup.clipId || c.name === "spectral-brush");
    const segmentDb = (d, hz, startSeconds, endSeconds) => {
      const slice = E.sliceFrames(d, Math.round(startSeconds * d.sampleRate), Math.round(endSeconds * d.sampleRate));
      const spec = E.Analysis.spectrum(slice, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = clip ? E.Ops.renderClip(clip) : null;
    const restored = rendered
      ? {
          edgeHigh: segmentDb(rendered, 4000, 0, 0.1),
          centerHigh: segmentDb(rendered, 4000, 0.45, 0.55),
          frequencyEdge: segmentDb(rendered, 4400, 0.45, 0.55),
          centerLow: segmentDb(rendered, 500, 0.45, 0.55),
        }
      : { missing: true };
    window.__rythme.undo();
    return restored;
  }, brushSetup);
  check(
    "Waveform spectral brush silence undoes cleanly",
    Math.abs(brushUndo.edgeHigh - brushSetup.before.edgeHigh) < 3 &&
      Math.abs(brushUndo.centerHigh - brushSetup.before.centerHigh) < 3 &&
      Math.abs(brushUndo.frequencyEdge - brushSetup.before.frequencyEdge) < 3 &&
      Math.abs(brushUndo.centerLow - brushSetup.before.centerLow) < 3,
    JSON.stringify({ before: brushSetup.before, undo: brushUndo }),
  );
  const channelSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const low = E.Generate.sine(500, 0.8, { sampleRate: sr, amplitude: 0.35, channels: 1 });
    const high = E.Generate.sine(4000, 0.8, { sampleRate: sr, amplitude: 0.35, channels: 1 });
    const audio = E.createAudioData(2, E.frameCount(low), sr);
    for (let i = 0; i < E.frameCount(audio); i++) {
      const sample = low.channels[0][i] + high.channels[0][i];
      audio.channels[0][i] = sample;
      audio.channels[1][i] = sample;
    }
    s.dispatch(E.insertClip(track.id, audio, 16, "spectral-channel"), { label: "Spectral Channel Fixture" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "spectral-channel");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    s.dispatch(E.selectSpectralRange({ time: { start: clip.start, end: clip.start + clip.duration }, frequency: { minHz: 3500, maxHz: 4500 }, channel: "all" }), {
      history: false,
    });
    const channelDb = (d, channel, hz) => {
      const spec = E.Analysis.spectrum({ sampleRate: d.sampleRate, channels: [d.channels[channel]] }, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = E.Ops.renderClip(clip);
    return {
      trackId: track.id,
      clipId: clip.id,
      before: {
        leftHigh: channelDb(rendered, 0, 4000),
        rightHigh: channelDb(rendered, 1, 4000),
      },
    };
  });
  await page.waitForFunction(() => {
    const select = document.querySelector('[data-action="spectral-channel"]');
    return select && !select.disabled;
  });
  await chooseOption(page, '[data-action="spectral-channel"]', "left");
  const selectedChannel = await page.evaluate(() => window.__rythme.getState().selection.spectral?.channel);
  check("Waveform spectral channel selector targets the left channel", selectedChannel === "left", String(selectedChannel));
  await page.click('[data-action="spectral-silence"]');
  const channelAfter = await page.evaluate((setup) => {
    const E = window.__engine;
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === setup.trackId);
    const clip = track?.clips.find((c) => c.id === setup.clipId || c.name === "spectral-channel");
    const channelDb = (d, channel, hz) => {
      const spec = E.Analysis.spectrum({ sampleRate: d.sampleRate, channels: [d.channels[channel]] }, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = clip ? E.Ops.renderClip(clip) : null;
    return rendered
      ? {
          leftHigh: channelDb(rendered, 0, 4000),
          rightHigh: channelDb(rendered, 1, 4000),
          canUndo: window.__rythme.canUndo(),
        }
      : { missing: true };
  }, channelSetup);
  check(
    "Waveform left-channel spectral silence leaves the right channel intact",
    channelAfter.leftHigh < channelSetup.before.leftHigh - 15 &&
      Math.abs(channelAfter.rightHigh - channelSetup.before.rightHigh) < 3 &&
      channelAfter.canUndo,
    JSON.stringify({ before: channelSetup.before, after: channelAfter }),
  );
  const channelUndo = await page.evaluate((setup) => {
    const E = window.__engine;
    window.__rythme.undo();
    const s = window.__rythme.getState();
    const track = s.project.tracks.find((t) => t.id === setup.trackId);
    const clip = track?.clips.find((c) => c.id === setup.clipId || c.name === "spectral-channel");
    const channelDb = (d, channel, hz) => {
      const spec = E.Analysis.spectrum({ sampleRate: d.sampleRate, channels: [d.channels[channel]] }, { fftSize: 4096, window: "hann" });
      let best = 0;
      for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
      return spec.db[best];
    };
    const rendered = clip ? E.Ops.renderClip(clip) : null;
    const restored = rendered
      ? {
          leftHigh: channelDb(rendered, 0, 4000),
          rightHigh: channelDb(rendered, 1, 4000),
        }
      : { missing: true };
    window.__rythme.undo();
    return restored;
  }, channelSetup);
  check(
    "Waveform channel-specific spectral silence undoes cleanly",
    Math.abs(channelUndo.leftHigh - channelSetup.before.leftHigh) < 3 && Math.abs(channelUndo.rightHigh - channelSetup.before.rightHigh) < 3,
    JSON.stringify({ before: channelSetup.before, undo: channelUndo }),
  );
  const diagnosticSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const hot = E.Generate.sine(440, 0.3, { sampleRate: sr, amplitude: 1.5, channels: 2 });
    const clipped = {
      sampleRate: sr,
      channels: hot.channels.map((ch) => Float32Array.from(ch, (v) => Math.max(-1, Math.min(1, v)))),
    };
    const audio = E.concat(E.Generate.generateSilence(0.2, 2, sr), clipped, E.Generate.generateSilence(0.2, 2, sr));
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-clip"), { label: "Diagnostics Clip" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-clip");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { trackId: track.id, clipId: clip.id, clipCount: s.getState().project.tracks[0].clips.length };
  });
  await page.click('[data-action="diagnostics-scan"]');
  const diagnosticScan = await page.evaluate(() => ({
    text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
    range: window.__rythme.getState().selection.range,
  }));
  check(
    "Waveform diagnostics scan selects a clipping issue",
    /issue/.test(diagnosticScan.text) && /clip/i.test(diagnosticScan.text) && diagnosticScan.range?.end > diagnosticScan.range?.start,
    JSON.stringify(diagnosticScan),
  );
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="diagnostics-repair"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="diagnostics-repair"]');
  const diagnosticRepair = await page.evaluate((setup) => {
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    return { clipCount: track?.clips.length ?? 0, canUndo: window.__rythme.canUndo() };
  }, diagnosticSetup);
  check(
    "Waveform diagnostics repair bakes an undoable clipping fix",
    diagnosticRepair.clipCount > diagnosticSetup.clipCount && diagnosticRepair.canUndo,
    JSON.stringify({ before: diagnosticSetup, after: diagnosticRepair }),
  );
  const diagnosticUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const afterRepairUndo = track?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterRepairUndo, afterInsertUndo };
  }, diagnosticSetup);
  check(
    "Waveform diagnostics repair and fixture insert undo cleanly",
    diagnosticUndo.afterRepairUndo === diagnosticSetup.clipCount && diagnosticUndo.afterInsertUndo === diagnosticSetup.clipCount - 1,
    JSON.stringify(diagnosticUndo),
  );
  const silenceDiagnosticSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.concat(
      E.Generate.sine(440, 0.25, { sampleRate: sr, amplitude: 0.55, channels: 2 }),
      E.Generate.generateSilence(0.5, 2, sr),
      E.Generate.sine(440, 0.25, { sampleRate: sr, amplitude: 0.55, channels: 2 }),
    );
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-silence"), { label: "Diagnostics Silence" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-silence");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return {
      trackId: track.id,
      clipId: clip.id,
      clipCount: s.getState().project.tracks[0].clips.length,
      duration: E.durationSeconds(audio),
    };
  });
  await page.click('[data-action="diagnostics-scan"]');
  const silenceDiagnosticScan = await page.evaluate(() => ({
    text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
    range: window.__rythme.getState().selection.range,
    repairText: document.querySelector('[data-action="diagnostics-repair"]')?.textContent ?? "",
  }));
  check(
    "Waveform diagnostics scan selects a silence issue",
    /issue/.test(silenceDiagnosticScan.text) &&
      /silence/i.test(silenceDiagnosticScan.text) &&
      /remove/i.test(silenceDiagnosticScan.repairText) &&
      silenceDiagnosticScan.range?.end > silenceDiagnosticScan.range?.start,
    JSON.stringify(silenceDiagnosticScan),
  );
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="diagnostics-repair"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="diagnostics-repair"]');
  const silenceDiagnosticRepair = await page.evaluate((setup) => {
    const E = window.__engine;
    const state = window.__rythme.getState();
    const track = state.project.tracks.find((t) => t.id === setup.trackId);
    const parts = track?.clips.filter((c) => c.name === "diagnostics-silence") ?? [];
    if (!track || parts.length === 0) {
      return { clipCount: track?.clips.length ?? 0, diagnosticParts: parts.length, duration: 0, silenceIssues: -1, canUndo: window.__rythme.canUndo() };
    }
    const minStart = Math.min(...parts.map((c) => c.start));
    const localTrack = { ...track, clips: parts.map((c) => ({ ...c, start: c.start - minStart })) };
    const localProject = { ...state.project, tracks: [localTrack] };
    const audio = E.Ops.renderProject(localProject);
    const issues = E.Analysis.scanAudioDiagnostics(audio, { includeClipping: false, minSilenceMs: 250 });
    return {
      clipCount: track?.clips.length ?? 0,
      diagnosticParts: parts.length,
      duration: E.durationSeconds(audio),
      silenceIssues: issues.length,
      canUndo: window.__rythme.canUndo(),
    };
  }, silenceDiagnosticSetup);
  check(
    "Waveform diagnostics repair ripple-removes silence",
    silenceDiagnosticRepair.diagnosticParts === 2 &&
      silenceDiagnosticRepair.duration < silenceDiagnosticSetup.duration - 0.35 &&
      silenceDiagnosticRepair.silenceIssues === 0 &&
      silenceDiagnosticRepair.canUndo,
    JSON.stringify({ before: silenceDiagnosticSetup, after: silenceDiagnosticRepair }),
  );
  const silenceDiagnosticUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const afterRepairUndo = track?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterRepairUndo, afterInsertUndo };
  }, silenceDiagnosticSetup);
  check(
    "Waveform diagnostics silence repair and fixture insert undo cleanly",
    silenceDiagnosticUndo.afterRepairUndo === silenceDiagnosticSetup.clipCount &&
      silenceDiagnosticUndo.afterInsertUndo === silenceDiagnosticSetup.clipCount - 1,
    JSON.stringify(silenceDiagnosticUndo),
  );
  const batchDiagnosticSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const hot = E.Generate.sine(880, 0.3, { sampleRate: sr, amplitude: 1.5, channels: 2 });
    const clipped = {
      sampleRate: sr,
      channels: hot.channels.map((ch) => Float32Array.from(ch, (v) => Math.max(-1, Math.min(1, v)))),
    };
    const audio = E.concat(
      E.Generate.sine(440, 0.2, { sampleRate: sr, amplitude: 0.5, channels: 2 }),
      E.Generate.generateSilence(0.45, 2, sr),
      clipped,
      E.Generate.generateSilence(0.45, 2, sr),
      E.Generate.sine(660, 0.2, { sampleRate: sr, amplitude: 0.5, channels: 2 }),
    );
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-batch"), { label: "Diagnostics Batch" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-batch");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return {
      trackId: track.id,
      clipCount: s.getState().project.tracks[0].clips.length,
      duration: E.durationSeconds(audio),
    };
  });
  const diagnosticPolicyDefaults = await page.evaluate(() => ({
    profile: document.querySelector('[data-action="diagnostics-profile"]')?.getAttribute("data-value") ?? "",
    clipping: document.querySelector('[data-action="diagnostics-include-clipping"]')?.checked ?? false,
    clicks: document.querySelector('[data-action="diagnostics-include-clicks"]')?.checked ?? true,
    dcOffset: document.querySelector('[data-action="diagnostics-include-dc-offset"]')?.checked ?? false,
    silence: document.querySelector('[data-action="diagnostics-include-silence"]')?.checked ?? false,
    clipCeilingDb: document.querySelector('[data-action="diagnostics-clip-threshold"]')?.value ?? "",
    clickThreshold: document.querySelector('[data-action="diagnostics-click-threshold"]')?.value ?? "",
    dcOffsetThresholdDb: document.querySelector('[data-action="diagnostics-dc-offset-threshold"]')?.value ?? "",
    silenceThresholdDb: document.querySelector('[data-action="diagnostics-silence-threshold"]')?.value ?? "",
    minSilenceMs: document.querySelector('[data-action="diagnostics-min-silence"]')?.value ?? "",
  }));
  check(
    "Waveform diagnostics scan policy defaults to Standard clipping, DC offset, silence, and Audition-style thresholds",
    diagnosticPolicyDefaults.profile === "standard" &&
      diagnosticPolicyDefaults.clipping &&
      !diagnosticPolicyDefaults.clicks &&
      diagnosticPolicyDefaults.dcOffset &&
      diagnosticPolicyDefaults.silence &&
      diagnosticPolicyDefaults.clipCeilingDb === "0" &&
      diagnosticPolicyDefaults.clickThreshold === "0.02" &&
      diagnosticPolicyDefaults.dcOffsetThresholdDb === "-40" &&
      diagnosticPolicyDefaults.silenceThresholdDb === "-60" &&
      diagnosticPolicyDefaults.minSilenceMs === "300",
    JSON.stringify(diagnosticPolicyDefaults),
  );
  await page.click('[data-action="diagnostics-include-silence"]');
  await page.click('[data-action="diagnostics-scan"]');
  const clippingOnlyScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      clippingChecked: document.querySelector('[data-action="diagnostics-include-clipping"]')?.checked ?? false,
      silenceChecked: document.querySelector('[data-action="diagnostics-include-silence"]')?.checked ?? true,
    };
  });
  check(
    "Waveform diagnostics clipping-only policy suppresses silence issues",
    clippingOnlyScan.clippingChecked &&
      !clippingOnlyScan.silenceChecked &&
      clippingOnlyScan.kinds.length > 0 &&
      clippingOnlyScan.kinds.every((kind) => kind === "clipping") &&
      /clip/i.test(clippingOnlyScan.text) &&
      !/silence/i.test(clippingOnlyScan.text),
    JSON.stringify(clippingOnlyScan),
  );
  await page.click('[data-action="diagnostics-include-silence"]');
  await page.click('[data-action="diagnostics-include-clipping"]');
  await page.click('[data-action="diagnostics-scan"]');
  const silenceOnlyScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      clippingChecked: document.querySelector('[data-action="diagnostics-include-clipping"]')?.checked ?? true,
      silenceChecked: document.querySelector('[data-action="diagnostics-include-silence"]')?.checked ?? false,
    };
  });
  check(
    "Waveform diagnostics silence-only policy suppresses clipping issues",
    !silenceOnlyScan.clippingChecked &&
      silenceOnlyScan.silenceChecked &&
      silenceOnlyScan.kinds.length > 0 &&
      silenceOnlyScan.kinds.every((kind) => kind === "silence") &&
      !/clip/i.test(silenceOnlyScan.text) &&
      /silence/i.test(silenceOnlyScan.text),
    JSON.stringify(silenceOnlyScan),
  );
  await page.fill('[data-action="diagnostics-min-silence"]', "600");
  await page.click('[data-action="diagnostics-scan"]');
  const longSilenceThresholdScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      count: items.length,
      minSilenceMs: document.querySelector('[data-action="diagnostics-min-silence"]')?.value ?? "",
      repairAllDisabled: document.querySelector('[data-action="diagnostics-repair-all"]')?.disabled ?? false,
    };
  });
  check(
    "Waveform diagnostics minimum-silence threshold suppresses shorter gaps",
    longSilenceThresholdScan.count === 0 &&
      longSilenceThresholdScan.minSilenceMs === "600" &&
      /No diagnostics issues/.test(longSilenceThresholdScan.text) &&
      longSilenceThresholdScan.repairAllDisabled,
    JSON.stringify(longSilenceThresholdScan),
  );
  await page.fill('[data-action="diagnostics-min-silence"]', "300");
  await page.click('[data-action="diagnostics-scan"]');
  const restoredSilenceThresholdScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      minSilenceMs: document.querySelector('[data-action="diagnostics-min-silence"]')?.value ?? "",
    };
  });
  check(
    "Waveform diagnostics restored minimum-silence threshold finds gaps again",
    restoredSilenceThresholdScan.minSilenceMs === "300" &&
      restoredSilenceThresholdScan.kinds.length > 0 &&
      restoredSilenceThresholdScan.kinds.every((kind) => kind === "silence"),
    JSON.stringify(restoredSilenceThresholdScan),
  );
  await page.click('[data-action="diagnostics-include-clipping"]');
  await page.click('[data-action="diagnostics-scan"]');
  const batchDiagnosticScan = await page.evaluate(() => ({
    text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
    range: window.__rythme.getState().selection.range,
    repairAllDisabled: document.querySelector('[data-action="diagnostics-repair-all"]')?.disabled ?? true,
  }));
  check(
    "Waveform diagnostics scan finds batch-repairable issues",
    /issue/.test(batchDiagnosticScan.text) &&
      /clip/i.test(batchDiagnosticScan.text) &&
      /silence/i.test(batchDiagnosticScan.text) &&
      !batchDiagnosticScan.repairAllDisabled &&
      batchDiagnosticScan.range?.end > batchDiagnosticScan.range?.start,
    JSON.stringify(batchDiagnosticScan),
  );
  const batchDiagnosticList = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      count: items.length,
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      activeCount: items.filter((item) => item.classList.contains("is-active")).length,
      labels: items.map((item) => item.textContent ?? ""),
    };
  });
  check(
    "Waveform diagnostics list shows selectable clipping and silence issues",
    batchDiagnosticList.count >= 3 &&
      batchDiagnosticList.kinds.includes("clipping") &&
      batchDiagnosticList.kinds.includes("silence") &&
      batchDiagnosticList.activeCount === 1 &&
      batchDiagnosticList.labels.every(
        (label) =>
          /\d+\.\d{2}-\d+\.\d{2}s/.test(label) &&
          /\d+ ms/.test(label) &&
          /samples/.test(label) &&
          /Pk -?\d+\.\d dB/.test(label) &&
          /RMS -?\d+\.\d dB/.test(label) &&
          /DC -?\d+\.\d dB/.test(label),
      ),
    JSON.stringify(batchDiagnosticList),
  );
  await page.click('[data-action="diagnostics-select"][data-diagnostic-kind="clipping"]');
  const batchDiagnosticSelection = await page.evaluate(() => {
    const active = document.querySelector('[data-action="diagnostics-select"].is-active');
    return {
      activeKind: active?.getAttribute("data-diagnostic-kind") ?? "",
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      range: window.__rythme.getState().selection.range,
    };
  });
  check(
    "Waveform diagnostics list selection targets the clicked issue",
    batchDiagnosticSelection.activeKind === "clipping" &&
      /clip/i.test(batchDiagnosticSelection.text) &&
      batchDiagnosticSelection.range?.end > batchDiagnosticSelection.range?.start,
    JSON.stringify(batchDiagnosticSelection),
  );
  await page.click('[data-action="diagnostics-preview"]');
  const batchDiagnosticPreview = await page.evaluate(() => {
    const state = window.__rythme.getState();
    return {
      loop: state.transport.loop,
      loopEnabled: state.transport.loopEnabled,
      playhead: state.transport.playhead,
      range: state.selection.range,
    };
  });
  check(
    "Waveform diagnostics Preview loops the selected issue range",
    !!batchDiagnosticPreview.loop &&
      batchDiagnosticPreview.loopEnabled &&
      Math.abs(batchDiagnosticPreview.loop.start - batchDiagnosticPreview.range.start) < 1e-6 &&
      Math.abs(batchDiagnosticPreview.loop.end - batchDiagnosticPreview.range.end) < 1e-6 &&
      Math.abs(batchDiagnosticPreview.playhead - batchDiagnosticPreview.range.start) < 1e-6,
    JSON.stringify(batchDiagnosticPreview),
  );
  await page.click('[data-action="diagnostics-repair-all"]');
  const batchDiagnosticRepair = await page.evaluate((setup) => {
    const E = window.__engine;
    const state = window.__rythme.getState();
    const track = state.project.tracks.find((t) => t.id === setup.trackId);
    const parts = track?.clips.filter((c) => c.name === "diagnostics-batch") ?? [];
    if (!track || parts.length === 0) {
      return { clipCount: track?.clips.length ?? 0, diagnosticParts: parts.length, duration: 0, issueCount: -1, canUndo: window.__rythme.canUndo() };
    }
    const minStart = Math.min(...parts.map((c) => c.start));
    const localTrack = { ...track, clips: parts.map((c) => ({ ...c, start: c.start - minStart })) };
    const localProject = { ...state.project, tracks: [localTrack] };
    const audio = E.Ops.renderProject(localProject);
    const issues = E.Analysis.scanAudioDiagnostics(audio, { minSilenceMs: 250 });
    return {
      clipCount: track.clips.length,
      diagnosticParts: parts.length,
      duration: E.durationSeconds(audio),
      issueCount: issues.length,
      canUndo: window.__rythme.canUndo(),
    };
  }, batchDiagnosticSetup);
  check(
    "Waveform diagnostics Repair All fixes clipping and silence in one edit",
    batchDiagnosticRepair.diagnosticParts >= 3 &&
      batchDiagnosticRepair.duration < batchDiagnosticSetup.duration - 0.75 &&
      batchDiagnosticRepair.issueCount === 0 &&
      batchDiagnosticRepair.canUndo,
    JSON.stringify({ before: batchDiagnosticSetup, after: batchDiagnosticRepair }),
  );
  const batchDiagnosticUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const afterRepairUndo = track?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterRepairUndo, afterInsertUndo };
  }, batchDiagnosticSetup);
  check(
    "Waveform diagnostics Repair All and fixture insert undo cleanly",
    batchDiagnosticUndo.afterRepairUndo === batchDiagnosticSetup.clipCount &&
      batchDiagnosticUndo.afterInsertUndo === batchDiagnosticSetup.clipCount - 1,
    JSON.stringify(batchDiagnosticUndo),
  );
  const softSilenceThresholdSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.concat(
      E.Generate.sine(440, 0.2, { sampleRate: sr, amplitude: 0.4, channels: 2 }),
      E.Generate.sine(110, 0.45, { sampleRate: sr, amplitude: 0.003, channels: 2 }),
      E.Generate.sine(440, 0.2, { sampleRate: sr, amplitude: 0.4, channels: 2 }),
    );
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-soft-silence"), { label: "Diagnostics Soft Silence" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-soft-silence");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length };
  });
  await page.click('[data-action="diagnostics-include-clipping"]');
  await page.fill('[data-action="diagnostics-silence-threshold"]', "-60");
  await page.click('[data-action="diagnostics-scan"]');
  const lowSilenceThresholdScan = await page.evaluate(() => ({
    text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
    count: document.querySelectorAll('[data-action="diagnostics-select"]').length,
    clippingChecked: document.querySelector('[data-action="diagnostics-include-clipping"]')?.checked ?? true,
    silenceChecked: document.querySelector('[data-action="diagnostics-include-silence"]')?.checked ?? false,
    silenceThresholdDb: document.querySelector('[data-action="diagnostics-silence-threshold"]')?.value ?? "",
  }));
  check(
    "Waveform diagnostics silence dB threshold ignores above-threshold quiet audio",
    !lowSilenceThresholdScan.clippingChecked &&
      lowSilenceThresholdScan.silenceChecked &&
      lowSilenceThresholdScan.silenceThresholdDb === "-60" &&
      lowSilenceThresholdScan.count === 0 &&
      /No diagnostics issues/.test(lowSilenceThresholdScan.text),
    JSON.stringify(lowSilenceThresholdScan),
  );
  await chooseOption(page, '[data-action="diagnostics-profile"]', "strict");
  await page.click('[data-action="diagnostics-scan"]');
  const raisedSilenceThresholdScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      profile: document.querySelector('[data-action="diagnostics-profile"]')?.getAttribute("data-value") ?? "",
      clipCeilingDb: document.querySelector('[data-action="diagnostics-clip-threshold"]')?.value ?? "",
      silenceThresholdDb: document.querySelector('[data-action="diagnostics-silence-threshold"]')?.value ?? "",
      minSilenceMs: document.querySelector('[data-action="diagnostics-min-silence"]')?.value ?? "",
    };
  });
  check(
    "Waveform diagnostics Strict profile finds quiet audio with preset thresholds",
    raisedSilenceThresholdScan.profile === "strict" &&
      raisedSilenceThresholdScan.clipCeilingDb === "-6" &&
      raisedSilenceThresholdScan.silenceThresholdDb === "-45" &&
      raisedSilenceThresholdScan.minSilenceMs === "150" &&
      raisedSilenceThresholdScan.kinds.length > 0 &&
      raisedSilenceThresholdScan.kinds.every((kind) => kind === "silence") &&
      /silence/i.test(raisedSilenceThresholdScan.text),
    JSON.stringify(raisedSilenceThresholdScan),
  );
  const softSilenceThresholdUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    return { clipCount: track?.clips.length ?? 0 };
  }, softSilenceThresholdSetup);
  check(
    "Waveform diagnostics silence threshold fixture insert undoes cleanly",
    softSilenceThresholdUndo.clipCount === softSilenceThresholdSetup.clipCount - 1,
    JSON.stringify(softSilenceThresholdUndo),
  );
  await chooseOption(page, '[data-action="diagnostics-profile"]', "standard");
  const clipThresholdSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.Generate.sine(330, 0.7, { sampleRate: sr, amplitude: 0.2, channels: 2 });
    const start = Math.round(sr * 0.3);
    const end = Math.round(sr * 0.42);
    for (const ch of audio.channels) {
      for (let i = start; i < end; i++) ch[i] = 0.55;
    }
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-soft-clip"), { label: "Diagnostics Soft Clip" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-soft-clip");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length };
  });
  await page.click('[data-action="diagnostics-include-silence"]');
  await page.click('[data-action="diagnostics-include-dc-offset"]');
  await page.fill('[data-action="diagnostics-clip-threshold"]', "-1");
  await page.click('[data-action="diagnostics-scan"]');
  const highClipThresholdScan = await page.evaluate(() => ({
    text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
    count: document.querySelectorAll('[data-action="diagnostics-select"]').length,
    clippingChecked: document.querySelector('[data-action="diagnostics-include-clipping"]')?.checked ?? false,
    silenceChecked: document.querySelector('[data-action="diagnostics-include-silence"]')?.checked ?? true,
    clipCeilingDb: document.querySelector('[data-action="diagnostics-clip-threshold"]')?.value ?? "",
  }));
  check(
    "Waveform diagnostics clip ceiling ignores plateaus below threshold",
    highClipThresholdScan.clippingChecked &&
      !highClipThresholdScan.silenceChecked &&
      highClipThresholdScan.clipCeilingDb === "-1" &&
      highClipThresholdScan.count === 0 &&
      /No diagnostics issues/.test(highClipThresholdScan.text),
    JSON.stringify(highClipThresholdScan),
  );
  await page.fill('[data-action="diagnostics-clip-threshold"]', "-6");
  await page.click('[data-action="diagnostics-scan"]');
  const loweredClipThresholdScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      clipCeilingDb: document.querySelector('[data-action="diagnostics-clip-threshold"]')?.value ?? "",
    };
  });
  check(
    "Waveform diagnostics lowered clip ceiling finds soft clipped plateaus",
    loweredClipThresholdScan.clipCeilingDb === "-6" &&
      loweredClipThresholdScan.kinds.length > 0 &&
      loweredClipThresholdScan.kinds.every((kind) => kind === "clipping") &&
      /clip/i.test(loweredClipThresholdScan.text),
    JSON.stringify(loweredClipThresholdScan),
  );
  const clipThresholdUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    return { clipCount: track?.clips.length ?? 0 };
  }, clipThresholdSetup);
  check(
    "Waveform diagnostics clip threshold fixture insert undoes cleanly",
    clipThresholdUndo.clipCount === clipThresholdSetup.clipCount - 1,
    JSON.stringify(clipThresholdUndo),
  );
  await chooseOption(page, '[data-action="diagnostics-profile"]', "standard");
  const dcOffsetSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.Generate.sine(550, 0.7, { sampleRate: sr, amplitude: 0.08, channels: 2 });
    for (const ch of audio.channels) {
      for (let i = 0; i < ch.length; i++) ch[i] += 0.12;
    }
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-dc-offset"), { label: "Diagnostics DC Offset" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-dc-offset");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length };
  });
  await page.click('[data-action="diagnostics-scan"]');
  const dcOffsetScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      labels: items.map((item) => item.textContent ?? ""),
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      repairText: document.querySelector('[data-action="diagnostics-repair"]')?.textContent ?? "",
      dcChecked: document.querySelector('[data-action="diagnostics-include-dc-offset"]')?.checked ?? false,
      dcThresholdDb: document.querySelector('[data-action="diagnostics-dc-offset-threshold"]')?.value ?? "",
      range: window.__rythme.getState().selection.range,
    };
  });
  check(
    "Waveform diagnostics DC offset scan selects a repairable issue",
    dcOffsetScan.dcChecked &&
      dcOffsetScan.dcThresholdDb === "-40" &&
      dcOffsetScan.kinds.length === 1 &&
      dcOffsetScan.kinds[0] === "dc-offset" &&
      /DC/i.test(dcOffsetScan.text) &&
      /Remove DC/i.test(dcOffsetScan.repairText) &&
      dcOffsetScan.labels.every((label) => /DC -?\d+\.\d dB/.test(label)) &&
      dcOffsetScan.range?.end > dcOffsetScan.range?.start,
    JSON.stringify(dcOffsetScan),
  );
  await page.click('[data-action="diagnostics-repair"]');
  const dcOffsetRepair = await page.evaluate((setup) => {
    const E = window.__engine;
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const parts = track?.clips.filter((c) => c.name === "diagnostics-dc-offset") ?? [];
    const audio = parts[0] ? E.Ops.renderClip(parts[0]) : null;
    const issues = audio
      ? E.Analysis.scanAudioDiagnostics(audio, {
          includeClipping: false,
          includeSilence: false,
          includeDcOffset: true,
          dcOffsetThresholdDb: -60,
        })
      : [];
    return {
      diagnosticParts: parts.length,
      dcIssues: issues.filter((issue) => issue.kind === "dc-offset").length,
      canUndo: window.__rythme.canUndo(),
    };
  }, dcOffsetSetup);
  check(
    "Waveform diagnostics Repair removes DC offset",
    dcOffsetRepair.diagnosticParts >= 1 && dcOffsetRepair.dcIssues === 0 && dcOffsetRepair.canUndo,
    JSON.stringify(dcOffsetRepair),
  );
  const dcOffsetUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const afterRepairUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterRepairUndo, afterInsertUndo };
  }, dcOffsetSetup);
  check(
    "Waveform diagnostics DC offset repair and fixture insert undo cleanly",
    dcOffsetUndo.afterRepairUndo === dcOffsetSetup.clipCount && dcOffsetUndo.afterInsertUndo === dcOffsetSetup.clipCount - 1,
    JSON.stringify(dcOffsetUndo),
  );
  await chooseOption(page, '[data-action="diagnostics-profile"]', "standard");
  const clickDiagnosticSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.Generate.sine(770, 0.7, { sampleRate: sr, amplitude: 0.12, channels: 2 });
    const clickFrame = Math.round(sr * 0.35);
    for (const ch of audio.channels) ch[clickFrame] = -0.95;
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-click"), { label: "Diagnostics Click" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-click");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length };
  });
  await page.click('[data-action="diagnostics-include-clipping"]');
  await page.click('[data-action="diagnostics-include-silence"]');
  await page.click('[data-action="diagnostics-include-clicks"]');
  await page.click('[data-action="diagnostics-include-dc-offset"]');
  await page.fill('[data-action="diagnostics-click-threshold"]', "0.1");
  await page.click('[data-action="diagnostics-scan"]');
  const clickDiagnosticScan = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-action="diagnostics-select"]')];
    return {
      text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
      labels: items.map((item) => item.textContent ?? ""),
      kinds: items.map((item) => item.getAttribute("data-diagnostic-kind")),
      repairText: document.querySelector('[data-action="diagnostics-repair"]')?.textContent ?? "",
      clicksChecked: document.querySelector('[data-action="diagnostics-include-clicks"]')?.checked ?? false,
      clickThreshold: document.querySelector('[data-action="diagnostics-click-threshold"]')?.value ?? "",
      range: window.__rythme.getState().selection.range,
    };
  });
  check(
    "Waveform diagnostics click scan selects a repairable issue",
    clickDiagnosticScan.clicksChecked &&
      clickDiagnosticScan.clickThreshold === "0.1" &&
      clickDiagnosticScan.kinds.length === 1 &&
      clickDiagnosticScan.kinds[0] === "click" &&
      /click/i.test(clickDiagnosticScan.text) &&
      /Repair Click/i.test(clickDiagnosticScan.repairText) &&
      clickDiagnosticScan.labels.every((label) => /Click/.test(label) && /Pk -?\d+\.\d dB/.test(label)) &&
      clickDiagnosticScan.range?.end > clickDiagnosticScan.range?.start,
    JSON.stringify(clickDiagnosticScan),
  );
  await page.click('[data-action="diagnostics-repair"]');
  const clickDiagnosticRepair = await page.evaluate((setup) => {
    const E = window.__engine;
    const state = window.__rythme.getState();
    const track = state.project.tracks.find((t) => t.id === setup.trackId);
    const parts = track?.clips.filter((c) => c.name === "diagnostics-click") ?? [];
    if (!track || parts.length === 0) return { diagnosticParts: parts.length, clickIssues: -1, canUndo: window.__rythme.canUndo() };
    const minStart = Math.min(...parts.map((c) => c.start));
    const localTrack = { ...track, clips: parts.map((c) => ({ ...c, start: c.start - minStart })) };
    const audio = E.Ops.renderProject({ ...state.project, tracks: [localTrack] });
    const issues = E.Analysis.scanAudioDiagnostics(audio, {
      includeClipping: false,
      includeClicks: true,
      includeDcOffset: false,
      includeSilence: false,
      clickThreshold: 0.1,
    });
    return {
      diagnosticParts: parts.length,
      clickIssues: issues.filter((issue) => issue.kind === "click").length,
      canUndo: window.__rythme.canUndo(),
    };
  }, clickDiagnosticSetup);
  check(
    "Waveform diagnostics Repair removes the detected click",
    clickDiagnosticRepair.diagnosticParts >= 1 && clickDiagnosticRepair.clickIssues === 0 && clickDiagnosticRepair.canUndo,
    JSON.stringify(clickDiagnosticRepair),
  );
  const clickDiagnosticUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const afterRepairUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterRepairUndo, afterInsertUndo };
  }, clickDiagnosticSetup);
  check(
    "Waveform diagnostics click repair and fixture insert undo cleanly",
    clickDiagnosticUndo.afterRepairUndo === clickDiagnosticSetup.clipCount &&
      clickDiagnosticUndo.afterInsertUndo === clickDiagnosticSetup.clipCount - 1,
    JSON.stringify(clickDiagnosticUndo),
  );
  await chooseOption(page, '[data-action="diagnostics-profile"]', "standard");
  await page.fill('[data-action="diagnostics-clip-threshold"]', "0");
  const shortenSilenceSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.concat(
      E.Generate.sine(440, 0.25, { sampleRate: sr, amplitude: 0.55, channels: 2 }),
      E.Generate.generateSilence(0.5, 2, sr),
      E.Generate.sine(440, 0.25, { sampleRate: sr, amplitude: 0.55, channels: 2 }),
    );
    s.dispatch(E.insertClip(track.id, audio, 12, "diagnostics-shorten-silence"), { label: "Diagnostics Shorten Silence" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "diagnostics-shorten-silence");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length, duration: E.durationSeconds(audio) };
  });
  await chooseOption(page, '[data-action="diagnostics-silence-repair-mode"]', "shorten");
  await page.fill('[data-action="diagnostics-silence-keep"]', "100");
  await page.click('[data-action="diagnostics-scan"]');
  const shortenSilenceScan = await page.evaluate(() => ({
    text: document.querySelector(".rh-waveform-diagnostic-readout")?.textContent ?? "",
    repairText: document.querySelector('[data-action="diagnostics-repair"]')?.textContent ?? "",
    mode: document.querySelector('[data-action="diagnostics-silence-repair-mode"]')?.getAttribute("data-value") ?? "",
    keepMs: document.querySelector('[data-action="diagnostics-silence-keep"]')?.value ?? "",
  }));
  check(
    "Waveform diagnostics silence repair policy exposes Shorten with keep duration",
    /silence/i.test(shortenSilenceScan.text) &&
      /shorten/i.test(shortenSilenceScan.repairText) &&
      shortenSilenceScan.mode === "shorten" &&
      shortenSilenceScan.keepMs === "100",
    JSON.stringify(shortenSilenceScan),
  );
  await page.click('[data-action="diagnostics-repair"]');
  const shortenSilenceRepair = await page.evaluate((setup) => {
    const E = window.__engine;
    const state = window.__rythme.getState();
    const track = state.project.tracks.find((t) => t.id === setup.trackId);
    const parts = track?.clips.filter((c) => c.name === "diagnostics-shorten-silence") ?? [];
    if (!track || parts.length === 0) return { diagnosticParts: parts.length, duration: 0, silenceIssues: -1, canUndo: window.__rythme.canUndo() };
    const minStart = Math.min(...parts.map((c) => c.start));
    const localTrack = { ...track, clips: parts.map((c) => ({ ...c, start: c.start - minStart })) };
    const localProject = { ...state.project, tracks: [localTrack] };
    const audio = E.Ops.renderProject(localProject);
    const issues = E.Analysis.scanAudioDiagnostics(audio, { includeClipping: false, minSilenceMs: 250 });
    return {
      diagnosticParts: parts.length,
      duration: E.durationSeconds(audio),
      silenceIssues: issues.length,
      canUndo: window.__rythme.canUndo(),
    };
  }, shortenSilenceSetup);
  check(
    "Waveform diagnostics Shorten policy leaves a short gap instead of removing all silence",
    shortenSilenceRepair.diagnosticParts === 2 &&
      shortenSilenceRepair.duration < shortenSilenceSetup.duration - 0.35 &&
      shortenSilenceRepair.duration > shortenSilenceSetup.duration - 0.45 &&
      shortenSilenceRepair.silenceIssues === 0 &&
      shortenSilenceRepair.canUndo,
    JSON.stringify({ before: shortenSilenceSetup, after: shortenSilenceRepair }),
  );
  const shortenSilenceUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const afterRepairUndo = track?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterRepairUndo, afterInsertUndo };
  }, shortenSilenceSetup);
  check(
    "Waveform diagnostics Shorten policy and fixture insert undo cleanly",
    shortenSilenceUndo.afterRepairUndo === shortenSilenceSetup.clipCount &&
      shortenSilenceUndo.afterInsertUndo === shortenSilenceSetup.clipCount - 1,
    JSON.stringify(shortenSilenceUndo),
  );
  await chooseOption(page, '[data-action="diagnostics-silence-repair-mode"]', "remove");
  const sampleEditSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.Generate.sine(660, 0.8, { sampleRate: sr, amplitude: 0.08, channels: 2 });
    s.dispatch(E.insertClip(track.id, audio, 13, "sample-edit-clip"), { label: "Sample Edit Clip" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "sample-edit-clip");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    s.dispatch(E.selectRange({ start: 13.1, end: 13.5 }, [track.id]), { history: false });
    const beforePeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip)).peak;
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length, beforePeak };
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="sample-normalize"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="sample-normalize"]');
  const sampleEditAfter = await page.evaluate((setup) => {
    const E = window.__engine;
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const middle = track?.clips.find((c) => Math.abs(c.start - 13.1) < 1e-6);
    return {
      clipCount: track?.clips.length ?? 0,
      middlePeak: middle ? E.Analysis.analyzeLevels(E.Ops.renderClip(middle)).peak : 0,
      canUndo: window.__rythme.canUndo(),
    };
  }, sampleEditSetup);
  check(
    "Waveform sample Normalize bakes the selected range",
    sampleEditAfter.clipCount > sampleEditSetup.clipCount && sampleEditAfter.middlePeak > sampleEditSetup.beforePeak * 8 && sampleEditAfter.canUndo,
    JSON.stringify({ before: sampleEditSetup, after: sampleEditAfter }),
  );
  const sampleEditUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const afterNormalizeUndo = track?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterNormalizeUndo, afterInsertUndo };
  }, sampleEditSetup);
  check(
    "Waveform sample Normalize and fixture insert undo cleanly",
    sampleEditUndo.afterNormalizeUndo === sampleEditSetup.clipCount && sampleEditUndo.afterInsertUndo === sampleEditSetup.clipCount - 1,
    JSON.stringify(sampleEditUndo),
  );
  const sampleGainSetup = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const state = s.getState();
    const track = state.project.tracks[0];
    const sr = state.project.sampleRate;
    const audio = E.Generate.sine(440, 0.8, { sampleRate: sr, amplitude: 0.1, channels: 2 });
    s.dispatch(E.insertClip(track.id, audio, 14, "sample-gain-silence"), { label: "Sample Gain Silence" });
    const clip = s.getState().project.tracks[0].clips.find((c) => c.name === "sample-gain-silence");
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.selectClips([clip.id]), { history: false });
    s.dispatch(E.selectRange({ start: 14.1, end: 14.5 }, [track.id]), { history: false });
    s.dispatch(E.setPlayhead(14.1), { history: false });
    const beforePeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip)).peak;
    return { trackId: track.id, clipCount: s.getState().project.tracks[0].clips.length, beforePeak };
  });
  await page.fill('[data-action="sample-gain-db"]', "6");
  await page.click('[data-action="sample-gain"]');
  const sampleGainAfter = await page.evaluate((setup) => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((t) => t.id === setup.trackId);
    const middle = track?.clips.find((c) => Math.abs(c.start - 14.1) < 1e-6);
    if (middle) s.dispatch(E.selectClips([middle.id]), { history: false });
    s.dispatch(E.selectRange({ start: 14.1, end: 14.5 }, [setup.trackId]), { history: false });
    s.dispatch(E.setPlayhead(14.1), { history: false });
    return {
      clipCount: track?.clips.length ?? 0,
      middlePeak: middle ? E.Analysis.analyzeLevels(E.Ops.renderClip(middle)).peak : 0,
      canUndo: s.canUndo(),
    };
  }, sampleGainSetup);
  check(
    "Waveform sample Gain bakes the selected range",
    sampleGainAfter.clipCount > sampleGainSetup.clipCount && sampleGainAfter.middlePeak > sampleGainSetup.beforePeak * 1.8 && sampleGainAfter.canUndo,
    JSON.stringify({ before: sampleGainSetup, after: sampleGainAfter }),
  );
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action="sample-silence"]');
    return button && !button.disabled;
  });
  await page.click('[data-action="sample-silence"]');
  const sampleSilenceAfter = await page.evaluate((setup) => {
    const E = window.__engine;
    const track = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId);
    const silent = track?.clips.find((c) => Math.abs(c.start - 14.1) < 1e-6);
    return {
      clipCount: track?.clips.length ?? 0,
      silentPeak: silent ? E.Analysis.analyzeLevels(E.Ops.renderClip(silent)).peak : 1,
      canUndo: window.__rythme.canUndo(),
    };
  }, sampleGainSetup);
  check(
    "Waveform sample Silence clears the selected range",
    sampleSilenceAfter.clipCount >= sampleGainAfter.clipCount && sampleSilenceAfter.silentPeak === 0 && sampleSilenceAfter.canUndo,
    JSON.stringify(sampleSilenceAfter),
  );
  const sampleGainUndo = await page.evaluate((setup) => {
    window.__rythme.undo();
    const afterSilenceUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    window.__rythme.undo();
    const afterGainUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    window.__rythme.undo();
    const afterInsertUndo = window.__rythme.getState().project.tracks.find((t) => t.id === setup.trackId)?.clips.length ?? 0;
    return { afterSilenceUndo, afterGainUndo, afterInsertUndo };
  }, sampleGainSetup);
  check(
    "Waveform sample Gain/Silence and fixture insert undo cleanly",
    sampleGainUndo.afterSilenceUndo === sampleGainAfter.clipCount &&
      sampleGainUndo.afterGainUndo === sampleGainSetup.clipCount &&
      sampleGainUndo.afterInsertUndo === sampleGainSetup.clipCount - 1,
    JSON.stringify(sampleGainUndo),
  );
  await page.evaluate(() => {
    window.__rythme.dispatch(window.__engine.setEditorMode("multitrack"), { history: false });
    window.__rythme.dispatch(window.__engine.clearSelection(), { history: false });
  });
  await page.waitForSelector(".rh-canvas", { timeout: 5000 });
  const multitrackRendered = await page.evaluate(() => ({
    mode: window.__rythme.getState().mode,
    hasCanvas: !!document.querySelector(".rh-canvas"),
  }));
  check("Multitrack editor mode restores the timeline canvas", multitrackRendered.mode === "multitrack" && multitrackRendered.hasCanvas, JSON.stringify(multitrackRendered));

  console.log("• rack parameter automation");
  const rackAutomationFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks[0];
    if (!track) return { ready: false, error: "no track" };
    const existing = track.effectRack?.slots.some((slot) => slot.id === "e2e-rack-gain") ?? false;
    if (!existing) {
      s.dispatch(E.addTrackEffectSlot(track.id, E.newEffectSlot("gain", { id: "e2e-rack-gain", name: "E2E Gain", params: { gainDb: -6 } })), { history: false });
    }
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.setPlayhead(1.75), { history: false });
    return { ready: true, trackId: track.id };
  });
  if (rackAutomationFixture.ready) {
    await page.getByRole("tab", { name: "Effects Rack" }).first().click();
    await page.waitForSelector('[data-rack-automation="e2e-rack-gain"] [data-action="write-rack-automation"]', { timeout: 5000 });
    await page.click('[data-rack-automation="e2e-rack-gain"] [data-action="write-rack-automation"]');
  }
  const rackAutomationWrite = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const lane = track?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === "e2e-rack-gain");
    const result = {
      ready: true,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      canUndo: s.canUndo(),
    };
    return result;
  }, rackAutomationFixture);
  check(
    "Effects Rack writes a track rack gain automation point at the playhead",
    rackAutomationWrite.ready &&
      rackAutomationWrite.laneName === "E2E Gain gainDb" &&
      rackAutomationWrite.target?.kind === "effectParam" &&
      rackAutomationWrite.target?.effectSlotId === "e2e-rack-gain" &&
      rackAutomationWrite.target?.param === "gainDb" &&
      rackAutomationWrite.points.length === 1 &&
      rackAutomationWrite.points[0].time === 1.75 &&
      rackAutomationWrite.points[0].value === -6 &&
      rackAutomationWrite.canUndo,
    JSON.stringify(rackAutomationWrite),
  );
  if (rackAutomationFixture.ready) {
    await page.locator('[aria-label="Envelope (E)"]').click();
    await page.evaluate(() => {
      const E = window.__engine;
      const s = window.__rythme;
      const track = s.getState().project.tracks[0];
      const lane = track?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === "e2e-rack-gain");
      if (lane) s.undo();
      s.dispatch(E.setScroll(0, 0), { history: false });
      s.dispatch(E.setZoom(180), { history: false });
    });
    await page.waitForSelector('[data-action="timeline-track-rack-gain-automation"][data-effect-slot-id="e2e-rack-gain"]', { timeout: 5000 });
    await page.click('[data-action="timeline-track-rack-gain-automation"][data-effect-slot-id="e2e-rack-gain"]');
    const rackLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator(".rh-track-head:not(.rh-video-track-head)").first().boundingBox(),
    };
    if (rackLaneBox.canvas && rackLaneBox.header) {
      const x0 = rackLaneBox.canvas.x + 260;
      const x1 = rackLaneBox.canvas.x + 390;
      const y0 = rackLaneBox.header.y + rackLaneBox.header.height * 0.82;
      const y1 = rackLaneBox.header.y + rackLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const rackTimelineAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const lane = track?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === "e2e-rack-gain");
    const pressed = document.querySelector('[data-action="timeline-track-rack-gain-automation"][data-effect-slot-id="e2e-rack-gain"]')?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      channelGainPoints: track?.automation?.find((automation) => automation.target.kind === "gainDb")?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeTrackEffectSlot(fixture.trackId, "e2e-rack-gain"), { history: false });
    return result;
  }, rackAutomationFixture);
  check(
    "Timeline envelope tool draws track rack gain automation for a rack slot",
    rackTimelineAutomation.ready &&
      rackTimelineAutomation.tool === "envelope" &&
      rackTimelineAutomation.pressed === "true" &&
      rackTimelineAutomation.laneName === "E2E Gain gainDb" &&
      rackTimelineAutomation.target?.kind === "effectParam" &&
      rackTimelineAutomation.target?.effectSlotId === "e2e-rack-gain" &&
      rackTimelineAutomation.target?.param === "gainDb" &&
      rackTimelineAutomation.points.length >= 2 &&
      rackTimelineAutomation.points.some((p) => p.value > 6) &&
      rackTimelineAutomation.points.some((p) => p.value < -40) &&
      rackTimelineAutomation.channelGainPoints === 0,
    JSON.stringify(rackTimelineAutomation),
  );
  const rackParamAutomationFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks[0];
    if (!track) return { ready: false, error: "no track" };
    const slotId = "e2e-rack-compressor";
    if (track.effectRack?.slots.some((slot) => slot.id === slotId)) {
      s.dispatch(E.removeTrackEffectSlot(track.id, slotId), { history: false });
    }
    s.dispatch(
      E.addTrackEffectSlot(
        track.id,
        E.newEffectSlot("compressor", {
          id: slotId,
          name: "E2E Compressor",
          params: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 },
        }),
      ),
      { history: false },
    );
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.setScroll(0, 0), { history: false });
    s.dispatch(E.setZoom(180), { history: false });
    return { ready: true, trackId: track.id, slotId, param: "thresholdDb" };
  });
  if (rackParamAutomationFixture.ready) {
    await page.waitForSelector('[data-action="timeline-track-rack-param-automation"][data-effect-slot-id="e2e-rack-compressor"][data-param="thresholdDb"]', {
      timeout: 5000,
    });
    await page.click('[data-action="timeline-track-rack-param-automation"][data-effect-slot-id="e2e-rack-compressor"][data-param="thresholdDb"]');
    const rackParamLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator(".rh-track-head:not(.rh-video-track-head)").first().boundingBox(),
    };
    if (rackParamLaneBox.canvas && rackParamLaneBox.header) {
      const x0 = rackParamLaneBox.canvas.x + 260;
      const x1 = rackParamLaneBox.canvas.x + 390;
      const y0 = rackParamLaneBox.header.y + rackParamLaneBox.header.height * 0.82;
      const y1 = rackParamLaneBox.header.y + rackParamLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const rackParamTimelineAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const lane = track?.automation?.find(
      (automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === fixture.slotId && automation.target.param === fixture.param,
    );
    const pressed = document
      .querySelector(`[data-action="timeline-track-rack-param-automation"][data-effect-slot-id="${fixture.slotId}"][data-param="${fixture.param}"]`)
      ?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      gainParamPoints: track?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === fixture.slotId && automation.target.param === "gainDb")?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeTrackEffectSlot(fixture.trackId, fixture.slotId), { history: false });
    return result;
  }, rackParamAutomationFixture);
  check(
    "Timeline envelope tool draws arbitrary track rack parameter automation",
    rackParamTimelineAutomation.ready &&
      rackParamTimelineAutomation.tool === "envelope" &&
      rackParamTimelineAutomation.pressed === "true" &&
      rackParamTimelineAutomation.laneName === "E2E Compressor thresholdDb" &&
      rackParamTimelineAutomation.target?.kind === "effectParam" &&
      rackParamTimelineAutomation.target?.effectSlotId === "e2e-rack-compressor" &&
      rackParamTimelineAutomation.target?.param === "thresholdDb" &&
      rackParamTimelineAutomation.points.length >= 2 &&
      rackParamTimelineAutomation.points.some((p) => p.value > -25) &&
      rackParamTimelineAutomation.points.some((p) => p.value <= -75) &&
      rackParamTimelineAutomation.gainParamPoints === 0,
    JSON.stringify(rackParamTimelineAutomation),
  );
  const busRackAutomationFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const busId = "e2e-bus-rack";
    const slotId = "e2e-bus-rack-gain";
    if (s.getState().project.buses?.some((bus) => bus.id === busId)) {
      s.dispatch(E.removeBus(busId), { history: false });
    }
    s.dispatch(E.addBus({ id: busId, name: "E2E Bus Rack" }), { history: false });
    s.dispatch(E.addBusEffectSlot(busId, E.newEffectSlot("gain", { id: slotId, name: "E2E Bus Gain", params: { gainDb: -6 } })), { history: false });
    const state = s.getState();
    const videoHeight = (state.project.videoTracks ?? []).filter((track) => track.visible !== false).reduce((sum, track) => sum + (track.height ?? 64), 0);
    const trackHeight = state.project.tracks.reduce((sum, track) => sum + (track.height ?? 96), 0);
    const busIndex = state.project.buses?.findIndex((bus) => bus.id === busId) ?? 0;
    s.dispatch(E.setScroll(state.view.scrollSec, Math.max(0, videoHeight + trackHeight + Math.max(0, busIndex) * 72 - 96)), { history: false });
    s.dispatch(E.setZoom(180), { history: false });
    return { ready: true, busId, slotId };
  });
  if (busRackAutomationFixture.ready) {
    await page.waitForSelector(
      '[data-action="timeline-bus-rack-gain-automation"][data-bus-id="e2e-bus-rack"][data-effect-slot-id="e2e-bus-rack-gain"]',
      { timeout: 5000 },
    );
    await page.click('[data-action="timeline-bus-rack-gain-automation"][data-bus-id="e2e-bus-rack"][data-effect-slot-id="e2e-bus-rack-gain"]');
    const busRackLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator('[data-bus-lane-header="e2e-bus-rack"]').boundingBox(),
    };
    if (busRackLaneBox.canvas && busRackLaneBox.header) {
      const x0 = busRackLaneBox.canvas.x + 260;
      const x1 = busRackLaneBox.canvas.x + 390;
      const y0 = busRackLaneBox.header.y + busRackLaneBox.header.height * 0.82;
      const y1 = busRackLaneBox.header.y + busRackLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const busRackTimelineAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const bus = s.getState().project.buses?.find((item) => item.id === fixture.busId);
    const lane = bus?.automation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === fixture.slotId);
    const pressed = document
      .querySelector(`[data-action="timeline-bus-rack-gain-automation"][data-bus-id="${fixture.busId}"][data-effect-slot-id="${fixture.slotId}"]`)
      ?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      channelGainPoints: bus?.automation?.find((automation) => automation.target.kind === "gainDb")?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeBusEffectSlot(fixture.busId, fixture.slotId), { history: false });
    s.dispatch(E.removeBus(fixture.busId), { history: false });
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, busRackAutomationFixture);
  check(
    "Timeline envelope tool draws bus rack gain automation for a rack slot",
    busRackTimelineAutomation.ready &&
      busRackTimelineAutomation.tool === "envelope" &&
      busRackTimelineAutomation.pressed === "true" &&
      busRackTimelineAutomation.laneName === "E2E Bus Gain gainDb" &&
      busRackTimelineAutomation.target?.kind === "effectParam" &&
      busRackTimelineAutomation.target?.effectSlotId === "e2e-bus-rack-gain" &&
      busRackTimelineAutomation.target?.param === "gainDb" &&
      busRackTimelineAutomation.points.length >= 2 &&
      busRackTimelineAutomation.points.some((p) => p.value > 6) &&
      busRackTimelineAutomation.points.some((p) => p.value < -40) &&
      busRackTimelineAutomation.channelGainPoints === 0,
    JSON.stringify(busRackTimelineAutomation),
  );
  const masterRackAutomationFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const slotId = "e2e-master-rack-gain";
    if (s.getState().project.masterEffectRack?.slots.some((slot) => slot.id === slotId)) {
      s.dispatch(E.removeMasterEffectSlot(slotId), { history: false });
    }
    s.dispatch(E.addMasterEffectSlot(E.newEffectSlot("gain", { id: slotId, name: "E2E Master Gain", params: { gainDb: -6 } })), { history: false });
    const state = s.getState();
    const videoHeight = (state.project.videoTracks ?? []).filter((track) => track.visible !== false).reduce((sum, track) => sum + (track.height ?? 64), 0);
    const trackHeight = state.project.tracks.reduce((sum, track) => sum + (track.height ?? 96), 0);
    const busHeight = (state.project.buses ?? []).length * 72;
    s.dispatch(E.setScroll(state.view.scrollSec, Math.max(0, videoHeight + trackHeight + busHeight)), { history: false });
    s.dispatch(E.setZoom(180), { history: false });
    return { ready: true, slotId };
  });
  if (masterRackAutomationFixture.ready) {
    await page.waitForSelector('[data-action="timeline-master-rack-gain-automation"][data-effect-slot-id="e2e-master-rack-gain"]', { timeout: 5000 });
    await page.click('[data-action="timeline-master-rack-gain-automation"][data-effect-slot-id="e2e-master-rack-gain"]');
    const masterRackLaneBox = {
      canvas: await page.locator(".rh-canvas").boundingBox(),
      header: await page.locator("[data-master-lane-header]").boundingBox(),
    };
    if (masterRackLaneBox.canvas && masterRackLaneBox.header) {
      const x0 = masterRackLaneBox.canvas.x + 280;
      const x1 = masterRackLaneBox.canvas.x + 410;
      const y0 = masterRackLaneBox.header.y + masterRackLaneBox.header.height * 0.82;
      const y1 = masterRackLaneBox.header.y + masterRackLaneBox.header.height * 0.18;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 4 });
      await page.mouse.up();
    }
  }
  const masterRackTimelineAutomation = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const lane = s.getState().project.masterAutomation?.find((automation) => automation.target.kind === "effectParam" && automation.target.effectSlotId === fixture.slotId);
    const pressed = document
      .querySelector(`[data-action="timeline-master-rack-gain-automation"][data-effect-slot-id="${fixture.slotId}"]`)
      ?.getAttribute("aria-pressed");
    const result = {
      ready: true,
      tool: s.getState().tool,
      pressed,
      laneName: lane?.name,
      target: lane?.target,
      points: lane?.points ?? [],
      channelGainPoints: s.getState().project.masterAutomation?.find((automation) => automation.target.kind === "gainDb")?.points.length ?? 0,
    };
    if (lane) s.undo();
    s.dispatch(E.removeMasterEffectSlot(fixture.slotId), { history: false });
    s.dispatch(E.setScroll(s.getState().view.scrollSec, 0), { history: false });
    return result;
  }, masterRackAutomationFixture);
  check(
    "Timeline envelope tool draws master rack gain automation for a rack slot",
    masterRackTimelineAutomation.ready &&
      masterRackTimelineAutomation.tool === "envelope" &&
      masterRackTimelineAutomation.pressed === "true" &&
      masterRackTimelineAutomation.laneName === "E2E Master Gain gainDb" &&
      masterRackTimelineAutomation.target?.kind === "effectParam" &&
      masterRackTimelineAutomation.target?.effectSlotId === "e2e-master-rack-gain" &&
      masterRackTimelineAutomation.target?.param === "gainDb" &&
      masterRackTimelineAutomation.points.length >= 2 &&
      masterRackTimelineAutomation.points.some((p) => p.value > 6) &&
      masterRackTimelineAutomation.points.some((p) => p.value < -40) &&
      masterRackTimelineAutomation.channelGainPoints === 0,
    JSON.stringify(masterRackTimelineAutomation),
  );
  await page.locator('[aria-label="Selection (V)"]').click();

  console.log("• send automation");
  const sendAutomationFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks[0];
    if (!track) return { ready: false, error: "no track" };
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-send-bus")) {
      s.dispatch(E.addBus({ id: "e2e-send-bus", name: "E2E Send Bus" }), { history: false });
    }
    const nextTrack = s.getState().project.tracks.find((item) => item.id === track.id);
    if (!nextTrack?.sends?.some((send) => send.id === "e2e-send")) {
      s.dispatch(E.addTrackSend(track.id, "e2e-send-bus", { id: "e2e-send", name: "E2E Send", gainDb: -9, pan: 0.25 }), { history: false });
    }
    s.dispatch(E.setActiveTrack(track.id), { history: false });
    s.dispatch(E.setPlayhead(2.25), { history: false });
    return { ready: true, trackId: track.id };
  });
  if (sendAutomationFixture.ready) {
    await page.getByRole("tab", { name: "Mixer" }).first().click();
    await page.waitForSelector('[data-send-id="e2e-send"] [data-action="write-send-gain-automation"]', { timeout: 5000 });
    await page.click('[data-send-id="e2e-send"] [data-action="write-send-gain-automation"]');
    await page.click('[data-send-id="e2e-send"] [data-action="write-send-pan-automation"]');
  }
  const sendAutomationWrite = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((item) => item.id === fixture.trackId);
    const gainLane = track?.automation?.find((automation) => automation.target.kind === "sendGainDb" && automation.target.sendId === "e2e-send");
    const panLane = track?.automation?.find((automation) => automation.target.kind === "sendPan" && automation.target.sendId === "e2e-send");
    const result = {
      ready: true,
      gainTarget: gainLane?.target,
      gainPoints: gainLane?.points ?? [],
      panTarget: panLane?.target,
      panPoints: panLane?.points ?? [],
      canUndo: s.canUndo(),
    };
    if (panLane) s.undo();
    if (gainLane) s.undo();
    s.dispatch(E.removeTrackSend(fixture.trackId, "e2e-send"), { history: false });
    s.dispatch(E.removeBus("e2e-send-bus"), { history: false });
    return result;
  }, sendAutomationFixture);
  check(
    "Mixer writes track send gain and pan automation points at the playhead",
    sendAutomationWrite.ready &&
      sendAutomationWrite.gainTarget?.kind === "sendGainDb" &&
      sendAutomationWrite.gainTarget?.sendId === "e2e-send" &&
      sendAutomationWrite.gainPoints.length === 1 &&
      sendAutomationWrite.gainPoints[0].time === 2.25 &&
      sendAutomationWrite.gainPoints[0].value === -9 &&
      sendAutomationWrite.panTarget?.kind === "sendPan" &&
      sendAutomationWrite.panTarget?.sendId === "e2e-send" &&
      sendAutomationWrite.panPoints.length === 1 &&
      sendAutomationWrite.panPoints[0].time === 2.25 &&
      sendAutomationWrite.panPoints[0].value === 0.25 &&
      sendAutomationWrite.canUndo,
    JSON.stringify(sendAutomationWrite),
  );

  const busSendAutomationFixture = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-bus-source")) {
      s.dispatch(E.addBus({ id: "e2e-bus-source", name: "E2E Bus Source" }), { history: false });
    }
    if (!s.getState().project.buses?.some((bus) => bus.id === "e2e-bus-target")) {
      s.dispatch(E.addBus({ id: "e2e-bus-target", name: "E2E Bus Target" }), { history: false });
    }
    const source = s.getState().project.buses?.find((bus) => bus.id === "e2e-bus-source");
    if (!source) return { ready: false, error: "source bus missing" };
    if (!source.sends?.some((send) => send.id === "e2e-bus-send")) {
      s.dispatch(E.addBusSend("e2e-bus-source", "e2e-bus-target", { id: "e2e-bus-send", name: "E2E Bus Send", gainDb: -12, pan: -0.25 }), {
        history: false,
      });
    }
    s.dispatch(E.setPlayhead(3.25), { history: false });
    return { ready: true };
  });
  if (busSendAutomationFixture.ready) {
    await page.getByRole("tab", { name: "Mixer" }).first().click();
    await page.waitForSelector('[data-bus-send-id="e2e-bus-send"] [data-action="write-bus-send-gain-automation"]', { timeout: 5000 });
    await page.click('[data-bus-send-id="e2e-bus-send"] [data-action="write-bus-send-gain-automation"]');
    await page.click('[data-bus-send-id="e2e-bus-send"] [data-action="write-bus-send-pan-automation"]');
  }
  const busSendAutomationWrite = await page.evaluate((fixture) => {
    if (!fixture.ready) return fixture;
    const E = window.__engine;
    const s = window.__rythme;
    const bus = s.getState().project.buses?.find((item) => item.id === "e2e-bus-source");
    const gainLane = bus?.automation?.find((automation) => automation.target.kind === "sendGainDb" && automation.target.sendId === "e2e-bus-send");
    const panLane = bus?.automation?.find((automation) => automation.target.kind === "sendPan" && automation.target.sendId === "e2e-bus-send");
    const result = {
      ready: true,
      gainTarget: gainLane?.target,
      gainPoints: gainLane?.points ?? [],
      panTarget: panLane?.target,
      panPoints: panLane?.points ?? [],
      canUndo: s.canUndo(),
    };
    if (panLane) s.undo();
    if (gainLane) s.undo();
    s.dispatch(E.removeBusSend("e2e-bus-source", "e2e-bus-send"), { history: false });
    s.dispatch(E.removeBus("e2e-bus-source"), { history: false });
    s.dispatch(E.removeBus("e2e-bus-target"), { history: false });
    return result;
  }, busSendAutomationFixture);
  check(
    "Mixer writes bus send gain and pan automation points at the playhead",
    busSendAutomationWrite.ready &&
      busSendAutomationWrite.gainTarget?.kind === "sendGainDb" &&
      busSendAutomationWrite.gainTarget?.sendId === "e2e-bus-send" &&
      busSendAutomationWrite.gainPoints.length === 1 &&
      busSendAutomationWrite.gainPoints[0].time === 3.25 &&
      busSendAutomationWrite.gainPoints[0].value === -12 &&
      busSendAutomationWrite.panTarget?.kind === "sendPan" &&
      busSendAutomationWrite.panTarget?.sendId === "e2e-bus-send" &&
      busSendAutomationWrite.panPoints.length === 1 &&
      busSendAutomationWrite.panPoints[0].time === 3.25 &&
      busSendAutomationWrite.panPoints[0].value === -0.25 &&
      busSendAutomationWrite.canUndo,
    JSON.stringify(busSendAutomationWrite),
  );

  console.log("• effects + undo");
  const undoWorks = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const tid = s.getState().project.tracks[0].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    const clip0 = s.getState().project.tracks[0].clips[0];
    const before = E.Analysis.analyzeLevels(E.Ops.renderClip(clip0)).peak;
    s.dispatch(E.applyEffect((d) => E.DSP.applyGainDb(d, -12)), { label: "Gain" });
    const clipA = s.getState().project.tracks[0].clips[0];
    const after = E.Analysis.analyzeLevels(E.Ops.renderClip(clipA)).peak;
    s.undo();
    const clipU = s.getState().project.tracks[0].clips[0];
    const undone = E.Analysis.analyzeLevels(E.Ops.renderClip(clipU)).peak;
    return { before, after, undone };
  });
  check("effect lowers peak", undoWorks.after < undoWorks.before - 1e-3, JSON.stringify(undoWorks));
  check("undo restores peak", Math.abs(undoWorks.undone - undoWorks.before) < 1e-3, JSON.stringify(undoWorks));

  console.log("• generate");
  const genOk = await page.evaluate(() => {
    const s = window.__rythme;
    const before = s.getState().project.tracks.reduce((n, t) => n + t.clips.length, 0);
    // use the demo's first track and insert a sine via the engine command layer
    const E = window.__engine;
    const tid = s.getState().project.tracks[0].id;
    const buf = E.Generate.sine(440, 1, { sampleRate: s.getState().project.sampleRate, amplitude: 0.5, channels: 2 });
    s.dispatch(E.insertClip(tid, buf, 6, "smoke-tone"), { label: "gen" });
    const after = s.getState().project.tracks.reduce((n, t) => n + t.clips.length, 0);
    return after - before;
  });
  check("generator inserts a clip", genOk === 1, `(delta ${genOk})`);

  console.log("• WAV import round-trip");
  const importOk = await page.evaluate(async () => {
    const E = window.__engine;
    const wav = E.IO.encodeWav(E.Generate.sine(330, 0.5, { sampleRate: 48000, amplitude: 0.7, channels: 2 }), { bitDepth: 16 });
    const str = Array.from(wav, (b) => String.fromCharCode(b)).join("");
    const r = await window.__doImport("smoke.wav", str);
    return r.frames;
  });
  check("imported WAV decodes to frames", importOk > 20000, `(frames ${importOk})`);

  console.log("• export mixdown");
  const exportOk = await page.evaluate(() => {
    const E = window.__engine;
    const mix = E.Ops.renderProject(window.__rythme.getState().project);
    const bytes = E.IO.encodeWav(mix, { bitDepth: 24 });
    const round = E.IO.decodeWav(bytes);
    return { bytes: bytes.length, ch: round.channels.length };
  });
  check("mixdown encodes WAV", exportOk.bytes > 44 && exportOk.ch === 2, JSON.stringify(exportOk));

  console.log("• noise reduction (Audition Noise Reduction process)");
  const nrOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // Capture a noise print from a noise-only buffer, stored on the real app store.
    const noise = E.Generate.whiteNoise(0.5, { sampleRate: SR, amplitude: 0.08, seed: 11, channels: 2 });
    s.setNoiseProfile(E.DSP.captureNoiseProfile(noise, { fftSize: 2048 }));
    const profile = s.getNoiseProfile();
    // Drop the noise on a fresh track, make it active, and reduce via the store.
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "nr" }), { label: "nr" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, noise, 0, "noise"), { label: "ins" });
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.reduceNoise(d, profile, { amount: 1, reduceByDb: 24 })), { label: "Noise Reduction" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    return { hasPrint: !!profile, beforeRms, afterRms, undoneRms };
  });
  check("noise print captured on store", nrOk.hasPrint, JSON.stringify(nrOk));
  check("noise reduction lowers RMS", nrOk.afterRms < nrOk.beforeRms * 0.5, JSON.stringify(nrOk));
  check("noise reduction undoes cleanly", Math.abs(nrOk.undoneRms - nrOk.beforeRms) < 1e-4, JSON.stringify(nrOk));

  console.log("• dehummer (Audition DeHummer)");
  const humOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // 60 Hz hum mixed with a 900 Hz voice-band tone.
    const hum = E.Generate.sine(60, 1, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const voice = E.Generate.sine(900, 1, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const mixed = { sampleRate: SR, channels: hum.channels.map((c, ci) => c.map((v, i) => v + voice.channels[ci][i])) };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "hum" }), { label: "hum" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, mixed, 0, "hum"), { label: "ins" });
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.deHum(d, { frequency: 60, harmonics: 4, reductionDb: -30 })), { label: "DeHummer" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    return { beforeRms, afterRms, undoneRms, hasDeHum: typeof E.DSP.deHum === "function" };
  });
  check("deHum exported on engine", humOk.hasDeHum, JSON.stringify(humOk));
  check("dehummer lowers RMS (hum removed)", humOk.afterRms < humOk.beforeRms * 0.85, JSON.stringify(humOk));
  check("dehummer undoes cleanly", Math.abs(humOk.undoneRms - humOk.beforeRms) < 1e-4, JSON.stringify(humOk));

  console.log("• center channel extractor (Audition Stereo Imagery)");
  const ccOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // center-panned vocal (L==R) + a hard-left instrument.
    const vocal = E.Generate.sine(1000, 1, { sampleRate: SR, amplitude: 0.5, channels: 1 }).channels[0];
    const inst = E.Generate.sine(300, 1, { sampleRate: SR, amplitude: 0.5, channels: 1 }).channels[0];
    const mix = { sampleRate: SR, channels: [vocal.map((v, i) => v + inst[i]), vocal.slice()] };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "cc" }), { label: "cc" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, mix, 0, "mix"), { label: "ins" });
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.centerChannelExtract(d, { mode: "remove" })), { label: "Vocal Remove" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    return { beforeRms, afterRms, undoneRms, hasFn: typeof E.DSP.centerChannelExtract === "function" };
  });
  check("centerChannelExtract exported on engine", ccOk.hasFn, JSON.stringify(ccOk));
  check("vocal remove lowers RMS (center cancelled)", ccOk.afterRms < ccOk.beforeRms * 0.85, JSON.stringify(ccOk));
  check("vocal remove undoes cleanly", Math.abs(ccOk.undoneRms - ccOk.beforeRms) < 1e-4, JSON.stringify(ccOk));

  console.log("• de-esser (Audition DeEsser)");
  const deOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // low body (300 Hz) + strong sibilance (7 kHz).
    const body = E.Generate.sine(300, 1, { sampleRate: SR, amplitude: 0.3, channels: 2 });
    const ess = E.Generate.sine(7000, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const mix = { sampleRate: SR, channels: body.channels.map((c, ci) => c.map((v, i) => v + ess.channels[ci][i])) };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ess" }), { label: "ess" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, mix, 0, "ess"), { label: "ins" });
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.deEss(d, { centerFreq: 7000, thresholdDb: -35 })), { label: "DeEsser" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).rms;
    return { beforeRms, afterRms, undoneRms, hasFn: typeof E.DSP.deEss === "function" };
  });
  check("deEss exported on engine", deOk.hasFn, JSON.stringify(deOk));
  check("de-esser lowers RMS (sibilance reduced)", deOk.afterRms < deOk.beforeRms * 0.92, JSON.stringify(deOk));
  check("de-esser undoes cleanly", Math.abs(deOk.undoneRms - deOk.beforeRms) < 1e-4, JSON.stringify(deOk));

  console.log("• stretch & pitch (Audition Time and Pitch)");
  const spOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.5, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "sp" }), { label: "sp" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeFrames = E.frameCount(E.Ops.renderClip(clip()));
    // pitch shift preserves frame count; time-stretch changes it.
    s.dispatch(E.applyEffect((d) => E.DSP.pitchShift(d, 12)), { label: "Pitch" });
    const pitchedFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.undo();
    const undoneFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.dispatch(E.applyEffect((d) => E.DSP.timeStretch(d, 2)), { label: "Stretch" });
    const stretchedFrames = E.frameCount(E.Ops.renderClip(clip()));
    return {
      beforeFrames,
      pitchedFrames,
      undoneFrames,
      stretchedFrames,
      hasFns: typeof E.DSP.pitchShift === "function" && typeof E.DSP.timeStretch === "function",
    };
  });
  check("pitchShift/timeStretch exported", spOk.hasFns, JSON.stringify(spOk));
  check("pitch shift preserves frame count", spOk.pitchedFrames === spOk.beforeFrames, JSON.stringify(spOk));
  check("pitch shift undoes cleanly", spOk.undoneFrames === spOk.beforeFrames, JSON.stringify(spOk));
  check("time-stretch ×2 roughly doubles frame count", Math.abs(spOk.stretchedFrames - spOk.beforeFrames * 2) < spOk.beforeFrames * 0.02, JSON.stringify(spOk));

  console.log("• hard limiter (Audition Amplitude & Compression)");
  const hlOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.3, { sampleRate: SR, amplitude: 0.9, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "hl" }), { label: "hl" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.hardLimiter(d, { ceilingDb: -0.3, inputBoostDb: 18 })), { label: "Hard Limiter" });
    const stats = E.Analysis.analyzeLevels(E.Ops.renderClip(clip()));
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    const ceiling = Math.pow(10, -0.3 / 20);
    return { beforeRms, afterRms: stats.rms, afterPeak: stats.peak, undoneRms, ceiling, hasFn: typeof E.DSP.hardLimiter === "function" };
  });
  check("hardLimiter exported on engine", hlOk.hasFn, JSON.stringify(hlOk));
  check("hard limiter keeps peak at/under ceiling", hlOk.afterPeak <= hlOk.ceiling + 1e-4, JSON.stringify(hlOk));
  check("hard limiter (boost) raises loudness", hlOk.afterRms > hlOk.beforeRms, JSON.stringify(hlOk));
  check("hard limiter undoes cleanly", Math.abs(hlOk.undoneRms - hlOk.beforeRms) < 1e-4, JSON.stringify(hlOk));

  console.log("• match loudness (Audition ITU-R BS.1770)");
  const mlOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(1000, 2, { sampleRate: SR, amplitude: 0.2, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ml" }), { label: "ml" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.matchLoudness(d, { targetLufs: -16 })), { label: "Match Loudness" });
    const lufs = E.Analysis.measureLoudness(E.Ops.renderClip(clip())).integrated;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, lufs, undoneRms, hasFn: typeof E.DSP.matchLoudness === "function" };
  });
  check("matchLoudness exported on engine", mlOk.hasFn, JSON.stringify(mlOk));
  check("match loudness hits the target (~-16 LUFS)", Math.abs(mlOk.lufs - -16) < 0.5, JSON.stringify(mlOk));
  check("match loudness undoes cleanly", Math.abs(mlOk.undoneRms - mlOk.beforeRms) < 1e-4, JSON.stringify(mlOk));

  console.log("• doppler shifter (Audition Special)");
  const dpOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.6, { sampleRate: SR, amplitude: 0.7, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dp" }), { label: "dp" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    const beforeFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.dispatch(E.applyEffect((d) => E.DSP.doppler(d, { speed: 80, closestDistance: 3 })), { label: "Doppler" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    const afterFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, afterRms, beforeFrames, afterFrames, undoneRms, hasFn: typeof E.DSP.doppler === "function" };
  });
  check("doppler exported on engine", dpOk.hasFn, JSON.stringify(dpOk));
  check("doppler changes the audio (edge attenuation)", dpOk.afterRms < dpOk.beforeRms && dpOk.afterFrames === dpOk.beforeFrames, JSON.stringify(dpOk));
  check("doppler undoes cleanly", Math.abs(dpOk.undoneRms - dpOk.beforeRms) < 1e-4, JSON.stringify(dpOk));

  console.log("• phaser (Audition Modulation)");
  const phOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const noise = E.Generate.whiteNoise(0.4, { sampleRate: SR, amplitude: 0.4, seed: 7, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ph" }), { label: "ph" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, noise, 0, "noise"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const before = E.Ops.renderClip(clip());
    const beforeRms = E.Analysis.analyzeLevels(before).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.phaser(d, { rateHz: 1, mix: 0.5 })), { label: "Phaser" });
    const afterClip = E.Ops.renderClip(clip());
    const afterRms = E.Analysis.analyzeLevels(afterClip).rms;
    let changed = 0;
    for (let i = 0; i < afterClip.channels[0].length; i++) if (Math.abs(afterClip.channels[0][i] - before.channels[0][i]) > 1e-4) { changed = 1; break; }
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, afterRms, changed, undoneRms, hasFn: typeof E.DSP.phaser === "function" };
  });
  check("phaser exported on engine", phOk.hasFn, JSON.stringify(phOk));
  check("phaser changes the audio", phOk.changed === 1, JSON.stringify(phOk));
  check("phaser undoes cleanly", Math.abs(phOk.undoneRms - phOk.beforeRms) < 1e-4, JSON.stringify(phOk));

  console.log("• multiband compressor (Audition Amplitude & Compression)");
  const mbOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const low = E.Generate.sine(80, 0.5, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const high = E.Generate.sine(6000, 0.5, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const mix = { sampleRate: SR, channels: low.channels.map((c, ci) => c.map((v, i) => v + high.channels[ci][i])) };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mb" }), { label: "mb" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, mix, 0, "mix"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const before = E.Ops.renderClip(clip());
    const beforeRms = E.Analysis.analyzeLevels(before).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.multibandCompress(d, { bands: [{ thresholdDb: -40, ratio: 20 }], limiter: { ceilingDb: -0.3 } })), { label: "Multiband" });
    const after = E.Ops.renderClip(clip());
    const afterPeak = E.Analysis.analyzeLevels(after).peak;
    let changed = 0;
    for (let i = 0; i < after.channels[0].length; i++) if (Math.abs(after.channels[0][i] - before.channels[0][i]) > 1e-4) { changed = 1; break; }
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, afterPeak, changed, undoneRms, hasFn: typeof E.DSP.multibandCompress === "function", ceiling: Math.pow(10, -0.3 / 20) };
  });
  check("multibandCompress exported on engine", mbOk.hasFn, JSON.stringify(mbOk));
  check("multiband changes the audio + holds the limiter ceiling", mbOk.changed === 1 && mbOk.afterPeak <= mbOk.ceiling + 1e-4, JSON.stringify(mbOk));
  check("multiband undoes cleanly", Math.abs(mbOk.undoneRms - mbOk.beforeRms) < 1e-4, JSON.stringify(mbOk));

  console.log("• pitch bender (Audition Time & Pitch)");
  const pbOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.6, { sampleRate: SR, amplitude: 0.7, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "pb" }), { label: "pb" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.dispatch(E.applyEffect((d) => E.DSP.pitchBend(d, { startSemitones: 0, endSemitones: 12 })), { label: "Pitch Bend" });
    const afterFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.undo();
    const undoneFrames = E.frameCount(E.Ops.renderClip(clip()));
    return { beforeFrames, afterFrames, undoneFrames, hasFn: typeof E.DSP.pitchBend === "function" };
  });
  check("pitchBend exported on engine", pbOk.hasFn, JSON.stringify(pbOk));
  check("pitch bend up shortens the clip", pbOk.afterFrames < pbOk.beforeFrames && pbOk.afterFrames > 0, JSON.stringify(pbOk));
  check("pitch bend undoes cleanly", pbOk.undoneFrames === pbOk.beforeFrames, JSON.stringify(pbOk));

  console.log("• tube-modeled compressor (Audition Amplitude & Compression)");
  const tcOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.4, { sampleRate: SR, amplitude: 0.7, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "tc" }), { label: "tc" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const before = E.Ops.renderClip(clip());
    const beforeRms = E.Analysis.analyzeLevels(before).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.tubeCompress(d, { driveDb: 12, warmth: 0.5, thresholdDb: -24, ratio: 4 })), { label: "Tube Compressor" });
    const after = E.Ops.renderClip(clip());
    let changed = 0;
    for (let i = 0; i < after.channels[0].length; i++) if (Math.abs(after.channels[0][i] - before.channels[0][i]) > 1e-4) { changed = 1; break; }
    let finite = 1;
    for (let i = 0; i < after.channels[0].length; i++) if (!Number.isFinite(after.channels[0][i])) { finite = 0; break; }
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, changed, finite, undoneRms, hasFn: typeof E.DSP.tubeCompress === "function" };
  });
  check("tubeCompress exported on engine", tcOk.hasFn, JSON.stringify(tcOk));
  check("tube compressor colors the audio (finite)", tcOk.changed === 1 && tcOk.finite === 1, JSON.stringify(tcOk));
  check("tube compressor undoes cleanly", Math.abs(tcOk.undoneRms - tcOk.beforeRms) < 1e-4, JSON.stringify(tcOk));

  console.log("• declicker (Audition Noise Reduction / Restoration)");
  const dckOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // clean tone with big click spikes injected
    const tone = E.Generate.sine(440, 0.3, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    for (const p of [1000, 3000, 5000, 7000]) for (const c of tone.channels) c[p] = c[p] >= 0 ? -0.99 : 0.99;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dck" }), { label: "dck" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "clicked"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforePeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).peak;
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.deClick(d)), { label: "DeClicker" });
    const afterPeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).peak;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforePeak, afterPeak, beforeRms, undoneRms, hasFn: typeof E.DSP.deClick === "function" };
  });
  check("deClick exported on engine", dckOk.hasFn, JSON.stringify(dckOk));
  check("declicker lowers the peak (clicks removed)", dckOk.afterPeak < dckOk.beforePeak - 0.3, JSON.stringify(dckOk));
  check("declicker undoes cleanly", Math.abs(dckOk.undoneRms - dckOk.beforeRms) < 1e-4, JSON.stringify(dckOk));

  console.log("• vocal enhancer (Audition Special)");
  const veOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // voice tone + low rumble to verify the high-pass engages
    const voice = E.Generate.sine(300, 0.4, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const rumble = E.Generate.sine(50, 0.4, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const mix = { sampleRate: SR, channels: voice.channels.map((c, ci) => c.map((v, i) => v + rumble.channels[ci][i])) };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ve" }), { label: "ve" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, mix, 0, "voice"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const before = E.Ops.renderClip(clip());
    const beforeRms = E.Analysis.analyzeLevels(before).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.vocalEnhance(d, { mode: "male" })), { label: "Vocal Enhancer" });
    const after = E.Ops.renderClip(clip());
    let changed = 0;
    for (let i = 0; i < after.channels[0].length; i++) if (Math.abs(after.channels[0][i] - before.channels[0][i]) > 1e-4) { changed = 1; break; }
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, changed, undoneRms, hasFn: typeof E.DSP.vocalEnhance === "function" };
  });
  check("vocalEnhance exported on engine", veOk.hasFn, JSON.stringify(veOk));
  check("vocal enhancer changes the audio", veOk.changed === 1, JSON.stringify(veOk));
  check("vocal enhancer undoes cleanly", Math.abs(veOk.undoneRms - veOk.beforeRms) < 1e-4, JSON.stringify(veOk));

  console.log("• fft filter (Audition Filter & EQ)");
  const ffOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const high = E.Generate.sine(6000, 0.3, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ff" }), { label: "ff" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, high, 0, "high"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    const lp = [{ freq: 0, gainDb: 0 }, { freq: 4000, gainDb: 0 }, { freq: 6000, gainDb: -48 }, { freq: 22050, gainDb: -48 }];
    s.dispatch(E.applyEffect((d) => E.DSP.fftFilter(d, { curve: lp })), { label: "FFT Filter" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, afterRms, undoneRms, hasFn: typeof E.DSP.fftFilter === "function" };
  });
  check("fftFilter exported on engine", ffOk.hasFn, JSON.stringify(ffOk));
  check("fft filter low-pass cuts a 6 kHz tone", ffOk.afterRms < ffOk.beforeRms * 0.5, JSON.stringify(ffOk));
  check("fft filter undoes cleanly", Math.abs(ffOk.undoneRms - ffOk.beforeRms) < 1e-4, JSON.stringify(ffOk));

  console.log("• convolution reverb (Audition Reverb)");
  const crOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "cr" }), { label: "cr" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "tone"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeFrames = E.frameCount(E.Ops.renderClip(clip()));
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.convolutionReverb(d, { decaySeconds: 0.3, mix: 0.5 })), { label: "Convolution Reverb" });
    const afterFrames = E.frameCount(E.Ops.renderClip(clip()));
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeFrames, afterFrames, beforeRms, undoneRms, hasFn: typeof E.DSP.convolutionReverb === "function" };
  });
  check("convolutionReverb exported on engine", crOk.hasFn, JSON.stringify(crOk));
  check("convolution reverb adds a tail (longer clip)", crOk.afterFrames > crOk.beforeFrames, JSON.stringify(crOk));
  check("convolution reverb undoes cleanly", Math.abs(crOk.undoneRms - crOk.beforeRms) < 1e-4, JSON.stringify(crOk));

  console.log("• channel mixer (Audition Stereo Imagery)");
  const cmOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    // distinct L/R tones so a swap is detectable
    const l = E.Generate.sine(300, 0.1, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const r = E.Generate.sine(900, 0.1, { sampleRate: SR, amplitude: 0.4 }).channels[0];
    const stereo = { sampleRate: SR, channels: [l, r] };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "cm" }), { label: "cm" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, stereo, 0, "stereo"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    const beforeL0 = E.Ops.renderClip(clip()).channels[0][50];
    s.dispatch(E.applyEffect((d) => E.DSP.channelMixer(d, { leftToLeft: 0, rightToLeft: 100, leftToRight: 100, rightToRight: 0 })), { label: "Channel Mixer" });
    const after = E.Ops.renderClip(clip());
    // after a swap, left output ≈ the original right (900 Hz) at sample 50
    const swapped = Math.abs(after.channels[0][50] - r[50]) < 1e-3 && Math.abs(after.channels[0][50] - beforeL0) > 1e-4;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, swapped, undoneRms, hasFn: typeof E.DSP.channelMixer === "function" };
  });
  check("channelMixer exported on engine", cmOk.hasFn, JSON.stringify(cmOk));
  check("channel mixer swaps L/R", cmOk.swapped, JSON.stringify(cmOk));
  check("channel mixer undoes cleanly", Math.abs(cmOk.undoneRms - cmOk.beforeRms) < 1e-4, JSON.stringify(cmOk));

  console.log("• dynamics processing (Audition transfer curve)");
  const dynOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const hot = E.Generate.sine(440, 0.3, { sampleRate: SR, amplitude: 0.9, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dyn" }), { label: "dyn" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, hot, 0, "dp"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const peakOf = (d) => { let m = 0; const c = d.channels[0]; for (let i = c.length >> 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return m; };
    const beforePeak = peakOf(E.Ops.renderClip(clip()));
    // 4:1 compressor curve above −24 dB → a 0.9 tone is strongly reduced.
    const curve = [{ inputDb: -60, outputDb: -60 }, { inputDb: -24, outputDb: -24 }, { inputDb: 0, outputDb: -18 }];
    s.dispatch(E.applyEffect((d) => E.DSP.dynamicsProcessing(d, { curve })), { label: "Dynamics Processing" });
    const afterPeak = peakOf(E.Ops.renderClip(clip()));
    s.undo();
    const undonePeak = peakOf(E.Ops.renderClip(clip()));
    return { beforePeak, afterPeak, undonePeak, hasFn: typeof E.DSP.dynamicsProcessing === "function" };
  });
  check("dynamicsProcessing exported on engine", dynOk.hasFn, JSON.stringify(dynOk));
  check("dynamics processing compresses a hot clip", dynOk.afterPeak < dynOk.beforePeak * 0.6, JSON.stringify(dynOk));
  check("dynamics processing undoes cleanly", Math.abs(dynOk.undonePeak - dynOk.beforePeak) < 1e-4, JSON.stringify(dynOk));

  console.log("• notch filter (Audition Filter and EQ)");
  const nfOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const t = E.Generate.sine(440, 0.4, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "nf" }), { label: "nf" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, t, 0, "nf"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    // settled RMS over the second half (past the IIR ramp)
    const rmsOf = (d) => { const c = d.channels[0]; let sum = 0; const st = c.length >> 1; for (let i = st; i < c.length; i++) sum += c[i] * c[i]; return Math.sqrt(sum / (c.length - st)); };
    const beforeRms = rmsOf(E.Ops.renderClip(clip()));
    s.dispatch(E.applyEffect((d) => E.DSP.notchFilter(d, { notches: [{ frequency: 440, gainDb: -40 }], q: 60 })), { label: "Notch Filter" });
    const afterRms = rmsOf(E.Ops.renderClip(clip()));
    s.undo();
    const undoneRms = rmsOf(E.Ops.renderClip(clip()));
    return { beforeRms, afterRms, undoneRms, hasFn: typeof E.DSP.notchFilter === "function" };
  });
  check("notchFilter exported on engine", nfOk.hasFn, JSON.stringify(nfOk));
  check("notch filter attenuates the notched tone", nfOk.afterRms < nfOk.beforeRms * 0.5, JSON.stringify(nfOk));
  check("notch filter undoes cleanly", Math.abs(nfOk.undoneRms - nfOk.beforeRms) < 1e-4, JSON.stringify(nfOk));

  console.log("• exciter (Audition Mastering — harmonic exciter)");
  const excOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const SR = s.getState().project.sampleRate;
    const FFT = 8192;
    const f = 5000;
    const t = E.Generate.sine(f, 0.4, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "exc" }), { label: "exc" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, t, 0, "exc"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const magAt = (d, freq) => { const c = d.channels[0]; const m = E.Analysis.magnitudes(c.subarray(c.length - FFT), FFT); return m[Math.round((freq * FFT) / SR)]; };
    const before3f = magAt(E.Ops.renderClip(clip()), 3 * f);
    s.dispatch(E.applyEffect((d) => E.DSP.exciter(d, { frequency: 3000, driveDb: 15, mix: 0.5, mode: "tape" })), { label: "Exciter" });
    const after3f = magAt(E.Ops.renderClip(clip()), 3 * f);
    s.undo();
    const undone3f = magAt(E.Ops.renderClip(clip()), 3 * f);
    return { before3f, after3f, undone3f, hasFn: typeof E.DSP.exciter === "function" };
  });
  check("exciter exported on engine", excOk.hasFn, JSON.stringify(excOk));
  check("exciter synthesizes a high harmonic (3f)", excOk.after3f > excOk.before3f * 5 + 1e-3, JSON.stringify(excOk));
  check("exciter undoes cleanly", Math.abs(excOk.undone3f - excOk.before3f) < 1e-4, JSON.stringify(excOk));

  console.log("• speech volume leveler (Audition Amplitude & Compression)");
  const svlOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.speechLeveler !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    // loud first half, quiet second half — distinct levels to level out
    const a = E.Generate.sine(300, 0.8, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const b = E.Generate.sine(300, 0.8, { sampleRate: SR, amplitude: 0.05 }).channels[0];
    const buf = new Float32Array(a.length + b.length);
    buf.set(a, 0); buf.set(b, a.length);
    const clipData = { sampleRate: SR, channels: [buf] };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "svl" }), { label: "svl" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "svl"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const tailDb = (c, from, to) => { const st = Math.floor(from + (to - from) * 0.75); let sum = 0; for (let i = st; i < to; i++) sum += c[i] * c[i]; return 20 * Math.log10(Math.sqrt(sum / (to - st)) + 1e-12); };
    const gap = (d) => { const c = d.channels[0]; const mid = c.length / 2; return Math.abs(tailDb(c, 0, mid) - tailDb(c, mid, c.length)); };
    const beforeGap = gap(E.Ops.renderClip(clip()));
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.speechLeveler(d, { targetDb: -18, amount: 1, maxGainDb: 30, windowMs: 120 })), { label: "Speech Volume Leveler" });
    const afterGap = gap(E.Ops.renderClip(clip()));
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeGap, afterGap, beforeRms, undoneRms, hasFn: typeof E.DSP.speechLeveler === "function" };
  });
  check("speechLeveler exported on engine", svlOk.hasFn, JSON.stringify(svlOk));
  check("speech leveler converges the loud/quiet halves", svlOk.afterGap < svlOk.beforeGap * 0.5, JSON.stringify(svlOk));
  check("speech leveler undoes cleanly", Math.abs(svlOk.undoneRms - svlOk.beforeRms) < 1e-4, JSON.stringify(svlOk));

  console.log("• guitar suite (Audition Special — amp + cabinet)");
  const gtrOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.guitarSuite !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const FFT = 8192;
    const f = 400;
    const t = E.Generate.sine(f, 0.4, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "gtr" }), { label: "gtr" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, t, 0, "gtr"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const magAt = (d, freq) => { const c = d.channels[0]; const m = E.Analysis.magnitudes(c.subarray(c.length - FFT), FFT); return m[Math.round((freq * FFT) / SR)]; };
    const before3f = magAt(E.Ops.renderClip(clip()), 3 * f);
    s.dispatch(E.applyEffect((d) => E.DSP.guitarSuite(d, { mode: "lead", driveDb: 18, compress: false })), { label: "Guitar Suite" });
    const after3f = magAt(E.Ops.renderClip(clip()), 3 * f);
    s.undo();
    const undone3f = magAt(E.Ops.renderClip(clip()), 3 * f);
    return { before3f, after3f, undone3f, hasFn: typeof E.DSP.guitarSuite === "function" };
  });
  check("guitarSuite exported on engine", gtrOk.hasFn, JSON.stringify(gtrOk));
  check("guitar suite overdrive adds a harmonic (3f)", gtrOk.after3f > gtrOk.before3f * 5 + 1e-3, JSON.stringify(gtrOk));
  check("guitar suite undoes cleanly", Math.abs(gtrOk.undone3f - gtrOk.before3f) < 1e-4, JSON.stringify(gtrOk));

  console.log("• hiss reduction (Audition Noise Reduction / Restoration)");
  const hissOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.hissReduction !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const noise = E.Generate.whiteNoise(0.6, { sampleRate: SR, amplitude: 0.03, seed: 9 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "hiss" }), { label: "hiss" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, noise, 0, "hiss"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.hissReduction(d, { reduceByDb: 24, amount: 1 })), { label: "Hiss Reduction" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, afterRms, undoneRms, hasFn: typeof E.DSP.hissReduction === "function" };
  });
  check("hissReduction exported on engine", hissOk.hasFn, JSON.stringify(hissOk));
  check("hiss reduction lowers the noise floor", hissOk.afterRms < hissOk.beforeRms * 0.8, JSON.stringify(hissOk));
  check("hiss reduction undoes cleanly", Math.abs(hissOk.undoneRms - hissOk.beforeRms) < 1e-4, JSON.stringify(hissOk));

  console.log("• studio reverb (Audition Reverb — early reflections + tail)");
  const srvOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.studioReverb !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.1, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "srv" }), { label: "srv" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "srv"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const dryLen = E.Ops.renderClip(clip()).channels[0].length;
    const tailEnergy = (d) => { const c = d.channels[0]; let sum = 0; for (let i = dryLen; i < c.length; i++) sum += c[i] * c[i]; return sum; };
    const beforeTail = tailEnergy(E.Ops.renderClip(clip())); // 0 — no samples past dryLen yet
    const beforeLen = E.Ops.renderClip(clip()).channels[0].length;
    s.dispatch(E.applyEffect((d) => E.DSP.studioReverb(d, { decay: 0.7, mix: 0.5, tailSeconds: 1 })), { label: "Studio Reverb" });
    const after = E.Ops.renderClip(clip());
    const afterTail = tailEnergy(after);
    s.undo();
    const undoneLen = E.Ops.renderClip(clip()).channels[0].length;
    return { beforeTail, beforeLen, afterLen: after.channels[0].length, afterTail, undoneLen, hasFn: typeof E.DSP.studioReverb === "function" };
  });
  check("studioReverb exported on engine", srvOk.hasFn, JSON.stringify(srvOk));
  check("studio reverb adds a tail past the dry clip", srvOk.afterLen > srvOk.beforeLen && srvOk.afterTail > 1e-6, JSON.stringify(srvOk));
  check("studio reverb undoes cleanly", srvOk.undoneLen === srvOk.beforeLen, JSON.stringify(srvOk));

  console.log("• mastering (Audition Special — master-bus rack)");
  const mstOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.mastering !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.2, { sampleRate: SR, amplitude: 0.15, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mst" }), { label: "mst" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "mst"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const lvl = (d) => E.Analysis.analyzeLevels(d);
    const before = lvl(E.Ops.renderClip(clip()));
    s.dispatch(E.applyEffect((d) => E.DSP.mastering(d, { driveDb: 6, ceilingDb: -1 })), { label: "Mastering" });
    const after = lvl(E.Ops.renderClip(clip()));
    s.undo();
    const undone = lvl(E.Ops.renderClip(clip()));
    // amount 0 must be an exact passthrough through the full store-bake pipeline.
    s.dispatch(E.applyEffect((d) => E.DSP.mastering(d, { amount: 0 })), { label: "Mastering (bypass)" });
    const bypassRms = lvl(E.Ops.renderClip(clip())).rms;
    s.undo();
    return { beforeRms: before.rms, afterRms: after.rms, afterPeak: after.peak, undoneRms: undone.rms, bypassRms, hasFn: typeof E.DSP.mastering === "function" };
  });
  check("mastering exported on engine", mstOk.hasFn, JSON.stringify(mstOk));
  check("mastering raises loudness under the ceiling", mstOk.afterRms > mstOk.beforeRms && mstOk.afterPeak <= 0.9 + 1e-3, JSON.stringify(mstOk));
  check("mastering amount 0 is a passthrough", Math.abs(mstOk.bypassRms - mstOk.beforeRms) < 1e-4, JSON.stringify(mstOk));
  check("mastering undoes cleanly", Math.abs(mstOk.undoneRms - mstOk.beforeRms) < 1e-4, JSON.stringify(mstOk));

  console.log("• analog delay (Audition Delay and Echo)");
  const adlOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.analogDelay !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(440, 0.1, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "adl" }), { label: "adl" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "adl"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const dryLen = E.Ops.renderClip(clip()).channels[0].length;
    const tailEnergy = (d) => { const c = d.channels[0]; let sum = 0; for (let i = dryLen; i < c.length; i++) sum += c[i] * c[i]; return sum; };
    const beforeLen = dryLen;
    s.dispatch(E.applyEffect((d) => E.DSP.analogDelay(d, { delayMs: 150, feedback: 0.5, mix: 0.5, tailSeconds: 1 })), { label: "Analog Delay" });
    const after = E.Ops.renderClip(clip());
    const afterTail = tailEnergy(after);
    s.undo();
    const undoneLen = E.Ops.renderClip(clip()).channels[0].length;
    return { beforeLen, afterLen: after.channels[0].length, afterTail, undoneLen, hasFn: typeof E.DSP.analogDelay === "function" };
  });
  check("analogDelay exported on engine", adlOk.hasFn, JSON.stringify(adlOk));
  check("analog delay adds echoes past the dry clip", adlOk.afterLen > adlOk.beforeLen && adlOk.afterTail > 1e-6, JSON.stringify(adlOk));
  check("analog delay undoes cleanly", adlOk.undoneLen === adlOk.beforeLen, JSON.stringify(adlOk));

  console.log("• adaptive noise reduction (Audition Noise Reduction / Restoration)");
  const anrOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.adaptiveNoiseReduction !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const noise = E.Generate.whiteNoise(0.6, { sampleRate: SR, amplitude: 0.03, seed: 7 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "anr" }), { label: "anr" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, noise, 0, "anr"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.adaptiveNoiseReduction(d, { reduceByDb: 24 })), { label: "Adaptive Noise Reduction" });
    const afterRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforeRms, afterRms, undoneRms, hasFn: typeof E.DSP.adaptiveNoiseReduction === "function" };
  });
  check("adaptiveNoiseReduction exported on engine", anrOk.hasFn, JSON.stringify(anrOk));
  check("adaptive noise reduction lowers the noise floor", anrOk.afterRms < anrOk.beforeRms * 0.8, JSON.stringify(anrOk));
  check("adaptive noise reduction undoes cleanly", Math.abs(anrOk.undoneRms - anrOk.beforeRms) < 1e-4, JSON.stringify(anrOk));

  console.log("• automatic pitch correction (Audition Time and Pitch)");
  const apcOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.autoPitchCorrect !== "function" || typeof E.DSP.detectPitch !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(450, 0.4, { sampleRate: SR, amplitude: 0.5, channels: 1 }); // between A4/A#4
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "apc" }), { label: "apc" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "apc"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforePitch = E.DSP.detectPitch(E.Ops.renderClip(clip()));
    const beforeRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    s.dispatch(E.applyEffect((d) => E.DSP.autoPitchCorrect(d, { referenceHz: 440, strength: 1 })), { label: "Auto Pitch Correct" });
    const afterPitch = E.DSP.detectPitch(E.Ops.renderClip(clip()));
    s.undo();
    const undoneRms = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).rms;
    return { beforePitch, afterPitch, beforeRms, undoneRms, hasFn: true };
  });
  check("autoPitchCorrect + detectPitch exported on engine", apcOk.hasFn, JSON.stringify(apcOk));
  check("auto pitch correction snaps toward the nearest semitone", apcOk.afterPitch < apcOk.beforePitch && Math.abs(apcOk.afterPitch - 440) / 440 < 0.01, JSON.stringify(apcOk));
  check("auto pitch correction undoes cleanly", Math.abs(apcOk.undoneRms - apcOk.beforeRms) < 1e-4, JSON.stringify(apcOk));

  console.log("• waveshaper distortion (Audition Distortion graph)");
  const wsOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.waveshaper !== "function" || typeof E.DSP.waveshapeCurve !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = E.Generate.sine(220, 0.4, { sampleRate: SR, amplitude: 0.9, channels: 1 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ws" }), { label: "ws" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, tone, 0, "ws"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforePeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).peak;
    const curve = [{ in: -1, out: -0.5 }, { in: -0.5, out: -0.5 }, { in: 0.5, out: 0.5 }, { in: 1, out: 0.5 }];
    // waveshapeCurve is callable end-to-end in the browser build (not just present).
    const curveVal = E.DSP.waveshapeCurve([{ in: -1, out: -0.5 }, { in: 1, out: 0.5 }], 0);
    s.dispatch(E.applyEffect((d) => E.DSP.waveshaper(d, { curve, mix: 1 })), { label: "Waveshaper" });
    const afterPeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).peak;
    s.undo();
    const undonePeak = E.Analysis.analyzeLevels(E.Ops.renderClip(clip())).peak;
    return { beforePeak, afterPeak, undonePeak, curveVal, hasFn: true };
  });
  check("waveshaper + waveshapeCurve exported on engine", wsOk.hasFn, JSON.stringify(wsOk));
  check("waveshapeCurve is callable and interpolates correctly", Math.abs(wsOk.curveVal - 0) < 1e-9, JSON.stringify(wsOk));
  check("waveshaper hard-clip curve caps the peak at the ceiling", wsOk.afterPeak <= 0.5 + 1e-4 && wsOk.afterPeak < wsOk.beforePeak * 0.8, JSON.stringify(wsOk));
  check("waveshaper undoes cleanly", Math.abs(wsOk.undonePeak - wsOk.beforePeak) < 1e-4, JSON.stringify(wsOk));

  console.log("• dereverb (Audition Noise Reduction / Restoration)");
  const drOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.deReverb !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const NN = 16384, ONSET = 512, TAU = 0.06, TF = 4096;
    const base = E.Generate.whiteNoise(NN / SR, { sampleRate: SR, amplitude: 1, seed: 7, channels: 1 }).channels[0];
    const data = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      const env = i < ONSET ? 1 : 0.7 * Math.exp(-(i - ONSET) / (TAU * SR));
      data[i] = base[i] * env;
    }
    const clipData = { sampleRate: SR, channels: [data] };
    const tailRms = (ch) => { let a = 0; for (let i = TF; i < NN; i++) a += ch[i] * ch[i]; return Math.sqrt(a / (NN - TF)); };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dr" }), { label: "dr" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "dr"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeTail = tailRms(E.Ops.renderClip(clip()).channels[0]);
    s.dispatch(E.applyEffect((d) => E.DSP.deReverb(d, { amount: 0.9, reverbMs: 800, reduceByDb: 28 })), { label: "DeReverb" });
    const afterTail = tailRms(E.Ops.renderClip(clip()).channels[0]);
    s.undo();
    const undoneTail = tailRms(E.Ops.renderClip(clip()).channels[0]);
    return { beforeTail, afterTail, undoneTail, hasFn: true };
  });
  check("deReverb exported on engine", drOk.hasFn, JSON.stringify(drOk));
  check("dereverb reduces the reverberant tail", drOk.afterTail < drOk.beforeTail * 0.6, JSON.stringify(drOk));
  check("dereverb undoes cleanly", Math.abs(drOk.undoneTail - drOk.beforeTail) < 1e-4, JSON.stringify(drOk));

  console.log("• declipper (Audition Clip Restoration)");
  const dcOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.deClip !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const CLIP = 0.6;
    const orig = E.Generate.sine(440, 0.2, { sampleRate: SR, amplitude: 0.9, channels: 1 }).channels[0];
    const data = new Float32Array(orig.length);
    for (let i = 0; i < orig.length; i++) data[i] = Math.max(-CLIP, Math.min(CLIP, orig[i])); // hard-clip the peaks flat
    const clipData = { sampleRate: SR, channels: [data] };
    const peak = (ch) => { let p = 0; for (const v of ch) p = Math.max(p, Math.abs(v)); return p; };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dc" }), { label: "dc" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "dc"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforePeak = peak(E.Ops.renderClip(clip()).channels[0]);
    s.dispatch(E.applyEffect((d) => E.DSP.deClip(d, { threshold: 0.55 })), { label: "DeClipper" });
    const afterPeak = peak(E.Ops.renderClip(clip()).channels[0]);
    s.undo();
    const undonePeak = peak(E.Ops.renderClip(clip()).channels[0]);
    return { beforePeak, afterPeak, undonePeak, hasFn: true };
  });
  check("deClip exported on engine", dcOk.hasFn, JSON.stringify(dcOk));
  check("declipper rebuilds the clipped peak above the clip level", dcOk.afterPeak > 0.6 && dcOk.afterPeak <= 1 && dcOk.beforePeak <= 0.61, JSON.stringify(dcOk));
  check("declipper undoes cleanly", Math.abs(dcOk.undonePeak - dcOk.beforePeak) < 1e-4, JSON.stringify(dcOk));

  console.log("• echo (Audition Delay and Echo)");
  const ecOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.echo !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const NB = 64;
    const base = E.Generate.whiteNoise(NB / SR, { sampleRate: SR, amplitude: 0.8, seed: 4, channels: 1 }).channels[0];
    const clipData = { sampleRate: SR, channels: [Float32Array.from(base)] };
    const rms = (ch, a, b) => { let s2 = 0; for (let i = a; i < b; i++) s2 += ch[i] * ch[i]; return Math.sqrt(s2 / Math.max(1, b - a)); };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "ec" }), { label: "ec" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "ec"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeLen = E.Ops.renderClip(clip()).channels[0].length;
    s.dispatch(E.applyEffect((d) => E.DSP.echo(d, { delayMs: 200, feedback: 0.6, mix: 1, tailSeconds: 1 })), { label: "Echo" });
    const after = E.Ops.renderClip(clip()).channels[0];
    const D = Math.round(0.2 * SR);
    const echoEnergy = rms(after, D - 64, D + 256); // energy around the first repeat
    s.undo();
    const undoneLen = E.Ops.renderClip(clip()).channels[0].length;
    return { beforeLen, afterLen: after.length, echoEnergy, undoneLen, hasFn: true };
  });
  check("echo exported on engine", ecOk.hasFn, JSON.stringify(ecOk));
  check("echo appends a tail and produces a repeat", ecOk.afterLen > ecOk.beforeLen && ecOk.echoEnergy > 1e-3, JSON.stringify(ecOk));
  check("echo undoes cleanly", ecOk.undoneLen === ecOk.beforeLen, JSON.stringify(ecOk));

  console.log("• scientific filter (Audition Filter and EQ)");
  const sfOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.scientificFilter !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    // A low (200 Hz) + high (8 kHz) tone; a Butterworth low-pass should kill the high.
    const low = E.Generate.sine(200, 0.4, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const high = E.Generate.sine(8000, 0.4, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const mix = { sampleRate: SR, channels: [low.channels[0].map((v, i) => v + high.channels[0][i])] };
    const settledRms = (ch) => { let sum = 0; const a = ch.length >> 1; for (let i = a; i < ch.length; i++) sum += ch[i] * ch[i]; return Math.sqrt(sum / (ch.length - a)); };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "sf" }), { label: "sf" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, mix, 0, "mix"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeRms = settledRms(E.Ops.renderClip(clip()).channels[0]);
    // Verify the design helper hits the textbook −3 dB at the corner.
    const cornerDb = E.DSP.scientificFilterResponseDb({ kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 1000 }, 1000, SR);
    s.dispatch(E.applyEffect((d) => E.DSP.scientificFilter(d, { kind: "butterworth", response: "lowpass", order: 8, cutoffHz: 1000 })), { label: "Scientific Filter" });
    const after = E.Ops.renderClip(clip()).channels[0];
    const afterRms = settledRms(after);
    let finite = 1;
    for (const v of after) if (!Number.isFinite(v)) { finite = 0; break; }
    s.undo();
    const undoneRms = settledRms(E.Ops.renderClip(clip()).channels[0]);
    // Elliptic (Cauer): −rippleDb at the corner, and steeper than Chebyshev I.
    const ell = { kind: "elliptic", response: "lowpass", order: 6, cutoffHz: 1000, rippleDb: 1, stopAttenDb: 50 };
    const ellCorner = E.DSP.scientificFilterResponseDb(ell, 1000, SR);
    const ellAt1300 = E.DSP.scientificFilterResponseDb(ell, 1300, SR);
    const chebAt1300 = E.DSP.scientificFilterResponseDb({ kind: "chebyshev1", response: "lowpass", order: 6, cutoffHz: 1000, rippleDb: 1 }, 1300, SR);
    return { beforeRms, afterRms, undoneRms, cornerDb, finite, ellCorner, ellAt1300, chebAt1300, hasFn: true };
  });
  check("scientificFilter exported on engine", sfOk.hasFn, JSON.stringify(sfOk));
  check("scientific filter design is −3 dB at the corner", Math.abs(sfOk.cornerDb + 3.0103) < 0.2, JSON.stringify(sfOk));
  check("scientific low-pass removes the high tone", sfOk.finite === 1 && sfOk.afterRms < sfOk.beforeRms * 0.85, JSON.stringify(sfOk));
  check("scientific filter undoes cleanly", Math.abs(sfOk.undoneRms - sfOk.beforeRms) < 1e-4, JSON.stringify(sfOk));
  check("elliptic filter is −rippleDb at corner and steeper than Chebyshev I", Math.abs(sfOk.ellCorner + 1) < 0.3 && sfOk.ellAt1300 < sfOk.chebAt1300 - 10, JSON.stringify(sfOk));

  console.log("• stereo expander (Audition Stereo Imagery)");
  const stxOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.stereoExpander !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    // Independent L/R tones → a real side signal to widen/collapse.
    const l = E.Generate.sine(300, 0.3, { sampleRate: SR, amplitude: 0.4, channels: 1 }).channels[0];
    const r = E.Generate.sine(500, 0.3, { sampleRate: SR, amplitude: 0.4, channels: 1 }).channels[0];
    const stereo = { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
    const sideRms = (d) => { const a = d.channels[0], b = d.channels[1]; let sum = 0; for (let i = 0; i < a.length; i++) { const v = (a[i] - b[i]) / 2; sum += v * v; } return Math.sqrt(sum / a.length); };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "stx" }), { label: "stx" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, stereo, 0, "stereo"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeSide = sideRms(E.Ops.renderClip(clip()));
    s.dispatch(E.applyEffect((d) => E.DSP.stereoExpander(d, { expand: 250 })), { label: "Stereo Expander" });
    const widened = E.Ops.renderClip(clip());
    const afterSide = sideRms(widened);
    let finite = 1;
    for (const ch of widened.channels) for (const v of ch) if (!Number.isFinite(v)) { finite = 0; break; }
    s.undo();
    const undoneSide = sideRms(E.Ops.renderClip(clip()));
    return { beforeSide, afterSide, undoneSide, finite, hasFn: true };
  });
  check("stereoExpander exported on engine", stxOk.hasFn, JSON.stringify(stxOk));
  check("stereo expander widens the stereo image", stxOk.finite === 1 && stxOk.afterSide > stxOk.beforeSide * 1.5, JSON.stringify(stxOk));
  check("stereo expander undoes cleanly", Math.abs(stxOk.undoneSide - stxOk.beforeSide) < 1e-4, JSON.stringify(stxOk));

  console.log("• full reverb (Audition Reverb)");
  const frvOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.fullReverb !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const base = E.Generate.whiteNoise(0.08, { sampleRate: SR, amplitude: 0.6, seed: 11, channels: 1 }).channels[0];
    const clipData = { sampleRate: SR, channels: [Float32Array.from(base)] };
    const rms = (ch, a, b) => { let q = 0; for (let i = a; i < b; i++) q += ch[i] * ch[i]; return Math.sqrt(q / Math.max(1, b - a)); };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "frv" }), { label: "frv" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "frv"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeLen = E.Ops.renderClip(clip()).channels[0].length;
    s.dispatch(E.applyEffect((d) => E.DSP.fullReverb(d, { decayMs: 300, perception: 50, mix: 0.6 })), { label: "Full Reverb" });
    const after = E.Ops.renderClip(clip()).channels[0];
    const tailEnergy = rms(after, beforeLen, after.length);
    let finite = 1;
    for (const v of after) if (!Number.isFinite(v)) { finite = 0; break; }
    s.undo();
    const undoneLen = E.Ops.renderClip(clip()).channels[0].length;
    return { beforeLen, afterLen: after.length, tailEnergy, undoneLen, finite, hasFn: true };
  });
  check("fullReverb exported on engine", frvOk.hasFn, JSON.stringify(frvOk));
  check("full reverb appends a decaying tail", frvOk.finite === 1 && frvOk.afterLen > frvOk.beforeLen && frvOk.tailEnergy > 1e-3, JSON.stringify(frvOk));
  check("full reverb undoes cleanly", frvOk.undoneLen === frvOk.beforeLen, JSON.stringify(frvOk));

  console.log("• automatic phase correction (Audition Restoration)");
  const aphOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.autoPhaseCorrect !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const base = E.Generate.whiteNoise(0.15, { sampleRate: SR, amplitude: 0.5, seed: 6, channels: 1 }).channels[0];
    const D = 18; // right channel delayed by 18 samples
    const r = new Float32Array(base.length);
    for (let i = 0; i < base.length; i++) { const j = i - D; r[i] = j >= 0 ? base[j] : 0; }
    const stereo = { sampleRate: SR, channels: [Float32Array.from(base), r] };
    const bestLag = (a, b, max) => { const n = a.length; let at = 0, best = -Infinity; for (let lag = -max; lag <= max; lag++) { let dot = 0; for (let i = 200; i < n - 200; i++) { const j = i + lag; dot += a[i] * (j >= 0 && j < n ? b[j] : 0); } if (Math.abs(dot) > best) { best = Math.abs(dot); at = lag; } } return at; };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "aph" }), { label: "aph" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, stereo, 0, "aph"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const before = E.Ops.renderClip(clip());
    const beforeLag = bestLag(before.channels[0], before.channels[1], 60);
    s.dispatch(E.applyEffect((d) => E.DSP.autoPhaseCorrect(d, { maxShiftMs: 5 })), { label: "Auto Phase Correction" });
    const after = E.Ops.renderClip(clip());
    const afterLag = bestLag(after.channels[0], after.channels[1], 60);
    let finite = 1;
    for (const ch of after.channels) for (const v of ch) if (!Number.isFinite(v)) { finite = 0; break; }
    s.undo();
    const undoneLag = bestLag(E.Ops.renderClip(clip()).channels[0], E.Ops.renderClip(clip()).channels[1], 60);
    return { beforeLag, afterLag, undoneLag, finite, hasFn: true };
  });
  check("autoPhaseCorrect exported on engine", aphOk.hasFn, JSON.stringify(aphOk));
  check("auto phase correction aligns the delayed channel", aphOk.finite === 1 && aphOk.beforeLag !== 0 && Math.abs(aphOk.afterLag) <= 1, JSON.stringify(aphOk));
  check("auto phase correction undoes cleanly", aphOk.undoneLag === aphOk.beforeLag, JSON.stringify(aphOk));

  console.log("• graphic phase shifter (Audition Stereo Imagery)");
  const gpsOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.graphicPhaseShifter !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const t = E.Generate.sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const data = { sampleRate: SR, channels: [Float32Array.from(t.channels[0])] };
    const rms = (ch) => { let q = 0; const a = ch.length >> 2, b = ch.length - a; for (let i = a; i < b; i++) q += ch[i] * ch[i]; return Math.sqrt(q / (b - a)); };
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "gps" }), { label: "gps" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, data, 0, "gps"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const before = E.Ops.renderClip(clip()).channels[0];
    const beforeRms = rms(before);
    // 180° flat curve = polarity inversion; magnitude (RMS) preserved, samples flipped.
    s.dispatch(E.applyEffect((d) => E.DSP.graphicPhaseShifter(d, { curve: [{ freq: 0, phaseDeg: 180 }, { freq: 22050, phaseDeg: 180 }] })), { label: "Graphic Phase Shifter" });
    const after = E.Ops.renderClip(clip()).channels[0];
    const afterRms = rms(after);
    let inverted = 1, finite = 1;
    const g = 2048;
    for (let i = g; i < before.length - g; i++) { if (!Number.isFinite(after[i])) finite = 0; if (Math.abs(after[i] + before[i]) > 1e-2) inverted = 0; }
    s.undo();
    const undoneRms = rms(E.Ops.renderClip(clip()).channels[0]);
    return { beforeRms, afterRms, inverted, finite, undoneRms, hasFn: true };
  });
  check("graphicPhaseShifter exported on engine", gpsOk.hasFn, JSON.stringify(gpsOk));
  check("phase shifter preserves magnitude and a 180° curve inverts", gpsOk.finite === 1 && gpsOk.inverted === 1 && Math.abs(gpsOk.afterRms - gpsOk.beforeRms) < gpsOk.beforeRms * 0.05, JSON.stringify(gpsOk));
  check("graphic phase shifter undoes cleanly", Math.abs(gpsOk.undoneRms - gpsOk.beforeRms) < 1e-4, JSON.stringify(gpsOk));

  console.log("• gain envelope (Audition Amplitude)");
  const gainEnvOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.gainEnvelope !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const N = 4000;
    const data = { sampleRate: SR, channels: [new Float32Array(N).fill(0.8)] }; // constant level
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "gen" }), { label: "gen" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, data, 0, "gen"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeStart = E.Ops.renderClip(clip()).channels[0][0];
    // Fade out: gain 1 → 0; start stays, end collapses to silence.
    s.dispatch(E.applyEffect((d) => E.DSP.gainEnvelope(d, { points: [{ time: 0, gain: 1 }, { time: 1, gain: 0 }] })), { label: "Gain Envelope" });
    const after = E.Ops.renderClip(clip()).channels[0];
    const startGain = after[0];
    const endGain = Math.abs(after[after.length - 1]);
    let finite = 1;
    for (const v of after) if (!Number.isFinite(v)) { finite = 0; break; }
    s.undo();
    const undoStart = E.Ops.renderClip(clip()).channels[0][0];
    return { beforeStart, startGain, endGain, finite, undoStart, hasFn: true };
  });
  check("gainEnvelope exported on engine", gainEnvOk.hasFn, JSON.stringify(gainEnvOk));
  check("gain envelope fades the level down over time", gainEnvOk.finite === 1 && Math.abs(gainEnvOk.startGain - 0.8) < 0.01 && gainEnvOk.endGain < 0.02, JSON.stringify(gainEnvOk));
  check("gain envelope undoes cleanly", Math.abs(gainEnvOk.undoStart - gainEnvOk.beforeStart) < 1e-4, JSON.stringify(gainEnvOk));

  console.log("• frequency band splitter (Audition)");
  const bandOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.frequencyBandSplit !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const src = E.Generate.whiteNoise(0.1, { sampleRate: SR, amplitude: 0.5, seed: 12, channels: 1 });
    // engine: 2 crossovers → 3 bands that recombine exactly
    const bands = E.DSP.frequencyBandSplit(src, { crossovers: [800, 3200] });
    let maxErr = 0;
    const x = src.channels[0];
    for (let i = 0; i < x.length; i++) { let sum = 0; for (const b of bands) sum += b.channels[0][i]; maxErr = Math.max(maxErr, Math.abs(sum - x[i])); }
    // store: drop each band on its own new track (the splitIntoBands flow)
    const before = s.getState().project.tracks.length;
    bands.forEach((band, i) => {
      const idx = s.getState().project.tracks.length;
      s.dispatch(E.addTrack({ name: `Band ${i + 1}` }), { label: "Band Splitter" });
      const tid = s.getState().project.tracks[idx].id;
      s.dispatch(E.insertClip(tid, band, 0, `Band ${i + 1}`), { label: "Band Splitter" });
    });
    const added = s.getState().project.tracks.length - before;
    return { bandCount: bands.length, maxErr, added, hasFn: true };
  });
  check("frequencyBandSplit exported on engine", bandOk.hasFn, JSON.stringify(bandOk));
  check("band splitter makes 3 bands that recombine exactly", bandOk.bandCount === 3 && bandOk.maxErr < 1e-4, JSON.stringify(bandOk));
  check("band splitter drops each band on its own track", bandOk.added === 3, JSON.stringify(bandOk));

  console.log("• amplitude statistics (Audition)");
  const ampStatOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Analysis.amplitudeStatistics !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    // half-scale sine → −6 dB peak, −9 dB RMS, no clipping
    const clean = E.Analysis.amplitudeStatistics(E.Generate.sine(1000, 0.3, { sampleRate: SR, amplitude: 0.5, channels: 1 })).channels[0];
    // a clamped sine → clipped samples
    const loud = E.Generate.sine(500, 0.1, { sampleRate: SR, amplitude: 1.5, channels: 1 });
    for (let i = 0; i < loud.channels[0].length; i++) loud.channels[0][i] = Math.max(-1, Math.min(1, loud.channels[0][i]));
    const clipped = E.Analysis.amplitudeStatistics(loud).channels[0];
    return {
      peakDb: clean.peakDb, rmsDb: clean.totalRmsDb, cleanClipped: clean.possiblyClippedSamples,
      clippedCount: clipped.possiblyClippedSamples, hasFn: true,
    };
  });
  check("amplitudeStatistics exported on engine", ampStatOk.hasFn, JSON.stringify(ampStatOk));
  check("amplitude statistics reads −6 dB peak / −9 dB RMS for a half-scale sine", Math.abs(ampStatOk.peakDb + 6.02) < 0.2 && Math.abs(ampStatOk.rmsDb + 9.03) < 0.2 && ampStatOk.cleanClipped === 0, JSON.stringify(ampStatOk));
  check("amplitude statistics counts clipped samples", ampStatOk.clippedCount > 1000, JSON.stringify(ampStatOk));

  console.log("• phase analysis (Audition)");
  const phaseOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Analysis.phaseAnalysis !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const m = E.Generate.sine(1000, 0.1, { sampleRate: SR, amplitude: 0.5, channels: 1 }).channels[0];
    const same = E.Analysis.phaseAnalysis({ sampleRate: SR, channels: [Float32Array.from(m), Float32Array.from(m)] });
    const inv = E.Analysis.phaseAnalysis({ sampleRate: SR, channels: [Float32Array.from(m), m.map((v) => -v)] });
    return { sameCorr: same.correlation, sameMono: same.monoCompatibility, invCorr: inv.correlation, invMono: inv.monoCompatibility, hasFn: true };
  });
  check("phaseAnalysis exported on engine", phaseOk.hasFn, JSON.stringify(phaseOk));
  check("phase analysis reads +1 in phase / −1 inverted", phaseOk.sameCorr > 0.999 && phaseOk.invCorr < -0.999, JSON.stringify(phaseOk));
  check("phase analysis flags mono cancellation when inverted", phaseOk.sameMono > 0.999 && phaseOk.invMono < 0.001, JSON.stringify(phaseOk));

  console.log("• delete silence (Audition)");
  const delSilOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.deleteSilence !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = (sec) => E.Generate.sine(440, sec, { sampleRate: SR, amplitude: 0.6, channels: 1 });
    const sil = { sampleRate: SR, channels: [new Float32Array(Math.round(0.5 * SR))] };
    const clipData = E.concat(tone(0.2), sil, tone(0.2)); // 0.9 s with a 0.5 s gap
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dsil" }), { label: "dsil" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "dsil"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeLen = E.Ops.renderClip(clip()).channels[0].length;
    s.dispatch(E.applyEffect((d) => E.DSP.deleteSilence(d, { thresholdDb: -50, minSilenceMs: 200, keepMs: 0 })), { label: "Delete Silence" });
    const after = E.Ops.renderClip(clip()).channels[0];
    let finite = 1;
    for (const v of after) if (!Number.isFinite(v)) { finite = 0; break; }
    s.undo();
    const undoneLen = E.Ops.renderClip(clip()).channels[0].length;
    return { beforeLen, afterLen: after.length, undoneLen, finite, hasFn: true };
  });
  check("deleteSilence exported on engine", delSilOk.hasFn, JSON.stringify(delSilOk));
  check("delete silence shortens the clip by ~the gap", delSilOk.finite === 1 && delSilOk.afterLen < delSilOk.beforeLen * 0.55, JSON.stringify(delSilOk));
  check("delete silence undoes cleanly", delSilOk.undoneLen === delSilOk.beforeLen, JSON.stringify(delSilOk));

  console.log("• spectrogram (Audition Spectral Frequency Display)");
  const spectroOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Analysis.spectrogram !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const sg = E.Analysis.spectrogram(E.Generate.sine(2000, 0.3, { sampleRate: SR, amplitude: 0.8, channels: 1 }), { fftSize: 1024, hop: 512 });
    const track = E.Analysis.spectrogramPeakTrack(sg);
    // dominant bin should sit near 2000 Hz in every frame
    let maxDev = 0;
    for (const hz of track) maxDev = Math.max(maxDev, Math.abs(hz - 2000));
    return { frames: sg.frames, bins: sg.bins, dbLen: sg.db.length, expectLen: sg.frames * sg.bins, maxDev, hasFn: true };
  });
  check("spectrogram exported on engine", spectroOk.hasFn, JSON.stringify(spectroOk));
  check("spectrogram returns a frames×bins matrix", spectroOk.dbLen === spectroOk.expectLen && spectroOk.frames > 1 && spectroOk.bins === 513, JSON.stringify(spectroOk));
  check("spectrogram locates a 2 kHz tone in its bin", spectroOk.maxDev < 60, JSON.stringify(spectroOk));

  console.log("• convert sample type (Audition)");
  const convOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.convertSampleType !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const stereo = E.Generate.sine(1000, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "cvt" }), { label: "cvt" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, stereo, 0, "cvt"), { label: "ins" });
    const clip = () => s.getState().project.tracks[idx].clips[0];
    const beforeCh = E.Ops.renderClip(clip()).channels.length;
    // stereo → mono: the clip buffer becomes 1 channel; render must still cope.
    s.dispatch(E.applyEffect((d) => E.DSP.convertSampleType(d, { channels: 1, bitDepth: 8 })), { label: "Convert Sample Type" });
    const out = E.Ops.renderClip(clip());
    const step = 1 / Math.pow(2, 7);
    let onGrid = 1, finite = 1;
    for (const ch of out.channels) for (const v of ch) { if (!Number.isFinite(v)) finite = 0; if (Math.abs(v / step - Math.round(v / step)) > 1e-3) onGrid = 0; }
    const mix = E.Ops.renderProject(s.getState().project); // whole-project render must not throw
    s.undo();
    const undoneCh = E.Ops.renderClip(clip()).channels.length;
    return { beforeCh, finite, onGrid, mixLen: mix.channels[0].length, undoneCh, hasFn: true };
  });
  check("convertSampleType exported on engine", convOk.hasFn, JSON.stringify(convOk));
  check("convert sample type quantizes to 8-bit and renders", convOk.finite === 1 && convOk.onGrid === 1 && convOk.mixLen > 0, JSON.stringify(convOk));
  check("convert sample type undoes cleanly", convOk.undoneCh === convOk.beforeCh, JSON.stringify(convOk));

  console.log("• mark audio (Audition Diagnostics)");
  const markOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Analysis.detectAudioRegions !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const tone = (sec) => E.Generate.sine(440, sec, { sampleRate: SR, amplitude: 0.6, channels: 1 });
    const sil = (sec) => ({ sampleRate: SR, channels: [new Float32Array(Math.round(sec * SR))] });
    const clipData = E.concat(tone(0.2), sil(0.5), tone(0.2)); // two phrases
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mark" }), { label: "mark" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, clipData, 0, "mark"), { label: "ins" });
    const beforeMarkers = s.getState().project.markers.length;
    const regions = E.Analysis.detectAudioRegions(E.Ops.renderProject(s.getState().project), { thresholdDb: -50, minSilenceMs: 300, minAudioMs: 100 });
    // add a range marker per region in one dispatch (the markAudioRegions path)
    s.dispatch((st) => { let state = st; regions.forEach((r, i) => { state = E.addMarker({ time: r.start, end: r.end, name: `Region ${i + 1}` })(state); }); return state; }, { label: "Mark Audio" });
    const after = s.getState().project.markers;
    const added = after.length - beforeMarkers;
    const firstRange = after.length ? after[after.length - added].end > after[after.length - added].time : false;
    s.undo();
    const undoneMarkers = s.getState().project.markers.length;
    return { regions: regions.length, added, firstRange, undoneMarkers, beforeMarkers, hasFn: true };
  });
  check("detectAudioRegions exported on engine", markOk.hasFn, JSON.stringify(markOk));
  check("mark audio finds 2 phrases and adds a range marker each", markOk.regions === 2 && markOk.added === 2 && markOk.firstRange, JSON.stringify(markOk));
  check("mark audio undoes cleanly", markOk.undoneMarkers === markOk.beforeMarkers, JSON.stringify(markOk));

  console.log("• tones generator (Audition Generate ▸ Tones)");
  const tonesOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Generate.tones !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const FFT = 8192;
    const peakFrac = (ch) => { const m = E.Analysis.magnitudes(ch.subarray(0, FFT), FFT); let total = 0, mx = 0; for (const v of m) { total += v * v; mx = Math.max(mx, v); } return total > 0 ? (mx * mx) / total : 0; };
    const pure = E.Generate.tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8, channels: 1 });
    const warble = E.Generate.tones(1000, 0.3, { sampleRate: SR, amplitude: 0.8, channels: 1, modDepthHz: 400, modRateHz: 8 });
    const pureFrac = peakFrac(pure.channels[0]);
    const warbleFrac = peakFrac(warble.channels[0]);
    // insert the warble clip on a new track (the insertTones path)
    const before = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "Tones" }), { label: "tones" });
    const tid = s.getState().project.tracks[before].id;
    s.dispatch(E.insertClip(tid, warble, 0, "Tones"), { label: "ins" });
    const clipLen = E.Ops.renderClip(s.getState().project.tracks[before].clips[0]).channels[0].length;
    return { pureFrac, warbleFrac, added: s.getState().project.tracks.length - before, clipLen, hasFn: true };
  });
  check("tones exported on engine", tonesOk.hasFn, JSON.stringify(tonesOk));
  check("tones FM spreads the spectrum vs a pure tone", tonesOk.warbleFrac < tonesOk.pureFrac * 0.5 && tonesOk.pureFrac > 0.5, JSON.stringify(tonesOk));
  check("tones clip inserts on a new track", tonesOk.added === 1 && tonesOk.clipLen > 0, JSON.stringify(tonesOk));

  console.log("• vectorscope (Audition Phase Scope)");
  const vsOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Analysis.vectorscope !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const m = E.Generate.sine(1000, 0.1, { sampleRate: SR, amplitude: 0.5, channels: 1 }).channels[0];
    const maxAbs = (a) => { let mx = 0; for (const v of a) mx = Math.max(mx, Math.abs(v)); return mx; };
    const mono = E.Analysis.vectorscope({ sampleRate: SR, channels: [Float32Array.from(m), Float32Array.from(m)] });
    const inv = E.Analysis.vectorscope({ sampleRate: SR, channels: [Float32Array.from(m), m.map((v) => -v)] });
    return { monoX: maxAbs(mono.x), monoY: maxAbs(mono.y), invX: maxAbs(inv.x), invY: maxAbs(inv.y), count: mono.count, hasFn: true };
  });
  check("vectorscope exported on engine", vsOk.hasFn, JSON.stringify(vsOk));
  check("vectorscope: mono is vertical (x≈0), inverted is horizontal (y≈0)", vsOk.count > 0 && vsOk.monoX < 1e-5 && vsOk.monoY > 0.9 && vsOk.invY < 1e-5 && vsOk.invX > 0.9, JSON.stringify(vsOk));

  console.log("• dtmf signals (Audition Generate ▸ DTMF)");
  const dtmfOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Generate.dtmfSequence !== "function") return { hasFn: false };
    const SR = s.getState().project.sampleRate;
    const buf = E.Generate.dtmfSequence("12", { sampleRate: SR, toneMs: 100, breakMs: 50, channels: 1 });
    const durMs = (buf.channels[0].length / SR) * 1000;
    // first key "1" = 697 + 1209
    const mags = E.Analysis.magnitudes(buf.channels[0].subarray(0, 4096), 4096);
    const bin = (hz) => mags[Math.round((hz * 4096) / SR)];
    // insert as a clip on a new track (the insertDtmfSequence path)
    const before = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "DTMF" }), { label: "dtmf" });
    const tid = s.getState().project.tracks[before].id;
    s.dispatch(E.insertClip(tid, buf, 0, "DTMF"), { label: "ins" });
    return { durMs, m697: bin(697), m1209: bin(1209), added: s.getState().project.tracks.length - before, hasFn: true };
  });
  check("dtmfSequence exported on engine", dtmfOk.hasFn, JSON.stringify(dtmfOk));
  check("dtmf '12' is 250 ms with the '1' dual-tone (697+1209)", Math.abs(dtmfOk.durMs - 250) < 2 && dtmfOk.m697 > 100 && dtmfOk.m1209 > 100, JSON.stringify(dtmfOk));
  check("dtmf clip inserts on a new track", dtmfOk.added === 1, JSON.stringify(dtmfOk));

  console.log("• project sample rate (Audition Convert Sample Type)");
  const srOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Ops.resampleProject !== "function") return { hasFn: false };
    const cur = s.getState().project.sampleRate;
    const target = cur === 48000 ? 44100 : 48000;
    // put a clip on a track so there is something to resample
    const tone = E.Generate.sine(440, 0.3, { sampleRate: cur, amplitude: 0.5, channels: 1 });
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "sr" }), { label: "sr" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, tone, 0, "sr"), { label: "ins" });
    const beforeSec = E.Ops.renderProject(s.getState().project).channels[0].length / s.getState().project.sampleRate;
    // convert the whole session (the convertProjectSampleRate path)
    s.dispatch((st) => ({ ...st, project: E.Ops.resampleProject(st.project, target) }), { label: "Convert Sample Rate" });
    const after = s.getState().project;
    const clipRate = after.tracks[idx].clips[0].buffer.sampleRate;
    const afterSec = E.Ops.renderProject(after).channels[0].length / after.sampleRate;
    s.undo();
    const undoneRate = s.getState().project.sampleRate;
    return { target, projRate: after.sampleRate, clipRate, beforeSec, afterSec, undoneRate, cur, hasFn: true };
  });
  check("resampleProject exported on engine", srOk.hasFn, JSON.stringify(srOk));
  check("project + clip switch to the new sample rate, duration preserved", srOk.projRate === srOk.target && srOk.clipRate === srOk.target && Math.abs(srOk.afterSec - srOk.beforeSec) < 1e-3, JSON.stringify(srOk));
  check("sample-rate conversion undoes cleanly", srOk.undoneRate === srOk.cur, JSON.stringify(srOk));

  console.log("• loudness meter (Audition True Peak / EBU R128)");
  const lmOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.Analysis.measureTruePeak !== "function") return { hasFn: false };
    const SR = 48000;
    // fs/4 tone, 45° phase: samples land at ±0.707·A so the sample peak is ~3 dB
    // below the true continuous peak (A = 0.9).
    const tone = E.Generate.sine(SR / 4, 1, { sampleRate: SR, amplitude: 0.9, phase: Math.PI / 4, channels: 2 });
    let sp = 0;
    for (const ch of tone.channels) for (let i = 0; i < ch.length; i++) sp = Math.max(sp, Math.abs(ch[i]));
    const sampleDb = 20 * Math.log10(sp);
    const truePeak = E.Analysis.measureTruePeak(tone).dBTP;
    // dynamic vs steady Loudness Range
    const loud = E.Generate.sine(300, 5, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const quiet = E.Generate.sine(300, 5, { sampleRate: SR, amplitude: 0.125, channels: 2 });
    const lraDynamic = E.Analysis.measureLoudness(E.concat(loud, quiet)).range;
    const lraSteady = E.Analysis.measureLoudness(E.Generate.sine(300, 10, { sampleRate: SR, amplitude: 0.5, channels: 2 })).range;
    return { hasFn: true, sampleDb, truePeak, lraDynamic, lraSteady };
  });
  check("measureTruePeak exported on engine", lmOk.hasFn, JSON.stringify(lmOk));
  check("true peak recovers the inter-sample overshoot (≫ sample peak, < 0 dBTP)", lmOk.truePeak > lmOk.sampleDb + 2 && lmOk.truePeak > -1.6 && lmOk.truePeak < 0, JSON.stringify(lmOk));
  check("loudness range is large for dynamic audio, ~0 for steady", lmOk.lraDynamic > 5 && lmOk.lraSteady < 1, JSON.stringify(lmOk));

  console.log("• true peak limiter (Audition Hard Limiter ▸ True Peak)");
  const tplOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.DSP.truePeakLimiter !== "function") return { hasFn: false };
    const SR = 48000;
    // fs/4 tone, 45° phase: samples sit ~3 dB below the inter-sample peak.
    const tone = E.Generate.sine(SR / 4, 0.3, { sampleRate: SR, amplitude: 0.9, phase: Math.PI / 4, channels: 2 });
    const tpDb = E.Analysis.measureTruePeak(E.DSP.truePeakLimiter(tone, { ceilingDb: -1, inputBoostDb: 6 })).dBTP;
    const hlDb = E.Analysis.measureTruePeak(E.DSP.hardLimiter(tone, { ceilingDb: -1, inputBoostDb: 6 })).dBTP;
    return { hasFn: true, tpDb, hlDb };
  });
  check("truePeakLimiter exported on engine", tplOk.hasFn, JSON.stringify(tplOk));
  check("true-peak limiter holds ISP ≤ ceiling where the hard limiter leaves it over", tplOk.tpDb <= -0.7 && tplOk.hlDb > 0, JSON.stringify(tplOk));

  console.log("• sidechain duck (Audition Essential Sound ▸ Ducking)");
  const duckOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.sidechainDuck !== "function" || typeof E.Ops.duckTrack !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    // target (music) track: a steady tone; key (voice) track: a burst at 0.4–0.8 s.
    const idxT = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "music" }), { label: "t" });
    const tid = s.getState().project.tracks[idxT].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1.6, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 0, "m"), { label: "i" });
    const idxK = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "voice" }), { label: "t" });
    const kid = s.getState().project.tracks[idxK].id;
    s.dispatch(E.insertClip(kid, E.Generate.sine(200, 0.4, { sampleRate: sr, amplitude: 0.6, channels: 2 }), 0.4, "v"), { label: "i" });
    const rms = (t0, t1) => {
      const ch = E.Ops.renderTrack(s.getState().project.tracks[idxT], sr, 2).channels[0];
      const a = Math.round(t0 * sr), b = Math.round(t1 * sr);
      let acc = 0;
      for (let i = a; i < b; i++) acc += ch[i] * ch[i];
      return Math.sqrt(acc / Math.max(1, b - a));
    };
    const before = rms(0.7, 0.79);
    s.dispatch((st) => ({ ...st, project: E.Ops.duckTrack(st.project, tid, kid, { amountDb: -12, attackMs: 30, releaseMs: 150, holdMs: 50 }) }), { label: "Sidechain Duck" });
    const after = rms(0.7, 0.79);
    s.undo();
    const undone = rms(0.7, 0.79);
    return { hasFn: true, before, after, undone };
  });
  check("sidechainDuck + duckTrack exported on engine", duckOk.hasFn, JSON.stringify(duckOk));
  check("ducking dips the target under the key (and undoes cleanly)", duckOk.after < duckOk.before * 0.5 && Math.abs(duckOk.undone - duckOk.before) < 1e-4, JSON.stringify(duckOk));

  console.log("• sidechain compressor (keyed compression / pumping)");
  const scOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.sidechainCompress !== "function" || typeof E.Ops.sidechainCompressTrack !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idxT = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "bass" }), { label: "t" });
    const tid = s.getState().project.tracks[idxT].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1.6, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 0, "b"), { label: "i" });
    const idxK = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "kick" }), { label: "t" });
    const kid = s.getState().project.tracks[idxK].id;
    s.dispatch(E.insertClip(kid, E.Generate.sine(120, 0.4, { sampleRate: sr, amplitude: 0.8, channels: 2 }), 0.4, "k"), { label: "i" });
    const rms = (t0, t1) => {
      const ch = E.Ops.renderTrack(s.getState().project.tracks[idxT], sr, 2).channels[0];
      const a = Math.round(t0 * sr), b = Math.round(t1 * sr);
      let acc = 0;
      for (let i = a; i < b; i++) acc += ch[i] * ch[i];
      return Math.sqrt(acc / Math.max(1, b - a));
    };
    const before = rms(0.6, 0.78);
    s.dispatch((st) => ({ ...st, project: E.Ops.sidechainCompressTrack(st.project, tid, kid, { thresholdDb: -30, ratio: 6, attackMs: 10, releaseMs: 120 }) }), { label: "Sidechain Compressor" });
    const after = rms(0.6, 0.78);
    s.undo();
    const undone = rms(0.6, 0.78);
    // proportionality: a louder key compresses more than a quieter one (a duck would not)
    const tone = E.Generate.sine(440, 0.6, { sampleRate: sr, amplitude: 0.5, channels: 2 });
    const loudKey = E.Generate.sine(120, 0.6, { sampleRate: sr, amplitude: 0.8, channels: 2 });
    const quietKey = E.Generate.sine(120, 0.6, { sampleRate: sr, amplitude: 0.25, channels: 2 });
    const midRms = (buf) => { const ch = buf.channels[0]; const a = Math.round(0.45 * sr), b = Math.round(0.58 * sr); let acc = 0; for (let i = a; i < b; i++) acc += ch[i] * ch[i]; return Math.sqrt(acc / Math.max(1, b - a)); };
    const loudDip = midRms(E.DSP.sidechainCompress(tone, loudKey, { thresholdDb: -30, ratio: 4, attackMs: 10 }));
    const quietDip = midRms(E.DSP.sidechainCompress(tone, quietKey, { thresholdDb: -30, ratio: 4, attackMs: 10 }));
    return { hasFn: true, before, after, undone, loudDip, quietDip };
  });
  check("sidechainCompress + sidechainCompressTrack exported on engine", scOk.hasFn, JSON.stringify(scOk));
  check("sidechain compression pumps the target under the key (and undoes cleanly)", scOk.after < scOk.before * 0.7 && Math.abs(scOk.undone - scOk.before) < 1e-4, JSON.stringify(scOk));
  check("compression is proportional: a louder key reduces more", scOk.loudDip < scOk.quietDip * 0.9, JSON.stringify(scOk));

  console.log("• sidechain gate (keyed / trance gate — inverse of ducking)");
  const sgOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.DSP.sidechainGate !== "function" || typeof E.Ops.sidechainGateTrack !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idxT = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "pad" }), { label: "t" });
    const tid = s.getState().project.tracks[idxT].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1.6, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 0, "p"), { label: "i" });
    const idxK = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "trigger" }), { label: "t" });
    const kid = s.getState().project.tracks[idxK].id;
    s.dispatch(E.insertClip(kid, E.Generate.sine(200, 0.4, { sampleRate: sr, amplitude: 0.7, channels: 2 }), 0.4, "k"), { label: "i" });
    const rms = (t0, t1) => {
      const ch = E.Ops.renderTrack(s.getState().project.tracks[idxT], sr, 2).channels[0];
      const a = Math.round(t0 * sr), b = Math.round(t1 * sr);
      let acc = 0;
      for (let i = a; i < b; i++) acc += ch[i] * ch[i];
      return Math.sqrt(acc / Math.max(1, b - a));
    };
    const openBefore = rms(0.55, 0.78); // during the key (full either way)
    s.dispatch((st) => ({ ...st, project: E.Ops.sidechainGateTrack(st.project, tid, kid, { thresholdDb: -30, rangeDb: -40, attackMs: 5, holdMs: 30, releaseMs: 80 }) }), { label: "Sidechain Gate" });
    const opened = rms(0.55, 0.78); // still audible under the key
    const gated = rms(1.4, 1.6); // gated after the key
    s.undo();
    const undone = rms(1.4, 1.6);
    return { hasFn: true, openBefore, opened, gated, undone };
  });
  check("sidechainGate + sidechainGateTrack exported on engine", sgOk.hasFn, JSON.stringify(sgOk));
  check("gate keeps the target under the key but mutes the ends (and undoes cleanly)", sgOk.opened > sgOk.openBefore * 0.85 && sgOk.gated < sgOk.opened * 0.2 && Math.abs(sgOk.undone - sgOk.openBefore) < 1e-4, JSON.stringify(sgOk));

  console.log("• auto-crossfade (Audition multitrack Crossfade)");
  const xfOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Ops.autoCrossfadeTrack !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "xf" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1.0, { sampleRate: sr, amplitude: 0.6, channels: 2 }), 0, "A"), { label: "i" });
    s.dispatch(E.insertClip(tid, E.Generate.sine(557, 1.0, { sampleRate: sr, amplitude: 0.6, channels: 2 }), 1.0, "B"), { label: "i" });
    const bId = s.getState().project.tracks[idx].clips[1].id;
    s.dispatch((st) => ({ ...st, project: E.Ops.moveClip(st.project, bId, 0.8) }), { label: "overlap" }); // 0.2 s overlap
    const rms = (t0, t1) => {
      const ch = E.Ops.renderTrack(s.getState().project.tracks[idx], sr, 2).channels[0];
      const a = Math.round(t0 * sr), b = Math.round(t1 * sr);
      let acc = 0;
      for (let i = a; i < b; i++) acc += ch[i] * ch[i];
      return Math.sqrt(acc / Math.max(1, b - a));
    };
    const ref = rms(0.3, 0.7); // single clip
    const raw = rms(0.88, 0.92); // overlap, summed → ~+3 dB bump
    s.dispatch((st) => ({ ...st, project: E.Ops.autoCrossfadeTrack(st.project, tid) }), { label: "Auto-Crossfade" });
    const faded = s.getState().project.tracks[idx].clips[0].fadeOut;
    const xf = rms(0.88, 0.92); // overlap, crossfaded → flat
    s.undo();
    const undoneFade = s.getState().project.tracks[idx].clips[0].fadeOut;
    return { hasFn: true, ref, raw, xf, faded, undoneFade };
  });
  check("autoCrossfadeTrack exported on engine", xfOk.hasFn, JSON.stringify(xfOk));
  check("crossfade sets a 0.2 s fade and flattens the overlap bump (undoes cleanly)", Math.abs(xfOk.faded - 0.2) < 0.01 && xfOk.raw > xfOk.ref * 1.3 && xfOk.xf > xfOk.ref * 0.85 && xfOk.xf < xfOk.ref * 1.15 && xfOk.undoneFade === 0, JSON.stringify(xfOk));

  console.log("• beat detection (Audition generate markers from beats)");
  const beatOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Analysis.detectBeats !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const bpm = 120, count = 8, interval = 60 / bpm;
    const n = Math.round(count * interval * sr);
    const ch = new Float32Array(n);
    const burst = Math.round(0.006 * sr);
    for (let k = 0; k < count; k++) {
      const start = Math.round(k * interval * sr);
      for (let i = 0; i < burst && start + i < n; i++) ch[start + i] = 0.9 * Math.sin((2 * Math.PI * 2000 * i) / sr) * (1 - i / burst);
    }
    const clickBuf = E.fromChannels([ch, ch], sr);
    const det = E.Analysis.detectBeats(clickBuf); // isolated → reliable tempo
    // marker path: put the clicks on a track, detect over the mix, drop cue markers, undo
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "beats" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, clickBuf, 0, "clicks"), { label: "i" });
    const detMix = E.Analysis.detectBeats(E.Ops.renderProject(s.getState().project));
    const before = s.getState().project.markers.length;
    s.dispatch((st) => {
      let state = st;
      detMix.beats.forEach((t, i) => { state = E.addMarker({ time: t, name: `Beat ${i + 1}` })(state); });
      return state;
    }, { label: "Mark Beats" });
    const added = s.getState().project.markers.length - before;
    s.undo();
    const undone = s.getState().project.markers.length;
    return { hasFn: true, bpm: det.bpm, beats: det.beats.length, added, expected: detMix.beats.length, before, undone };
  });
  check("detectBeats exported on engine", beatOk.hasFn, JSON.stringify(beatOk));
  check("detects ~120 BPM with one beat per click", Math.abs(beatOk.bpm - 120) < 3 && beatOk.beats >= 7 && beatOk.beats <= 9, JSON.stringify(beatOk));
  check("mark beats drops a cue marker per beat (and undoes cleanly)", beatOk.added > 0 && beatOk.added === beatOk.expected && beatOk.undone === beatOk.before, JSON.stringify(beatOk));

  console.log("• pitch detection (Audition pitch / note read-out)");
  const pitchOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.Analysis.detectPitch !== "function") return { hasFn: false };
    const SR = 48000;
    const a4 = E.Analysis.detectPitch(E.Generate.sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    const c4 = E.Analysis.detectPitch(E.Generate.sine(261.63, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    return { hasFn: true, a4Note: a4.note, a4Oct: a4.octave, a4Hz: a4.hz, a4Conf: a4.confidence, c4Note: c4.note, c4Oct: c4.octave };
  });
  check("detectPitch exported on engine", pitchOk.hasFn, JSON.stringify(pitchOk));
  check("detects 440 Hz as A4 and 261.6 Hz as C4 (high confidence)", pitchOk.a4Note === "A" && pitchOk.a4Oct === 4 && Math.abs(pitchOk.a4Hz - 440) < 3 && pitchOk.a4Conf > 0.8 && pitchOk.c4Note === "C" && pitchOk.c4Oct === 4, JSON.stringify(pitchOk));

  console.log("• match clip volume (Audition Clip ▸ Match Clip Volume)");
  const mvOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Ops.matchClipVolume !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mv" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 0.5, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 0, "loud"), { label: "i" });
    s.dispatch(E.insertClip(tid, E.Generate.sine(550, 0.5, { sampleRate: sr, amplitude: 0.125, channels: 2 }), 1, "quiet"), { label: "i" });
    const clip = (i) => s.getState().project.tracks[idx].clips[i];
    const peakOf = (c) => E.Analysis.analyzeLevels(E.Ops.renderClip(c)).peak;
    const beforeLoud = peakOf(clip(0));
    const beforeQuiet = peakOf(clip(1));
    const ids = [clip(0).id, clip(1).id];
    s.dispatch((st) => ({ ...st, project: E.Ops.matchClipVolume(st.project, ids, { mode: "peak" }) }), { label: "Match Clip Volume" });
    const afterLoud = peakOf(clip(0));
    const afterQuiet = peakOf(clip(1));
    s.undo();
    const undoneQuiet = peakOf(clip(1));
    return { hasFn: true, beforeLoud, beforeQuiet, afterLoud, afterQuiet, undoneQuiet };
  });
  check("matchClipVolume exported on engine", mvOk.hasFn, JSON.stringify(mvOk));
  check("match brings the quiet clip up to the loud clip's peak (and undoes cleanly)", mvOk.beforeQuiet < mvOk.beforeLoud * 0.5 && Math.abs(mvOk.afterQuiet - mvOk.afterLoud) < mvOk.afterLoud * 0.03 && Math.abs(mvOk.undoneQuiet - mvOk.beforeQuiet) < 1e-4, JSON.stringify(mvOk));

  console.log("• loudness radar (Audition loudness over time)");
  const lrOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.Analysis.loudnessTimeSeries !== "function") return { hasFn: false };
    const SR = 48000;
    const quiet = E.Generate.sine(1000, 2, { sampleRate: SR, amplitude: 0.1, channels: 2 });
    const loud = E.Generate.sine(1000, 2, { sampleRate: SR, amplitude: 0.8, channels: 2 });
    const ts = E.Analysis.loudnessTimeSeries(E.concat(quiet, loud));
    const m = ts.momentary.lufs;
    const ascending = ts.momentary.times.every((t, i) => i === 0 || t > ts.momentary.times[i - 1]);
    return { hasFn: true, n: m.length, first: m[0], last: m[m.length - 1], ascending };
  });
  check("loudnessTimeSeries exported on engine", lrOk.hasFn, JSON.stringify(lrOk));
  check("loudness radar momentary rises as the signal gets louder (times ascending)", lrOk.n > 10 && lrOk.last > lrOk.first + 6 && lrOk.ascending, JSON.stringify(lrOk));

  console.log("• split at markers (Audition split clips at markers)");
  const smOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Ops.splitClipsAtMarkers !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "sm" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    // place the clip far out (t=100) so any pre-existing demo markers don't interfere
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 4, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 100, "c"), { label: "i" });
    s.dispatch(E.addMarker({ time: 101, name: "m1" }), { label: "m" });
    s.dispatch(E.addMarker({ time: 102.5, name: "m2" }), { label: "m" });
    const before = s.getState().project.tracks[idx].clips.length;
    s.dispatch((st) => ({ ...st, project: E.Ops.splitClipsAtMarkers(st.project, [tid]) }), { label: "Split at Markers" });
    const after = s.getState().project.tracks[idx].clips.length;
    s.undo();
    const undone = s.getState().project.tracks[idx].clips.length;
    return { hasFn: true, before, after, undone };
  });
  check("splitClipsAtMarkers exported on engine", smOk.hasFn, JSON.stringify(smOk));
  check("split at markers cuts the clip at each marker (and undoes cleanly)", smOk.before === 1 && smOk.after === 3 && smOk.undone === 1, JSON.stringify(smOk));

  console.log("• marker csv export/import (Audition Export Markers)");
  const mkOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.IO.exportMarkersCsv !== "function" || typeof E.IO.parseMarkersCsv !== "function") return { hasFn: false };
    s.dispatch(E.addMarker({ time: 12.5, name: "Cue, A" }), { label: "m" }); // name with a comma
    s.dispatch(E.addMarker({ time: 20, end: 24.25, name: "Region B" }), { label: "m" });
    const csv = E.IO.exportMarkersCsv(s.getState().project.markers);
    const parsed = E.IO.parseMarkersCsv(csv);
    const exported = s.getState().project.markers.length;
    const hasCue = parsed.some((m) => m.name === "Cue, A" && m.end == null);
    const hasRegion = parsed.some((m) => m.name === "Region B" && Math.abs((m.end ?? 0) - 24.25) < 1e-3);
    const before = s.getState().project.markers.length;
    s.dispatch((st) => { let state = st; for (const m of E.IO.parseMarkersCsv(csv)) state = E.addMarker({ time: m.time, end: m.end, name: m.name })(state); return state; }, { label: "Import Markers" });
    const added = s.getState().project.markers.length - before;
    s.undo();
    const undone = s.getState().project.markers.length;
    return { hasFn: true, exported, parsedLen: parsed.length, added, before, undone, hasCue, hasRegion };
  });
  check("marker CSV export/parse exported on engine", mkOk.hasFn, JSON.stringify(mkOk));
  check("markers round-trip through CSV (comma name + region) and import undoes cleanly", mkOk.parsedLen === mkOk.exported && mkOk.hasCue && mkOk.hasRegion && mkOk.added === mkOk.exported && mkOk.undone === mkOk.before, JSON.stringify(mkOk));

  console.log("• amplitude histogram (Audition Amplitude Statistics ▸ Histogram)");
  const histOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.Analysis.amplitudeHistogram !== "function") return { hasFn: false };
    const SR = 48000;
    const sq = E.Generate.square(200, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const h = E.Analysis.amplitudeHistogram(sq, { binDb: 1 });
    const modal = Math.max(...h.counts);
    return { hasFn: true, peakBinDb: h.peakBinDb, modalFrac: modal / h.total, total: h.total, frames: sq.channels[0].length };
  });
  check("amplitudeHistogram exported on engine", histOk.hasFn, JSON.stringify(histOk));
  check("a −6 dBFS square wave concentrates in its dBFS bin", Math.abs(histOk.peakBinDb + 6.02) < 1 && histOk.modalFrac > 0.95 && histOk.total === histOk.frames, JSON.stringify(histOk));

  console.log("• merge clips (Audition Multitrack ▸ Merge Clips)");
  const mergeOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Ops.mergeClips !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mg" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 0, "a"), { label: "i" });
    s.dispatch(E.insertClip(tid, E.Generate.sine(330, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 1, "b"), { label: "i" });
    const ids = s.getState().project.tracks[idx].clips.map((c) => c.id);
    const before = s.getState().project.tracks[idx].clips.length;
    s.dispatch((st) => ({ ...st, project: E.Ops.mergeClips(st.project, ids) }), { label: "Merge Clips" });
    const merged = s.getState().project.tracks[idx].clips;
    const dur = merged[0].buffer.channels[0].length / sr;
    s.undo();
    const undone = s.getState().project.tracks[idx].clips.length;
    return { hasFn: true, before, after: merged.length, dur, undone };
  });
  check("mergeClips exported on engine", mergeOk.hasFn, JSON.stringify(mergeOk));
  check("merge joins two clips into one ~2 s clip (and undoes cleanly)", mergeOk.before === 2 && mergeOk.after === 1 && Math.abs(mergeOk.dur - 2) < 0.05 && mergeOk.undone === 2, JSON.stringify(mergeOk));

  console.log("• wav cue markers (Audition embed markers in WAV)");
  const cueOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.IO.encodeWav !== "function" || typeof E.IO.decodeWavCues !== "function") return { hasFn: false };
    const SR = 48000;
    const tone = E.Generate.sine(440, 2, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const markers = [{ time: 0.5, name: "Intro, A" }, { time: 1.5, name: "Chorus" }];
    const bytes = E.IO.encodeWav(tone, { bitDepth: 16, markers });
    const cues = E.IO.decodeWavCues(bytes);
    const none = E.IO.decodeWavCues(E.IO.encodeWav(tone, { bitDepth: 16 }));
    const ok = cues.length === 2 && Math.abs(cues[0].time - 0.5) < 1e-3 && cues[0].name === "Intro, A" && cues[1].name === "Chorus";
    const audioFrames = E.IO.decodeWav(bytes).channels[0].length;
    return { hasFn: true, ok, cueCount: cues.length, noneCount: none.length, audioFrames, frames: tone.channels[0].length };
  });
  check("encodeWav markers + decodeWavCues exported on engine", cueOk.hasFn, JSON.stringify(cueOk));
  check("markers round-trip through WAV cue points (plain WAV has none; audio intact)", cueOk.ok && cueOk.noneCount === 0 && cueOk.audioFrames === cueOk.frames, JSON.stringify(cueOk));

  console.log("• peak-hold spectrum (Audition Frequency Analysis ▸ Hold)");
  const peakHoldOk = await page.evaluate(() => {
    const E = window.__engine;
    const SR = 44100;
    const s = E.Analysis.spectrum(E.Generate.chirp(300, 5000, 0.5, { sampleRate: SR, amplitude: 0.6 }), { fftSize: 2048 });
    if (!s.peakDb) return { hasPeak: false };
    const binOf = (hz) => Math.round((hz * s.fftSize) / SR);
    let allGe = true;
    for (let i = 0; i < s.db.length; i++) if (s.peakDb[i] < s.db[i] - 1e-6) { allGe = false; break; }
    return { hasPeak: true, allGe, gap1k: s.peakDb[binOf(1000)] - s.db[binOf(1000)], gap3k: s.peakDb[binOf(3000)] - s.db[binOf(3000)] };
  });
  check("spectrum exposes peakDb (Hold)", peakHoldOk.hasPeak, JSON.stringify(peakHoldOk));
  check("peak-hold ≥ average everywhere and ≫ average across a sweep", peakHoldOk.allGe && peakHoldOk.gap1k > 10 && peakHoldOk.gap3k > 10, JSON.stringify(peakHoldOk));

  console.log("• aiff markers (Audition embed markers in AIFF)");
  const aiffMarkOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.IO.encodeAiff !== "function" || typeof E.IO.decodeAiffMarks !== "function") return { hasFn: false };
    const SR = 48000;
    const tone = E.Generate.sine(440, 2, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const markers = [{ time: 0.5, name: "Intro, A" }, { time: 1.5, name: "Chorus" }];
    const bytes = E.IO.encodeAiff(tone, { bitDepth: 16, markers });
    const marks = E.IO.decodeAiffMarks(bytes);
    const none = E.IO.decodeAiffMarks(E.IO.encodeAiff(tone, { bitDepth: 16 }));
    const ok = marks.length === 2 && Math.abs(marks[0].time - 0.5) < 1e-3 && marks[0].name === "Intro, A" && marks[1].name === "Chorus";
    const audioFrames = E.IO.decodeAiff(bytes).channels[0].length;
    return { hasFn: true, ok, marks: marks.length, noneCount: none.length, audioFrames, frames: tone.channels[0].length };
  });
  check("encodeAiff markers + decodeAiffMarks exported on engine", aiffMarkOk.hasFn, JSON.stringify(aiffMarkOk));
  check("markers round-trip through AIFF MARK chunk (plain AIFF has none; audio intact)", aiffMarkOk.ok && aiffMarkOk.noneCount === 0 && aiffMarkOk.audioFrames === aiffMarkOk.frames, JSON.stringify(aiffMarkOk));

  console.log("• export selected range (Audition Export ▸ File of a range)");
  const exportRangeOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    if (typeof E.Ops.renderProjectRange !== "function" || typeof E.IO.markersInRange !== "function") return { hasFn: false };
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "rng" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 4, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 200, "c"), { label: "i" }); // far out, t=200..204
    s.dispatch(E.addMarker({ time: 201, name: "in" }), { label: "m" });
    s.dispatch(E.addMarker({ time: 250, name: "out" }), { label: "m" }); // outside the range
    const p = s.getState().project;
    const audio = E.Ops.renderProjectRange(p, 201, 203); // 2 s window
    const cues = E.IO.markersInRange(p.markers, 201, 203);
    const bytes = E.IO.encodeWav(audio, { bitDepth: 16, markers: cues });
    const decoded = E.IO.decodeWav(bytes);
    const back = E.IO.decodeWavCues(bytes);
    const dur = decoded.channels[0].length / sr;
    return { hasFn: true, dur, cueCount: back.length, cueTime: back[0] ? back[0].time : -1, cueName: back[0] ? back[0].name : "" };
  });
  check("renderProjectRange + markersInRange exported on engine", exportRangeOk.hasFn, JSON.stringify(exportRangeOk));
  check("range export is 2 s with the in-range marker re-based (out-of-range dropped)", Math.abs(exportRangeOk.dur - 2) < 0.01 && exportRangeOk.cueCount === 1 && Math.abs(exportRangeOk.cueTime - 0) < 1e-3 && exportRangeOk.cueName === "in", JSON.stringify(exportRangeOk));
  const batchProcessOk = await page.evaluate(() => {
    const E = window.__engine;
    if (typeof E.Ops.encodeBatchExports !== "function" || typeof E.Ops.processBatchAudio !== "function") return { hasFn: false };
    const sr = 44100;
    let p = E.emptyProject("Batch Process E2E", 0, sr);
    const track = E.newTrack(0, { name: "Hot Stem" });
    p = { ...p, tracks: [track] };
    const clip = E.newClip(E.Generate.sine(440, 0.4, { sampleRate: sr, amplitude: 0.25, channels: 2 }), { trackId: track.id, start: 0, name: "tone" });
    p = E.Ops.addClip(p, track.id, clip);
    const files = E.Ops.encodeBatchExports(p, { kind: "clips", clipIds: [clip.id] }, {
      format: "wav",
      bitDepth: 32,
      float: true,
      processing: [
        { kind: "normalizePeak", targetDb: -1 },
        { kind: "hardLimiter", ceilingDb: -6, lookAheadMs: 1 },
      ],
    });
    const decoded = files[0] ? E.IO.decodeWav(files[0].bytes) : null;
    const peak = decoded ? Math.max(...decoded.channels.flatMap((ch) => Array.from(ch, (v) => Math.abs(v)))) : 0;
    return { hasFn: true, count: files.length, name: files[0]?.name ?? "", peak };
  });
  check("batch export exposes a per-file process chain", batchProcessOk.hasFn, JSON.stringify(batchProcessOk));
  check("batch process Normalize + Limit is applied before WAV encoding", batchProcessOk.count === 1 && /Hot Stem/.test(batchProcessOk.name) && batchProcessOk.peak <= 0.502 && batchProcessOk.peak > 0.49, JSON.stringify(batchProcessOk));

  // ── Window ▸ Workspace switcher (Audition's named workspace presets) ──
  // Drive the real menu the way a user does: click Window → Workspace → preset,
  // and confirm the dock layout actually changes (panel tabs render as
  // `#monet-tab-<panelId>`), then Reset Layout restores the default workspace.
  console.log("• Window ▸ Workspace switcher (Audition workspaces)");
  const panelTabCount = () => page.evaluate(() => document.querySelectorAll('[id^="monet-tab-"]').length);
  const openWorkspaceItem = async (label) => {
    await page.locator('button[role="menuitem"]', { hasText: "Window" }).first().click();
    await page.getByText("Workspace", { exact: true }).click(); // submenu-parent opens its sub
    await page.getByText(label, { exact: true }).click();
  };

  const wsBefore = await panelTabCount();
  await openWorkspaceItem("Maximum Waveform Editing");
  await page
    .waitForFunction(() => document.querySelectorAll('[id^="monet-tab-"]').length === 2, null, { timeout: 5000 })
    .catch(() => {});
  const wsNarrow = await panelTabCount();
  const filesKept = await page.evaluate(() => !!document.getElementById("monet-tab-files"));
  const mixerGone = await page.evaluate(() => !document.getElementById("monet-tab-mixer"));
  check(
    "Maximum Waveform Editing narrows the dock to Files + Markers",
    wsNarrow === 2 && filesKept && mixerGone,
    JSON.stringify({ wsBefore, wsNarrow, filesKept, mixerGone }),
  );

  await openWorkspaceItem("Reset Layout");
  await page
    .waitForFunction((n) => document.querySelectorAll('[id^="monet-tab-"]').length === n, wsBefore, { timeout: 5000 })
    .catch(() => {});
  const wsReset = await panelTabCount();
  check("Reset Layout restores the default workspace", wsReset === wsBefore && wsBefore > 2, JSON.stringify({ wsBefore, wsReset }));

  // ── View ▸ Display Time Format (Audition's selectable time readout) ──
  // Park the playhead at 1.5 s, then switch formats via the real View menu and
  // confirm the on-screen readout (`.rh-time`) reformats to each format.
  console.log("• View ▸ Display Time Format (Audition time display)");
  const sr = await page.evaluate(() => window.__rythme.getState().project.sampleRate);
  await page.evaluate(() => window.__rythme.dispatch(window.__engine.setPlayhead(1.5), { history: false }));
  const timeText = () => page.evaluate(() => document.querySelector(".rh-time")?.textContent ?? "");
  const pickTimeFormat = async (label) => {
    await page.locator('button[role="menuitem"]', { hasText: "View" }).first().click();
    await page.getByText("Display Time Format", { exact: true }).click(); // submenu-parent opens its sub
    await page.getByText(label, { exact: true }).click();
  };

  await page.waitForFunction(() => (document.querySelector(".rh-time")?.textContent ?? "") === "00:01.500", null, { timeout: 5000 }).catch(() => {});
  const tDecimal = await timeText();
  check("decimal readout shows mm:ss.ms at 1.5 s", tDecimal === "00:01.500", JSON.stringify({ tDecimal }));

  await pickTimeFormat("Samples");
  const expectSamples = String(Math.round(1.5 * sr));
  await page.waitForFunction((v) => (document.querySelector(".rh-time")?.textContent ?? "") === v, expectSamples, { timeout: 5000 }).catch(() => {});
  const tSamples = await timeText();
  check("Samples readout = round(1.5 × sampleRate)", tSamples === expectSamples, JSON.stringify({ tSamples, expectSamples }));

  await pickTimeFormat("Bars and Beats");
  await page.waitForFunction(() => /^\d+:\d+:\d{3}$/.test(document.querySelector(".rh-time")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  const tBars = await timeText();
  check("Bars and Beats readout is bar:beat:ticks", /^\d+:\d+:\d{3}$/.test(tBars), JSON.stringify({ tBars }));

  await pickTimeFormat("Decimal (mm:ss.ms)");
  await page.waitForFunction(() => (document.querySelector(".rh-time")?.textContent ?? "") === "00:01.500", null, { timeout: 5000 }).catch(() => {});
  const tBack = await timeText();
  check("switching back to Decimal restores mm:ss.ms", tBack === "00:01.500", JSON.stringify({ tBack }));

  // ── View ▸ Zoom (Audition's Zoom to Selection / Zoom Out Full) ──
  // The timeline reports its usable width to the store; the zoom commands size
  // px/s to fit either the whole session or the current time selection.
  console.log("• View ▸ Zoom (Zoom to Selection / Zoom Out Full)");
  const viewState = () => page.evaluate(() => window.__rythme.getState().view);
  const vp0 = await viewState();
  const total = await page.evaluate(() => window.__engine.projectDuration(window.__rythme.getState().project));
  check("timeline reported its viewport width to the store", vp0.viewportPx > 1, JSON.stringify(vp0));

  await page.locator('button[role="menuitem"]', { hasText: "View" }).first().click();
  await page.getByText("Zoom Out Full", { exact: true }).click();
  const vFull = await viewState();
  const expFull = Math.min(8000, Math.max(2, vp0.viewportPx / total));
  check(
    "Zoom Out Full fits the session (px/s = viewportPx / duration, scroll 0)",
    Math.abs(vFull.pxPerSecond - expFull) < 1 && vFull.scrollSec === 0,
    JSON.stringify({ vFull, expFull, total, viewportPx: vp0.viewportPx }),
  );

  await page.evaluate(() => window.__rythme.dispatch(window.__engine.selectRange({ start: 1, end: 3 }, []), { history: false }));
  await page.locator('button[role="menuitem"]', { hasText: "View" }).first().click();
  await page.getByText("Zoom to Selection", { exact: true }).click();
  const vSel = await viewState();
  const expSel = Math.min(8000, Math.max(2, vp0.viewportPx / 2)); // 2 s selection
  check(
    "Zoom to Selection fills the viewport with the selection (scroll to its start)",
    Math.abs(vSel.pxPerSecond - expSel) < 1 && Math.abs(vSel.scrollSec - 1) < 1e-6,
    JSON.stringify({ vSel, expSel }),
  );

  // ── Edit ▸ Zero Crossings (Audition snap-to-zero-crossing) ──
  // A pure tone on its own track far out → the snap should pull a non-aligned
  // selection inward onto sample-accurate zero crossings.
  console.log("• Edit ▸ Zero Crossings (snap selection to zero crossings)");
  const zc = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "zc" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(100, 4, { sampleRate: sr, amplitude: 0.8, channels: 2 }), 50, "c"), { label: "i" }); // 100 Hz, t=50..54
    s.dispatch(E.selectRange({ start: 50.123, end: 50.187 }, [tid]), { history: false }); // edges off any crossing
    return { sr, tid, before: s.getState().selection.range };
  });

  await page.locator('button[role="menuitem"]', { hasText: "Edit" }).first().click();
  await page.getByText("Zero Crossings", { exact: true }).click(); // submenu-parent opens its sub
  await page.getByText("Adjust Selection Inward", { exact: true }).click();

  const zcAfter = await page.evaluate(({ tid, sr }) => {
    const E = window.__engine;
    const s = window.__rythme;
    const track = s.getState().project.tracks.find((t) => t.id === tid);
    const buf = E.Ops.renderTrack(track, sr, 2);
    const ch = buf.channels;
    const at = (t) => {
      const i = Math.round(t * sr);
      let sum = 0;
      for (const c of ch) sum += c[i] ?? 0;
      return Math.abs(sum / ch.length);
    };
    const r = s.getState().selection.range;
    return { r, atStart: at(r.start), atEnd: at(r.end) };
  }, { tid: zc.tid, sr: zc.sr });

  check(
    "Adjust Selection Inward shrinks the selection",
    zcAfter.r.start > zc.before.start && zcAfter.r.end < zc.before.end,
    JSON.stringify({ before: zc.before, after: zcAfter.r }),
  );
  check(
    "snapped edges land on zero crossings (|amplitude| ≈ 0)",
    zcAfter.atStart < 0.1 && zcAfter.atEnd < 0.1,
    JSON.stringify(zcAfter),
  );

  // ── Graphic Equalizer (Filter & EQ) ──
  // Bass-boost preset should lift a 60 Hz tone, and undo restores it exactly.
  console.log("• Graphic Equalizer (10-band octave EQ)");
  const geqOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "geq" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.clearSelection(), { history: false }); // drop any lingering selection from earlier blocks so the effect scopes to this track
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, E.Generate.sine(60, 1, { sampleRate: sr, amplitude: 0.3, channels: 2 }), 0, "c"), { label: "i" }); // 60 Hz, in the bass region
    const peak = () => E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).peak;
    const before = peak();
    const bass = [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]; // Bass Boost preset
    s.dispatch(E.applyEffect((d) => E.DSP.graphicEQ(d, bass)), { label: "Graphic EQ" });
    const after = peak();
    s.undo();
    const undone = peak();
    return { before, after, undone };
  });
  check("Graphic EQ bass boost raises the 60 Hz peak", geqOk.after > geqOk.before * 1.2, JSON.stringify(geqOk));
  check("Graphic EQ undo restores the clip", Math.abs(geqOk.undone - geqOk.before) < 1e-3, JSON.stringify(geqOk));

  // ── Multitrack ▸ Bounce to New Track (Audition consolidation) ──
  // Drive the real menu: bouncing the whole session adds a track whose clip is
  // the session mix; undo removes it.
  console.log("• Multitrack ▸ Bounce to New Track");
  const bBefore = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    return { count: s.getState().project.tracks.length, mixPeak: E.Analysis.analyzeLevels(E.Ops.renderProject(s.getState().project)).peak };
  });
  await page.locator('button[role="menuitem"]', { hasText: "Multitrack" }).first().click();
  await page.getByText("Bounce to New Track", { exact: true }).click(); // submenu-parent opens its sub
  await page.getByText("Entire Session to New Track", { exact: true }).click();
  const bAfter = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    const tracks = s.getState().project.tracks;
    const nt = tracks[tracks.length - 1];
    return { count: tracks.length, name: nt.name, peak: E.Analysis.analyzeLevels(E.Ops.renderTrack(nt, s.getState().project.sampleRate, 2)).peak };
  });
  check("Bounce ▸ Entire Session adds a track", bAfter.count === bBefore.count + 1, JSON.stringify({ bBefore, bAfter }));
  check("the bounced track carries the full session mix (peak matches the mixdown)", Math.abs(bAfter.peak - bBefore.mixPeak) < 1e-3, JSON.stringify({ bBefore, bAfter }));
  const bUndo = await page.evaluate(() => { window.__rythme.undo(); return window.__rythme.getState().project.tracks.length; });
  check("undo removes the bounced track", bUndo === bBefore.count, JSON.stringify({ bBefore, bUndo }));

  // ── Parametric Equalizer (Filter & EQ) ──
  // The "Warm" curve's low shelf should lift a 60 Hz tone; undo restores it.
  console.log("• Parametric Equalizer (free-form band cascade)");
  const peqOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false }); // avoid a stale selection re-scoping the effect
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "peq" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.setActiveTrack(tid), { history: false });
    s.dispatch(E.insertClip(tid, E.Generate.sine(60, 1, { sampleRate: sr, amplitude: 0.3, channels: 2 }), 0, "c"), { label: "i" });
    const peak = () => E.Analysis.analyzeLevels(E.Ops.renderClip(s.getState().project.tracks[idx].clips[0])).peak;
    const before = peak();
    const warm = [{ type: "lowshelf", freq: 150, gainDb: 3 }, { type: "peaking", freq: 3000, q: 1, gainDb: -2 }, { type: "highshelf", freq: 9000, gainDb: -2 }];
    s.dispatch(E.applyEffect((d) => E.DSP.parametricEQ(d, warm)), { label: "Parametric EQ" });
    const after = peak();
    s.undo();
    return { before, after, undone: peak() };
  });
  check("Parametric EQ 'Warm' low shelf raises the 60 Hz peak", peqOk.after > peqOk.before * 1.2, JSON.stringify(peqOk));
  check("Parametric EQ undo restores the clip", Math.abs(peqOk.undone - peqOk.before) < 1e-3, JSON.stringify(peqOk));

  // ── Clip ▸ Duplicate (Audition clip duplication) ──
  // Select a clip, duplicate it via the menu → a copy lands right after the
  // original (sharing its buffer); undo removes it.
  console.log("• Clip ▸ Duplicate");
  const dupBefore = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "dup" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(300, 1, { sampleRate: sr, amplitude: 0.4, channels: 2 }), 80, "orig"), { label: "i" }); // t=80..81
    const clip = s.getState().project.tracks[idx].clips[0];
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { idx, start: clip.start, duration: clip.duration };
  });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Duplicate", { exact: true }).click();
  const dupAfter = await page.evaluate(({ idx, start, duration }) => {
    const clips = window.__rythme.getState().project.tracks[idx].clips;
    const copy = clips.find((c) => Math.abs(c.start - (start + duration)) < 1e-6);
    return { count: clips.length, copyStart: copy ? copy.start : -1, expected: start + duration };
  }, { idx: dupBefore.idx, start: dupBefore.start, duration: dupBefore.duration });
  check("Clip ▸ Duplicate adds a copy right after the original", dupAfter.count === 2 && Math.abs(dupAfter.copyStart - dupAfter.expected) < 1e-6, JSON.stringify({ dupBefore, dupAfter }));
  const dupUndo = await page.evaluate(({ idx }) => { window.__rythme.undo(); return window.__rythme.getState().project.tracks[idx].clips.length; }, { idx: dupBefore.idx });
  check("undo removes the duplicated clip", dupUndo === 1, JSON.stringify({ dupUndo }));

  // ── Clip ▸ Clip Gain (Audition per-clip volume trim) ──
  // Select a clip, nudge its gain +3 dB via the menu → gainDb = 3 and the
  // rendered peak rises ~×1.41; undo restores 0 dB.
  console.log("• Clip ▸ Clip Gain");
  const cgBefore = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "cg" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.4, channels: 2 }), 90, "g"), { label: "i" });
    const clip = s.getState().project.tracks[idx].clips[0];
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { idx, gain: clip.gainDb, peak: E.Analysis.analyzeLevels(E.Ops.renderClip(clip)).peak };
  });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Clip Gain", { exact: true }).click(); // submenu-parent opens its sub
  await page.getByText("+3 dB", { exact: true }).click();
  const cgAfter = await page.evaluate(({ idx }) => {
    const E = window.__engine;
    const clip = window.__rythme.getState().project.tracks[idx].clips[0];
    return { gain: clip.gainDb, peak: E.Analysis.analyzeLevels(E.Ops.renderClip(clip)).peak };
  }, { idx: cgBefore.idx });
  check("Clip Gain +3 dB sets the clip gain to 3", Math.abs(cgAfter.gain - 3) < 1e-6, JSON.stringify({ cgBefore, cgAfter }));
  check("Clip Gain +3 dB raises the rendered peak (~×1.41)", cgAfter.peak / cgBefore.peak > 1.3, JSON.stringify({ cgBefore, cgAfter }));
  const cgUndo = await page.evaluate(({ idx }) => { window.__rythme.undo(); return window.__rythme.getState().project.tracks[idx].clips[0].gainDb; }, { idx: cgBefore.idx });
  check("undo restores the clip gain to 0 dB", Math.abs(cgUndo) < 1e-6, JSON.stringify({ cgUndo }));

  // ── Clip ▸ Fade (Audition non-destructive clip fade handles) ──
  // Select a clip, set a 0.5 s fade-in via the menu → the clip carries the fade
  // and its rendered head is attenuated; undo clears it.
  console.log("• Clip ▸ Fade");
  const cfBefore = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "fade" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 2, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 70, "f"), { label: "i" }); // 2 s clip
    const clip = s.getState().project.tracks[idx].clips[0];
    s.dispatch(E.selectClips([clip.id]), { history: false });
    return { idx, fadeIn: clip.fadeIn };
  });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Fade", { exact: true }).click(); // submenu-parent opens its sub
  await page.getByText("Fade In", { exact: true }).click();
  const cfAfter = await page.evaluate(({ idx }) => {
    const E = window.__engine;
    const clip = window.__rythme.getState().project.tracks[idx].clips[0];
    const r = E.Ops.renderClip(clip).channels[0];
    const q = Math.floor(r.length / 4);
    const rms = (from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += r[i] * r[i]; return Math.sqrt(sum / (to - from)); };
    return { fadeIn: clip.fadeIn, headRms: rms(0, q), tailRms: rms(3 * q, 4 * q) };
  }, { idx: cfBefore.idx });
  check("Clip ▸ Fade ▸ Fade In sets a 0.5 s clip fade", Math.abs(cfAfter.fadeIn - 0.5) < 1e-6, JSON.stringify({ cfBefore, cfAfter }));
  check("the clip fade attenuates the rendered head (head RMS < tail RMS)", cfAfter.headRms < cfAfter.tailRms, JSON.stringify(cfAfter));
  const cfUndo = await page.evaluate(({ idx }) => { window.__rythme.undo(); return window.__rythme.getState().project.tracks[idx].clips[0].fadeIn; }, { idx: cfBefore.idx });
  check("undo clears the clip fade", Math.abs(cfUndo) < 1e-6, JSON.stringify({ cfUndo }));

  // ── Clip ▸ Group Clips (Audition multitrack clip grouping) ──
  // Group two clips via the menu, then moving one drags the other by the same
  // delta; after Ungroup, moving one leaves the other put.
  console.log("• Clip ▸ Group Clips");
  const grpBefore = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "grp" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.3, channels: 2 }), 100, "g1"), { label: "i" }); // @100
    s.dispatch(E.insertClip(tid, E.Generate.sine(330, 1, { sampleRate: sr, amplitude: 0.3, channels: 2 }), 105, "g2"), { label: "i" }); // @105
    const clips = s.getState().project.tracks[idx].clips;
    s.dispatch(E.selectClips(clips.map((c) => c.id)), { history: false });
    return { idx, id1: clips[0].id, id2: clips[1].id };
  });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Group Clips", { exact: true }).click();
  const grpMoved = await page.evaluate(({ idx, id1 }) => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.moveClipTo(id1, 110), { label: "Move" }); // 100 → 110, delta +10
    const clips = s.getState().project.tracks[idx].clips;
    return { s1: clips.find((c) => c.id === id1).start, s2: clips.find((c) => c.id !== id1).start };
  }, { idx: grpBefore.idx, id1: grpBefore.id1 });
  check("grouped clips move together (sibling follows by the same delta)", Math.abs(grpMoved.s1 - 110) < 1e-6 && Math.abs(grpMoved.s2 - 115) < 1e-6, JSON.stringify({ grpBefore, grpMoved }));

  await page.evaluate(({ id1, id2 }) => window.__rythme.dispatch(window.__engine.selectClips([id1, id2]), { history: false }), { id1: grpBefore.id1, id2: grpBefore.id2 });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Ungroup Clips", { exact: true }).click();
  const ungMoved = await page.evaluate(({ idx, id1 }) => {
    const E = window.__engine;
    const s = window.__rythme;
    const before2 = s.getState().project.tracks[idx].clips.find((c) => c.id !== id1).start;
    s.dispatch(E.moveClipTo(id1, 120), { label: "Move" });
    const clips = s.getState().project.tracks[idx].clips;
    return { s1: clips.find((c) => c.id === id1).start, s2: clips.find((c) => c.id !== id1).start, before2 };
  }, { idx: grpBefore.idx, id1: grpBefore.id1 });
  check("after Ungroup, moving one clip leaves the other put", Math.abs(ungMoved.s1 - 120) < 1e-6 && Math.abs(ungMoved.s2 - ungMoved.before2) < 1e-6, JSON.stringify(ungMoved));

  // ── Edit ▸ Snapping (clip drags snap to edges) ──
  // The menu toggles view.snap, and snapTime (used by the drag) snaps a near-edge
  // time to a clip start while leaving a far time alone.
  console.log("• Edit ▸ Snapping");
  const snap0 = await page.evaluate(() => window.__rythme.getState().view.snap);
  await page.locator('button[role="menuitem"]', { hasText: "Edit" }).first().click();
  await page.getByText("Snapping", { exact: true }).click();
  const snap1 = await page.evaluate(() => window.__rythme.getState().view.snap);
  check("Edit ▸ Snapping toggles view.snap", snap1 === !snap0, JSON.stringify({ snap0, snap1 }));

  const snapOk = await page.evaluate(() => {
    const E = window.__engine;
    const p = window.__rythme.getState().project;
    const start = p.tracks.flatMap((t) => t.clips.map((c) => c.start)).find((s) => s > 0.1);
    if (start == null) return { ok: false };
    return { ok: true, start, snapped: E.snapTime(p, start + 0.02, 0.1), far: E.snapTime(p, 100.123, 0.05) };
  });
  check("snapTime pulls a near-edge time to the clip start", snapOk.ok && Math.abs(snapOk.snapped - snapOk.start) < 1e-9, JSON.stringify(snapOk));
  check("snapTime leaves a far time alone (no edge within tolerance)", snapOk.ok && Math.abs(snapOk.far - 100.123) < 1e-9, JSON.stringify(snapOk));

  await page.locator('button[role="menuitem"]', { hasText: "Edit" }).first().click(); // restore snapping to its default
  await page.getByText("Snapping", { exact: true }).click();

  // ── Swap Channels (Stereo Imagery) ──
  // A clip with distinct L/R has its channels swapped; undo restores them.
  console.log("• Swap Channels (Stereo Imagery)");
  const swapOk = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "sw" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    const n = sr;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.4; R[i] = Math.sin((2 * Math.PI * 660 * i) / sr) * 0.3; } // L ≠ R
    s.dispatch(E.insertClip(tid, { sampleRate: sr, channels: [L, R] }, 60, "sw"), { label: "i" });
    s.dispatch(E.setActiveTrack(tid), { history: false });
    const k = 100;
    const at = () => { const b = s.getState().project.tracks[idx].clips[0].buffer; return { l: b.channels[0][k], r: b.channels[1][k] }; };
    const before = at();
    s.dispatch(E.applyEffect((d) => E.DSP.swapStereo(d)), { label: "Swap" });
    const after = at();
    s.undo();
    return { before, after, undone: at() };
  });
  check(
    "Swap Channels swaps L and R",
    Math.abs(swapOk.after.l - swapOk.before.r) < 1e-9 && Math.abs(swapOk.after.r - swapOk.before.l) < 1e-9 && Math.abs(swapOk.before.l - swapOk.before.r) > 1e-6,
    JSON.stringify(swapOk),
  );
  check("Swap Channels undo restores the original channels", Math.abs(swapOk.undone.l - swapOk.before.l) < 1e-9 && Math.abs(swapOk.undone.r - swapOk.before.r) < 1e-9, JSON.stringify(swapOk));

  // ── Edit ▸ Mix Paste (Audition's mixed/inverted paste) ──
  // Copy a tone, then Mix Paste it inverted on top → it nulls the original
  // (near silence); undo restores the audio.
  console.log("• Edit ▸ Mix Paste");
  const mpBefore = await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mp" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 0, "mp"), { label: "i" });
    s.dispatch(E.selectRange({ start: 0, end: 1 }, [tid]), { history: false });
    s.dispatch(E.copySelection(), { history: false });
    s.dispatch(E.setPlayhead(0), { history: false });
    return { idx, before: E.Analysis.analyzeLevels(E.Ops.renderTrack(s.getState().project.tracks[idx], sr, 2)).peak };
  });
  const trackPeak = (idx) => page.evaluate((i) => {
    const E = window.__engine;
    const s = window.__rythme;
    return E.Analysis.analyzeLevels(E.Ops.renderTrack(s.getState().project.tracks[i], s.getState().project.sampleRate, 2)).peak;
  }, idx);
  await page.locator('button[role="menuitem"]', { hasText: "Edit" }).first().click();
  await page.getByText("Mix Paste", { exact: true }).click(); // submenu-parent opens its sub
  await page.getByText("Mix (Inverted — null test)", { exact: true }).click();
  const mpAfter = await trackPeak(mpBefore.idx);
  check("Mix Paste (Inverted) nulls the original (near silence)", mpAfter < mpBefore.before * 0.05, JSON.stringify({ mpBefore, mpAfter }));
  const mpUndo = await page.evaluate((i) => { window.__rythme.undo(); return i; }, mpBefore.idx).then(() => trackPeak(mpBefore.idx));
  check("Mix Paste undo restores the audio", Math.abs(mpUndo - mpBefore.before) < 1e-3, JSON.stringify({ mpUndo, before: mpBefore.before }));

  // ── Clip ▸ Merge Markers in Selection (Audition Merge Markers) ──
  // Three markers in a time selection collapse into one region; undo restores.
  console.log("• Clip ▸ Merge Markers in Selection");
  const inRangeCount = () => page.evaluate(() => window.__rythme.getState().project.markers.filter((m) => m.time >= 499.5 && m.time <= 502.5).length);
  await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    s.dispatch(E.addMarker({ time: 500, name: "mm1" }), { label: "m" }); // a far-out range with no other markers
    s.dispatch(E.addMarker({ time: 501, name: "mm2" }), { label: "m" });
    s.dispatch(E.addMarker({ time: 502, name: "mm3" }), { label: "m" });
    s.dispatch(E.selectRange({ start: 499.5, end: 502.5 }, []), { history: false });
  });
  const mmBefore = await inRangeCount();
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Merge Markers in Selection", { exact: true }).click();
  const mmRegion = await page.evaluate(() => {
    const inRange = window.__rythme.getState().project.markers.filter((m) => m.time >= 499.5 && m.time <= 502.5);
    return inRange.length === 1 ? { time: inRange[0].time, end: inRange[0].end, kind: inRange[0].kind, count: 1 } : { count: inRange.length };
  });
  check(
    "Merge Markers collapses the in-range markers to one region spanning them",
    mmBefore >= 3 && mmRegion.count === 1 && mmRegion.kind === "region" && mmRegion.time <= 500 + 1e-9 && mmRegion.end >= 502 - 1e-9,
    JSON.stringify({ mmBefore, mmRegion }),
  );
  const mmUndo = await page.evaluate(() => { window.__rythme.undo(); return 0; }).then(inRangeCount);
  check("undo restores the merged markers", mmUndo === mmBefore, JSON.stringify({ mmUndo, mmBefore }));

  // ── Multitrack ▸ Next / Previous Marker (Audition marker navigation) ──
  // The playhead jumps to the next/previous marker; seeking adds no undo step.
  console.log("• Multitrack ▸ Next / Previous Marker");
  const playheadAt = () => page.evaluate(() => window.__rythme.getState().transport.playhead);
  await page.evaluate(() => {
    const E = window.__engine;
    const s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    s.dispatch(E.addMarker({ time: 600, name: "n1" }), { label: "m" }); // far out so no other markers interfere
    s.dispatch(E.addMarker({ time: 601, name: "n2" }), { label: "m" });
    s.dispatch(E.addMarker({ time: 602, name: "n3" }), { label: "m" });
    s.dispatch(E.setPlayhead(599), { history: false });
  });
  const navUndoBefore = await page.evaluate(() => window.__rythme.undoLabels().length);
  await page.locator('button[role="menuitem"]', { hasText: "Multitrack" }).first().click();
  await page.getByText("Next Marker", { exact: true }).click();
  const nav1 = await playheadAt();
  await page.locator('button[role="menuitem"]', { hasText: "Multitrack" }).first().click();
  await page.getByText("Next Marker", { exact: true }).click();
  const nav2 = await playheadAt();
  await page.locator('button[role="menuitem"]', { hasText: "Multitrack" }).first().click();
  await page.getByText("Previous Marker", { exact: true }).click();
  const nav3 = await playheadAt();
  const navUndoAfter = await page.evaluate(() => window.__rythme.undoLabels().length);
  check(
    "Next/Previous Marker steps the playhead across markers without adding undo steps",
    nav1 === 600 && nav2 === 601 && nav3 === 600 && navUndoAfter === navUndoBefore,
    JSON.stringify({ nav1, nav2, nav3, navUndoBefore, navUndoAfter }),
  );

  // ── Clip ▸ Mute Clip(s) (Audition clip mute) ──
  // A muted clip stays on the timeline but renders silent in the mix; undo restores it.
  console.log("• Clip ▸ Mute Clip(s)");
  const mtPeak = (idx) => page.evaluate((i) => {
    const E = window.__engine, s = window.__rythme;
    const st = s.getState();
    return E.Analysis.analyzeLevels(E.Ops.renderTrack(st.project.tracks[i], st.project.sampleRate, 2)).peak;
  }, idx);
  const mtSetup = await page.evaluate(() => {
    const E = window.__engine, s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "mute" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 70, "m1"), { label: "i" }); // far out, own track
    const cid = s.getState().project.tracks[idx].clips[0].id;
    s.dispatch(E.selectClips([cid]), { history: false });
    return { idx };
  });
  const mtAudible = await mtPeak(mtSetup.idx);
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Mute Clip(s)", { exact: true }).click();
  const mtMuted = await mtPeak(mtSetup.idx);
  const mtFlag = await page.evaluate(({ idx }) => window.__rythme.getState().project.tracks[idx].clips[0].muted, { idx: mtSetup.idx });
  check(
    "Mute Clip(s) silences the clip in the mix (peak → ~0) and sets the muted flag",
    mtAudible > 0.4 && mtMuted < 1e-6 && mtFlag === true,
    JSON.stringify({ mtAudible, mtMuted, mtFlag }),
  );
  const mtUndo = await page.evaluate(() => { window.__rythme.undo(); return 0; }).then(() => mtPeak(mtSetup.idx));
  check("undo restores the muted clip's audio", mtUndo > 0.4, JSON.stringify({ mtUndo }));

  // ── Multitrack ▸ Loop Selection (Audition selection-driven transport loop) ──
  // Selecting a time range and choosing Loop Selection sets the transport loop
  // region to that range and enables looping (the previously-dead Loop machinery).
  console.log("• Multitrack ▸ Loop Selection");
  await page.evaluate(() => {
    const E = window.__engine, s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    s.dispatch(E.setLoopEnabled(false), { history: false });
    s.dispatch(E.setLoop(null), { history: false }); // reset any prior loop
    s.dispatch(E.selectRange({ start: 3, end: 7 }, []), { history: false });
  });
  await page.locator('button[role="menuitem"]', { hasText: "Multitrack" }).first().click();
  await page.getByText("Loop Selection", { exact: true }).click();
  const loopState = await page.evaluate(() => {
    const t = window.__rythme.getState().transport;
    return { loop: t.loop, enabled: t.loopEnabled };
  });
  check(
    "Loop Selection sets the transport loop region to the selection and enables looping",
    !!loopState.loop && Math.abs(loopState.loop.start - 3) < 1e-9 && Math.abs(loopState.loop.end - 7) < 1e-9 && loopState.enabled === true,
    JSON.stringify(loopState),
  );

  // ── Clip ▸ Lock in Time (Audition clip position lock) ──
  // A locked clip can't be moved; unlocking restores movability.
  console.log("• Clip ▸ Lock in Time");
  const lkSetup = await page.evaluate(() => {
    const E = window.__engine, s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "lock" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 80, "lk"), { label: "i" });
    const cid = s.getState().project.tracks[idx].clips[0].id;
    s.dispatch(E.selectClips([cid]), { history: false });
    return { idx, cid };
  });
  const lkStart = (idx, cid) => page.evaluate(({ idx, cid }) => window.__rythme.getState().project.tracks[idx].clips.find((c) => c.id === cid).start, { idx, cid });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Lock in Time", { exact: true }).click();
  await page.evaluate(({ cid }) => window.__rythme.dispatch((s) => ({ ...s, project: window.__engine.Ops.moveClip(s.project, cid, 90) }), { label: "Move" }), { cid: lkSetup.cid });
  const lkLockedStart = await lkStart(lkSetup.idx, lkSetup.cid);
  const lkFlag = await page.evaluate(({ idx, cid }) => window.__rythme.getState().project.tracks[idx].clips.find((c) => c.id === cid).locked, { idx: lkSetup.idx, cid: lkSetup.cid });
  check("Lock in Time pins the clip (move is a no-op) and sets the locked flag", Math.abs(lkLockedStart - 80) < 1e-9 && lkFlag === true, JSON.stringify({ lkLockedStart, lkFlag }));

  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Lock in Time", { exact: true }).click(); // unlock
  await page.evaluate(({ cid }) => window.__rythme.dispatch((s) => ({ ...s, project: window.__engine.Ops.moveClip(s.project, cid, 90) }), { label: "Move" }), { cid: lkSetup.cid });
  const lkMovedStart = await lkStart(lkSetup.idx, lkSetup.cid);
  check("after Unlock, the clip can be moved again", Math.abs(lkMovedStart - 90) < 1e-9, JSON.stringify({ lkMovedStart }));

  // ── Clip ▸ Nudge (Audition clip Nudge Left/Right) ──
  // Nudge Right shifts the selected clip later by 0.1 s; Nudge Left brings it back.
  console.log("• Clip ▸ Nudge");
  const ndSetup = await page.evaluate(() => {
    const E = window.__engine, s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "nudge" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 50, "nd"), { label: "i" });
    const cid = s.getState().project.tracks[idx].clips[0].id;
    s.dispatch(E.selectClips([cid]), { history: false });
    return { idx, cid };
  });
  const ndStart = (idx, cid) => page.evaluate(({ idx, cid }) => window.__rythme.getState().project.tracks[idx].clips.find((c) => c.id === cid).start, { idx, cid });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Nudge", { exact: true }).click(); // submenu parent opens its sub
  await page.getByText("Nudge Right", { exact: true }).click();
  const ndRight = await ndStart(ndSetup.idx, ndSetup.cid);
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Nudge", { exact: true }).click();
  await page.getByText("Nudge Left", { exact: true }).click();
  const ndLeft = await ndStart(ndSetup.idx, ndSetup.cid);
  check(
    "Nudge Right then Left shifts the clip by ±0.1 s and returns it",
    Math.abs(ndRight - 50.1) < 1e-6 && Math.abs(ndLeft - 50) < 1e-6,
    JSON.stringify({ ndRight, ndLeft }),
  );

  // ── Clip ▸ Loop (Audition looped clip) ──
  // Loop ×2 doubles the clip duration and tiles the source (the tail renders loud,
  // not silent); No Loop restores a single play.
  console.log("• Clip ▸ Loop");
  const lpSetup = await page.evaluate(() => {
    const E = window.__engine, s = window.__rythme;
    s.dispatch(E.clearSelection(), { history: false });
    const sr = s.getState().project.sampleRate;
    const idx = s.getState().project.tracks.length;
    s.dispatch(E.addTrack({ name: "loop" }), { label: "t" });
    const tid = s.getState().project.tracks[idx].id;
    s.dispatch(E.insertClip(tid, E.Generate.sine(440, 1, { sampleRate: sr, amplitude: 0.5, channels: 2 }), 40, "lp"), { label: "i" }); // 1 s source
    const cid = s.getState().project.tracks[idx].clips[0].id;
    s.dispatch(E.selectClips([cid]), { history: false });
    return { idx, cid };
  });
  const lpClip = (idx, cid) => page.evaluate(({ idx, cid }) => {
    const E = window.__engine;
    const c = window.__rythme.getState().project.tracks[idx].clips.find((x) => x.id === cid);
    const r = E.Ops.renderClip(c);
    const half = Math.floor(r.channels[0].length / 2);
    let tailPeak = 0;
    for (let i = half; i < r.channels[0].length; i++) tailPeak = Math.max(tailPeak, Math.abs(r.channels[0][i]));
    return { looped: !!c.looped, duration: c.duration, tailPeak };
  }, { idx, cid });
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Loop", { exact: true }).click(); // submenu parent
  await page.getByText("Loop ×2", { exact: true }).click();
  const lpOn = await lpClip(lpSetup.idx, lpSetup.cid);
  check(
    "Loop ×2 doubles the duration, marks it looped, and tiles the source (loud tail)",
    lpOn.looped === true && Math.abs(lpOn.duration - 2) < 1e-6 && lpOn.tailPeak > 0.4,
    JSON.stringify(lpOn),
  );
  await page.locator('button[role="menuitem"]', { hasText: "Clip" }).first().click();
  await page.getByText("Loop", { exact: true }).click();
  await page.getByText("No Loop", { exact: true }).click();
  const lpOff = await lpClip(lpSetup.idx, lpSetup.cid);
  check("No Loop restores a single play", lpOff.looped === false && Math.abs(lpOff.duration - 1) < 1e-6, JSON.stringify(lpOff));

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));

  console.log("");
  if (failures === 0) console.log(`e2e: ALL PASSED`);
  else console.log(`e2e: ${failures} FAILURE(S)`);
} catch (err) {
  console.error("e2e harness error:", err);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

process.exit(failures === 0 ? 0 : 1);
