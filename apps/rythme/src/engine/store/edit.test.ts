// Unit tests for store/edit — the high-level edit Command creators. These wrap
// engine/ops (already covered in ops.test) but add the untested layer the menus
// and shortcuts actually depend on: selection→active→all target resolution,
// clipboard/selection bookkeeping, scope dispatch, and the no-op identity guards
// the store needs so empty edits don't push undo steps.

import { beforeEach, describe, expect, it } from "vitest";
import { frameCount, type AudioData } from "../audio/types";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import { sine } from "../generate/tone";
import { addClip } from "../ops";
import { renderClip, renderProject } from "../ops/render";
import { spectrum } from "../analysis/spectrum";
import { scanAudioDiagnostics } from "../analysis/diagnostics";
import { concat, createAudioData, sliceFrames } from "../audio/buffer";
import { initialState } from "./store";
import {
  applyEffect,
  applySpectralBrushSelectionGain,
  applySpectralHarmonicSelectionGain,
  applySpectralSelectionGain,
  applyWaveformRangeGain,
  applyWaveformSampleEdit,
  copySelection,
  cutSelection,
  deleteClipCmd,
  deleteSelection,
  insertClip,
  insertClipOnTracks,
  moveClipTo,
  pasteAtPlayhead,
  repairClickRange,
  repairClippingRange,
  repairDcOffsetRange,
  repairDiagnosticIssues,
  repairSilenceRange,
  silenceSelection,
  splitAtPlayhead,
  splitAtTime,
  targetTrackIds,
  trimToSelection,
} from "./edit";
import type { EditorState } from "../model/types";

const SR = 48000;
const buf = (freq: number) => sine(freq, 2, { sampleRate: SR, amplitude: 0.8, channels: 1 });
const mixedBuf = (): AudioData => {
  const low = sine(500, 2, { sampleRate: SR, amplitude: 0.35, channels: 1 });
  const high = sine(4000, 2, { sampleRate: SR, amplitude: 0.35, channels: 1 });
  const out = createAudioData(1, low.channels[0].length, SR);
  for (let i = 0; i < out.channels[0].length; i++) out.channels[0][i] = low.channels[0][i] + high.channels[0][i];
  return out;
};
const brushBuf = (): AudioData => {
  const low = sine(500, 2, { sampleRate: SR, amplitude: 0.25, channels: 1 });
  const center = sine(4000, 2, { sampleRate: SR, amplitude: 0.25, channels: 1 });
  const edge = sine(4400, 2, { sampleRate: SR, amplitude: 0.25, channels: 1 });
  const out = createAudioData(1, low.channels[0].length, SR);
  for (let i = 0; i < out.channels[0].length; i++) out.channels[0][i] = low.channels[0][i] + center.channels[0][i] + edge.channels[0][i];
  return out;
};
const stereoMixedBuf = (): AudioData => {
  const mono = mixedBuf();
  return {
    sampleRate: SR,
    channels: [Float32Array.from(mono.channels[0]), Float32Array.from(mono.channels[0])],
  };
};
const harmonicBuf = (): AudioData => {
  const tones = [
    sine(440, 2, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
    sine(880, 2, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
    sine(1320, 2, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
    sine(3000, 2, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
  ];
  const out = createAudioData(1, frameCount(tones[0]), SR);
  for (let i = 0; i < frameCount(out); i++) {
    for (const tone of tones) out.channels[0][i] += tone.channels[0][i];
  }
  return out;
};
const hardClippedBuf = (): AudioData => {
  const hot = sine(440, 0.5, { sampleRate: SR, amplitude: 0.9, channels: 1 }).channels[0];
  return { sampleRate: SR, channels: [Float32Array.from(hot, (v) => Math.max(-0.6, Math.min(0.6, v)))] };
};
const clickedBuf = (): AudioData => {
  const tone = sine(440, 0.6, { sampleRate: SR, amplitude: 0.2, channels: 1 }).channels[0];
  const clicked = Float32Array.from(tone);
  clicked[Math.round(0.3 * SR)] = -0.95;
  return { sampleRate: SR, channels: [clicked] };
};
const dcOffsetBuf = (): AudioData => {
  const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.1, channels: 1 }).channels[0];
  return { sampleRate: SR, channels: [Float32Array.from(tone, (v) => v + 0.12)] };
};
const silenceGapBuf = (): AudioData =>
  concat(
    sine(440, 0.2, { sampleRate: SR, amplitude: 0.7, channels: 1 }),
    createAudioData(1, Math.round(0.4 * SR), SR),
    sine(440, 0.2, { sampleRate: SR, amplitude: 0.7, channels: 1 }),
  );
const diagnosticBatchBuf = (): AudioData =>
  concat(
    sine(440, 0.2, { sampleRate: SR, amplitude: 0.7, channels: 1 }),
    createAudioData(1, Math.round(0.4 * SR), SR),
    hardClippedBuf(),
    createAudioData(1, Math.round(0.4 * SR), SR),
    sine(440, 0.2, { sampleRate: SR, amplitude: 0.7, channels: 1 }),
  );
const rampBuf = (): AudioData => ({
  sampleRate: 10,
  channels: [Float32Array.from({ length: 20 }, (_, i) => i / 20)],
});

let s: EditorState;
let tA: string, tB: string, cA: string, cB: string;

beforeEach(() => {
  resetIds();
  let p = emptyProject("T", 0, SR);
  const a = newTrack(0, { name: "A" });
  const b = newTrack(1, { name: "B" });
  p = { ...p, tracks: [a, b] };
  const ca = newClip(buf(440), { trackId: a.id, start: 0, name: "a" });
  const cb = newClip(buf(330), { trackId: b.id, start: 0, name: "b" });
  p = addClip(p, a.id, ca);
  p = addClip(p, b.id, cb);
  s = initialState(p); // activeTrackId = first track (A)
  [tA, tB, cA, cB] = [a.id, b.id, ca.id, cb.id];
});

const track = (st: EditorState, id: string) => st.project.tracks.find((t) => t.id === id)!;
const clips = (st: EditorState, id: string) => track(st, id).clips;
const binDb = (d: AudioData, hz: number): number => {
  const spec = spectrum(d, { fftSize: 4096, window: "hann" });
  let best = 0;
  for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
  return spec.db[best];
};
const channelBinDb = (d: AudioData, channel: number, hz: number): number => binDb({ sampleRate: d.sampleRate, channels: [d.channels[channel]] }, hz);
const segmentBinDb = (d: AudioData, hz: number, startSeconds: number, endSeconds: number): number =>
  binDb(sliceFrames(d, Math.round(startSeconds * d.sampleRate), Math.round(endSeconds * d.sampleRate)), hz);

describe("targetTrackIds — selection → active → all", () => {
  it("prefers an explicit track selection", () => {
    expect(targetTrackIds({ ...s, selection: { ...s.selection, trackIds: [tB] } })).toEqual([tB]);
  });
  it("falls back to the active track", () => {
    expect(targetTrackIds(s)).toEqual([tA]); // active is A, no selection
  });
  it("falls back to every track when nothing is active or selected", () => {
    expect(targetTrackIds({ ...s, activeTrackId: null })).toEqual([tA, tB]);
  });
});

describe("insertClip", () => {
  it("drops a clip on the named track and floors the start at 0", () => {
    const r = insertClip(tB, buf(220), 1.5, "drop")(s);
    expect(clips(r, tB)).toHaveLength(2);
    const added = clips(r, tB).find((c) => c.name === "drop")!;
    expect(added.start).toBe(1.5);
    const neg = insertClip(tA, buf(220), -3, "x")(s);
    expect(clips(neg, tA).find((c) => c.name === "x")!.start).toBe(0);
  });

  it("insertClipOnTracks drops one recorded buffer on multiple tracks in one edit", () => {
    const recording = buf(110);
    const r = insertClipOnTracks([tA, tB, tA, "ghost"], recording, 3, "recording")(s);
    expect(clips(r, tA).find((c) => c.name === "recording")?.buffer).toBe(recording);
    expect(clips(r, tB).find((c) => c.name === "recording")?.start).toBe(3);
    expect(clips(r, tA).filter((c) => c.name === "recording")).toHaveLength(1);
  });
});

describe("split", () => {
  it("splitAtPlayhead razors only the target (active) track", () => {
    const at1 = { ...s, transport: { ...s.transport, playhead: 1 } };
    const r = splitAtPlayhead()(at1);
    expect(clips(r, tA)).toHaveLength(2); // A spans 0..2 → split at 1
    expect(clips(r, tB)).toHaveLength(1); // B untouched (not targeted)
  });
  it("splitAtTime can target explicit tracks", () => {
    const r = splitAtTime(1, [tA, tB])(s);
    expect(clips(r, tA)).toHaveLength(2);
    expect(clips(r, tB)).toHaveLength(2);
  });
});

describe("moveClipTo", () => {
  it("sets a clip's start time", () => {
    const r = moveClipTo(cA, 5)(s);
    expect(clips(r, tA).find((c) => c.id === cA)!.start).toBe(5);
  });
});

describe("deleteClipCmd", () => {
  it("removes the clip and drops it from the selection", () => {
    const sel = { ...s, selection: { ...s.selection, clipIds: [cA] } };
    const r = deleteClipCmd(cA)(sel);
    expect(clips(r, tA)).toHaveLength(0);
    expect(r.selection.clipIds).toEqual([]);
  });
});

describe("deleteSelection", () => {
  it("ripple-deletes a range and clears it; non-ripple keeps the range", () => {
    const ranged = { ...s, selection: { clipIds: [], trackIds: [tA], range: { start: 0, end: 1 }, spectral: null } };
    expect(deleteSelection(true)(ranged).selection.range).toBeNull();
    expect(deleteSelection(false)(ranged).selection.range).toEqual({ start: 0, end: 1 });
  });
  it("deletes selected clips and clears the whole selection", () => {
    const sel = { ...s, selection: { clipIds: [cA, cB], trackIds: [tA, tB], range: null, spectral: null } };
    const r = deleteSelection()(sel);
    expect(clips(r, tA)).toHaveLength(0);
    expect(clips(r, tB)).toHaveLength(0);
    expect(r.selection).toEqual({ clipIds: [], trackIds: [], range: null, spectral: null });
  });
  it("is a no-op when nothing is selected", () => {
    expect(deleteSelection()(s)).toBe(s);
  });
});

describe("range commands require a range", () => {
  it("silenceSelection / trimToSelection / copySelection / cutSelection no-op without a range", () => {
    expect(silenceSelection()(s)).toBe(s);
    expect(trimToSelection()(s)).toBe(s);
    expect(copySelection()(s)).toBe(s);
    expect(cutSelection()(s)).toBe(s);
  });
  it("silenceSelection edits the project but preserves the range selection", () => {
    const ranged = { ...s, selection: { clipIds: [], trackIds: [tA], range: { start: 0, end: 1 }, spectral: null } };
    const r = silenceSelection()(ranged);
    expect(r.project).not.toBe(ranged.project);
    expect(r.selection.range).toEqual({ start: 0, end: 1 }); // non-destructive to the selection
  });
});

describe("clipboard", () => {
  it("copySelection captures a clipboard without mutating the project", () => {
    const ranged = { ...s, selection: { clipIds: [], trackIds: [tA], range: { start: 0, end: 1 }, spectral: null } };
    const r = copySelection()(ranged);
    expect(r.clipboard).toBeTruthy();
    expect(r.project).toBe(ranged.project); // copy is non-destructive
  });
  it("cutSelection fills the clipboard, edits the project, and clears the range", () => {
    const ranged = { ...s, selection: { clipIds: [], trackIds: [tA], range: { start: 0, end: 1 }, spectral: null } };
    const r = cutSelection()(ranged);
    expect(r.clipboard).toBeTruthy();
    expect(r.project).not.toBe(ranged.project);
    expect(r.selection.range).toBeNull();
  });
  it("pasteAtPlayhead no-ops with an empty clipboard, and edits once filled", () => {
    expect(pasteAtPlayhead()(s)).toBe(s);
    const ranged = { ...s, selection: { clipIds: [], trackIds: [tA], range: { start: 0, end: 1 }, spectral: null } };
    const copied = copySelection()(ranged);
    const pasted = pasteAtPlayhead()({ ...copied, transport: { ...copied.transport, playhead: 5 } });
    expect(pasted.project).not.toBe(copied.project);
  });
});

describe("applyEffect — scope dispatch", () => {
  // Negate samples: a deterministic, buffer-changing processor.
  const neg = (d: AudioData): AudioData => ({
    sampleRate: d.sampleRate,
    channels: d.channels.map((ch) => ch.map((v) => -v)),
  });

  it("no-ops when there is no range, no clip selection, and no active track", () => {
    const noScope = { ...s, activeTrackId: null };
    expect(applyEffect(neg)(noScope)).toBe(noScope); // returns the input state untouched
  });

  it("falls back to the active track, leaving other tracks untouched", () => {
    const origB = clips(s, tB)[0];
    const r = applyEffect(neg)(s); // active track A
    expect(clips(r, tA)[0]).not.toBe(clips(s, tA)[0]); // A processed
    expect(clips(r, tB)[0]).toBe(origB); // B shared by reference, untouched
  });

  it("targets the selected clips when clips are selected", () => {
    const origA = clips(s, tA)[0];
    const sel = { ...s, selection: { ...s.selection, clipIds: [cB] } };
    const r = applyEffect(neg)(sel);
    expect(clips(r, tB)[0]).not.toBe(clips(s, tB)[0]); // B (selected) processed
    expect(clips(r, tA)[0]).toBe(origA); // A untouched
  });
});

describe("applySpectralSelectionGain", () => {
  it("no-ops without a spectral selection", () => {
    expect(applySpectralSelectionGain(-24)(s)).toBe(s);
  });

  it("bakes a frequency-local edit into the selected time range on target tracks", () => {
    const audio = mixedBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(audio, { trackId: a.id, start: 0, name: "a" }));
    project = addClip(project, b.id, newClip(audio, { trackId: b.id, start: 0, name: "b" }));
    const state: EditorState = {
      ...initialState(project),
      selection: {
        clipIds: [],
        trackIds: [a.id],
        range: { start: 0.5, end: 1.5 },
        spectral: {
          time: { start: 0.5, end: 1.5 },
          frequency: { minHz: 3500, maxHz: 4500 },
          channel: "all",
        },
      },
    };

    const edited = applySpectralSelectionGain(-48)(state);
    const aClips = clips(edited, a.id);
    expect(aClips.map((c) => c.start)).toEqual([0, 0.5, 1.5]);
    expect(clips(edited, b.id)).toHaveLength(1);

    const middle = aClips[1].buffer;
    expect(binDb(middle, 4000)).toBeLessThan(binDb(middle, 500) - 18);
    expect(Math.abs(binDb(aClips[0].buffer, 4000) - binDb(aClips[0].buffer, 500))).toBeLessThan(8);
  });

  it("respects the selected spectral channel", () => {
    const audio = stereoMixedBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    project = { ...project, tracks: [a] };
    project = addClip(project, a.id, newClip(audio, { trackId: a.id, start: 0, name: "stereo" }));
    const state: EditorState = {
      ...initialState(project),
      selection: {
        clipIds: [],
        trackIds: [a.id],
        range: { start: 0.5, end: 1.5 },
        spectral: {
          time: { start: 0.5, end: 1.5 },
          frequency: { minHz: 3500, maxHz: 4500 },
          channel: "left",
        },
      },
    };

    const edited = applySpectralSelectionGain(-48)(state);
    const middle = clips(edited, a.id)[1].buffer;
    expect(channelBinDb(middle, 0, 4000)).toBeLessThan(channelBinDb(audio, 0, 4000) - 18);
    expect(Math.abs(channelBinDb(middle, 1, 4000) - channelBinDb(audio, 1, 4000))).toBeLessThan(3);
  });
});

describe("applySpectralBrushSelectionGain", () => {
  it("bakes a soft spectral brush into only the selected range and target track", () => {
    const audio = brushBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(audio, { trackId: a.id, start: 0, name: "a" }));
    project = addClip(project, b.id, newClip(audio, { trackId: b.id, start: 0, name: "b" }));
    const state: EditorState = {
      ...initialState(project),
      selection: {
        clipIds: [],
        trackIds: [a.id],
        range: { start: 0.5, end: 1.5 },
        spectral: {
          time: { start: 0.5, end: 1.5 },
          frequency: { minHz: 3500, maxHz: 4500 },
          channel: "all",
        },
      },
    };

    const edited = applySpectralBrushSelectionGain(-60)(state);
    const aClips = clips(edited, a.id);
    expect(aClips.map((c) => c.start)).toEqual([0, 0.5, 1.5]);
    expect(clips(edited, b.id)).toHaveLength(1);

    const sourceMiddle = sliceFrames(audio, Math.round(0.5 * SR), Math.round(1.5 * SR));
    const brushed = aClips[1].buffer;
    expect(segmentBinDb(brushed, 4000, 0.45, 0.55)).toBeLessThan(segmentBinDb(sourceMiddle, 4000, 0.45, 0.55) - 12);
    expect(Math.abs(segmentBinDb(brushed, 4000, 0, 0.1) - segmentBinDb(sourceMiddle, 4000, 0, 0.1))).toBeLessThan(6);
    expect(Math.abs(segmentBinDb(brushed, 4400, 0.45, 0.55) - segmentBinDb(sourceMiddle, 4400, 0.45, 0.55))).toBeLessThan(6);
    expect(Math.abs(segmentBinDb(brushed, 500, 0.45, 0.55) - segmentBinDb(sourceMiddle, 500, 0.45, 0.55))).toBeLessThan(4);
  });
});

describe("applySpectralHarmonicSelectionGain", () => {
  it("bakes a harmonic-stack spectral edit into only the selected range and target track", () => {
    const audio = harmonicBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(audio, { trackId: a.id, start: 0, name: "a" }));
    project = addClip(project, b.id, newClip(audio, { trackId: b.id, start: 0, name: "b" }));
    const state: EditorState = {
      ...initialState(project),
      selection: {
        clipIds: [],
        trackIds: [a.id],
        range: { start: 0.5, end: 1.5 },
        spectral: {
          time: { start: 0.5, end: 1.5 },
          frequency: { minHz: 420, maxHz: 460 },
          channel: "all",
        },
      },
    };

    const edited = applySpectralHarmonicSelectionGain(-48, { harmonics: 3, bandwidthHz: 80 })(state);
    const aClips = clips(edited, a.id);
    expect(aClips.map((c) => c.start)).toEqual([0, 0.5, 1.5]);
    expect(clips(edited, b.id)).toHaveLength(1);

    const middle = aClips[1].buffer;
    expect(binDb(middle, 440)).toBeLessThan(binDb(aClips[0].buffer, 440) - 12);
    expect(binDb(middle, 880)).toBeLessThan(binDb(aClips[0].buffer, 880) - 12);
    expect(binDb(middle, 1320)).toBeLessThan(binDb(aClips[0].buffer, 1320) - 12);
    expect(Math.abs(binDb(middle, 3000) - binDb(aClips[0].buffer, 3000))).toBeLessThan(4);
  });
});

describe("applyWaveformSampleEdit", () => {
  it("no-ops without a selected or explicit range", () => {
    expect(applyWaveformSampleEdit("reverse")(s)).toBe(s);
    expect(applyWaveformRangeGain(3)(s)).toBe(s);
  });

  it("bakes a sample-level reverse over only the selected waveform range", () => {
    let project = emptyProject("T", 0, 10);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(rampBuf(), { trackId: a.id, start: 0, name: "ramp" }));
    project = addClip(project, b.id, newClip(rampBuf(), { trackId: b.id, start: 0, name: "other" }));
    const state: EditorState = {
      ...initialState(project),
      selection: { clipIds: [], trackIds: [a.id], range: { start: 0.5, end: 1.0 }, spectral: null },
    };

    const edited = applyWaveformSampleEdit("reverse")(state);
    const aClips = clips(edited, a.id);
    expect(aClips.map((c) => c.start)).toEqual([0, 0.5, 1]);
    expect(aClips.map((c) => c.duration)).toEqual([0.5, 0.5, 1]);
    expect(clips(edited, b.id)).toHaveLength(1);
    expect(edited.selection.range).toEqual({ start: 0.5, end: 1.0 });

    const reversed = Array.from(aClips[1].buffer.channels[0]);
    for (let i = 0; i < 5; i++) expect(reversed[i]).toBeCloseTo((9 - i) / 20, 6);
    expect(renderClip(aClips[0]).channels[0][0]).toBeCloseTo(0, 6);
    expect(renderClip(aClips[2]).channels[0][0]).toBeCloseTo(0.5, 6);
  });

  it("bakes gain and silence over only the selected waveform range", () => {
    let project = emptyProject("T", 0, 10);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(rampBuf(), { trackId: a.id, start: 0, name: "ramp" }));
    project = addClip(project, b.id, newClip(rampBuf(), { trackId: b.id, start: 0, name: "other" }));
    const state: EditorState = {
      ...initialState(project),
      selection: { clipIds: [], trackIds: [a.id], range: { start: 0.5, end: 1.0 }, spectral: null },
    };

    const gained = applyWaveformRangeGain(6.0206)(state);
    const gainedClips = clips(gained, a.id);
    expect(gainedClips.map((c) => c.start)).toEqual([0, 0.5, 1]);
    expect(gainedClips[1].buffer.channels[0][0]).toBeCloseTo(0.5, 4);
    expect(gainedClips[1].buffer.channels[0][4]).toBeCloseTo(0.9, 4);
    expect(clips(gained, b.id)).toHaveLength(1);

    const silenced = applyWaveformSampleEdit("silence")(state);
    const silentClip = clips(silenced, a.id)[1];
    expect(Array.from(silentClip.buffer.channels[0]).every((v) => v === 0)).toBe(true);
    expect(clips(silenced, b.id)).toHaveLength(1);
  });

  it("removes DC offset over only the selected waveform range", () => {
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(dcOffsetBuf(), { trackId: a.id, start: 0, name: "dc" }));
    project = addClip(project, b.id, newClip(dcOffsetBuf(), { trackId: b.id, start: 0, name: "other" }));
    const state: EditorState = {
      ...initialState(project),
      selection: { clipIds: [], trackIds: [a.id], range: { start: 0.25, end: 0.75 }, spectral: null },
    };

    const edited = applyWaveformSampleEdit("removeDcOffset")(state);
    const aClips = clips(edited, a.id);
    expect(aClips.map((c) => c.start)).toEqual([0, 0.25, 0.75]);
    expect(clips(edited, b.id)).toHaveLength(1);

    const middleIssues = scanAudioDiagnostics(renderClip(aClips[1]), {
      includeClipping: false,
      includeSilence: false,
      includeDcOffset: true,
      dcOffsetThresholdDb: -60,
    });
    const outerIssues = scanAudioDiagnostics(renderClip(aClips[0]), {
      includeClipping: false,
      includeSilence: false,
      includeDcOffset: true,
      dcOffsetThresholdDb: -30,
    });
    expect(middleIssues).toHaveLength(0);
    expect(outerIssues.some((issue) => issue.kind === "dc-offset")).toBe(true);
  });
});

describe("repairClippingRange", () => {
  it("bakes DeClipper over a waveform diagnostics range on the selected track", () => {
    const clipped = hardClippedBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(clipped, { trackId: a.id, start: 0, name: "clipped" }));
    project = addClip(project, b.id, newClip(buf(330), { trackId: b.id, start: 0, name: "clean" }));
    const state: EditorState = { ...initialState(project), activeTrackId: a.id };
    const renderA = (p: typeof project) => renderProject({ ...p, tracks: [p.tracks.find((t) => t.id === a.id)!] });
    const before = scanAudioDiagnostics(renderA(project), { includeSilence: false, clipCeiling: 0.59, minClipRunSamples: 4 });
    expect(before.length).toBeGreaterThan(0);

    const repaired = repairClippingRange({ start: before[0].start, end: before[0].end }, [a.id], {
      threshold: 0.55,
      minRunLength: 4,
    })(state);
    const after = scanAudioDiagnostics(renderA(repaired.project), { includeSilence: false, clipCeiling: 0.59, minClipRunSamples: 4 });

    expect(repaired.project).not.toBe(project);
    expect(repaired.selection.range).toEqual({ start: before[0].start, end: before[0].end });
    expect(after.length).toBeLessThan(before.length);
    expect(clips(repaired, b.id)).toHaveLength(1);
  });
});

describe("repairClickRange", () => {
  it("bakes DeClicker over a waveform diagnostics range on the selected track", () => {
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(clickedBuf(), { trackId: a.id, start: 0, name: "clicked" }));
    project = addClip(project, b.id, newClip(clickedBuf(), { trackId: b.id, start: 0, name: "other" }));
    const state: EditorState = { ...initialState(project), activeTrackId: a.id };
    const clickOnly = { includeClipping: false, includeClicks: true, includeDcOffset: false, includeSilence: false, clickThreshold: 0.1 };
    const renderA = (p: typeof project) => renderProject({ ...p, tracks: [p.tracks.find((t) => t.id === a.id)!] });
    const before = scanAudioDiagnostics(renderA(project), clickOnly);
    expect(before.some((issue) => issue.kind === "click")).toBe(true);

    const repaired = repairClickRange({ start: before[0].start, end: before[0].end }, [a.id], { threshold: 0.1 })(state);
    const after = scanAudioDiagnostics(renderA(repaired.project), clickOnly);
    const bAfter = scanAudioDiagnostics(renderProject({ ...repaired.project, tracks: [repaired.project.tracks.find((t) => t.id === b.id)!] }), clickOnly);

    expect(repaired.project).not.toBe(project);
    expect(after.some((issue) => issue.kind === "click")).toBe(false);
    expect(bAfter.some((issue) => issue.kind === "click")).toBe(true);
    expect(repaired.selection.range).toEqual({ start: before[0].start, end: before[0].end });
  });
});

describe("repairDcOffsetRange", () => {
  it("bakes DC-offset removal over a waveform diagnostics range on the selected track", () => {
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(dcOffsetBuf(), { trackId: a.id, start: 0, name: "dc" }));
    project = addClip(project, b.id, newClip(dcOffsetBuf(), { trackId: b.id, start: 0, name: "other" }));
    const state: EditorState = { ...initialState(project), activeTrackId: a.id };
    const renderA = (p: typeof project) => renderProject({ ...p, tracks: [p.tracks.find((t) => t.id === a.id)!] });
    const dcOnly = { includeClipping: false, includeSilence: false, includeDcOffset: true, dcOffsetThresholdDb: -30 };
    const before = scanAudioDiagnostics(renderA(project), dcOnly);
    expect(before.some((issue) => issue.kind === "dc-offset")).toBe(true);

    const repaired = repairDcOffsetRange({ start: before[0].start, end: before[0].end }, [a.id])(state);
    const after = scanAudioDiagnostics(renderA(repaired.project), { ...dcOnly, dcOffsetThresholdDb: -60 });
    const bAfter = scanAudioDiagnostics(renderProject({ ...repaired.project, tracks: [repaired.project.tracks.find((t) => t.id === b.id)!] }), dcOnly);

    expect(repaired.project).not.toBe(project);
    expect(after.some((issue) => issue.kind === "dc-offset")).toBe(false);
    expect(bAfter.some((issue) => issue.kind === "dc-offset")).toBe(true);
    expect(repaired.selection.range).toEqual({ start: before[0].start, end: before[0].end });
  });
});

describe("repairSilenceRange", () => {
  it("ripple-removes a waveform diagnostics silence issue on the selected track", () => {
    const withSilence = silenceGapBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(withSilence, { trackId: a.id, start: 0, name: "gap" }));
    project = addClip(project, b.id, newClip(buf(330), { trackId: b.id, start: 0, name: "clean" }));
    const state: EditorState = {
      ...initialState(project),
      activeTrackId: a.id,
      selection: {
        clipIds: [],
        trackIds: [a.id],
        range: { start: 0.2, end: 0.6 },
        spectral: {
          time: { start: 0.2, end: 0.6 },
          frequency: { minHz: 0, maxHz: 1000 },
          channel: "all",
        },
      },
    };
    const renderA = (p: typeof project) => renderProject({ ...p, tracks: [p.tracks.find((t) => t.id === a.id)!] });
    const beforeAudio = renderA(project);
    const before = scanAudioDiagnostics(beforeAudio, { includeClipping: false, silenceThresholdDb: -60, minSilenceMs: 250 });
    expect(before.filter((issue) => issue.kind === "silence")).toHaveLength(1);

    const repaired = repairSilenceRange({ start: before[0].start, end: before[0].end }, [a.id])(state);
    const afterAudio = renderA(repaired.project);
    const after = scanAudioDiagnostics(afterAudio, { includeClipping: false, silenceThresholdDb: -60, minSilenceMs: 250 });

    expect(repaired.project).not.toBe(project);
    expect(repaired.selection.range).toBeNull();
    expect(repaired.selection.spectral).toBeNull();
    expect(repaired.selection.trackIds).toEqual([a.id]);
    expect(frameCount(afterAudio)).toBeLessThan(frameCount(beforeAudio) - Math.round(0.3 * SR));
    expect(after).toHaveLength(0);
    expect(clips(repaired, b.id)).toHaveLength(1);
  });

  it("shortens a waveform diagnostics silence issue to the configured keep length", () => {
    const withSilence = silenceGapBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(withSilence, { trackId: a.id, start: 0, name: "gap" }));
    project = addClip(project, b.id, newClip(buf(330), { trackId: b.id, start: 0, name: "clean" }));
    const state: EditorState = { ...initialState(project), activeTrackId: a.id };
    const renderA = (p: typeof project) => renderProject({ ...p, tracks: [p.tracks.find((t) => t.id === a.id)!] });
    const beforeAudio = renderA(project);
    const before = scanAudioDiagnostics(beforeAudio, { includeClipping: false, silenceThresholdDb: -60, minSilenceMs: 250 });
    expect(before.filter((issue) => issue.kind === "silence")).toHaveLength(1);

    const repaired = repairSilenceRange({ start: before[0].start, end: before[0].end }, [a.id], { mode: "shorten", keepMs: 100 })(state);
    const afterAudio = renderA(repaired.project);
    const after = scanAudioDiagnostics(afterAudio, { includeClipping: false, silenceThresholdDb: -60, minSilenceMs: 250 });
    const removedFrames = frameCount(beforeAudio) - frameCount(afterAudio);

    expect(removedFrames).toBeGreaterThan(Math.round(0.29 * SR));
    expect(removedFrames).toBeLessThan(Math.round(0.31 * SR));
    expect(after).toHaveLength(0);
    expect(clips(repaired, b.id)).toHaveLength(1);
  });
});

describe("repairDiagnosticIssues", () => {
  it("repairs clipping and ripple-removes silence issues in one batch command", () => {
    const diagnosticAudio = diagnosticBatchBuf();
    let project = emptyProject("T", 0, SR);
    const a = newTrack(0, { name: "A" });
    const b = newTrack(1, { name: "B" });
    project = { ...project, tracks: [a, b] };
    project = addClip(project, a.id, newClip(diagnosticAudio, { trackId: a.id, start: 0, name: "diagnostics" }));
    project = addClip(project, b.id, newClip(buf(330), { trackId: b.id, start: 0, name: "clean" }));
    const state: EditorState = { ...initialState(project), activeTrackId: a.id };
    const renderA = (p: typeof project) => renderProject({ ...p, tracks: [p.tracks.find((t) => t.id === a.id)!] });
    const beforeAudio = renderA(project);
    const before = scanAudioDiagnostics(beforeAudio, {
      clipCeiling: 0.59,
      minClipRunSamples: 4,
      silenceThresholdDb: -60,
      minSilenceMs: 250,
    });
    expect(before.some((issue) => issue.kind === "clipping")).toBe(true);
    expect(before.filter((issue) => issue.kind === "silence")).toHaveLength(2);

    const repaired = repairDiagnosticIssues(
      before.map((issue) => ({ kind: issue.kind, range: { start: issue.start, end: issue.end } })),
      [a.id],
      { threshold: 0.55, minRunLength: 4 },
    )(state);
    const afterAudio = renderA(repaired.project);
    const after = scanAudioDiagnostics(afterAudio, {
      clipCeiling: 0.59,
      minClipRunSamples: 4,
      silenceThresholdDb: -60,
      minSilenceMs: 250,
    });

    expect(repaired.project).not.toBe(project);
    expect(repaired.selection.range).toBeNull();
    expect(repaired.selection.trackIds).toEqual([a.id]);
    expect(frameCount(afterAudio)).toBeLessThan(frameCount(beforeAudio) - Math.round(0.7 * SR));
    expect(after.filter((issue) => issue.kind === "silence")).toHaveLength(0);
    expect(after.filter((issue) => issue.kind === "clipping").length).toBeLessThan(before.filter((issue) => issue.kind === "clipping").length);
    expect(clips(repaired, b.id)).toHaveLength(1);
  });
});
