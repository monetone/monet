// ─────────────────────────────────────────────────────────────
// state/demo — a small generated demo session
// ─────────────────────────────────────────────────────────────
// So the app opens with something to look at and edit, we synthesize a short
// multitrack session entirely from the engine's generators (no asset files).

import { type AudioData, emptyProject, Generate, newClip, newTrack, Ops, type Project } from "../engine";

export function demoProject(): Project {
  const sr = 48000;
  let p = emptyProject("Demo Session", 0, sr);

  const defs: { name: string; make: () => AudioData; start: number; gainDb: number }[] = [
    { name: "Lead Synth", make: () => Generate.sine(220, 3, { sampleRate: sr, amplitude: 0.7, channels: 2 }), start: 0, gainDb: -3 },
    { name: "Sub Bass", make: () => Generate.triangle(82.4, 4, { sampleRate: sr, amplitude: 0.6, channels: 2 }), start: 0.5, gainDb: -6 },
    { name: "Pad", make: () => Generate.square(330, 2.5, { sampleRate: sr, amplitude: 0.25, channels: 2 }), start: 1, gainDb: -12 },
    { name: "Sweep FX", make: () => Generate.chirp(200, 4000, 2, { sampleRate: sr, amplitude: 0.5, channels: 2 }), start: 2.5, gainDb: -8 },
    { name: "Noise Air", make: () => Generate.pinkNoise(5, { sampleRate: sr, amplitude: 0.18, channels: 2 }), start: 0, gainDb: -18 },
  ];

  defs.forEach((d, i) => {
    const track = newTrack(i, { name: d.name, gainDb: d.gainDb });
    p = { ...p, tracks: [...p.tracks, track] };
    const clip = newClip(d.make(), { trackId: track.id, name: d.name, start: d.start, fadeIn: 0.05, fadeOut: 0.2 });
    p = Ops.addClip(p, track.id, clip);
  });

  p.markers.push(
    { id: "mk-intro", time: 0, name: "Intro", color: "var(--accent-audio)", kind: "cue" },
    { id: "mk-drop", time: 2.5, name: "Drop", color: "oklch(0.78 0.14 200)", kind: "cue" },
  );
  return p;
}
