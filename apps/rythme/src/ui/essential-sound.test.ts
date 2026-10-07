// ─────────────────────────────────────────────────────────────
// ui/essential-sound.test — Essential Sound role workflows
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { DSP, emptyProject, Generate, newClip, newTrack, Ops, RythmeStore } from "../engine";
import { resetIds } from "../engine/model/ids";
import { applyEssentialSoundAutoDuck, applyEssentialSoundPreset, setActiveTrackAudioRole } from "./commands";

const SR = 48000;

function rmsAt(d: { channels: Float32Array[] }, start: number, end: number): number {
  const ch = d.channels[0];
  const a = Math.round(start * SR);
  const b = Math.round(end * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

describe("Essential Sound commands", () => {
  it("sets and clears the active track role", () => {
    resetIds();
    const store = new RythmeStore(emptyProject("Roles", 1, SR));

    expect(setActiveTrackAudioRole(store, "dialogue")).toBe(true);
    expect(store.getState().project.tracks[0].audioRole).toBe("dialogue");

    expect(setActiveTrackAudioRole(store, null)).toBe(true);
    expect(store.getState().project.tracks[0].audioRole).toBeUndefined();
  });

  it("applies an Essential Sound preset over the active track", () => {
    resetIds();
    let project = emptyProject("Preset", 1, SR);
    const trackId = project.tracks[0].id;
    const clip = newClip(Generate.sine(440, 0.2, { sampleRate: SR, amplitude: 0.2, channels: 2 }), { trackId });
    project = Ops.addClip(project, trackId, clip);
    const store = new RythmeStore(project);

    expect(applyEssentialSoundPreset(store, "sfx")).toBe(true);
    const out = store.getState().project.tracks[0].clips[0].buffer;
    expect(out.channels[0].length).toBe(clip.buffer.channels[0].length);
    expect(DSP.peakAmplitude(out)).toBeGreaterThan(0.85);
  });

  it("returns false when there is no processable scope", () => {
    const store = new RythmeStore(emptyProject("Empty", 0, SR));
    expect(applyEssentialSoundPreset(store, "dialogue")).toBe(false);
  });

  it("auto-ducks Music-role tracks under Dialogue-role tracks", () => {
    resetIds();
    let project = emptyProject("Duck", 0, SR);
    const music = newTrack(0, { name: "Music", audioRole: "music" });
    const dialogue = newTrack(1, { name: "Dialogue", audioRole: "dialogue" });
    project = { ...project, tracks: [music, dialogue] };
    project = Ops.addClip(project, music.id, newClip(Generate.sine(440, 1.2, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: music.id, start: 0 }));
    project = Ops.addClip(project, dialogue.id, newClip(Generate.sine(180, 0.4, { sampleRate: SR, amplitude: 0.7, channels: 2 }), { trackId: dialogue.id, start: 0.35 }));
    const before = Ops.renderClip(project.tracks[0].clips[0]);
    const store = new RythmeStore(project);

    const count = applyEssentialSoundAutoDuck(store, { amountDb: -18, attackMs: 10, releaseMs: 90, holdMs: 20 });

    expect(count).toBe(1);
    const duckedTrack = store.getState().project.tracks[0];
    expect(duckedTrack.clips).toHaveLength(1);
    expect(duckedTrack.clips[0].name).toBe("Ducked");
    const after = Ops.renderClip(duckedTrack.clips[0]);
    expect(rmsAt(after, 0.55, 0.72)).toBeLessThan(rmsAt(before, 0.55, 0.72) * 0.35);
    expect(store.getState().project.tracks[1].clips[0].name).not.toBe("Ducked");
  });

  it("does not duck without both Dialogue and Music roles", () => {
    const store = new RythmeStore(emptyProject("No Roles", 1, SR));
    expect(applyEssentialSoundAutoDuck(store)).toBe(0);
  });
});
