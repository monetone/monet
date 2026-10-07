// ─────────────────────────────────────────────────────────────
// render/timeline-view — the multitrack timeline canvas
// ─────────────────────────────────────────────────────────────
// One canvas draws the time ruler, lane backgrounds + beat grid, clips with
// their waveform overview, fades, markers, the time-range selection and the
// playhead. Track headers (name + M/S/R + fader) are DOM overlaid on the left.
// Pointer behaviour is tool-driven (select/move, time-select, razor, marker,
// hand, zoom, fade).

import { Slider } from "@monet-ui/monet-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addMarker,
  beatDuration,
  clearSelection,
  clipEnd,
  moveClipTo,
  projectDuration,
  selectClips,
  selectRange,
  setActiveTrack,
  setBusEffectParamAutomationPoint,
  setBusGainAutomationPoint,
  setBusPanAutomationPoint,
  setBusSendGainAutomationPoint,
  setBusSendPanAutomationPoint,
  setClipEffectParamAutomationPoint,
  setClipGainAutomationPoint,
  setClipFadesCmd,
  setClipPanAutomationPoint,
  setMasterEffectParamAutomationPoint,
  setMasterGainAutomationPoint,
  setMasterPanAutomationPoint,
  setPlayhead,
  setScroll,
  setViewportWidth,
  setTrackGainAutomationPoint,
  setTrackPanAutomationPoint,
  setTrackEffectParamAutomationPoint,
  setTrackGain,
  setTrackSendGainAutomationPoint,
  setTrackSendPanAutomationPoint,
  snapTime,
  splitAtTime,
  toggleArm,
  toggleBusMute,
  toggleBusSolo,
  toggleMute,
  toggleSolo,
  trimClipEdgesCmd,
  zoomBy,
  type Clip,
  type EditorState,
  type EffectSlot,
  type VideoClip,
  type VideoTrack,
  type Bus,
} from "../engine";
import { useEditorState, useStore } from "../state/store-context";
import { videoPreviewUrl } from "../ui/video-preview";
import { getClipPeaks } from "./peaks-cache";
import { requestVideoThumbnailStrip, subscribeVideoThumbnailInvalidation } from "./video-thumbnails";

const HEADER_W = 170;
const RULER_H = 26;
const EDGE_PX = 7;
const SNAP_PX = 8; // snap tolerance for clip drags, in pixels
const AUTOMATION_MIN_DB = -60;
const AUTOMATION_MAX_DB = 12;
const BUS_LANE_H = 72;
const MASTER_LANE_H = 72;
type TimelineAutomationTarget =
  | { kind: "gainDb"; sendId?: undefined }
  | { kind: "pan"; sendId?: undefined }
  | { kind: "clipGainDb"; sendId?: undefined }
  | { kind: "clipPan"; sendId?: undefined }
  | { kind: "clipRackGainDb"; effectSlotId: string; param: "gainDb"; sendId?: undefined }
  | { kind: "clipRackPan"; effectSlotId: string; param: "pan"; sendId?: undefined }
  | { kind: "clipRackParam"; effectSlotId: string; param: string; label: string; min: number; max: number; sendId?: undefined }
  | { kind: "rackGainDb"; effectSlotId: string; param: "gainDb"; sendId?: undefined }
  | { kind: "rackPan"; effectSlotId: string; param: "pan"; sendId?: undefined }
  | { kind: "rackParam"; effectSlotId: string; param: string; label: string; min: number; max: number; sendId?: undefined }
  | { kind: "sendGainDb"; sendId: string }
  | { kind: "sendPan"; sendId: string };
type MasterTimelineAutomationTarget = Extract<TimelineAutomationTarget, { kind: "gainDb" } | { kind: "pan" } | { kind: "rackGainDb" } | { kind: "rackPan" } | { kind: "rackParam" }>;
type ClipTimelineAutomationTarget = Extract<TimelineAutomationTarget, { kind: "clipGainDb" } | { kind: "clipPan" } | { kind: "clipRackGainDb" } | { kind: "clipRackPan" } | { kind: "clipRackParam" }>;
type ClipChannelTimelineAutomationTarget = Extract<TimelineAutomationTarget, { kind: "clipGainDb" } | { kind: "clipPan" }>;
type ClipRackTimelineAutomationTarget = Extract<TimelineAutomationTarget, { kind: "clipRackGainDb" } | { kind: "clipRackPan" } | { kind: "clipRackParam" }>;
type RackTimelineAutomationTarget = Extract<TimelineAutomationTarget, { kind: "rackGainDb" } | { kind: "rackPan" } | { kind: "rackParam" }>;
interface RackAutomationButton<TTarget extends TimelineAutomationTarget = RackTimelineAutomationTarget> {
  key: string;
  target: TTarget;
  label: string;
  title: string;
}

interface DragState {
  kind: "move" | "range" | "pan" | "trimL" | "trimR" | "fadeIn" | "fadeOut" | "automation";
  clipId?: string;
  trackId?: string;
  busId?: string;
  masterAutomation?: boolean;
  automationTarget?: TimelineAutomationTarget;
  grabTime?: number;
  origStart?: number;
  origScroll?: number;
  startX?: number;
  startY?: number;
  anchorTime?: number;
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function TimelineView() {
  const store = useStore();
  const state = useEditorState();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [thumbnailVersion, setThumbnailVersion] = useState(0);
  const [automationTarget, setAutomationTarget] = useState<TimelineAutomationTarget>({ kind: "gainDb" });

  // track the viewport size; report the usable timeline width to the store so
  // Zoom to Selection / Zoom Out Full can size the zoom to the window.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const report = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      store.dispatch(setViewportWidth(el.clientWidth - HEADER_W), { history: false });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [store]);

  useEffect(() => subscribeVideoThumbnailInvalidation(() => setThumbnailVersion((v) => v + 1)), []);

  const pps = state.view.pxPerSecond;
  const scrollSec = state.view.scrollSec;
  const scrollY = state.view.scrollY;
  const tracks = state.project.tracks;
  const buses = state.project.buses ?? [];
  const videoTracks = (state.project.videoTracks ?? []).filter((t) => t.visible !== false);

  // cumulative track tops
  const videoTops: number[] = [];
  let videoAcc = 0;
  for (const t of videoTracks) {
    videoTops.push(videoAcc);
    videoAcc += t.height;
  }
  const videoContentH = videoAcc;
  const tops: number[] = [];
  let acc = 0;
  for (const t of tracks) {
    tops.push(acc);
    acc += t.height;
  }
  const trackContentH = acc;
  const busTops: number[] = [];
  let busAcc = 0;
  for (let i = 0; i < buses.length; i++) {
    busTops.push(busAcc);
    busAcc += BUS_LANE_H;
  }
  const busContentH = busAcc;
  const masterContentTop = videoContentH + trackContentH + busContentH;
  const contentH = masterContentTop + MASTER_LANE_H;

  const timeToX = (t: number) => HEADER_W + (t - scrollSec) * pps;
  const xToTime = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return scrollSec + (clientX - rect.left - HEADER_W) / pps;
  };
  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const trackAtY = (y: number): number => {
    const ly = y - RULER_H + scrollY - videoContentH;
    for (let i = 0; i < tracks.length; i++) if (ly >= tops[i] && ly < tops[i] + tracks[i].height) return i;
    return -1;
  };
  const busAtY = (y: number): number => {
    const ly = y - RULER_H + scrollY - videoContentH - trackContentH;
    for (let i = 0; i < buses.length; i++) if (ly >= busTops[i] && ly < busTops[i] + BUS_LANE_H) return i;
    return -1;
  };
  const masterAtY = (y: number): boolean => {
    const ly = y - RULER_H + scrollY - masterContentTop;
    return ly >= 0 && ly < MASTER_LANE_H;
  };

  // ── draw ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = size.w;
    const H = size.h;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const accent = cssVar(canvas, "--accent", "oklch(0.78 0.13 200)");
    const text3 = cssVar(canvas, "--text-3", "rgba(255,255,255,0.45)");
    const stroke = cssVar(canvas, "--stroke-soft", "rgba(255,255,255,0.08)");
    const resolve = (c: string) => (c.startsWith("var(") ? accent : c);

    // lane backgrounds + beat grid
    const beat = beatDuration(state.project);
    const firstBeat = Math.floor(scrollSec / beat) * beat;
    for (let i = 0; i < videoTracks.length; i++) {
      const top = RULER_H + videoTops[i] - scrollY;
      if (top + videoTracks[i].height < RULER_H || top > H) continue;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.18)";
      ctx.fillRect(HEADER_W, top, W - HEADER_W, videoTracks[i].height);
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fillRect(HEADER_W, top, W - HEADER_W, videoTracks[i].height);
    }
    for (let i = 0; i < tracks.length; i++) {
      const top = RULER_H + videoContentH + tops[i] - scrollY;
      if (top + tracks[i].height < RULER_H || top > H) continue;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.12)";
      ctx.fillRect(HEADER_W, top, W - HEADER_W, tracks[i].height);
      if (tracks[i].id === state.activeTrackId) {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(HEADER_W, top, W - HEADER_W, tracks[i].height);
      }
    }
    for (let i = 0; i < buses.length; i++) {
      const top = RULER_H + videoContentH + trackContentH + busTops[i] - scrollY;
      if (top + BUS_LANE_H < RULER_H || top > H) continue;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.18)";
      ctx.fillRect(HEADER_W, top, W - HEADER_W, BUS_LANE_H);
      ctx.fillStyle = "rgba(255,255,255,0.018)";
      ctx.fillRect(HEADER_W, top, W - HEADER_W, BUS_LANE_H);
    }
    const masterTop = RULER_H + masterContentTop - scrollY;
    if (masterTop + MASTER_LANE_H >= RULER_H && masterTop <= H) {
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fillRect(HEADER_W, masterTop, W - HEADER_W, MASTER_LANE_H);
      ctx.fillStyle = "rgba(0,0,0,0.20)";
      ctx.fillRect(HEADER_W, masterTop, W - HEADER_W, MASTER_LANE_H);
    }
    // grid lines
    ctx.lineWidth = 1;
    for (let t = firstBeat, n = 0; timeToX(t) < W; t += beat, n++) {
      const x = timeToX(t);
      if (x < HEADER_W) continue;
      const isBar = Math.round(t / beat) % state.project.timeSignature[0] === 0;
      ctx.strokeStyle = isBar ? "rgba(255,255,255,0.10)" : stroke;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }

    // video reference clips
    for (let i = 0; i < videoTracks.length; i++) {
      const track = videoTracks[i];
      const top = RULER_H + videoTops[i] - scrollY;
      if (top + track.height < RULER_H || top > H) continue;
      for (const clip of track.clips) drawVideoClip(ctx, clip, track, resolve, timeToX, top, track.height, state);
    }

    // audio clips
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const top = RULER_H + videoContentH + tops[i] - scrollY;
      if (top + track.height < RULER_H || top > H) continue;
      for (const clip of track.clips) {
        drawClip(ctx, clip, track.color, resolve, timeToX, top, track.height, state, automationTarget);
      }
      drawTrackAutomation(ctx, track, automationTarget, resolve(track.color), timeToX, top, track.height, W);
    }

    // bus automation lanes
    for (let i = 0; i < buses.length; i++) {
      const bus = buses[i];
      const top = RULER_H + videoContentH + trackContentH + busTops[i] - scrollY;
      if (top + BUS_LANE_H < RULER_H || top > H) continue;
      drawTrackAutomation(ctx, bus, automationTarget, resolve(bus.color), timeToX, top, BUS_LANE_H, W);
    }
    if (isMasterAutomationTarget(automationTarget) && masterTop + MASTER_LANE_H >= RULER_H && masterTop <= H) {
      drawTrackAutomation(ctx, { automation: state.project.masterAutomation }, automationTarget, accent, timeToX, masterTop, MASTER_LANE_H, W);
    }

    // selection range
    if (state.selection.range) {
      const { start, end } = state.selection.range;
      const x0 = Math.max(HEADER_W, timeToX(start));
      const x1 = Math.max(HEADER_W, timeToX(end));
      ctx.fillStyle = "color-mix(in oklch, " + accent + " 18%, transparent)";
      try {
        ctx.fillRect(x0, RULER_H, x1 - x0, H - RULER_H);
      } catch {
        ctx.fillStyle = "rgba(120,180,255,0.16)";
        ctx.fillRect(x0, RULER_H, x1 - x0, H - RULER_H);
      }
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, RULER_H);
      ctx.lineTo(x0 + 0.5, H);
      ctx.moveTo(x1 + 0.5, RULER_H);
      ctx.lineTo(x1 + 0.5, H);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ruler
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fillRect(HEADER_W, 0, W - HEADER_W, RULER_H);
    ctx.fillStyle = text3;
    ctx.font = "9px var(--font-mono, monospace)";
    ctx.textBaseline = "middle";
    const step = chooseTickStep(pps);
    for (let t = Math.floor(scrollSec / step) * step; timeToX(t) < W; t += step) {
      const x = timeToX(t);
      if (x < HEADER_W) continue;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H - 7);
      ctx.lineTo(x + 0.5, RULER_H);
      ctx.stroke();
      ctx.fillText(formatTick(t), x + 3, RULER_H / 2);
    }

    // markers
    for (const m of state.project.markers) {
      const x = timeToX(m.time);
      if (x < HEADER_W || x > W) continue;
      ctx.strokeStyle = resolve(m.color);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = resolve(m.color);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 8, 0);
      ctx.lineTo(x, 8);
      ctx.closePath();
      ctx.fill();
    }

    // playhead
    const px = timeToX(state.transport.playhead);
    if (px >= HEADER_W && px <= W) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, H);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 7);
      ctx.closePath();
      ctx.fill();
    }
  }, [state, size, pps, scrollSec, scrollY, videoContentH, thumbnailVersion, automationTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── pointer handling ─────────────────────────────────────────────────────────
  const clipHit = (time: number, trackIndex: number): Clip | null => {
    if (trackIndex < 0) return null;
    const track = tracks[trackIndex];
    for (let i = track.clips.length - 1; i >= 0; i--) {
      const c = track.clips[i];
      if (time >= c.start && time <= clipEnd(c)) return c;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    if (x < HEADER_W) return; // headers handle their own events
    (e.target as Element).setPointerCapture(e.pointerId);
    const time = Math.max(0, xToTime(e.clientX));
    const ti = trackAtY(y);
    const bi = busAtY(y);
    const isMasterLane = masterAtY(y);
    const hit = clipHit(time, ti);

    // ruler → scrub playhead
    if (y < RULER_H) {
      store.dispatch(setPlayhead(time), { history: false });
      dragRef.current = { kind: "range", anchorTime: time, trackId: undefined, startX: x };
      return;
    }

    const tool = state.tool;
    if (tool === "hand") {
      dragRef.current = { kind: "pan", startX: e.clientX, origScroll: scrollSec };
      return;
    }
    if (tool === "zoom") {
      store.dispatch(zoomBy(e.altKey ? 1 / 1.5 : 1.5), { history: false });
      return;
    }
    if (tool === "marker") {
      store.dispatch(addMarker({ time, name: `Marker ${state.project.markers.length + 1}` }), { label: "Add marker" });
      return;
    }
    if (ti >= 0) store.dispatch(setActiveTrack(tracks[ti].id), { history: false });

    if (tool === "envelope" && ti >= 0) {
      if (hit && isClipAutomationTarget(automationTarget)) {
        const value = automationValueAtY(automationTarget, y, videoContentH + tops[ti] + 3, Math.max(1, tracks[ti].height - 6), scrollY);
        store.dispatch(clipAutomationPointCommand(automationTarget, hit.id, clipAutomationTime(hit, time), value), {
          coalesceKey: `automation:${automationTargetKey(automationTarget)}:${hit.id}`,
          label: automationEditLabel(automationTarget),
        });
        dragRef.current = { kind: "automation", clipId: hit.id, automationTarget };
        return;
      }
      if (isClipAutomationTarget(automationTarget)) return;
      const value = automationValueAtY(automationTarget, y, tops[ti], tracks[ti].height, scrollY);
      store.dispatch(trackAutomationPointCommand(automationTarget, tracks[ti].id, time, value), {
        coalesceKey: `automation:${automationTargetKey(automationTarget)}:${tracks[ti].id}`,
        label: automationEditLabel(automationTarget),
      });
      dragRef.current = { kind: "automation", trackId: tracks[ti].id, automationTarget };
      return;
    }
    if (tool === "envelope" && bi >= 0) {
      if (!isBusAutomationTarget(automationTarget)) return;
      const value = automationValueAtY(automationTarget, y, videoContentH + trackContentH + busTops[bi], BUS_LANE_H, scrollY);
      store.dispatch(busAutomationPointCommand(automationTarget, buses[bi].id, time, value), {
        coalesceKey: `automation:${automationTargetKey(automationTarget)}:${buses[bi].id}`,
        label: automationEditLabel(automationTarget),
      });
      dragRef.current = { kind: "automation", busId: buses[bi].id, automationTarget };
      return;
    }
    if (tool === "envelope" && isMasterLane) {
      if (!isMasterAutomationTarget(automationTarget)) return;
      const value = automationValueAtY(automationTarget, y, masterContentTop, MASTER_LANE_H, scrollY);
      store.dispatch(masterAutomationPointCommand(automationTarget, time, value), {
        coalesceKey: `automation:${automationTargetKey(automationTarget)}:master`,
        label: automationEditLabel(automationTarget),
      });
      dragRef.current = { kind: "automation", masterAutomation: true, automationTarget };
      return;
    }

    if (tool === "razor") {
      store.dispatch(splitAtTime(time, ti >= 0 ? [tracks[ti].id] : undefined), { label: "Split" });
      return;
    }

    if (tool === "marquee" || (tool === "select" && !hit)) {
      // time-range selection
      store.dispatch(setPlayhead(time), { history: false });
      dragRef.current = { kind: "range", anchorTime: time, trackId: ti >= 0 ? tracks[ti].id : undefined };
      store.dispatch(selectRange({ start: time, end: time }, ti >= 0 ? [tracks[ti].id] : tracks.map((t) => t.id)), {
        history: false,
      });
      return;
    }

    if (tool === "fade" && hit) {
      const left = timeToX(hit.start);
      const dir = x - left < (timeToX(clipEnd(hit)) - left) / 2 ? "fadeIn" : "fadeOut";
      dragRef.current = { kind: dir, clipId: hit.id, origStart: hit.start };
      return;
    }

    if (hit && tool === "select") {
      const leftX = timeToX(hit.start);
      const rightX = timeToX(clipEnd(hit));
      store.dispatch(selectClips([hit.id], e.shiftKey), { history: false });
      if (Math.abs(x - leftX) <= EDGE_PX) {
        dragRef.current = { kind: "trimL", clipId: hit.id };
      } else if (Math.abs(x - rightX) <= EDGE_PX) {
        dragRef.current = { kind: "trimR", clipId: hit.id };
      } else {
        dragRef.current = { kind: "move", clipId: hit.id, trackId: hit.trackId, grabTime: time - hit.start, origStart: hit.start };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      updateCursor(e);
      return;
    }
    const time = Math.max(0, xToTime(e.clientX));
    switch (drag.kind) {
      case "pan": {
        const dx = e.clientX - (drag.startX ?? 0);
        store.dispatch(setScroll(Math.max(0, (drag.origScroll ?? 0) - dx / pps)), { history: false });
        break;
      }
      case "range": {
        const a = drag.anchorTime ?? 0;
        const start = Math.min(a, time);
        const end = Math.max(a, time);
        const tids = drag.trackId ? [drag.trackId] : tracks.map((t) => t.id);
        store.dispatch(selectRange({ start, end }, tids), { history: false });
        break;
      }
      case "move": {
        const raw = Math.max(0, time - (drag.grabTime ?? 0));
        const st = store.getState();
        let newStart = raw;
        if (st.view.snap) {
          // snap the clip's start to clip edges / the origin / markers / the playhead, within SNAP_PX
          const extra = [st.transport.playhead, ...st.project.markers.flatMap((m) => (m.end != null ? [m.time, m.end] : [m.time]))];
          newStart = snapTime(st.project, raw, SNAP_PX / st.view.pxPerSecond, drag.clipId, extra);
        }
        store.dispatch(moveClipTo(drag.clipId!, newStart), { coalesceKey: "move:" + drag.clipId, label: "Move clip" });
        break;
      }
      case "trimL": {
        const c = findClip(state, drag.clipId!);
        if (c) store.dispatch(trimClipEdgesCmd(drag.clipId!, time - c.start, 0), { coalesceKey: "trimL:" + drag.clipId, label: "Trim" });
        break;
      }
      case "trimR": {
        const c = findClip(state, drag.clipId!);
        if (c) store.dispatch(trimClipEdgesCmd(drag.clipId!, 0, time - clipEnd(c)), { coalesceKey: "trimR:" + drag.clipId, label: "Trim" });
        break;
      }
      case "fadeIn": {
        const c = findClip(state, drag.clipId!);
        if (c) store.dispatch(setClipFadesCmd(drag.clipId!, { fadeIn: Math.max(0, time - c.start) }), { coalesceKey: "fi:" + drag.clipId, label: "Fade in" });
        break;
      }
      case "fadeOut": {
        const c = findClip(state, drag.clipId!);
        if (c) store.dispatch(setClipFadesCmd(drag.clipId!, { fadeOut: Math.max(0, clipEnd(c) - time) }), { coalesceKey: "fo:" + drag.clipId, label: "Fade out" });
        break;
      }
      case "automation": {
        if (drag.clipId) {
          const clip = findClip(state, drag.clipId);
          const target = drag.automationTarget ?? automationTarget;
          if (!clip || !isClipAutomationTarget(target)) break;
          const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);
          if (trackIndex < 0) break;
          const { y } = localXY(e);
          const value = automationValueAtY(target, y, videoContentH + tops[trackIndex] + 3, Math.max(1, tracks[trackIndex].height - 6), scrollY);
          store.dispatch(clipAutomationPointCommand(target, clip.id, clipAutomationTime(clip, time), value), {
            coalesceKey: `automation:${automationTargetKey(target)}:${clip.id}`,
            label: automationEditLabel(target),
          });
        } else if (drag.trackId) {
          const trackIndex = tracks.findIndex((t) => t.id === drag.trackId);
          if (trackIndex < 0) break;
          const { y } = localXY(e);
          const target = drag.automationTarget ?? automationTarget;
          const value = automationValueAtY(target, y, tops[trackIndex], tracks[trackIndex].height, scrollY);
          store.dispatch(trackAutomationPointCommand(target, drag.trackId!, time, value), {
            coalesceKey: `automation:${automationTargetKey(target)}:${drag.trackId}`,
            label: automationEditLabel(target),
          });
        } else if (drag.busId) {
          const busIndex = buses.findIndex((bus) => bus.id === drag.busId);
          if (busIndex < 0) break;
          const { y } = localXY(e);
          const target = drag.automationTarget ?? automationTarget;
          const value = automationValueAtY(target, y, videoContentH + trackContentH + busTops[busIndex], BUS_LANE_H, scrollY);
          store.dispatch(busAutomationPointCommand(target, drag.busId, time, value), {
            coalesceKey: `automation:${automationTargetKey(target)}:${drag.busId}`,
            label: automationEditLabel(target),
          });
        } else if (drag.masterAutomation) {
          const { y } = localXY(e);
          const target = drag.automationTarget ?? automationTarget;
          if (!isMasterAutomationTarget(target)) break;
          const value = automationValueAtY(target, y, masterContentTop, MASTER_LANE_H, scrollY);
          store.dispatch(masterAutomationPointCommand(target, time, value), {
            coalesceKey: `automation:${automationTargetKey(target)}:master`,
            label: automationEditLabel(target),
          });
        }
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.kind === "range") {
      const r = state.selection.range;
      if (r && r.end - r.start < 1e-4) store.dispatch(clearSelection(), { history: false });
    }
    dragRef.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const updateCursor = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = localXY(e);
    if (x < HEADER_W || y < RULER_H) {
      canvas.style.cursor = "default";
      return;
    }
    const tool = state.tool;
    if (tool === "hand") canvas.style.cursor = "grab";
    else if (tool === "zoom") canvas.style.cursor = "zoom-in";
    else if (tool === "razor") canvas.style.cursor = "crosshair";
    else if (tool === "envelope") canvas.style.cursor = "crosshair";
    else {
      const ti = trackAtY(y);
      const time = xToTime(e.clientX);
      const hit = clipHit(time, ti);
      if (hit && tool === "select") {
        const lx = timeToX(hit.start);
        const rx = timeToX(clipEnd(hit));
        canvas.style.cursor = Math.abs(x - lx) <= EDGE_PX || Math.abs(x - rx) <= EDGE_PX ? "ew-resize" : "move";
      } else canvas.style.cursor = "text";
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      store.dispatch(zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1), { history: false });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dx = e.deltaX || e.deltaY;
      store.dispatch(setScroll(Math.max(0, scrollSec + dx / pps)), { history: false });
    } else {
      const maxY = Math.max(0, contentH - (size.h - RULER_H));
      store.dispatch(setScroll(scrollSec, Math.min(maxY, Math.max(0, scrollY + e.deltaY))), { history: false });
    }
  };

  const total = projectDuration(state.project);

  return (
    <div ref={wrapRef} className="rh-timeline">
      <canvas
        ref={canvasRef}
        className="rh-canvas"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
      <div className="rh-headers" style={{ top: RULER_H, width: HEADER_W, height: size.h - RULER_H }}>
        <div style={{ transform: `translateY(${-scrollY}px)` }}>
          {videoTracks.map((t, i) => (
            <VideoTrackHeader key={t.id} track={t} index={i} />
          ))}
          {tracks.map((t, i) => (
            <TrackHeader key={t.id} index={i} active={t.id === state.activeTrackId} automationTarget={automationTarget} setAutomationTarget={setAutomationTarget} />
          ))}
          {buses.map((bus, i) => (
            <BusHeader key={bus.id} bus={bus} index={i} automationTarget={automationTarget} setAutomationTarget={setAutomationTarget} />
          ))}
          <MasterHeader automationTarget={automationTarget} setAutomationTarget={setAutomationTarget} />
          <div className="rh-addtrack-spacer" />
        </div>
      </div>
      <div className="rh-hscroll" aria-hidden>
        {total > 0 && (
          <div
            className="rh-hscroll-thumb"
            style={{
              left: `${(scrollSec / Math.max(total, scrollSec + (size.w - HEADER_W) / pps)) * 100}%`,
              width: `${Math.min(100, (((size.w - HEADER_W) / pps) / Math.max(total, 0.001)) * 100)}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── track header (DOM) ────────────────────────────────────────────────────────
function TrackHeader({
  index,
  active,
  automationTarget,
  setAutomationTarget,
}: {
  index: number;
  active: boolean;
  automationTarget: TimelineAutomationTarget;
  setAutomationTarget: (target: TimelineAutomationTarget) => void;
}) {
  const store = useStore();
  const state = useEditorState();
  const t = state.project.tracks[index];
  if (!t) return null;
  const color = t.color;
  const selectedClip = state.selection.clipIds.length === 1 ? t.clips.find((clip) => clip.id === state.selection.clipIds[0]) : undefined;
  const selectedClipRackTargets = clipRackAutomationTargets(selectedClip?.effectRack?.slots ?? []);
  return (
    <div
      className={`rh-track-head ${active ? "is-active" : ""}`}
      style={{ height: t.height }}
      onPointerDown={() => store.dispatch(setActiveTrack(t.id), { history: false })}
    >
      <div className="rh-th-row">
        <span className="rh-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <span className="rh-th-name" title={t.name}>{t.name}</span>
        <span className="rh-th-idx">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="rh-th-row">
        <button className={`rh-msr ${t.mute ? "is-mute" : ""}`} title="Mute" onClick={() => store.dispatch(toggleMute(t.id), { label: "Mute" })}>M</button>
        <button className={`rh-msr ${t.solo ? "is-solo" : ""}`} title="Solo" onClick={() => store.dispatch(toggleSolo(t.id), { label: "Solo" })}>S</button>
        <button className={`rh-msr ${t.recordArm ? "is-rec" : ""}`} title="Record arm" onClick={() => store.dispatch(toggleArm(t.id), { label: "Arm" })}>R</button>
        <button
          className={`rh-auto-toggle ${automationTargetMatches(automationTarget, { kind: "gainDb" }) ? "is-active" : ""}`}
          title="Draw volume automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "gainDb" })}
          onClick={() => setAutomationTarget({ kind: "gainDb" })}
        >
          VOL
        </button>
        <button
          className={`rh-auto-toggle ${automationTargetMatches(automationTarget, { kind: "pan" }) ? "is-active" : ""}`}
          title="Draw pan automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "pan" })}
          onClick={() => setAutomationTarget({ kind: "pan" })}
        >
          PAN
        </button>
        <Slider
          className="rh-fader"
          aria-label={`Track gain, ${t.gainDb.toFixed(1)} dB`}
          min={-60}
          max={12}
          step={0.5}
          accent={color}
          value={t.gainDb}
          onChange={(v) => store.dispatch(setTrackGain(t.id, v), { coalesceKey: "gain:" + t.id, label: "Gain" })}
        />
      </div>
      <div className="rh-th-row rh-th-clip-auto">
        <span className="rh-th-idx">CLIP</span>
        <button
          className={`rh-auto-toggle is-clip ${automationTargetMatches(automationTarget, { kind: "clipGainDb" }) ? "is-active" : ""}`}
          title="Draw clip volume automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "clipGainDb" })}
          data-action="timeline-clip-gain-automation"
          onClick={() => setAutomationTarget({ kind: "clipGainDb" })}
        >
          CLV
        </button>
        <button
          className={`rh-auto-toggle is-clip ${automationTargetMatches(automationTarget, { kind: "clipPan" }) ? "is-active" : ""}`}
          title="Draw clip pan automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "clipPan" })}
          data-action="timeline-clip-pan-automation"
          onClick={() => setAutomationTarget({ kind: "clipPan" })}
        >
          CLP
        </button>
      </div>
      {selectedClip && selectedClipRackTargets.length > 0 && (
        <div className="rh-th-row rh-th-rack-auto">
          <span className="rh-th-idx">CLIP FX</span>
          {selectedClipRackTargets.map(({ key, target, label, title }) => (
            <button
              key={key}
              className={`rh-auto-toggle is-rack ${automationTargetMatches(automationTarget, target) ? "is-active" : ""}`}
              title={title}
              aria-pressed={automationTargetMatches(automationTarget, target)}
              data-action={
                target.kind === "clipRackGainDb"
                  ? "timeline-clip-rack-gain-automation"
                  : target.kind === "clipRackPan"
                    ? "timeline-clip-rack-pan-automation"
                    : "timeline-clip-rack-param-automation"
              }
              data-clip-id={selectedClip.id}
              data-effect-slot-id={target.effectSlotId}
              data-param={target.param}
              onClick={() => setAutomationTarget(target)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {rackAutomationTargets(t.effectRack?.slots ?? []).length > 0 && (
        <div className="rh-th-row rh-th-rack-auto">
          <span className="rh-th-idx">RACK</span>
          {rackAutomationTargets(t.effectRack?.slots ?? []).map(({ key, target, label, title }) => (
            <button
              key={key}
              className={`rh-auto-toggle is-rack ${automationTargetMatches(automationTarget, target) ? "is-active" : ""}`}
              title={title}
              aria-pressed={automationTargetMatches(automationTarget, target)}
              data-action={
                target.kind === "rackGainDb"
                  ? "timeline-track-rack-gain-automation"
                  : target.kind === "rackPan"
                    ? "timeline-track-rack-pan-automation"
                    : "timeline-track-rack-param-automation"
              }
              data-effect-slot-id={target.effectSlotId}
              data-param={target.param}
              onClick={() => setAutomationTarget(target)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(t.sends ?? []).length > 0 && (
        <div className="rh-th-row rh-th-auto-sends">
          {(t.sends ?? []).map((send, sendIndex) => {
            const sendGainTarget: TimelineAutomationTarget = { kind: "sendGainDb", sendId: send.id };
            const sendPanTarget: TimelineAutomationTarget = { kind: "sendPan", sendId: send.id };
            return (
              <span key={send.id} className="rh-th-send-auto">
                <button
                  className={`rh-auto-toggle is-send ${automationTargetMatches(automationTarget, sendGainTarget) ? "is-active" : ""}`}
                  title={`Draw ${send.name} send gain automation`}
                  aria-pressed={automationTargetMatches(automationTarget, sendGainTarget)}
                  data-action="timeline-send-gain-automation"
                  data-send-id={send.id}
                  onClick={() => setAutomationTarget(sendGainTarget)}
                >
                  S{sendIndex + 1}G
                </button>
                <button
                  className={`rh-auto-toggle is-send ${automationTargetMatches(automationTarget, sendPanTarget) ? "is-active" : ""}`}
                  title={`Draw ${send.name} send pan automation`}
                  aria-pressed={automationTargetMatches(automationTarget, sendPanTarget)}
                  data-action="timeline-send-pan-automation"
                  data-send-id={send.id}
                  onClick={() => setAutomationTarget(sendPanTarget)}
                >
                  S{sendIndex + 1}P
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BusHeader({
  bus,
  index,
  automationTarget,
  setAutomationTarget,
}: {
  bus: Bus;
  index: number;
  automationTarget: TimelineAutomationTarget;
  setAutomationTarget: (target: TimelineAutomationTarget) => void;
}) {
  const store = useStore();
  return (
    <div className="rh-track-head rh-bus-head" data-bus-lane-header={bus.id} style={{ height: BUS_LANE_H }}>
      <div className="rh-th-row">
        <span className="rh-dot" style={{ background: bus.color, boxShadow: `0 0 6px ${bus.color}` }} />
        <span className="rh-th-name" title={bus.name}>{bus.name}</span>
        <span className="rh-th-idx">B{index + 1}</span>
      </div>
      <div className="rh-th-row">
        <button className={`rh-msr ${bus.mute ? "is-mute" : ""}`} title="Bus mute" onClick={() => store.dispatch(toggleBusMute(bus.id), { label: "Bus mute" })}>M</button>
        <button className={`rh-msr ${bus.solo ? "is-solo" : ""}`} title="Bus solo" onClick={() => store.dispatch(toggleBusSolo(bus.id), { label: "Bus solo" })}>S</button>
        <button
          className={`rh-auto-toggle ${automationTargetMatches(automationTarget, { kind: "gainDb" }) ? "is-active" : ""}`}
          title="Draw bus volume automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "gainDb" })}
          data-action="timeline-bus-gain-automation"
          data-bus-id={bus.id}
          onClick={() => setAutomationTarget({ kind: "gainDb" })}
        >
          VOL
        </button>
        <button
          className={`rh-auto-toggle ${automationTargetMatches(automationTarget, { kind: "pan" }) ? "is-active" : ""}`}
          title="Draw bus pan automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "pan" })}
          data-action="timeline-bus-pan-automation"
          data-bus-id={bus.id}
          onClick={() => setAutomationTarget({ kind: "pan" })}
        >
          PAN
        </button>
      </div>
      {rackAutomationTargets(bus.effectRack?.slots ?? []).length > 0 && (
        <div className="rh-th-row rh-th-rack-auto">
          <span className="rh-th-idx">RACK</span>
          {rackAutomationTargets(bus.effectRack?.slots ?? []).map(({ key, target, label, title }) => (
            <button
              key={key}
              className={`rh-auto-toggle is-rack ${automationTargetMatches(automationTarget, target) ? "is-active" : ""}`}
              title={title}
              aria-pressed={automationTargetMatches(automationTarget, target)}
              data-action={
                target.kind === "rackGainDb"
                  ? "timeline-bus-rack-gain-automation"
                  : target.kind === "rackPan"
                    ? "timeline-bus-rack-pan-automation"
                    : "timeline-bus-rack-param-automation"
              }
              data-bus-id={bus.id}
              data-effect-slot-id={target.effectSlotId}
              data-param={target.param}
              onClick={() => setAutomationTarget(target)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(bus.sends ?? []).length > 0 && (
        <div className="rh-th-row rh-th-auto-sends">
          {(bus.sends ?? []).map((send, sendIndex) => {
            const sendGainTarget: TimelineAutomationTarget = { kind: "sendGainDb", sendId: send.id };
            const sendPanTarget: TimelineAutomationTarget = { kind: "sendPan", sendId: send.id };
            return (
              <span key={send.id} className="rh-th-send-auto">
                <button
                  className={`rh-auto-toggle is-send ${automationTargetMatches(automationTarget, sendGainTarget) ? "is-active" : ""}`}
                  title={`Draw ${send.name} bus send gain automation`}
                  aria-pressed={automationTargetMatches(automationTarget, sendGainTarget)}
                  data-action="timeline-bus-send-gain-automation"
                  data-send-id={send.id}
                  onClick={() => setAutomationTarget(sendGainTarget)}
                >
                  S{sendIndex + 1}G
                </button>
                <button
                  className={`rh-auto-toggle is-send ${automationTargetMatches(automationTarget, sendPanTarget) ? "is-active" : ""}`}
                  title={`Draw ${send.name} bus send pan automation`}
                  aria-pressed={automationTargetMatches(automationTarget, sendPanTarget)}
                  data-action="timeline-bus-send-pan-automation"
                  data-send-id={send.id}
                  onClick={() => setAutomationTarget(sendPanTarget)}
                >
                  S{sendIndex + 1}P
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MasterHeader({
  automationTarget,
  setAutomationTarget,
}: {
  automationTarget: TimelineAutomationTarget;
  setAutomationTarget: (target: TimelineAutomationTarget) => void;
}) {
  const masterRackTargets = rackAutomationTargets(useEditorState().project.masterEffectRack?.slots ?? []);
  return (
    <div className="rh-track-head rh-master-head" data-master-lane-header style={{ height: MASTER_LANE_H }}>
      <div className="rh-th-row">
        <span className="rh-dot rh-master-dot" />
        <span className="rh-th-name" title="Master">Master</span>
        <span className="rh-th-idx">MIX</span>
      </div>
      <div className="rh-th-row">
        <button
          className={`rh-auto-toggle ${automationTargetMatches(automationTarget, { kind: "gainDb" }) ? "is-active" : ""}`}
          title="Draw master volume automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "gainDb" })}
          data-action="timeline-master-gain-automation"
          onClick={() => setAutomationTarget({ kind: "gainDb" })}
        >
          VOL
        </button>
        <button
          className={`rh-auto-toggle ${automationTargetMatches(automationTarget, { kind: "pan" }) ? "is-active" : ""}`}
          title="Draw master pan automation"
          aria-pressed={automationTargetMatches(automationTarget, { kind: "pan" })}
          data-action="timeline-master-pan-automation"
          onClick={() => setAutomationTarget({ kind: "pan" })}
        >
          PAN
        </button>
      </div>
      {masterRackTargets.length > 0 && (
        <div className="rh-th-row rh-th-rack-auto">
          <span className="rh-th-idx">RACK</span>
          {masterRackTargets.map(({ key, target, label, title }) => (
            <button
              key={key}
              className={`rh-auto-toggle is-rack ${automationTargetMatches(automationTarget, target) ? "is-active" : ""}`}
              title={title}
              aria-pressed={automationTargetMatches(automationTarget, target)}
              data-action={
                target.kind === "rackGainDb"
                  ? "timeline-master-rack-gain-automation"
                  : target.kind === "rackPan"
                    ? "timeline-master-rack-pan-automation"
                    : "timeline-master-rack-param-automation"
              }
              data-effect-slot-id={target.effectSlotId}
              data-param={target.param}
              onClick={() => setAutomationTarget(target)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoTrackHeader({ track, index }: { track: VideoTrack; index: number }) {
  const locked = track.locked || track.clips.some((clip) => clip.locked);
  return (
    <div
      className="rh-track-head rh-video-track-head"
      data-video-track-header={track.id}
      style={{ height: track.height }}
      title={locked ? "Picture reference locked" : "Picture reference track"}
    >
      <div className="rh-th-row">
        <span className="rh-dot" style={{ background: track.color, boxShadow: `0 0 6px ${track.color}` }} />
        <span className="rh-th-name">{track.name}</span>
        <span className="rh-th-idx">V{index + 1}</span>
      </div>
      <div className="rh-th-row">
        <span className={`rh-msr ${locked ? "is-solo" : ""}`} style={{ width: 42 }}>{locked ? "LOCK" : "PIC"}</span>
        <span className="rh-th-idx">{track.clips.length} clip{track.clips.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────
function findClip(state: EditorState, clipId: string): Clip | null {
  for (const t of state.project.tracks) for (const c of t.clips) if (c.id === clipId) return c;
  return null;
}

function automationTargetKey(target: TimelineAutomationTarget): string {
  if (isAnyRackAutomationTarget(target)) return `${target.kind}:${target.effectSlotId}:${target.param}`;
  return target.sendId ? `${target.kind}:${target.sendId}` : target.kind;
}

function automationTargetMatches(a: TimelineAutomationTarget, b: TimelineAutomationTarget): boolean {
  const aEffectSlotId = isAnyRackAutomationTarget(a) ? a.effectSlotId : undefined;
  const bEffectSlotId = isAnyRackAutomationTarget(b) ? b.effectSlotId : undefined;
  const aParam = isAnyRackAutomationTarget(a) ? a.param : undefined;
  const bParam = isAnyRackAutomationTarget(b) ? b.param : undefined;
  return a.kind === b.kind && a.sendId === b.sendId && aEffectSlotId === bEffectSlotId && aParam === bParam;
}

function automationIsPan(target: TimelineAutomationTarget): boolean {
  return target.kind === "pan" || target.kind === "sendPan" || target.kind === "clipPan" || target.kind === "rackPan" || target.kind === "clipRackPan";
}

function isMasterAutomationTarget(target: TimelineAutomationTarget): target is MasterTimelineAutomationTarget {
  return target.kind === "gainDb" || target.kind === "pan" || isRackAutomationTarget(target);
}

function isClipAutomationTarget(target: TimelineAutomationTarget): target is ClipTimelineAutomationTarget {
  return target.kind === "clipGainDb" || target.kind === "clipPan" || isClipRackAutomationTarget(target);
}

function isClipRackAutomationTarget(target: TimelineAutomationTarget): target is ClipRackTimelineAutomationTarget {
  return target.kind === "clipRackGainDb" || target.kind === "clipRackPan" || target.kind === "clipRackParam";
}

function isRackAutomationTarget(target: TimelineAutomationTarget): target is RackTimelineAutomationTarget {
  return target.kind === "rackGainDb" || target.kind === "rackPan" || target.kind === "rackParam";
}

function isAnyRackAutomationTarget(target: TimelineAutomationTarget): target is RackTimelineAutomationTarget | ClipRackTimelineAutomationTarget {
  return isRackAutomationTarget(target) || isClipRackAutomationTarget(target);
}

function isBusAutomationTarget(target: TimelineAutomationTarget): boolean {
  return target.kind === "gainDb" || target.kind === "pan" || target.kind === "sendGainDb" || target.kind === "sendPan" || isRackAutomationTarget(target);
}

function clipAutomationLaneKind(target: ClipChannelTimelineAutomationTarget): "gainDb" | "pan" {
  return target.kind === "clipGainDb" ? "gainDb" : "pan";
}

function paramButtonLabel(param: string): string {
  const letters = param
    .replace(/Db$/i, "")
    .replace(/Ms$/i, "")
    .replace(/Hz$/i, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(/(?=[A-Z])|\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return letters.slice(0, 3) || param.slice(0, 3).toUpperCase();
}

function paramAutomationRange(param: string, value: number): { min: number; max: number } {
  const key = param.toLowerCase();
  if (key === "pan") return { min: -1, max: 1 };
  if (key.includes("shiftms") && (key.includes("left") || key.includes("right"))) return { min: -100, max: 100 };
  if (key.endsWith("ms") || key === "windowms") return { min: 0, max: Math.max(1000, value * 2 || 1000) };
  if (key.endsWith("hz") || key.includes("freq") || key === "frequency") return { min: key === "bodyhz" ? 20 : 20, max: 20000 };
  if (key === "ratio") return { min: 1, max: 40 };
  if (key === "q") return { min: 0.1, max: 100 };
  if (key === "feedback") return { min: -0.95, max: 0.95 };
  if (key === "width") return { min: 0, max: 3 };
  if (key === "expand") return { min: 0, max: 300 };
  if (key.includes("toleft") || key.includes("toright")) return { min: -200, max: 200 };
  if (key.includes("phase") || key.endsWith("deg")) return { min: -180, max: 180 };
  if (key === "stages") return { min: 1, max: 24 };
  if (key === "harmonics") return { min: 1, max: 64 };
  if (key.includes("falloff") || key === "amount" || key === "mix" || key === "warmth" || key === "depth" || key === "decay" || key === "damping" || key === "absorption" || key === "perception" || key === "ambience") {
    return { min: 0, max: key === "perception" ? 100 : 1 };
  }
  if (key.includes("ceiling")) return { min: -24, max: 0 };
  if (key.includes("threshold") || key.includes("gate") || key.includes("reduction")) return { min: -100, max: 0 };
  if (key.endsWith("db") || key.includes("gain") || key.includes("drive") || key.includes("level") || key.includes("shelf") || key.includes("presence") || key.includes("output")) {
    return { min: -80, max: 48 };
  }
  return { min: Math.min(0, value), max: Math.max(1, value * 2 || 1) };
}

function extraRackParamTargets(slot: EffectSlot, slotIndex: number): Array<{ param: string; label: string; title: string; min: number; max: number }> {
  return Object.entries(slot.params)
    .filter(([param, value]) => typeof value === "number" && Number.isFinite(value) && !(slot.kind === "gain" && (param === "gainDb" || param === "db")) && !(slot.kind === "pan" && param === "pan"))
    .map(([param, value]) => {
      const range = paramAutomationRange(param, value as number);
      const label = `FX${slotIndex + 1}${paramButtonLabel(param)}`;
      return { param, label, title: `Draw ${slot.name} ${param} automation`, min: range.min, max: range.max };
    });
}

function rackAutomationTargets(slots: EffectSlot[]): RackAutomationButton[] {
  const targets: RackAutomationButton[] = [];
  slots.forEach((slot, slotIndex) => {
    if (slot.kind === "gain") {
      const target: RackTimelineAutomationTarget = { kind: "rackGainDb", effectSlotId: slot.id, param: "gainDb" };
      targets.push({ key: `${slot.id}:gainDb`, target, label: `FX${slotIndex + 1}G`, title: `Draw ${slot.name} gain automation` });
      return;
    }
    if (slot.kind === "pan") {
      const target: RackTimelineAutomationTarget = { kind: "rackPan", effectSlotId: slot.id, param: "pan" };
      targets.push({ key: `${slot.id}:pan`, target, label: `FX${slotIndex + 1}P`, title: `Draw ${slot.name} pan automation` });
    }
    extraRackParamTargets(slot, slotIndex).forEach(({ param, label, title, min, max }) => {
      const target: RackTimelineAutomationTarget = { kind: "rackParam", effectSlotId: slot.id, param, label: paramButtonLabel(param), min, max };
      targets.push({ key: `${slot.id}:${param}`, target, label, title });
    });
  });
  return targets;
}

function clipRackAutomationTargets(slots: EffectSlot[]): RackAutomationButton<ClipRackTimelineAutomationTarget>[] {
  const targets: RackAutomationButton<ClipRackTimelineAutomationTarget>[] = [];
  slots.forEach((slot, slotIndex) => {
    if (slot.kind === "gain") {
      const target: ClipRackTimelineAutomationTarget = { kind: "clipRackGainDb", effectSlotId: slot.id, param: "gainDb" };
      targets.push({ key: `${slot.id}:gainDb`, target, label: `FX${slotIndex + 1}G`, title: `Draw ${slot.name} clip gain automation` });
      return;
    }
    if (slot.kind === "pan") {
      const target: ClipRackTimelineAutomationTarget = { kind: "clipRackPan", effectSlotId: slot.id, param: "pan" };
      targets.push({ key: `${slot.id}:pan`, target, label: `FX${slotIndex + 1}P`, title: `Draw ${slot.name} clip pan automation` });
    }
    extraRackParamTargets(slot, slotIndex).forEach(({ param, label, title, min, max }) => {
      const target: ClipRackTimelineAutomationTarget = { kind: "clipRackParam", effectSlotId: slot.id, param, label: paramButtonLabel(param), min, max };
      targets.push({ key: `${slot.id}:${param}`, target, label, title: title.replace(" automation", " clip automation") });
    });
  });
  return targets;
}

function automationLaneMatches(target: TimelineAutomationTarget, laneTarget: NonNullable<EditorState["project"]["tracks"][number]["automation"]>[number]["target"]): boolean {
  if (isClipRackAutomationTarget(target)) return laneTarget.kind === "effectParam" && laneTarget.effectSlotId === target.effectSlotId && laneTarget.param === target.param;
  if (isClipAutomationTarget(target)) return laneTarget.kind === clipAutomationLaneKind(target);
  if (isRackAutomationTarget(target)) return laneTarget.kind === "effectParam" && laneTarget.effectSlotId === target.effectSlotId && laneTarget.param === target.param;
  return laneTarget.kind === target.kind && laneTarget.sendId === target.sendId;
}

function automationRange(target: TimelineAutomationTarget): { min: number; max: number } {
  if (target.kind === "rackParam" || target.kind === "clipRackParam") return { min: target.min, max: target.max };
  if (automationIsPan(target)) return { min: -1, max: 1 };
  if (target.kind === "rackGainDb" || target.kind === "clipRackGainDb") return { min: -60, max: 24 };
  return { min: AUTOMATION_MIN_DB, max: AUTOMATION_MAX_DB };
}

function automationEditLabel(target: TimelineAutomationTarget): string {
  if (target.kind === "clipGainDb") return "Clip volume automation";
  if (target.kind === "clipPan") return "Clip pan automation";
  if (target.kind === "clipRackGainDb") return "Clip rack gain automation";
  if (target.kind === "clipRackPan") return "Clip rack pan automation";
  if (target.kind === "clipRackParam") return `Clip rack ${target.param} automation`;
  if (target.kind === "rackGainDb") return "Rack gain automation";
  if (target.kind === "rackPan") return "Rack pan automation";
  if (target.kind === "rackParam") return `Rack ${target.param} automation`;
  if (target.kind === "sendGainDb") return "Send gain automation";
  if (target.kind === "sendPan") return "Send pan automation";
  return target.kind === "gainDb" ? "Volume automation" : "Pan automation";
}

function automationCanvasLabel(target: TimelineAutomationTarget): string {
  if (target.kind === "clipGainDb") return "CLIP VOL";
  if (target.kind === "clipPan") return "CLIP PAN";
  if (target.kind === "clipRackGainDb") return "CLIP RACK GAIN";
  if (target.kind === "clipRackPan") return "CLIP RACK PAN";
  if (target.kind === "clipRackParam") return `CLIP RACK ${target.label}`;
  if (target.kind === "rackGainDb") return "RACK GAIN";
  if (target.kind === "rackPan") return "RACK PAN";
  if (target.kind === "rackParam") return `RACK ${target.label}`;
  if (target.kind === "sendGainDb") return "SEND VOL";
  if (target.kind === "sendPan") return "SEND PAN";
  return target.kind === "pan" ? "PAN" : "VOL";
}

function trackAutomationPointCommand(target: TimelineAutomationTarget, trackId: string, time: number, value: number) {
  if (isRackAutomationTarget(target)) return setTrackEffectParamAutomationPoint(trackId, target.effectSlotId, target.param, time, value);
  if (target.kind === "sendGainDb") return setTrackSendGainAutomationPoint(trackId, target.sendId, time, value);
  if (target.kind === "sendPan") return setTrackSendPanAutomationPoint(trackId, target.sendId, time, value);
  return target.kind === "gainDb" ? setTrackGainAutomationPoint(trackId, time, value) : setTrackPanAutomationPoint(trackId, time, value);
}

function busAutomationPointCommand(target: TimelineAutomationTarget, busId: string, time: number, value: number) {
  if (isRackAutomationTarget(target)) return setBusEffectParamAutomationPoint(busId, target.effectSlotId, target.param, time, value);
  if (target.kind === "sendGainDb") return setBusSendGainAutomationPoint(busId, target.sendId, time, value);
  if (target.kind === "sendPan") return setBusSendPanAutomationPoint(busId, target.sendId, time, value);
  return target.kind === "gainDb" ? setBusGainAutomationPoint(busId, time, value) : setBusPanAutomationPoint(busId, time, value);
}

function masterAutomationPointCommand(target: MasterTimelineAutomationTarget, time: number, value: number) {
  if (isRackAutomationTarget(target)) return setMasterEffectParamAutomationPoint(target.effectSlotId, target.param, time, value);
  return target.kind === "gainDb" ? setMasterGainAutomationPoint(time, value) : setMasterPanAutomationPoint(time, value);
}

function clipAutomationPointCommand(target: ClipTimelineAutomationTarget, clipId: string, time: number, value: number) {
  if (isClipRackAutomationTarget(target)) return setClipEffectParamAutomationPoint(clipId, target.effectSlotId, target.param, time, value);
  return target.kind === "clipGainDb" ? setClipGainAutomationPoint(clipId, time, value) : setClipPanAutomationPoint(clipId, time, value);
}

function clipAutomationTime(clip: Clip, timelineTime: number): number {
  return Math.max(0, Math.min(clip.duration, timelineTime - clip.start));
}

function automationValueAtY(target: TimelineAutomationTarget, y: number, trackTop: number, trackHeight: number, scrollY: number): number {
  const localY = y - RULER_H + scrollY - trackTop;
  const t = Math.max(0, Math.min(1, localY / Math.max(1, trackHeight)));
  if (automationIsPan(target)) return 1 - t * 2;
  const { min, max } = automationRange(target);
  return max - t * (max - min);
}

function yForAutomationValue(target: TimelineAutomationTarget, value: number, top: number, height: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  const { min, max } = automationRange(target);
  const t = automationIsPan(target)
    ? (1 - Math.max(-1, Math.min(1, finite))) / 2
    : (max - Math.max(min, Math.min(max, finite))) / (max - min);
  return top + t * height;
}

function drawTrackAutomation(
  ctx: CanvasRenderingContext2D,
  laneOwner: { automation?: EditorState["project"]["tracks"][number]["automation"] },
  target: TimelineAutomationTarget,
  color: string,
  timeToX: (t: number) => number,
  top: number,
  height: number,
  width: number,
) {
  const lane = laneOwner.automation?.find((x) => x.enabled && automationLaneMatches(target, x.target) && x.points.length > 0);
  if (!lane) return;
  const points = [...lane.points].filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)).sort((a, b) => a.time - b.time);
  if (points.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(HEADER_W, top, width - HEADER_W, height);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  if (automationIsPan(target)) ctx.setLineDash([5, 4]);
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  points.forEach((point, i) => {
    const x = timeToX(point.time);
    const y = yForAutomationValue(target, point.value, top, height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  for (const point of points) {
    const x = timeToX(point.time);
    const y = yForAutomationValue(target, point.value, top, height);
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  ctx.setLineDash([]);
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textBaseline = "top";
  ctx.fillText(automationCanvasLabel(target), HEADER_W + 6, top + 5);
  ctx.restore();
}

function drawClipAutomation(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  target: TimelineAutomationTarget,
  color: string,
  timeToX: (t: number) => number,
  top: number,
  height: number,
) {
  if (!isClipAutomationTarget(target)) return;
  const lane = clip.automation?.find((x) => x.enabled && automationLaneMatches(target, x.target) && x.points.length > 0);
  if (!lane) return;
  const points = [...lane.points]
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
  if (points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.92;
  if (automationIsPan(target)) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  points.forEach((point, i) => {
    const x = timeToX(clip.start + point.time);
    const y = yForAutomationValue(target, point.value, top, height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  for (const point of points) {
    const x = timeToX(clip.start + point.time);
    const y = yForAutomationValue(target, point.value, top, height);
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillText(automationCanvasLabel(target), Math.max(timeToX(clip.start), HEADER_W) + 5, top + 5);
  ctx.restore();
}

function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  clip: VideoClip,
  track: VideoTrack,
  resolve: (c: string) => string,
  timeToX: (t: number) => number,
  top: number,
  height: number,
  state: EditorState,
) {
  const x0 = timeToX(clip.start);
  const x1 = timeToX(clipEnd(clip));
  const w = x1 - x0;
  if (x1 < HEADER_W || w <= 0) return;
  const vx0 = Math.max(HEADER_W, x0);
  const pad = 4;
  const ct = top + pad;
  const ch = height - pad * 2;
  const color = resolve(track.color);
  const frameRate = clip.speed > 0 ? state.project.videoFrameRate / clip.speed : state.project.videoFrameRate;
  const frameStepPx = Math.max(18, Math.min(52, Math.round(frameRate > 0 ? state.view.pxPerSecond / frameRate * 8 : 28)));
  const previewUrl = videoPreviewUrl(clip.assetId);
  const thumbnails = previewUrl ? requestVideoThumbnailStrip(clip.assetId, previewUrl, clip.duration, 8) : undefined;

  ctx.save();
  ctx.beginPath();
  ctx.rect(vx0, ct, Math.max(0, x1 - vx0), ch);
  ctx.clip();

  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(vx0, ct, x1 - vx0, ch);
  ctx.fillStyle = withAlpha(color, 0.2);
  ctx.fillRect(vx0, ct, x1 - vx0, ch);

  const firstFrameX = Math.max(vx0 + 4, x0 + 4);
  let frameIndex = Math.max(0, Math.floor((Math.max(vx0, x0) - x0) / Math.max(1, frameStepPx)));
  for (let x = firstFrameX; x < x1 - 5; x += frameStepPx, frameIndex++) {
    const fw = Math.min(frameStepPx - 4, x1 - x - 5);
    if (fw < 8) continue;
    const fh = Math.max(10, ch - 25);
    const decodedFrame = thumbnails?.status === "ready" && thumbnails.frames.length ? thumbnails.frames[frameIndex % thumbnails.frames.length] : undefined;
    if (decodedFrame) {
      ctx.drawImage(decodedFrame, x, ct + 18, fw, fh);
    } else {
      const shade = 0.13 + (frameIndex % 4) * 0.035;
      ctx.fillStyle = `rgba(255,255,255,${shade})`;
      ctx.fillRect(x, ct + 18, fw, fh);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(x + 0.5, ct + 18.5, fw - 1, fh - 1);
  }

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textBaseline = "top";
  ctx.fillText(clip.locked ? "LOCKED" : thumbnails?.status === "ready" ? "THUMBS" : "PICTURE", Math.max(vx0, x0) + 5, ct + 4);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(clip.name, Math.max(vx0, x0) + 55, ct + 4);
  ctx.restore();

  ctx.strokeStyle = clip.locked ? "rgba(255,255,255,0.9)" : withAlpha(color, 0.65);
  ctx.lineWidth = clip.locked ? 1.5 : 1;
  ctx.strokeRect(vx0 + 0.5, ct + 0.5, Math.max(0, x1 - vx0) - 1, ch - 1);
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  trackColor: string,
  resolve: (c: string) => string,
  timeToX: (t: number) => number,
  top: number,
  height: number,
  state: EditorState,
  automationTarget: TimelineAutomationTarget,
) {
  const x0 = timeToX(clip.start);
  const x1 = timeToX(clipEnd(clip));
  const w = x1 - x0;
  if (x1 < HEADER_W || w <= 0) return;
  const vx0 = Math.max(HEADER_W, x0);
  const pad = 3;
  const ct = top + pad;
  const ch = height - pad * 2;
  const color = resolve(trackColor);
  const selected = state.selection.clipIds.includes(clip.id);

  ctx.save();
  ctx.beginPath();
  ctx.rect(vx0, ct, Math.max(0, x1 - vx0), ch);
  ctx.clip();

  // body
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(vx0, ct, x1 - vx0, ch);
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.fillRect(vx0, ct, x1 - vx0, ch);

  // waveform
  const widthPx = Math.max(1, Math.round(w));
  const peaks = getClipPeaks(clip, widthPx);
  const mid = ct + ch / 2;
  const amp = (ch / 2) * 0.9;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = 0; px < peaks.max.length; px++) {
    const sx = x0 + (px / peaks.max.length) * w;
    if (sx < HEADER_W - 1) continue;
    ctx.moveTo(sx + 0.5, mid - peaks.max[px] * amp);
    ctx.lineTo(sx + 0.5, mid - peaks.min[px] * amp);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  drawClipAutomation(ctx, clip, automationTarget, color, timeToX, ct, ch);

  // fades
  if (clip.fadeIn > 0) {
    const fw = clip.fadeIn * (w / clip.duration);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.moveTo(x0, ct);
    ctx.lineTo(x0 + fw, ct);
    ctx.lineTo(x0, ct + ch);
    ctx.closePath();
    ctx.fill();
  }
  if (clip.fadeOut > 0) {
    const fw = clip.fadeOut * (w / clip.duration);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.moveTo(x1, ct);
    ctx.lineTo(x1 - fw, ct);
    ctx.lineTo(x1, ct + ch);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // border + label
  ctx.strokeStyle = selected ? "#fff" : withAlpha(color, 0.6);
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.strokeRect(vx0 + 0.5, ct + 0.5, Math.max(0, x1 - vx0) - 1, ch - 1);
  if (w > 36) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "9px var(--font-mono, monospace)";
    ctx.textBaseline = "top";
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx0, ct, x1 - vx0, ch);
    ctx.clip();
    ctx.fillText(clip.name, Math.max(vx0, x0) + 4, ct + 3);
    ctx.restore();
  }
}

function withAlpha(color: string, a: number): string {
  try {
    return `color-mix(in oklch, ${color} ${Math.round(a * 100)}%, transparent)`;
  } catch {
    return color;
  }
}

function chooseTickStep(pps: number): number {
  const targetPx = 80;
  const sec = targetPx / pps;
  const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const s of steps) if (s >= sec) return s;
  return 600;
}

function formatTick(t: number): string {
  if (t < 60) return `${t.toFixed(t < 1 ? 2 : t < 10 ? 1 : 0)}s`;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
