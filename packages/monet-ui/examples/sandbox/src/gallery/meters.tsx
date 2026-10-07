// Component-gallery demos — Creative ▸ Meters.
// Mocked measurement / analysis widgets: a Photoshop-style Histogram, a DAW
// LevelMeter + ChannelStrip, and a Spectrum analyzer. Pure-display widgets
// (Histogram / LevelMeter / Spectrum) take mock data; ChannelStrip is wrapped
// in a controlled demo so its fader + M/S/R toggles actually respond. The
// meters gently animate from a mock source via setInterval so the panels feel
// live. Each demo is a normal function component (hooks are fine here — never
// in a GalleryEntry.render(), which is a bare call, not a mounted component).
import { useEffect, useRef, useState } from "react";
import {
  Histogram,
  LevelMeter,
  ChannelStrip,
  Spectrum,
  type HistogramSeries,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// ─── shared mock-data helpers ──────────────────────────────────

/** A smooth bell curve, one value 0..1 per bin — stands in for a luminance /
 *  channel histogram. `center`/`spread` shape where the mass sits. */
function bell(n: number, center: number, spread: number, peak = 1): number[] {
  return Array.from({ length: n }, (_, i) =>
    peak * Math.exp(-(((i - center) ** 2) / (2 * spread * spread))),
  );
}

/** A mock spectrum: a sloped noise floor with a few resonant peaks, 0..1. */
function mockSpectrum(n: number, t: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    const floor = (1 - f) * 0.5 + 0.05;
    const wobble = 0.12 * Math.sin(f * 22 + t) * Math.sin(f * 7 - t * 0.6);
    const peakA = 0.4 * Math.exp(-(((f - 0.18) ** 2) / 0.0009));
    const peakB = 0.3 * Math.exp(-(((f - 0.52) ** 2) / 0.002));
    return Math.max(0, Math.min(1, floor * 0.6 + wobble + peakA + peakB));
  });
}

/** Drive a slowly bouncing 0..1 level off a sine, with a lagging peak-hold. */
function useBouncingLevel(speed: number, base: number, swing: number) {
  const [value, setValue] = useState(base);
  const peak = useRef(base);
  const [, force] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - start) / 1000;
      const v = Math.max(
        0,
        Math.min(1, base + swing * (0.6 * Math.sin(t * speed) + 0.4 * Math.sin(t * speed * 2.3 + 1))),
      );
      setValue(v);
      peak.current = v > peak.current ? v : Math.max(v, peak.current - 0.01);
      force((n) => n + 1);
    }, 120);
    return () => window.clearInterval(id);
  }, [speed, base, swing]);
  return { value, peak: peak.current };
}

// ─── Histogram ─────────────────────────────────────────────────

const LUMA = bell(56, 30, 11, 1);
const HISTO_SERIES: HistogramSeries[] = [
  { data: bell(56, 22, 9, 0.85), color: "#ff5b5b" },
  { data: bell(56, 30, 10, 0.9), color: "#5bff7a" },
  { data: bell(56, 38, 8, 0.8), color: "#5b8bff" },
];

function HistogramDemo() {
  return (
    <div style={{ padding: 6 }}>
      <Histogram
        data={LUMA}
        series={HISTO_SERIES}
        height={120}
        stats={[
          { label: "Mean", value: "138.2" },
          { label: "Std dev", value: "41.7" },
          { label: "Pixels", value: "11.2M" },
        ]}
      />
    </div>
  );
}

// ─── LevelMeter ────────────────────────────────────────────────

function LevelMeterDemo() {
  const l = useBouncingLevel(2.1, 0.62, 0.3);
  const r = useBouncingLevel(2.6, 0.58, 0.32);
  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        justifyContent: "center",
        padding: 8,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <LevelMeter value={l.value} peak={l.peak} label="L" aria-label="Left level" />
      <LevelMeter value={r.value} peak={r.peak} label="R" aria-label="Right level" />
      <LevelMeter
        value={0}
        channels={[0.74, 0.66, 0.81, 0.59]}
        orientation="horizontal"
        label="Bus"
        style={{ width: 120 }}
        aria-label="Bus levels"
      />
    </div>
  );
}

// ─── ChannelStrip ──────────────────────────────────────────────

/** Interactive: the fader + M/S/R toggles are controlled from local state, so
 *  they respond to the user, while the embedded meter animates off a mock feed. */
function ChannelStripDemo() {
  const [vol, setVol] = useState(0.72);
  const [mute, setMute] = useState(false);
  const [solo, setSolo] = useState(false);
  const [record, setRecord] = useState(true);
  const { value: meter } = useBouncingLevel(2.4, 0.58, 0.34);
  const db = vol <= 0 ? "−∞ dB" : `${(20 * Math.log10(vol)).toFixed(1)} dB`;
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 6, height: "100%", boxSizing: "border-box" }}>
      <ChannelStrip
        name="Drums"
        color="#d9a45b"
        meter={mute ? 0 : meter}
        dbLabel={db}
        volume={vol}
        onVolumeChange={setVol}
        mute={mute}
        onMuteChange={setMute}
        solo={solo}
        onSoloChange={setSolo}
        record={record}
        onRecordChange={setRecord}
      />
    </div>
  );
}

// ─── Spectrum ──────────────────────────────────────────────────

function SpectrumDemo() {
  const [data, setData] = useState(() => mockSpectrum(64, 0));
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      setData(mockSpectrum(64, (performance.now() - start) / 1000));
    }, 120);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div style={{ padding: 6 }}>
      <Spectrum data={data} freqLabels={["20", "200", "2k", "20k"]} />
    </div>
  );
}

// ─── catalog ───────────────────────────────────────────────────

export const metersEntries: GalleryEntry[] = [
  { id: "meters/Histogram", label: "Histogram", category: "Meters", section: "Creative", render: () => <HistogramDemo /> },
  { id: "meters/LevelMeter", label: "LevelMeter", category: "Meters", section: "Creative", render: () => <LevelMeterDemo /> },
  { id: "meters/ChannelStrip", label: "ChannelStrip", category: "Meters", section: "Creative", render: () => <ChannelStripDemo /> },
  { id: "meters/Spectrum", label: "Spectrum", category: "Meters", section: "Creative", render: () => <SpectrumDemo /> },
];
