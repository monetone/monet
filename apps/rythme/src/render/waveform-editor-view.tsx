// ─────────────────────────────────────────────────────────────
// render/waveform-editor-view — single-source Waveform editor surface
// ─────────────────────────────────────────────────────────────
// Audition keeps Waveform and Multitrack as separate editor modes. This surface
// reuses Rythme's existing project model while presenting the active source as a
// focused waveform with shared playhead/range selection semantics.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Select } from "@monet-ui/monet-react";
import {
  Analysis,
  Ops,
  addMarker,
  applySpectralBrushSelectionGain,
  applySpectralHarmonicSelectionGain,
  applySpectralSelectionGain,
  applyWaveformRangeGain,
  applyWaveformSampleEdit,
  clipById,
  clipEnd,
  dbToGain,
  frameCount,
  mixToMono,
  projectDuration,
  repairClickRange,
  repairClippingRange,
  repairDcOffsetRange,
  repairDiagnosticIssues,
  repairSilenceRange,
  setLoop,
  selectRange,
  selectSpectralRange,
  setPlayhead,
  setScroll,
  setViewportWidth,
  sliceFrames,
  splitAtTime,
  zoomBy,
  type AudioData,
  type Clip,
  type EditorState,
  type SpectralChannel,
  type Track,
  type WaveformSilenceRepairMode,
  type WaveformSampleEditKind,
} from "../engine";
import { useEditorState, useStore } from "../state/store-context";
import { formatTime, type TimeFormat } from "../ui/format";

const RULER_H = 28;
const WHEEL_ZOOM = 1.1;
const LANE_GAP = 8;
const MIN_SPECTRAL_H = 118;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WaveformSource {
  kind: "clip" | "mixdown";
  title: string;
  detail: string;
  color: string;
  timelineStart: number;
  duration: number;
  trackIds: string[];
  audio: AudioData;
}

interface DragState {
  kind: "range" | "pan" | "spectral";
  anchorLocal?: number;
  anchorHz?: number;
  startX?: number;
  origScroll?: number;
}

type AudioDiagnosticIssue = ReturnType<typeof Analysis.scanAudioDiagnostics>[number];

interface DiagnosticScan {
  sourceKey: string;
  issues: AudioDiagnosticIssue[];
}

interface DiagnosticScanOptions {
  includeClipping: boolean;
  includeClicks: boolean;
  includeDcOffset: boolean;
  includeSilence: boolean;
  clipCeilingDb: number;
  clickThreshold: number;
  dcOffsetThresholdDb: number;
  silenceThresholdDb: number;
  minSilenceMs: number;
}

const DIAGNOSTIC_SCAN_PROFILES = {
  standard: {
    label: "Standard",
    options: {
      includeClipping: true,
      includeClicks: false,
      includeDcOffset: true,
      includeSilence: true,
      clipCeilingDb: 0,
      clickThreshold: 0.02,
      dcOffsetThresholdDb: -40,
      silenceThresholdDb: -60,
      minSilenceMs: 300,
    },
  },
  restoration: {
    label: "Restoration",
    options: {
      includeClipping: true,
      includeClicks: true,
      includeDcOffset: true,
      includeSilence: true,
      clipCeilingDb: -1,
      clickThreshold: 0.02,
      dcOffsetThresholdDb: -45,
      silenceThresholdDb: -55,
      minSilenceMs: 200,
    },
  },
  strict: {
    label: "Strict",
    options: {
      includeClipping: true,
      includeClicks: true,
      includeDcOffset: true,
      includeSilence: true,
      clipCeilingDb: -6,
      clickThreshold: 0.015,
      dcOffsetThresholdDb: -50,
      silenceThresholdDb: -45,
      minSilenceMs: 150,
    },
  },
} satisfies Record<string, { label: string; options: DiagnosticScanOptions }>;
const DEFAULT_DIAGNOSTIC_OPTIONS = DIAGNOSTIC_SCAN_PROFILES.standard.options;

type DiagnosticScanProfile = keyof typeof DIAGNOSTIC_SCAN_PROFILES | "custom";

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function WaveformEditorView({ timeFormat = "decimal" }: { timeFormat?: TimeFormat }) {
  const store = useStore();
  const state = useEditorState();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState({ w: 800, h: 360 });
  const [spectralGainDb, setSpectralGainDb] = useState(-24);
  const [spectralBrushHardness, setSpectralBrushHardness] = useState(4);
  const [spectralHarmonicCount, setSpectralHarmonicCount] = useState(6);
  const [waveformGainDb, setWaveformGainDb] = useState(3);
  const [diagnosticScanOptions, setDiagnosticScanOptions] = useState<DiagnosticScanOptions>(DEFAULT_DIAGNOSTIC_OPTIONS);
  const [diagnosticScanProfile, setDiagnosticScanProfile] = useState<DiagnosticScanProfile>("standard");
  const [diagnosticSilenceRepairMode, setDiagnosticSilenceRepairMode] = useState<WaveformSilenceRepairMode>("remove");
  const [diagnosticSilenceKeepMs, setDiagnosticSilenceKeepMs] = useState(100);
  const [diagnosticScan, setDiagnosticScan] = useState<DiagnosticScan | null>(null);
  const [activeDiagnosticId, setActiveDiagnosticId] = useState<string | null>(null);

  // Deliberately narrow: `state` changes identity on every store update, and
  // rebuilding the source is expensive. These five fields are what it reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => waveformSource(state), [
    state.project,
    state.selection.clipIds,
    state.selection.range,
    state.activeTrackId,
    state.transport.playhead,
  ]);
  const sourceKey = source
    ? `${source.kind}:${source.title}:${source.timelineStart}:${source.duration}:${frameCount(source.audio)}:${state.project.meta.modified}`
    : "none";
  const diagnostics = useMemo(
    () => (diagnosticScan?.sourceKey === sourceKey ? diagnosticScan.issues : []),
    [diagnosticScan, sourceKey],
  );
  const diagnosticsScanned = diagnosticScan?.sourceKey === sourceKey;
  const activeDiagnostic = useMemo(
    () => diagnostics.find((issue) => issue.id === activeDiagnosticId) ?? diagnostics[0] ?? null,
    [activeDiagnosticId, diagnostics],
  );

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const report = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      store.dispatch(setViewportWidth(el.clientWidth), { history: false });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [store]);

  const pps = state.view.pxPerSecond;
  const maxScroll = source ? Math.max(0, source.duration - size.w / pps) : 0;
  const scrollSec = Math.min(Math.max(0, state.view.scrollSec), maxScroll);
  const fmtOpts = { sampleRate: state.project.sampleRate, tempo: state.project.tempo, timeSignature: state.project.timeSignature };
  const layout = editorLayout(size.w, size.h);
  const spectral = state.selection.spectral;
  const selectedRange = source ? intersectSelection(state.selection.range, source.timelineStart, source.timelineStart + source.duration) : null;
  const hasSelectedRange = !!selectedRange;
  const spectralReadout = spectral
    ? `${spectral.time.start.toFixed(2)}-${spectral.time.end.toFixed(2)}s · ${Math.round(spectral.frequency.minHz)}-${Math.round(spectral.frequency.maxHz)} Hz`
    : "No spectral selection";
  const rangeReadout = selectedRange
    ? `Range ${selectedRange.start.toFixed(2)}-${selectedRange.end.toFixed(2)}s`
    : "No range selection";
  const diagnosticReadout = formatDiagnosticSummary(diagnostics, diagnosticsScanned, activeDiagnostic);
  const applySpectralGain = (gainDb: number, label: string) => {
    store.dispatch(applySpectralSelectionGain(gainDb), { label });
  };
  const applySpectralBrush = (gainDb: number, label: string) => {
    store.dispatch(
      applySpectralBrushSelectionGain(gainDb, { hardness: spectralBrushHardness, frequencyHardness: spectralBrushHardness }),
      { label },
    );
  };
  const applySpectralHarmonics = (gainDb: number, label: string) => {
    store.dispatch(applySpectralHarmonicSelectionGain(gainDb, { harmonics: spectralHarmonicCount }), { label });
  };
  const setSpectralChannel = (channel: SpectralChannel) => {
    if (!spectral) return;
    store.dispatch(selectSpectralRange({ ...spectral, channel }), { history: false });
  };
  const applySampleEdit = (kind: WaveformSampleEditKind, label: string) => {
    if (!source || !selectedRange) return;
    store.dispatch(applyWaveformSampleEdit(kind, source.trackIds, selectedRange), { label });
    setDiagnosticScan(null);
    setActiveDiagnosticId(null);
  };
  const applySampleGain = () => {
    if (!source || !selectedRange) return;
    store.dispatch(applyWaveformRangeGain(waveformGainDb, source.trackIds, selectedRange), { label: "Gain Range" });
    setDiagnosticScan(null);
    setActiveDiagnosticId(null);
  };
  const selectDiagnosticIssue = (issue: AudioDiagnosticIssue) => {
    if (!source) return;
    const range = diagnosticTimelineRange(source, issue);
    setActiveDiagnosticId(issue.id);
    store.dispatch(setPlayhead(range.start), { history: false });
    store.dispatch(selectRange(range, source.trackIds), { history: false });
  };
  const clearDiagnosticScan = () => {
    setDiagnosticScan(null);
    setActiveDiagnosticId(null);
  };
  const setDiagnosticScanPolicy = (kind: "includeClipping" | "includeClicks" | "includeDcOffset" | "includeSilence", checked: boolean) => {
    const next = { ...diagnosticScanOptions, [kind]: checked };
    if (!next.includeClipping && !next.includeClicks && !next.includeDcOffset && !next.includeSilence) return;
    setDiagnosticScanOptions(next);
    setDiagnosticScanProfile("custom");
    clearDiagnosticScan();
  };
  const setDiagnosticScanNumber = (kind: "clipCeilingDb" | "clickThreshold" | "dcOffsetThresholdDb" | "silenceThresholdDb" | "minSilenceMs", value: number) => {
    setDiagnosticScanOptions({ ...diagnosticScanOptions, [kind]: sanitizeDiagnosticScanNumber(kind, value) });
    setDiagnosticScanProfile("custom");
    clearDiagnosticScan();
  };
  const setDiagnosticProfile = (profile: DiagnosticScanProfile) => {
    setDiagnosticScanProfile(profile);
    if (profile !== "custom") setDiagnosticScanOptions(DIAGNOSTIC_SCAN_PROFILES[profile].options);
    clearDiagnosticScan();
  };
  const setDiagnosticSilenceKeep = (value: number) => {
    setDiagnosticSilenceKeepMs(Math.round(clamp(value, 10, 5000)));
  };
  const scanDiagnostics = () => {
    if (!source) return;
    const issues = Analysis.scanAudioDiagnostics(source.audio, {
      includeClipping: diagnosticScanOptions.includeClipping,
      includeClicks: diagnosticScanOptions.includeClicks,
      includeDcOffset: diagnosticScanOptions.includeDcOffset,
      includeSilence: diagnosticScanOptions.includeSilence,
      clipCeiling: dbToGain(diagnosticScanOptions.clipCeilingDb),
      clickThreshold: diagnosticScanOptions.clickThreshold,
      dcOffsetThresholdDb: diagnosticScanOptions.dcOffsetThresholdDb,
      silenceThresholdDb: diagnosticScanOptions.silenceThresholdDb,
      minSilenceMs: diagnosticScanOptions.minSilenceMs,
      maxIssues: 64,
    });
    setDiagnosticScan({ sourceKey, issues });
    setActiveDiagnosticId(issues[0]?.id ?? null);
    if (issues[0]) {
      const range = diagnosticTimelineRange(source, issues[0]);
      store.dispatch(setPlayhead(range.start), { history: false });
      store.dispatch(selectRange(range, source.trackIds), { history: false });
    }
  };
  const stepDiagnostic = () => {
    if (!diagnostics.length) return;
    const current = activeDiagnostic ? diagnostics.findIndex((issue) => issue.id === activeDiagnostic.id) : -1;
    selectDiagnosticIssue(diagnostics[(current + 1) % diagnostics.length]);
  };
  const previewActiveDiagnostic = () => {
    if (!source || !activeDiagnostic) return;
    const range = diagnosticTimelineRange(source, activeDiagnostic);
    setActiveDiagnosticId(activeDiagnostic.id);
    store.dispatch(setPlayhead(range.start), { history: false });
    store.dispatch(selectRange(range, source.trackIds), { history: false });
    store.dispatch(setLoop(range), { history: false });
  };
  const repairActiveDiagnostic = () => {
    if (!source || !activeDiagnostic) return;
    const range = diagnosticTimelineRange(source, activeDiagnostic);
    if (activeDiagnostic.kind === "clipping") {
      store.dispatch(repairClippingRange(range, source.trackIds), { label: "Repair Clipping" });
    } else if (activeDiagnostic.kind === "click") {
      store.dispatch(repairClickRange(range, source.trackIds, { threshold: diagnosticScanOptions.clickThreshold }), { label: "Repair Click" });
    } else if (activeDiagnostic.kind === "dc-offset") {
      store.dispatch(repairDcOffsetRange(range, source.trackIds), { label: "Remove DC Offset" });
    } else {
      store.dispatch(repairSilenceRange(range, source.trackIds, diagnosticSilenceRepairPolicy(diagnosticSilenceRepairMode, diagnosticSilenceKeepMs)), {
        label: diagnosticSilenceRepairMode === "shorten" ? "Shorten Silence" : "Remove Silence",
      });
    }
    setDiagnosticScan(null);
    setActiveDiagnosticId(null);
  };
  const repairAllDiagnostics = () => {
    if (!source || diagnostics.length === 0) return;
    store.dispatch(
      repairDiagnosticIssues(
        diagnostics.map((issue) => ({ kind: issue.kind, range: diagnosticTimelineRange(source, issue) })),
        source.trackIds,
        {},
        {
          clicks: { threshold: diagnosticScanOptions.clickThreshold },
          silence: diagnosticSilenceRepairPolicy(diagnosticSilenceRepairMode, diagnosticSilenceKeepMs),
        },
      ),
      { label: "Repair Diagnostics" },
    );
    setDiagnosticScan(null);
    setActiveDiagnosticId(null);
  };

  const localToX = (seconds: number) => (seconds - scrollSec) * pps;
  const xToLocal = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return clamp(scrollSec + (clientX - rect.left) / pps, 0, source?.duration ?? 0);
  };
  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const yToHz = (y: number) => {
    const nyquist = (source?.audio.sampleRate ?? state.project.sampleRate) / 2;
    return clamp(((layout.spectral.y + layout.spectral.h - y) / Math.max(1, layout.spectral.h)) * nyquist, 0, nyquist);
  };

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
    const waveColor = source?.color ?? accent;

    ctx.fillStyle = "rgba(0,0,0,0.20)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fillRect(0, 0, W, RULER_H);

    if (!source) {
      ctx.fillStyle = text3;
      ctx.font = "12px var(--font-ui, system-ui)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No audio source", W / 2, H / 2);
      return;
    }

    const layout = editorLayout(W, H);
    const visibleStart = scrollSec;
    const visibleEnd = Math.min(source.duration, scrollSec + W / pps);
    drawRuler(ctx, W, visibleStart, pps, text3, stroke);
    drawLaneLabels(ctx, layout, text3);
    drawMarkers(ctx, state, source, localToX, H, waveColor);
    drawWave(ctx, source.audio, visibleStart, visibleEnd, layout.wave, waveColor, stroke);
    drawSpectrogram(ctx, source.audio, visibleStart, visibleEnd, layout.spectral, stroke);
    drawDiagnostics(ctx, diagnostics, activeDiagnostic, source, localToX, [layout.wave, layout.spectral]);
    drawSelection(ctx, state, source, localToX, [layout.wave, layout.spectral], accent);
    drawSpectralSelection(ctx, state, source, localToX, layout.spectral, accent);
    drawPlayhead(ctx, state, source, localToX, H, accent);
  }, [source, state, size, pps, scrollSec, diagnostics, activeDiagnostic]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!source || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { y } = localXY(e);
    const local = xToLocal(e.clientX);
    const time = source.timelineStart + local;

    if (state.tool === "hand") {
      dragRef.current = { kind: "pan", startX: e.clientX, origScroll: scrollSec };
      return;
    }
    if (state.tool === "zoom") {
      store.dispatch(zoomBy(e.altKey ? 1 / 1.5 : 1.5), { history: false });
      return;
    }
    if (state.tool === "marker") {
      store.dispatch(addMarker({ time, name: `Marker ${state.project.markers.length + 1}` }), { label: "Add marker" });
      return;
    }
    if (pointInRect(y, layout.spectral) && (state.tool === "select" || state.tool === "marquee")) {
      store.dispatch(setPlayhead(time), { history: false });
      dragRef.current = { kind: "spectral", anchorLocal: local, anchorHz: yToHz(y) };
      return;
    }
    if (state.tool === "razor" && source.kind === "clip") {
      store.dispatch(splitAtTime(time, source.trackIds), { label: "Split" });
      return;
    }

    store.dispatch(setPlayhead(time), { history: false });
    store.dispatch(selectRange({ start: time, end: time }, source.trackIds), { history: false });
    dragRef.current = { kind: "range", anchorLocal: local };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !source) return;
    if (drag.kind === "pan") {
      const dx = e.clientX - (drag.startX ?? 0);
      store.dispatch(setScroll(clamp((drag.origScroll ?? 0) - dx / pps, 0, maxScroll)), { history: false });
      return;
    }
    if (drag.kind === "spectral") {
      const { y } = localXY(e);
      const local = xToLocal(e.clientX);
      const hz = yToHz(y);
      const a = drag.anchorLocal ?? local;
      const b = drag.anchorHz ?? hz;
      store.dispatch(setPlayhead(source.timelineStart + local), { history: false });
      store.dispatch(
        selectSpectralRange({
          time: { start: source.timelineStart + Math.min(a, local), end: source.timelineStart + Math.max(a, local) },
          frequency: { minHz: Math.min(b, hz), maxHz: Math.max(b, hz) },
          channel: spectral?.channel ?? "all",
        }),
        { history: false },
      );
      return;
    }
    const local = xToLocal(e.clientX);
    const a = drag.anchorLocal ?? local;
    const start = source.timelineStart + Math.min(a, local);
    const end = source.timelineStart + Math.max(a, local);
    store.dispatch(setPlayhead(source.timelineStart + local), { history: false });
    store.dispatch(selectRange({ start, end }, source.trackIds), { history: false });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!source) return;
    if (e.ctrlKey || e.metaKey) {
      store.dispatch(zoomBy(e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM), { history: false });
      return;
    }
    const dx = e.deltaX || e.deltaY;
    store.dispatch(setScroll(clamp(scrollSec + dx / pps, 0, maxScroll)), { history: false });
  };

  return (
    <div className="rh-waveform">
      <div className="rh-waveform-bar">
        <div className="rh-waveform-title">
          <span className="rh-waveform-dot" style={{ background: source?.color ?? "var(--accent-audio)" }} />
          <span>{source?.title ?? "Waveform"}</span>
        </div>
        <div className="rh-waveform-meta">
          {source ? `${source.detail} · ${formatTime(source.duration, timeFormat, fmtOpts)} · ${frameCount(source.audio).toLocaleString()} samples` : "No audio source"}
        </div>
        <div className="rh-waveform-controls">
          <div className="rh-waveform-control-row">
            <span className={`rh-waveform-spectral-readout ${spectral ? "" : "is-empty"}`}>{spectralReadout}</span>
            <input
              className="rh-waveform-gain"
              type="number"
              min={-60}
              max={24}
              step={0.5}
              value={spectralGainDb}
              disabled={!spectral}
              title="Spectral gain"
              onChange={(e) => setSpectralGainDb(clamp(Number(e.target.value), -60, 24))}
            />
            <button
              className="rh-waveform-action"
              disabled={!spectral}
              data-action="spectral-gain"
              onClick={() => applySpectralGain(spectralGainDb, "Spectral Gain")}
            >
              Apply
            </button>
            <button
              className="rh-waveform-action"
              disabled={!spectral}
              data-action="spectral-silence"
              onClick={() => applySpectralGain(-120, "Spectral Silence")}
            >
              Silence
            </button>
            <label className="rh-waveform-diagnostic-profile">
              Ch
              <Select
                size="sm"
                value={spectral?.channel ?? "all"}
                disabled={!spectral}
                title="Spectral channel"
                data-action="spectral-channel"
                options={[
                  { value: "all", label: "All" },
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ]}
                onChange={(v) => setSpectralChannel(v as SpectralChannel)}
              />
            </label>
            <button
              className="rh-waveform-action"
              disabled={!spectral}
              data-action="spectral-brush-gain"
              onClick={() => applySpectralBrush(spectralGainDb, "Spectral Brush Gain")}
            >
              Brush
            </button>
            <button
              className="rh-waveform-action"
              disabled={!spectral}
              data-action="spectral-brush-silence"
              onClick={() => applySpectralBrush(-120, "Spectral Brush Silence")}
            >
              B Silence
            </button>
            <label className="rh-waveform-diagnostic-number">
              B
              <input
                type="number"
                min={0.5}
                max={8}
                step={0.5}
                value={spectralBrushHardness}
                disabled={!spectral}
                title="Spectral brush hardness"
                data-action="spectral-brush-hardness"
                onChange={(e) => setSpectralBrushHardness(clamp(e.currentTarget.valueAsNumber, 0.5, 8))}
              />
            </label>
            <label className="rh-waveform-diagnostic-number">
              H
              <input
                type="number"
                min={2}
                max={16}
                step={1}
                value={spectralHarmonicCount}
                disabled={!spectral}
                title="Harmonic count"
                data-action="spectral-harmonic-count"
                onChange={(e) => setSpectralHarmonicCount(Math.round(clamp(e.currentTarget.valueAsNumber, 2, 16)))}
              />
            </label>
            <button
              className="rh-waveform-action"
              disabled={!spectral}
              data-action="spectral-harmonics-gain"
              onClick={() => applySpectralHarmonics(spectralGainDb, "Spectral Harmonics Gain")}
            >
              Harmonics
            </button>
            <button
              className="rh-waveform-action"
              disabled={!spectral}
              data-action="spectral-harmonics-silence"
              onClick={() => applySpectralHarmonics(-120, "Spectral Harmonics Silence")}
            >
              H Silence
            </button>
          </div>
          <div className="rh-waveform-control-row rh-waveform-diagnostics">
            <span className={`rh-waveform-diagnostic-readout ${diagnostics.length ? "has-issues" : ""}`}>{diagnosticReadout}</span>
            <label className="rh-waveform-diagnostic-profile">
              Profile
              <Select
                size="sm"
                value={diagnosticScanProfile}
                title="Diagnostics scan profile"
                data-action="diagnostics-profile"
                options={[
                  ...Object.entries(DIAGNOSTIC_SCAN_PROFILES).map(([key, profile]) => ({ value: key, label: profile.label })),
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(v) => setDiagnosticProfile(v as DiagnosticScanProfile)}
              />
            </label>
            <label className="rh-waveform-diagnostic-filter">
              <input
                type="checkbox"
                checked={diagnosticScanOptions.includeClipping}
                data-action="diagnostics-include-clipping"
                onChange={(e) => setDiagnosticScanPolicy("includeClipping", e.currentTarget.checked)}
              />
              Clip
            </label>
            <label className="rh-waveform-diagnostic-filter">
              <input
                type="checkbox"
                checked={diagnosticScanOptions.includeSilence}
                data-action="diagnostics-include-silence"
                onChange={(e) => setDiagnosticScanPolicy("includeSilence", e.currentTarget.checked)}
              />
              Silence
            </label>
            <label className="rh-waveform-diagnostic-filter">
              <input
                type="checkbox"
                checked={diagnosticScanOptions.includeClicks}
                data-action="diagnostics-include-clicks"
                onChange={(e) => setDiagnosticScanPolicy("includeClicks", e.currentTarget.checked)}
              />
              Clicks
            </label>
            <label className="rh-waveform-diagnostic-filter">
              <input
                type="checkbox"
                checked={diagnosticScanOptions.includeDcOffset}
                data-action="diagnostics-include-dc-offset"
                onChange={(e) => setDiagnosticScanPolicy("includeDcOffset", e.currentTarget.checked)}
              />
              DC
            </label>
            <label className="rh-waveform-diagnostic-number">
              Clip ≥
              <input
                type="number"
                min={-24}
                max={0}
                step={0.5}
                value={diagnosticScanOptions.clipCeilingDb}
                title="Clipping threshold in dBFS"
                data-action="diagnostics-clip-threshold"
                onChange={(e) => setDiagnosticScanNumber("clipCeilingDb", e.currentTarget.valueAsNumber)}
              />
              dB
            </label>
            <label className="rh-waveform-diagnostic-number">
              Click ≥
              <input
                type="number"
                min={0}
                max={1}
                step={0.005}
                value={diagnosticScanOptions.clickThreshold}
                title="Click residual threshold"
                data-action="diagnostics-click-threshold"
                onChange={(e) => setDiagnosticScanNumber("clickThreshold", e.currentTarget.valueAsNumber)}
              />
            </label>
            <label className="rh-waveform-diagnostic-number">
              DC ≥
              <input
                type="number"
                min={-90}
                max={0}
                step={1}
                value={diagnosticScanOptions.dcOffsetThresholdDb}
                title="DC offset threshold in dBFS"
                data-action="diagnostics-dc-offset-threshold"
                onChange={(e) => setDiagnosticScanNumber("dcOffsetThresholdDb", e.currentTarget.valueAsNumber)}
              />
              dB
            </label>
            <label className="rh-waveform-diagnostic-number">
              Silence ≤
              <input
                type="number"
                min={-90}
                max={0}
                step={1}
                value={diagnosticScanOptions.silenceThresholdDb}
                title="Silence threshold in dBFS"
                data-action="diagnostics-silence-threshold"
                onChange={(e) => setDiagnosticScanNumber("silenceThresholdDb", e.currentTarget.valueAsNumber)}
              />
              dB
            </label>
            <label className="rh-waveform-diagnostic-number">
              Min
              <input
                type="number"
                min={10}
                max={5000}
                step={10}
                value={diagnosticScanOptions.minSilenceMs}
                title="Minimum silence duration in milliseconds"
                data-action="diagnostics-min-silence"
                onChange={(e) => setDiagnosticScanNumber("minSilenceMs", e.currentTarget.valueAsNumber)}
              />
              ms
            </label>
            <label className="rh-waveform-diagnostic-profile">
              Silence fix
              <Select
                size="sm"
                value={diagnosticSilenceRepairMode}
                title="Silence repair policy"
                data-action="diagnostics-silence-repair-mode"
                options={[
                  { value: "remove", label: "Remove" },
                  { value: "shorten", label: "Shorten" },
                ]}
                onChange={(v) => setDiagnosticSilenceRepairMode(v as WaveformSilenceRepairMode)}
              />
            </label>
            {diagnosticSilenceRepairMode === "shorten" && (
              <label className="rh-waveform-diagnostic-number">
                Keep
                <input
                  type="number"
                  min={10}
                  max={5000}
                  step={10}
                  value={diagnosticSilenceKeepMs}
                  title="Silence kept after shortening, in milliseconds"
                  data-action="diagnostics-silence-keep"
                  onChange={(e) => setDiagnosticSilenceKeep(e.currentTarget.valueAsNumber)}
                />
                ms
              </label>
            )}
            <button className="rh-waveform-action" disabled={!source} data-action="diagnostics-scan" onClick={scanDiagnostics}>
              Scan
            </button>
            <button className="rh-waveform-action" disabled={!diagnostics.length} data-action="diagnostics-next" onClick={stepDiagnostic}>
              Next
            </button>
            <button className="rh-waveform-action" disabled={!activeDiagnostic} data-action="diagnostics-preview" onClick={previewActiveDiagnostic}>
              Preview
            </button>
            <button
              className="rh-waveform-action"
              disabled={!activeDiagnostic}
              data-action="diagnostics-repair"
              onClick={repairActiveDiagnostic}
            >
              {activeDiagnostic?.kind === "silence"
                ? diagnosticSilenceRepairMode === "shorten"
                  ? "Shorten"
                  : "Remove"
                : activeDiagnostic?.kind === "dc-offset"
                  ? "Remove DC"
                  : activeDiagnostic?.kind === "click"
                    ? "Repair Click"
                  : "Repair"}
            </button>
            <button
              className="rh-waveform-action"
              disabled={!diagnostics.length}
              data-action="diagnostics-repair-all"
              onClick={repairAllDiagnostics}
            >
              Repair All
            </button>
          </div>
          {diagnostics.length > 0 && (
            <div className="rh-waveform-diagnostic-list" data-diagnostics-count={diagnostics.length}>
              {diagnostics.map((issue, index) => (
                <button
                  key={issue.id}
                  className={`rh-waveform-diagnostic-item ${issue.id === activeDiagnostic?.id ? "is-active" : ""}`}
                  data-action="diagnostics-select"
                  data-diagnostic-index={index}
                  data-diagnostic-kind={issue.kind}
                  onClick={() => selectDiagnosticIssue(issue)}
                >
                  <span>{formatDiagnosticKind(issue)}</span>
                  <span>{formatDiagnosticRange(issue)}</span>
                  <span>{formatDiagnosticDuration(issue)}</span>
                  <span>{issue.sampleCount.toLocaleString()} samples</span>
                  <span>{formatDiagnosticLevel(issue)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="rh-waveform-control-row rh-waveform-sample-edits">
            <span className={`rh-waveform-range-readout ${hasSelectedRange ? "" : "is-empty"}`}>{rangeReadout}</span>
            <input
              className="rh-waveform-gain"
              type="number"
              min={-60}
              max={24}
              step={0.5}
              value={waveformGainDb}
              disabled={!hasSelectedRange}
              title="Waveform range gain"
              data-action="sample-gain-db"
              onChange={(e) => setWaveformGainDb(clamp(e.currentTarget.valueAsNumber, -60, 24))}
            />
            <button className="rh-waveform-action" disabled={!hasSelectedRange} data-action="sample-gain" onClick={applySampleGain}>
              Gain
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-normalize"
              onClick={() => applySampleEdit("normalizePeak", "Normalize Range")}
            >
              Normalize
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-remove-dc"
              onClick={() => applySampleEdit("removeDcOffset", "Remove DC Offset")}
            >
              Remove DC
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-reverse"
              onClick={() => applySampleEdit("reverse", "Reverse Range")}
            >
              Reverse
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-invert"
              onClick={() => applySampleEdit("invertPolarity", "Invert Range")}
            >
              Invert
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-silence"
              onClick={() => applySampleEdit("silence", "Silence Range")}
            >
              Silence
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-fade-in"
              onClick={() => applySampleEdit("fadeIn", "Fade In Range")}
            >
              Fade In
            </button>
            <button
              className="rh-waveform-action"
              disabled={!hasSelectedRange}
              data-action="sample-fade-out"
              onClick={() => applySampleEdit("fadeOut", "Fade Out Range")}
            >
              Fade Out
            </button>
          </div>
        </div>
      </div>
      <div ref={wrapRef} className="rh-waveform-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="rh-waveform-canvas"
          style={{ width: size.w, height: size.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        />
      </div>
    </div>
  );
}

function waveformSource(state: EditorState): WaveformSource | null {
  const selected = state.selection.clipIds.map((id) => clipById(state.project, id)).find((x): x is { clip: Clip; track: Track } => !!x);
  if (selected) return clipSource(selected.clip, selected.track);

  const duration = projectDuration(state.project);
  const activeTrack = state.project.tracks.find((t) => t.id === state.activeTrackId) ?? state.project.tracks[0];
  const atPlayhead = activeTrack?.clips.find((c) => state.transport.playhead >= c.start && state.transport.playhead <= clipEnd(c));
  if (activeTrack && atPlayhead) return clipSource(atPlayhead, activeTrack);

  const firstActive = activeTrack?.clips[0];
  if (activeTrack && firstActive) return clipSource(firstActive, activeTrack);

  for (const track of state.project.tracks) {
    const clip = track.clips[0];
    if (clip) return clipSource(clip, track);
  }

  if (state.selection.range && duration > 0) return mixdownSource(state, duration);
  return duration > 0 ? mixdownSource(state, duration) : null;
}

function clipSource(clip: Clip, track: Track): WaveformSource {
  return {
    kind: "clip",
    title: clip.name,
    detail: track.name,
    color: track.color,
    timelineStart: clip.start,
    duration: clip.duration,
    trackIds: [track.id],
    audio: Ops.renderClip(clip),
  };
}

function mixdownSource(state: EditorState, duration: number): WaveformSource {
  return {
    kind: "mixdown",
    title: state.project.name,
    detail: "Mixdown",
    color: "var(--accent-audio)",
    timelineStart: 0,
    duration,
    trackIds: state.project.tracks.map((t) => t.id),
    audio: Ops.renderProject(state.project),
  };
}

function drawRuler(ctx: CanvasRenderingContext2D, width: number, scrollSec: number, pps: number, text3: string, stroke: string) {
  ctx.fillStyle = text3;
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const step = chooseTickStep(pps);
  for (let t = Math.floor(scrollSec / step) * step; (t - scrollSec) * pps < width; t += step) {
    if (t < 0) continue;
    const x = (t - scrollSec) * pps;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, RULER_H - 8);
    ctx.lineTo(x + 0.5, RULER_H);
    ctx.stroke();
    ctx.fillText(formatTick(t), x + 4, RULER_H / 2);
  }
}

function drawLaneLabels(ctx: CanvasRenderingContext2D, layout: ReturnType<typeof editorLayout>, text3: string) {
  ctx.fillStyle = text3;
  ctx.font = "10px var(--font-ui, system-ui)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Waveform", 8, layout.wave.y + 7);
  ctx.fillText("Spectral Frequency Display", 8, layout.spectral.y + 7);
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  audio: AudioData,
  visibleStart: number,
  visibleEnd: number,
  rect: Rect,
  color: string,
  stroke: string,
) {
  const sr = audio.sampleRate;
  const startFrame = Math.round(visibleStart * sr);
  const endFrame = Math.max(startFrame, Math.round(visibleEnd * sr));
  const visible = sliceFrames(audio, startFrame, endFrame);
  const mono = mixToMono(visible).channels[0] ?? new Float32Array(0);
  const peaks = Analysis.channelPeaks(mono, Math.max(1, Math.floor(rect.w)));
  const top = rect.y + 10;
  const bottom = rect.y + rect.h - 8;
  const center = (top + bottom) / 2;
  const amp = Math.max(1, (bottom - top) / 2);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.moveTo(rect.x, center + 0.5);
  ctx.lineTo(rect.x + rect.w, center + 0.5);
  ctx.stroke();

  ctx.strokeStyle = resolveCanvasColor(ctx, color);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  for (let x = 0; x < peaks.min.length; x++) {
    const y0 = center - peaks.max[x] * amp;
    const y1 = center - peaks.min[x] * amp;
    ctx.moveTo(rect.x + x + 0.5, y0);
    ctx.lineTo(rect.x + x + 0.5, y1);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  audio: AudioData,
  visibleStart: number,
  visibleEnd: number,
  rect: Rect,
  stroke: string,
) {
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const sr = audio.sampleRate;
  const visible = sliceFrames(audio, Math.round(visibleStart * sr), Math.max(0, Math.round(visibleEnd * sr)));
  if (frameCount(visible) === 0 || rect.w <= 0 || rect.h <= 0) return;

  const sg = Analysis.spectrogram(visible, { fftSize: 1024, minDb: -120 });
  if (sg.frames < 1 || sg.bins < 1) return;
  const img = new ImageData(sg.frames, sg.bins);
  const range = Math.max(1, sg.maxDb - sg.minDb);
  for (let f = 0; f < sg.frames; f++) {
    const base = f * sg.bins;
    for (let b = 0; b < sg.bins; b++) {
      const [r, g, bl] = heat((sg.db[base + b] - sg.minDb) / range);
      const px = ((sg.bins - 1 - b) * sg.frames + f) * 4;
      img.data[px] = r;
      img.data[px + 1] = g;
      img.data[px + 2] = bl;
      img.data[px + 3] = 255;
    }
  }
  const off = document.createElement("canvas");
  off.width = sg.frames;
  off.height = sg.bins;
  off.getContext("2d")?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = stroke;
  ctx.globalAlpha = 0.7;
  for (const t of [0.25, 0.5, 0.75]) {
    const y = rect.y + rect.h * t;
    ctx.beginPath();
    ctx.moveTo(rect.x, y + 0.5);
    ctx.lineTo(rect.x + rect.w, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  source: WaveformSource,
  localToX: (seconds: number) => number,
  rects: Rect[],
  accent: string,
) {
  const range = intersectSelection(state.selection.range, source.timelineStart, source.timelineStart + source.duration);
  if (!range) return;
  const x0 = localToX(range.start - source.timelineStart);
  const x1 = localToX(range.end - source.timelineStart);
  const left = Math.min(x0, x1);
  const width = Math.abs(x1 - x0);
  for (const rect of rects) {
    ctx.fillStyle = "rgba(100, 180, 255, 0.16)";
    ctx.fillRect(left, rect.y, width, rect.h);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(left + 0.5, rect.y);
    ctx.lineTo(left + 0.5, rect.y + rect.h);
    ctx.moveTo(left + width + 0.5, rect.y);
    ctx.lineTo(left + width + 0.5, rect.y + rect.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawSpectralSelection(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  source: WaveformSource,
  localToX: (seconds: number) => number,
  rect: Rect,
  accent: string,
) {
  const spectral = state.selection.spectral;
  if (!spectral) return;
  const range = intersectSelection(spectral.time, source.timelineStart, source.timelineStart + source.duration);
  if (!range) return;
  const nyquist = source.audio.sampleRate / 2;
  const minHz = clamp(spectral.frequency.minHz, 0, nyquist);
  const maxHz = clamp(spectral.frequency.maxHz, minHz, nyquist);
  const x0 = localToX(range.start - source.timelineStart);
  const x1 = localToX(range.end - source.timelineStart);
  const y0 = rect.y + (1 - maxHz / nyquist) * rect.h;
  const y1 = rect.y + (1 - minHz / nyquist) * rect.h;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.max(1, Math.abs(x1 - x0));
  const height = Math.max(1, Math.abs(y1 - y0));
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.fillRect(left, top, width, height);
  ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, width - 1), Math.max(1, height - 1));
  ctx.lineWidth = 1;
}

function drawDiagnostics(
  ctx: CanvasRenderingContext2D,
  issues: AudioDiagnosticIssue[],
  active: AudioDiagnosticIssue | null,
  source: WaveformSource,
  localToX: (seconds: number) => number,
  rects: Rect[],
) {
  for (const issue of issues) {
    const range = {
      start: source.timelineStart + issue.start,
      end: source.timelineStart + issue.end,
    };
    const clipped = intersectSelection(range, source.timelineStart, source.timelineStart + source.duration);
    if (!clipped) continue;
    const x0 = localToX(clipped.start - source.timelineStart);
    const x1 = localToX(clipped.end - source.timelineStart);
    const left = Math.min(x0, x1);
    const width = Math.max(1, Math.abs(x1 - x0));
    const isActive = active?.id === issue.id;
    for (const rect of rects) {
      ctx.fillStyle =
        issue.kind === "clipping"
          ? isActive
            ? "rgba(255, 96, 80, 0.24)"
            : "rgba(255, 96, 80, 0.12)"
          : issue.kind === "click"
            ? isActive
              ? "rgba(226, 116, 255, 0.23)"
              : "rgba(226, 116, 255, 0.11)"
          : issue.kind === "dc-offset"
            ? isActive
              ? "rgba(106, 190, 255, 0.22)"
              : "rgba(106, 190, 255, 0.11)"
            : isActive
              ? "rgba(255, 204, 92, 0.20)"
              : "rgba(255, 204, 92, 0.10)";
      ctx.fillRect(left, rect.y, width, rect.h);
      if (isActive) {
        ctx.strokeStyle =
          issue.kind === "clipping"
            ? "rgba(255, 130, 116, 0.88)"
            : issue.kind === "click"
              ? "rgba(234, 150, 255, 0.86)"
            : issue.kind === "dc-offset"
              ? "rgba(128, 207, 255, 0.86)"
              : "rgba(255, 214, 112, 0.82)";
        ctx.strokeRect(left + 0.5, rect.y + 0.5, Math.max(1, width - 1), Math.max(1, rect.h - 1));
      }
    }
  }
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  source: WaveformSource,
  localToX: (seconds: number) => number,
  height: number,
  accent: string,
) {
  const local = state.transport.playhead - source.timelineStart;
  if (local < 0 || local > source.duration) return;
  const x = localToX(local);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, height);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(x - 5, 0);
  ctx.lineTo(x + 5, 0);
  ctx.lineTo(x, 8);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  source: WaveformSource,
  localToX: (seconds: number) => number,
  height: number,
  fallbackColor: string,
) {
  for (const marker of state.project.markers) {
    if (marker.time < source.timelineStart || marker.time > source.timelineStart + source.duration) continue;
    const x = localToX(marker.time - source.timelineStart);
    ctx.strokeStyle = resolveCanvasColor(ctx, marker.color || fallbackColor);
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function intersectSelection(range: EditorState["selection"]["range"], start: number, end: number) {
  if (!range) return null;
  const a = Math.max(start, Math.min(range.start, range.end));
  const b = Math.min(end, Math.max(range.start, range.end));
  return b > a ? { start: a, end: b } : null;
}

function diagnosticTimelineRange(source: WaveformSource, issue: AudioDiagnosticIssue) {
  return {
    start: source.timelineStart + issue.start,
    end: source.timelineStart + issue.end,
  };
}

function formatDiagnosticSummary(issues: AudioDiagnosticIssue[], scanned: boolean, active: AudioDiagnosticIssue | null): string {
  if (!scanned) return "Diagnostics not scanned";
  if (!issues.length) return "No diagnostics issues";
  const clips = issues.filter((issue) => issue.kind === "clipping").length;
  const clicks = issues.filter((issue) => issue.kind === "click").length;
  const dc = issues.filter((issue) => issue.kind === "dc-offset").length;
  const silence = issues.filter((issue) => issue.kind === "silence").length;
  const current = active ? `${formatDiagnosticKind(active)} ${active.start.toFixed(2)}-${active.end.toFixed(2)}s` : "";
  const counts = [`${issues.length} issue${issues.length === 1 ? "" : "s"}`];
  if (clips) counts.push(`${clips} clip`);
  if (clicks) counts.push(`${clicks} click`);
  if (dc) counts.push(`${dc} DC`);
  if (silence) counts.push(`${silence} silence`);
  return current ? `${counts.join(" · ")} · ${current}` : counts.join(" · ");
}

function formatDiagnosticKind(issue: AudioDiagnosticIssue): string {
  if (issue.kind === "clipping") return "Clip";
  if (issue.kind === "click") return "Click";
  if (issue.kind === "dc-offset") return "DC";
  return "Silence";
}

function formatDiagnosticRange(issue: AudioDiagnosticIssue): string {
  return `${issue.start.toFixed(2)}-${issue.end.toFixed(2)}s`;
}

function formatDiagnosticDuration(issue: AudioDiagnosticIssue): string {
  const durationMs = Math.max(1, Math.round((issue.end - issue.start) * 1000));
  return `${durationMs} ms`;
}

function formatDiagnosticLevel(issue: AudioDiagnosticIssue): string {
  return `Pk ${formatDiagnosticDb(issue.peakDb)} · RMS ${formatDiagnosticDb(issue.rmsDb)} · DC ${formatDiagnosticDb(issue.dcOffsetDb)}`;
}

function formatDiagnosticDb(db: number): string {
  const safe = Number.isFinite(db) ? clamp(db, -120, 24) : -120;
  return `${safe.toFixed(1)} dB`;
}

function diagnosticSilenceRepairPolicy(mode: WaveformSilenceRepairMode, keepMs: number) {
  return { mode, keepMs: Math.round(clamp(keepMs, 10, 5000)) };
}

function sanitizeDiagnosticScanNumber(kind: "clipCeilingDb" | "clickThreshold" | "dcOffsetThresholdDb" | "silenceThresholdDb" | "minSilenceMs", value: number): number {
  if (kind === "clipCeilingDb") return clamp(Math.round(clamp(value, -24, 0) * 2) / 2, -24, 0);
  if (kind === "clickThreshold") return Math.round(clamp(value, 0, 1) * 1000) / 1000;
  if (kind === "dcOffsetThresholdDb") return Math.round(clamp(value, -90, 0));
  if (kind === "silenceThresholdDb") return Math.round(clamp(value, -90, 0));
  return Math.round(clamp(value, 10, 5000));
}

function chooseTickStep(pps: number): number {
  const targetPx = 90;
  const raw = targetPx / Math.max(1, pps);
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 5, 10]) {
    const step = m * pow;
    if (step >= raw) return step;
  }
  return pow * 10;
}

function formatTick(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function resolveCanvasColor(ctx: CanvasRenderingContext2D, color: string): string {
  if (!color.startsWith("var(")) return color;
  const canvas = ctx.canvas;
  const name = color.slice(4, -1).trim();
  return cssVar(canvas, name, "oklch(0.78 0.13 200)");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function editorLayout(width: number, height: number): { wave: Rect; spectral: Rect } {
  const contentY = RULER_H;
  const contentH = Math.max(1, height - RULER_H);
  const available = Math.max(1, contentH - LANE_GAP);
  const minSpectral = Math.min(MIN_SPECTRAL_H, Math.max(1, available - 1));
  const maxSpectral = Math.max(1, available - 70);
  const spectralH = clamp(Math.round(available * 0.42), Math.min(minSpectral, maxSpectral), Math.max(minSpectral, maxSpectral));
  const waveH = Math.max(1, available - spectralH);
  return {
    wave: { x: 0, y: contentY, w: width, h: waveH },
    spectral: { x: 0, y: contentY + waveH + LANE_GAP, w: width, h: spectralH },
  };
}

function pointInRect(y: number, rect: Rect): boolean {
  return y >= rect.y && y <= rect.y + rect.h;
}

/** dB-normalized value (0...1) to a compact spectral heat colour. */
function heat(t: number): [number, number, number] {
  const x = clamp(t, 0, 1);
  const stops: [number, [number, number, number]][] = [
    [0, [8, 10, 40]],
    [0.35, [30, 60, 200]],
    [0.6, [40, 200, 200]],
    [0.8, [235, 220, 40]],
    [1, [255, 255, 255]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (x <= b) {
      const u = (x - a) / (b - a || 1);
      return [Math.round(ca[0] + (cb[0] - ca[0]) * u), Math.round(ca[1] + (cb[1] - ca[1]) * u), Math.round(ca[2] + (cb[2] - ca[2]) * u)];
    }
  }
  return [255, 255, 255];
}
