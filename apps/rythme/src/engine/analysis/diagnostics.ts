// ─────────────────────────────────────────────────────────────
// engine/analysis/diagnostics — waveform-editor scan issues
// ─────────────────────────────────────────────────────────────
// Audition's Diagnostics panel is a scan-first workflow. These pure helpers
// identify concrete source ranges the UI can select, preview, and repair.

import { dbToGain, gainToDb } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import type { Seconds } from "../model/types";
import { detectSilence } from "./detect";

export type AudioDiagnosticKind = "clipping" | "click" | "dc-offset" | "silence";

export interface AudioDiagnosticIssue {
  id: string;
  kind: AudioDiagnosticKind;
  start: Seconds;
  end: Seconds;
  sampleCount: number;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  dcOffset: number;
  dcOffsetDb: number;
}

export interface AudioDiagnosticsOptions {
  /** Include flat clipped plateaus. Default true. */
  includeClipping?: boolean;
  /** Include short impulsive clicks/pops. Default false. */
  includeClicks?: boolean;
  /** Include full-source DC offset issues. Default true. */
  includeDcOffset?: boolean;
  /** Include long silent ranges. Default true. */
  includeSilence?: boolean;
  /** Samples at/above this absolute level are clipping candidates. Default 0.999969. */
  clipCeiling?: number;
  /** Consecutive samples within this delta count as a flat plateau. Default 1e-4. */
  flatnessEps?: number;
  /** Shortest flat plateau to report. Default 5 samples. */
  minClipRunSamples?: number;
  /** Merge nearby clipped plateaus into one issue. Default 50 ms. */
  mergeClipGapMs?: number;
  /** Add context around clipped plateaus. Default 2 ms. */
  clipPaddingMs?: number;
  /** Local-prediction residual floor for click detection. Default 0.02. */
  clickThreshold?: number;
  /** Residual must exceed sensitivity x median residual. Default 5. */
  clickSensitivity?: number;
  /** Longest click run to report. Default 16 samples. */
  maxClickRunSamples?: number;
  /** Merge nearby click runs into one issue. Default 5 ms. */
  mergeClickGapMs?: number;
  /** Add context around click runs. Default 2 ms. */
  clickPaddingMs?: number;
  /** Channel DC offset at/above this dBFS magnitude is reported. Default -40. */
  dcOffsetThresholdDb?: number;
  /** Silence threshold in dBFS. Default -60. */
  silenceThresholdDb?: number;
  /** Shortest silence range to report. Default 300 ms. */
  minSilenceMs?: number;
  /** Cap result count to keep UI lists bounded. Default 128. */
  maxIssues?: number;
}

interface RawIssue {
  kind: AudioDiagnosticKind;
  start: number;
  end: number;
  sampleCount: number;
}

export function scanAudioDiagnostics(d: AudioData, opts: AudioDiagnosticsOptions = {}): AudioDiagnosticIssue[] {
  const sr = Number.isFinite(d.sampleRate) && d.sampleRate > 0 ? d.sampleRate : 44100;
  const frames = frameCount(d);
  if (frames <= 0) return [];

  const issues: RawIssue[] = [];
  if (opts.includeClipping !== false) issues.push(...detectFlatClipping(d, opts, sr));
  if (opts.includeClicks === true) issues.push(...detectClicks(d, opts, sr));
  if (opts.includeDcOffset !== false) issues.push(...detectDcOffset(d, opts, sr));
  if (opts.includeSilence !== false) {
    const minSilenceSec = finiteOr(opts.minSilenceMs, 300) / 1000;
    const silence = detectSilence(d, finiteOr(opts.silenceThresholdDb, -60), minSilenceSec);
    for (const range of silence) {
      const start = clamp(range.start, 0, frames / sr);
      const end = clamp(range.end, start, frames / sr);
      if (end > start) issues.push({ kind: "silence", start, end, sampleCount: Math.round((end - start) * sr) });
    }
  }

  const maxIssues = Math.max(1, Math.floor(finiteOr(opts.maxIssues, 128)));
  return issues
    .sort((a, b) => a.start - b.start || rankKind(a.kind) - rankKind(b.kind))
    .slice(0, maxIssues)
    .map((issue, index) => {
      const metrics = measureIssue(d, issue, sr, frames);
      return {
        id: `${issue.kind}-${index + 1}-${Math.round(issue.start * 1000)}`,
        kind: issue.kind,
        start: issue.start,
        end: issue.end,
        sampleCount: issue.sampleCount,
        ...metrics,
      };
    });
}

function detectClicks(d: AudioData, opts: AudioDiagnosticsOptions, sr: number): RawIssue[] {
  const frames = frameCount(d);
  const duration = frames / sr;
  if (frames < 3) return [];
  const sensitivity = Math.max(0, finiteOr(opts.clickSensitivity, 5));
  const floor = Math.max(0, finiteOr(opts.clickThreshold, 0.02));
  const maxRun = Math.max(1, Math.floor(finiteOr(opts.maxClickRunSamples, 16)));
  const pad = Math.max(0, finiteOr(opts.clickPaddingMs, 2)) / 1000;
  const raw: RawIssue[] = [];

  for (const ch of d.channels) {
    const n = Math.min(frames, ch.length);
    if (n < 3) continue;
    const residual = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) residual[i] = Math.abs(ch[i] - (ch[i - 1] + ch[i + 1]) / 2);
    const threshold = Math.max(floor, sensitivity * median(residual));

    let i = 1;
    while (i < n - 1) {
      if (residual[i] <= threshold) {
        i++;
        continue;
      }
      const runStart = i;
      while (i < n - 1 && residual[i] > threshold) i++;
      const runEnd = i - 1;
      const len = runEnd - runStart + 1;
      if (len <= maxRun) {
        raw.push({
          kind: "click",
          start: clamp(runStart / sr - pad, 0, duration),
          end: clamp((runEnd + 1) / sr + pad, 0, duration),
          sampleCount: len,
        });
      }
    }
  }

  return mergeNearbyIssues(raw, Math.max(0, finiteOr(opts.mergeClickGapMs, 5)) / 1000);
}

function detectDcOffset(d: AudioData, opts: AudioDiagnosticsOptions, sr: number): RawIssue[] {
  const frames = frameCount(d);
  if (frames <= 0) return [];
  const threshold = Math.max(0, dbToGain(finiteOr(opts.dcOffsetThresholdDb, -40)));
  let maxOffset = 0;
  for (const ch of d.channels) {
    let sum = 0;
    const n = Math.min(frames, ch.length);
    for (let i = 0; i < n; i++) sum += ch[i];
    const offset = n ? sum / n : 0;
    if (Math.abs(offset) > Math.abs(maxOffset)) maxOffset = offset;
  }
  return Math.abs(maxOffset) >= threshold ? [{ kind: "dc-offset", start: 0, end: frames / sr, sampleCount: frames }] : [];
}

function detectFlatClipping(d: AudioData, opts: AudioDiagnosticsOptions, sr: number): RawIssue[] {
  const frames = frameCount(d);
  const duration = frames / sr;
  const ceiling = clamp(finiteOr(opts.clipCeiling, 0.999969), 0, 1);
  const flatnessEps = Math.max(0, finiteOr(opts.flatnessEps, 1e-4));
  const minRun = Math.max(2, Math.floor(finiteOr(opts.minClipRunSamples, 5)));
  const pad = Math.max(0, finiteOr(opts.clipPaddingMs, 2)) / 1000;
  const raw: RawIssue[] = [];

  for (const ch of d.channels) {
    let i = 0;
    while (i < frames) {
      if (!(Math.abs(ch[i]) >= ceiling)) {
        i++;
        continue;
      }
      const sign = ch[i] >= 0 ? 1 : -1;
      const runStart = i;
      while (i < frames && Math.abs(ch[i]) >= ceiling && (ch[i] >= 0 ? 1 : -1) === sign) i++;
      const runEnd = i - 1;

      let flatStart = runStart;
      for (let j = runStart + 1; j <= runEnd + 1; j++) {
        const stillFlat = j <= runEnd && Math.abs(ch[j] - ch[j - 1]) <= flatnessEps;
        if (stillFlat) continue;
        const flatEnd = j - 1;
        const len = flatEnd - flatStart + 1;
        if (len >= minRun) {
          raw.push({
            kind: "clipping",
            start: clamp(flatStart / sr - pad, 0, duration),
            end: clamp((flatEnd + 1) / sr + pad, 0, duration),
            sampleCount: len,
          });
        }
        flatStart = j;
      }
    }
  }

  return mergeNearbyIssues(raw, Math.max(0, finiteOr(opts.mergeClipGapMs, 50)) / 1000);
}

function mergeNearbyIssues(issues: RawIssue[], gapSec: number): RawIssue[] {
  const sorted = issues.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RawIssue[] = [];
  for (const issue of sorted) {
    const last = merged[merged.length - 1];
    if (last && issue.start <= last.end + gapSec) {
      last.end = Math.max(last.end, issue.end);
      last.sampleCount += issue.sampleCount;
    } else {
      merged.push({ ...issue });
    }
  }
  return merged;
}

function rankKind(kind: AudioDiagnosticKind): number {
  if (kind === "clipping") return 0;
  if (kind === "click") return 1;
  if (kind === "dc-offset") return 2;
  return 3;
}

function median(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  const sorted = Float64Array.from(arr).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measureIssue(
  d: AudioData,
  issue: RawIssue,
  sr: number,
  frames: number,
): Pick<AudioDiagnosticIssue, "peak" | "peakDb" | "rms" | "rmsDb" | "dcOffset" | "dcOffsetDb"> {
  const startFrame = Math.floor(clamp(issue.start * sr, 0, frames));
  const endFrame = Math.ceil(clamp(issue.end * sr, startFrame, frames));
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  let dcOffset = 0;
  for (const ch of d.channels) {
    const end = Math.min(endFrame, ch.length);
    let sum = 0;
    let chCount = 0;
    for (let i = startFrame; i < end; i++) {
      const raw = ch[i];
      const v = Math.abs(raw);
      if (v > peak) peak = v;
      sumSquares += raw * raw;
      sum += raw;
      count++;
      chCount++;
    }
    const chOffset = chCount ? sum / chCount : 0;
    if (Math.abs(chOffset) > Math.abs(dcOffset)) dcOffset = chOffset;
  }
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return { peak, peakDb: gainToDb(peak), rms, rmsDb: gainToDb(rms), dcOffset, dcOffsetDb: gainToDb(Math.abs(dcOffset)) };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
