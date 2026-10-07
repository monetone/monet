// Unit tests for the timeline model factory. query.test.ts uses these
// constructors to build fixtures but never asserts the defaults they fill in —
// so the kind-specific track logic, sequence track generation, color/transform
// defaults and project wiring were untested. Pin them here.

import { describe, expect, it } from "vitest";
import {
  createClip,
  createEffect,
  createMedia,
  createProject,
  createSequence,
  createTrack,
  defaultColorGrade,
  defaultTransform,
  resetIds,
} from "./factory";
import { SCHEMA_ID } from "./types";

describe("defaultTransform", () => {
  it("is identity: 100% scale/opacity, centred anchor, no crop", () => {
    expect(defaultTransform()).toEqual({
      x: 0,
      y: 0,
      scale: 100,
      scaleX: 100,
      scaleY: 100,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 100,
      blendMode: "normal",
      cropL: 0,
      cropT: 0,
      cropR: 0,
      cropB: 0,
    });
  });
});

describe("defaultColorGrade", () => {
  it("is disabled and neutral — gamma & gain default to 1, everything else 0", () => {
    const g = defaultColorGrade();
    expect(g.enabled).toBe(false);
    expect(g.gamma).toBe(1);
    expect(g.gain).toBe(1);
    // every additive control is zero
    for (const k of ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows", "whites", "blacks", "vibrance", "hue", "lift"] as const) {
      expect(g[k], k).toBe(0);
    }
  });
});

describe("createEffect", () => {
  it("is enabled with an fx-prefixed id and passes through type/name/params", () => {
    const fx = createEffect("blur", "Gaussian Blur", { radius: 4 });
    expect(fx.id.startsWith("fx_")).toBe(true);
    expect(fx.type).toBe("blur");
    expect(fx.name).toBe("Gaussian Blur");
    expect(fx.enabled).toBe(true);
    expect(fx.params).toEqual({ radius: 4 });
    expect(createEffect("x", "X").params).toEqual({}); // default empty params
  });
});

describe("createMedia", () => {
  it("fills sensible defaults for an offline/placeholder item", () => {
    const m = createMedia({ name: "clip.mov", kind: "video" });
    expect(m.id.startsWith("media_")).toBe(true);
    expect(m.path).toBe("");
    expect(m.durationFrames).toBe(0);
    expect(m.fps).toBe(24);
    expect(m.width).toBe(0);
    expect(m.height).toBe(0);
    expect(m.hasAudio).toBe(false);
  });

  it("passes provided probe metadata through", () => {
    const m = createMedia({ name: "a", kind: "video", path: "/a.mov", durationFrames: 240, fps: 30, width: 1920, height: 1080, hasAudio: true });
    expect(m).toMatchObject({ path: "/a.mov", durationFrames: 240, fps: 30, width: 1920, height: 1080, hasAudio: true });
  });
});

describe("createClip", () => {
  it("applies clip defaults and a fresh transform/color grade", () => {
    const c = createClip({ name: "a", kind: "video", start: 10, duration: 20 });
    expect(c.id.startsWith("clip_")).toBe(true);
    expect(c.mediaId).toBe(""); // omitted → empty
    expect(c.inPoint).toBe(0);
    expect(c.speed).toBe(1);
    expect(c.enabled).toBe(true);
    expect(c.audioGain).toBe(0);
    expect(c.fadeInFrames).toBe(0);
    expect(c.fadeOutFrames).toBe(0);
    expect(c.effects).toEqual([]);
    expect(c.transform).toEqual(defaultTransform());
    expect(c.color).toEqual(defaultColorGrade());
  });

  it("gives each clip its own transform object (no shared mutable defaults)", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 1 });
    const b = createClip({ name: "b", kind: "video", start: 0, duration: 1 });
    a.transform.opacity = 50;
    expect(b.transform.opacity).toBe(100); // unaffected
    expect(a.transform).not.toBe(b.transform);
  });

  it("passes through the supplied fields", () => {
    const c = createClip({ mediaId: "media_9", name: "vox", kind: "audio", start: 5, duration: 12, inPoint: 3, speed: 2 });
    expect(c).toMatchObject({ mediaId: "media_9", name: "vox", kind: "audio", start: 5, duration: 12, inPoint: 3, speed: 2 });
  });
});

describe("createTrack", () => {
  it("video tracks get a V-prefixed id and a taller lane", () => {
    const v = createTrack("video", "V1");
    expect(v.id.startsWith("V_")).toBe(true);
    expect(v.kind).toBe("video");
    expect(v.height).toBe(56);
    expect(v).toMatchObject({ enabled: true, locked: false, muted: false, solo: false, gain: 0, clips: [] });
  });

  it("audio tracks get an A-prefixed id and a shorter lane", () => {
    const a = createTrack("audio", "A1");
    expect(a.id.startsWith("A_")).toBe(true);
    expect(a.kind).toBe("audio");
    expect(a.height).toBe(44);
  });
});

describe("createSequence", () => {
  it("builds 3 video + 3 audio tracks (video first) at 1080p/24 by default", () => {
    resetIds();
    const seq = createSequence();
    expect(seq.tracks.map((t) => t.name)).toEqual(["V1", "V2", "V3", "A1", "A2", "A3"]);
    expect(seq.tracks.slice(0, 3).every((t) => t.kind === "video")).toBe(true);
    expect(seq.tracks.slice(3).every((t) => t.kind === "audio")).toBe(true);
    expect(seq.fps).toBe(24);
    expect(seq.width).toBe(1920);
    expect(seq.height).toBe(1080);
    expect(seq.durationFrames).toBe(24 * 60); // default = one minute
    expect(seq.background).toBe("#000000");
    expect(seq.markers).toEqual([]);
  });

  it("honours track counts, fps and derives the default duration from fps", () => {
    const seq = createSequence({ videoTracks: 2, audioTracks: 0, fps: 30, width: 1280, height: 720 });
    expect(seq.tracks.map((t) => t.kind)).toEqual(["video", "video"]);
    expect(seq.fps).toBe(30);
    expect(seq.durationFrames).toBe(30 * 60);
    expect(seq.width).toBe(1280);
    expect(seq.height).toBe(720);
  });

  it("respects an explicit durationFrames", () => {
    expect(createSequence({ durationFrames: 500 }).durationFrames).toBe(500);
  });
});

describe("createProject", () => {
  it("wraps one sequence and wires the active id + mirrored format", () => {
    const p = createProject("Demo");
    expect(p.schema).toBe(SCHEMA_ID);
    expect(p.name).toBe("Demo");
    expect(p.media).toEqual([]);
    expect(p.sequences).toHaveLength(1);
    const seq = p.sequences[0];
    expect(p.activeSequenceId).toBe(seq.id);
    expect(p.fps).toBe(seq.fps);
    expect(p.width).toBe(seq.width);
    expect(p.height).toBe(seq.height);
  });

  it("defaults the name to Untitled", () => {
    expect(createProject().name).toBe("Untitled");
  });
});
