// ─────────────────────────────────────────────────────────────
// ui/analyze-panel — levels, loudness & spectrum of the current scope
// ─────────────────────────────────────────────────────────────
// Measurement is on-demand (a button) because mixing/rendering the scope can be
// non-trivial. The scope is the selected range, else the selected clip, else
// the whole mixdown.

import { useEffect, useRef, useState } from "react";
import { Button, ScrubbyNumber } from "@monet-ui/monet-react";
import * as E from "../engine";
import { useEditorState, useStore } from "../state/store-context";
import { dbLabel } from "./format";

const accent = "var(--accent-audio)";

interface Report {
  levels: E.Analysis.LevelStats;
  loudness: E.Analysis.LoudnessResult;
  truePeak: E.Analysis.TruePeakResult;
  clipping: E.Analysis.ClipReport;
  spectrum: E.Analysis.SpectrumResult;
  stats: E.Analysis.AmplitudeStatistics;
  phase: E.Analysis.PhaseAnalysis;
  spectrogram: E.Analysis.SpectrogramResult;
  vectorscope: E.Analysis.VectorscopeResult;
  pitch: E.Analysis.PitchResult;
  loudnessSeries: E.Analysis.LoudnessTimeSeries;
  histogram: E.Analysis.AmplitudeHistogramResult;
}

function scopeAudio(state: E.EditorState): E.AudioData {
  const sr = state.project.sampleRate;
  if (state.selection.range) {
    const mix = E.Ops.renderProject(state.project);
    return E.sliceFrames(mix, Math.round(state.selection.range.start * sr), Math.round(state.selection.range.end * sr));
  }
  const id = state.selection.clipIds[0];
  if (id) {
    const found = E.clipById(state.project, id);
    if (found) return E.Ops.renderClip(found.clip);
  }
  return E.Ops.renderProject(state.project);
}

function scopeTimeRange(state: E.EditorState): E.TimeRange | null {
  if (state.selection.range && state.selection.range.end > state.selection.range.start) return state.selection.range;
  const id = state.selection.clipIds[0];
  if (id) {
    const found = E.clipById(state.project, id);
    if (found) return { start: found.clip.start, end: found.clip.start + found.clip.duration };
  }
  const end = E.projectDuration(state.project);
  return end > 0 ? { start: 0, end } : null;
}

export function AnalyzePanel() {
  const store = useStore();
  const st = useEditorState();
  const [report, setReport] = useState<Report | null>(null);
  const analyzePrefs = E.normalizePanelPreferences(st.project.panelPreferences, st.project.sampleRate).analyze;
  const spectralMinHz = analyzePrefs.spectralMinHz;
  const spectralMaxHz = analyzePrefs.spectralMaxHz;
  const spectralGainDb = analyzePrefs.spectralGainDb;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectroRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const loudnessRef = useRef<HTMLCanvasElement>(null);
  const histogramRef = useRef<HTMLCanvasElement>(null);

  const analyze = () => {
    const audio = scopeAudio(store.getState());
    if (E.frameCount(audio) === 0) {
      setReport(null);
      return;
    }
    setReport({
      levels: E.Analysis.analyzeLevels(audio),
      loudness: E.Analysis.measureLoudness(audio),
      truePeak: E.Analysis.measureTruePeak(audio),
      clipping: E.Analysis.detectClipping(audio),
      spectrum: E.Analysis.spectrum(audio, { fftSize: 4096, window: "hann" }),
      stats: E.Analysis.amplitudeStatistics(audio),
      phase: E.Analysis.phaseAnalysis(audio),
      spectrogram: E.Analysis.spectrogram(audio, { fftSize: 1024, hop: 512, minDb: -90 }),
      vectorscope: E.Analysis.vectorscope(audio, { maxPoints: 4000 }),
      pitch: E.Analysis.detectPitch(audio),
      loudnessSeries: E.Analysis.loudnessTimeSeries(audio),
      histogram: E.Analysis.amplitudeHistogram(audio, { minDb: -90, binDb: 1 }),
    });
  };

  const setSpectralSelection = () => {
    const state = store.getState();
    const time = scopeTimeRange(state);
    if (!time) return;
    store.dispatch(E.selectSpectralRange({ time, frequency: { minHz: spectralMinHz, maxHz: spectralMaxHz }, channel: "all" }), {
      history: false,
    });
  };

  const applySpectralGain = (gainDb: number, label: string) => {
    store.dispatch(E.applySpectralSelectionGain(gainDb), { label });
    setReport(null);
  };

  const setAnalyzePrefs = (patch: Partial<E.AnalyzePanelPreferences>, label: string) => {
    store.dispatch(E.setProjectPanelPreferences({ analyze: patch }), { history: false, dirty: true, label });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !report) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 240;
    const H = 120;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, W, H);
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#5fb0ff";
    const { freqs, db } = report.spectrum;
    const fMin = 20;
    const fMax = report.spectrum.fftSize ? Math.min(20000, freqs[freqs.length - 1]) : 20000;
    const xOf = (f: number) => (Math.log10(Math.max(fMin, f) / fMin) / Math.log10(fMax / fMin)) * W;
    const yOf = (d: number) => {
      const top = 6;
      const bottom = -90;
      const clamped = Math.max(bottom, Math.min(top, d));
      return (1 - (clamped - bottom) / (top - bottom)) * H;
    };
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 1; i < freqs.length; i++) {
      if (freqs[i] < fMin) continue;
      ctx.lineTo(xOf(freqs[i]), yOf(db[i]));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = "color-mix(in oklch, " + accent + " 30%, transparent)";
    try {
      ctx.fill();
    } catch {
      ctx.fillStyle = "rgba(95,176,255,0.3)";
      ctx.fill();
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let i = 1; i < freqs.length; i++) {
      if (freqs[i] < fMin) continue;
      const x = xOf(freqs[i]);
      const y = yOf(db[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Peak-hold ("Hold") overlay — the loudest each bin ever got, drawn dimmer.
    const peakDb = report.spectrum.peakDb;
    if (peakDb) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      let startedPeak = false;
      for (let i = 1; i < freqs.length; i++) {
        if (freqs[i] < fMin) continue;
        const x = xOf(freqs[i]);
        const y = yOf(peakDb[i]);
        if (!startedPeak) {
          ctx.moveTo(x, y);
          startedPeak = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [report]);

  // Spectral Frequency Display: paint the STFT magnitude matrix as a heat-map.
  useEffect(() => {
    const canvas = spectroRef.current;
    if (!canvas || !report) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sg = report.spectrogram;
    const cols = sg.frames;
    const rows = sg.bins;
    if (cols < 1 || rows < 1) return;
    const img = new ImageData(cols, rows);
    const range = Math.max(1, sg.maxDb - sg.minDb);
    for (let f = 0; f < cols; f++) {
      const base = f * sg.bins;
      for (let b = 0; b < rows; b++) {
        const [r, g, bl] = heat((sg.db[base + b] - sg.minDb) / range);
        const px = ((rows - 1 - b) * cols + f) * 4; // invert Y so treble is at the top
        img.data[px] = r;
        img.data[px + 1] = g;
        img.data[px + 2] = bl;
        img.data[px + 3] = 255;
      }
    }
    const off = document.createElement("canvas");
    off.width = cols;
    off.height = rows;
    off.getContext("2d")?.putImageData(img, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 240;
    const H = 120;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, 0, 0, W, H);

    const spectral = st.selection.spectral;
    const scope = scopeTimeRange(st);
    if (spectral && scope && scope.end > scope.start) {
      const start = Math.max(scope.start, spectral.time.start);
      const end = Math.min(scope.end, spectral.time.end);
      if (end > start) {
        const nyquist = sg.sampleRate / 2;
        const minHz = Math.max(0, Math.min(nyquist, spectral.frequency.minHz));
        const maxHz = Math.max(minHz, Math.min(nyquist, spectral.frequency.maxHz));
        const x = ((start - scope.start) / (scope.end - scope.start)) * W;
        const w = ((end - start) / (scope.end - scope.start)) * W;
        const yTop = H - (maxHz / nyquist) * H;
        const yBottom = H - (minHz / nyquist) * H;
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.strokeStyle = "rgba(255,255,255,0.88)";
        ctx.lineWidth = 1;
        ctx.fillRect(x, yTop, w, Math.max(1, yBottom - yTop));
        ctx.strokeRect(x + 0.5, yTop + 0.5, Math.max(1, w - 1), Math.max(1, yBottom - yTop - 1));
      }
    }
  }, [report, st]);

  // Phase Scope / goniometer: plot the L-vs-R point cloud with phase guides.
  useEffect(() => {
    const canvas = scopeRef.current;
    if (!canvas || !report) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const vs = report.vectorscope;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 120;
    const H = 140;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const r = (H / 2) * 0.92;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); // vertical = mono
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); // horizontal = anti-phase
    ctx.moveTo(cx - r * 0.7, cy + r * 0.7); ctx.lineTo(cx + r * 0.7, cy - r * 0.7); // L
    ctx.moveTo(cx - r * 0.7, cy - r * 0.7); ctx.lineTo(cx + r * 0.7, cy + r * 0.7); // R
    ctx.stroke();
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#5fb0ff";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = accent;
    for (let i = 0; i < vs.count; i++) ctx.fillRect(cx + vs.x[i] * r, cy - vs.y[i] * r, 1, 1); // +y up
    ctx.globalAlpha = 1;
  }, [report]);

  // Loudness Radar: momentary + short-term loudness over time, with the integrated line.
  useEffect(() => {
    const canvas = loudnessRef.current;
    if (!canvas || !report) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 240;
    const H = 100;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, W, H);
    const { momentary, shortTerm, integrated } = report.loudnessSeries;
    const top = 0;
    const bottom = -40; // LUFS range shown
    const tMax = Math.max(0.001, momentary.times[momentary.times.length - 1] ?? 1);
    const xOf = (t: number) => (t / tMax) * W;
    const yOf = (l: number) => (1 - (Math.max(bottom, Math.min(top, l)) - bottom) / (top - bottom)) * H;
    const line = (series: { times: number[]; lufs: number[] }, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < series.lufs.length; i++) {
        if (!Number.isFinite(series.lufs[i])) { started = false; continue; }
        const x = xOf(series.times[i]);
        const y = yOf(series.lufs[i]);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#5fb0ff";
    if (Number.isFinite(integrated)) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yOf(integrated));
      ctx.lineTo(W, yOf(integrated));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    line(shortTerm, "rgba(255,255,255,0.45)", 1); // short-term, dim
    line(momentary, accent, 1.25); // momentary, accent
  }, [report]);

  // Amplitude histogram: bars of the dBFS distribution (count on a sqrt scale).
  useEffect(() => {
    const canvas = histogramRef.current;
    if (!canvas || !report) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 240;
    const H = 90;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, W, H);
    const { counts } = report.histogram;
    const n = counts.length;
    if (n < 1) return;
    const max = Math.max(1, ...counts);
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#5fb0ff";
    ctx.fillStyle = accent;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const h = Math.sqrt(counts[i] / max) * (H - 2); // sqrt so quiet bins are visible
      if (h <= 0) continue;
      ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h); // low dB at left, 0 dBFS at right
    }
  }, [report]);

  const scopeLabel = st.selection.range ? "selected range" : st.selection.clipIds[0] ? "selected clip" : "full mix";
  const nyquist = st.project.sampleRate / 2;
  const spectral = st.selection.spectral;

  return (
    <div className="rh-panel">
      <div className="rh-row-actions">
        <Button size="sm" variant="primary" onClick={analyze}>Analyze {scopeLabel}</Button>
      </div>
      {!report && <div className="rh-empty">Press Analyze to measure</div>}
      {report && (
        <>
          <div className="rh-meter-grid">
            <Stat label="Peak" value={dbLabel(report.levels.peakDb)} />
            <Stat label="RMS" value={dbLabel(report.levels.rmsDb)} />
            <Stat label="Loudness" value={Number.isFinite(report.loudness.integrated) ? `${report.loudness.integrated.toFixed(1)} LUFS` : "−∞ LUFS"} />
            <Stat label="True Peak" value={Number.isFinite(report.truePeak.dBTP) ? `${report.truePeak.dBTP.toFixed(1)} dBTP` : "−∞ dBTP"} warn={report.truePeak.dBTP > -1} />
            <Stat label="Short-term" value={Number.isFinite(report.loudness.shortTermMax) ? `${report.loudness.shortTermMax.toFixed(1)} LUFS` : "−∞ LUFS"} />
            <Stat label="DC Offset" value={report.levels.dcOffset.toFixed(4)} />
            <Stat label="Clipped" value={`${report.clipping.count}`} warn={report.clipping.count > 0} />
            <Stat label="Range" value={`${report.loudness.range.toFixed(1)} LU`} />
            <Stat
              label="Pitch"
              value={
                report.pitch.confidence > 0.6 && report.pitch.hz > 0
                  ? `${report.pitch.note}${report.pitch.octave} ${report.pitch.cents >= 0 ? "+" : ""}${report.pitch.cents}¢`
                  : "—"
              }
            />
          </div>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Amplitude Statistics</div>
          <div className="rh-meter-grid">
            <Stat label="Min Sample" value={report.stats.overall.minSample.toFixed(4)} />
            <Stat label="Max Sample" value={report.stats.overall.maxSample.toFixed(4)} />
            <Stat label="Max RMS" value={dbLabel(report.stats.overall.maxRmsDb)} />
            <Stat label="Min RMS" value={dbLabel(report.stats.overall.minRmsDb)} />
            <Stat label="Avg RMS" value={dbLabel(report.stats.overall.averageRmsDb)} />
            <Stat label="Dynamic Range" value={`${report.stats.overall.dynamicRangeDb.toFixed(1)} dB`} />
            <Stat label="Possibly Clipped" value={`${report.stats.overall.possiblyClippedSamples}`} warn={report.stats.overall.possiblyClippedSamples > 0} />
            <Stat label="DC Offset" value={dbLabel(report.stats.overall.dcOffsetDb)} />
          </div>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Phase Analysis</div>
          {report.phase.stereo ? (
            <div className="rh-meter-grid">
              <Stat label="Correlation" value={report.phase.correlation.toFixed(2)} warn={report.phase.correlation < 0} />
              <Stat label="Width" value={report.phase.width.toFixed(2)} />
              <Stat label="Balance" value={report.phase.balance === 0 ? "C" : `${report.phase.balance < 0 ? "L" : "R"} ${Math.abs(report.phase.balance * 100).toFixed(0)}%`} />
              <Stat label="Mono Compat" value={report.phase.monoCompatibility.toFixed(2)} warn={report.phase.monoCompatibility < 0.5} />
            </div>
          ) : (
            <div className="rh-empty">Mono — no phase to compare</div>
          )}
          <div className="monet-section-label" style={{ marginTop: 8 }}>Spectrum</div>
          <canvas ref={canvasRef} className="rh-spectrum" style={{ width: "100%", height: 120 }} />
          <div className="rh-spectrum-axis">
            <span>20</span><span>100</span><span>1k</span><span>10k</span><span>20k</span>
          </div>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Phase Scope</div>
          <canvas ref={scopeRef} className="rh-spectrum" style={{ width: "100%", height: 140 }} />
          <div className="monet-section-label" style={{ marginTop: 8 }}>Spectral Frequency Display</div>
          <canvas ref={spectroRef} className="rh-spectrum" style={{ width: "100%", height: 120 }} />
          <div className="rh-fx-param" style={{ marginTop: 6 }}>
            <ScrubbyNumber value={spectralMinHz} min={0} max={nyquist} step={10} suffix="Hz" accent={accent} onChange={(v) => setAnalyzePrefs({ spectralMinHz: v }, "Analyze spectral min")} />
            <ScrubbyNumber value={spectralMaxHz} min={0} max={nyquist} step={10} suffix="Hz" accent={accent} onChange={(v) => setAnalyzePrefs({ spectralMaxHz: v }, "Analyze spectral max")} />
            <Button size="sm" onClick={setSpectralSelection}>Set</Button>
          </div>
          <div className="rh-fx-param">
            <ScrubbyNumber value={spectralGainDb} min={-60} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setAnalyzePrefs({ spectralGainDb: v }, "Analyze spectral gain")} />
            <Button size="sm" disabled={!spectral} onClick={() => applySpectralGain(spectralGainDb, "Spectral Gain")}>Apply</Button>
            <Button size="sm" disabled={!spectral} onClick={() => applySpectralGain(-120, "Spectral Silence")}>Silence</Button>
          </div>
          {spectral && (
            <div className="rh-scope">
              {spectral.time.start.toFixed(2)}–{spectral.time.end.toFixed(2)}s · {Math.round(spectral.frequency.minHz)}–{Math.round(spectral.frequency.maxHz)} Hz
            </div>
          )}
          <div className="monet-section-label" style={{ marginTop: 8 }}>Loudness Over Time (0 … −40 LUFS)</div>
          <canvas ref={loudnessRef} className="rh-spectrum" style={{ width: "100%", height: 100 }} />
          <div className="monet-section-label" style={{ marginTop: 8 }}>Amplitude Histogram (−90 … 0 dBFS)</div>
          <canvas ref={histogramRef} className="rh-spectrum" style={{ width: "100%", height: 90 }} />
        </>
      )}
    </div>
  );
}

/** dB-normalized value (0…1) → an Audition-style blue→cyan→yellow→white heat colour. */
function heat(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0.0, [8, 10, 40]],
    [0.35, [30, 60, 200]],
    [0.6, [40, 200, 200]],
    [0.8, [235, 220, 40]],
    [1.0, [255, 255, 255]],
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

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rh-stat">
      <span className="rh-stat-lbl">{label}</span>
      <span className="rh-stat-val" style={warn ? { color: "oklch(0.72 0.2 30)" } : undefined}>{value}</span>
    </div>
  );
}
