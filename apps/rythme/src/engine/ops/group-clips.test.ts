// ─────────────────────────────────────────────────────────────
// ops/group-clips.test — Group Clips (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { emptyProject, newClip } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Clip, Project } from "../model/types";
import { duplicateClip, groupClips, moveClip, ungroupClips } from "./clip";
import { deserializeProject, serializeProject } from "../io/project";

const SR = 48000;
const buf = () => createAudioData(2, SR, SR); // 1 s

/** Two tracks: t0 has A@1 + B@5, t1 has C@2. */
function project(): Project {
  resetIds();
  const p = emptyProject("T", 2, SR);
  const [t0, t1] = p.tracks;
  return {
    ...p,
    tracks: [
      { ...t0, clips: [newClip(buf(), { trackId: t0.id, start: 1, name: "A" }), newClip(buf(), { trackId: t0.id, start: 5, name: "B" })] },
      { ...t1, clips: [newClip(buf(), { trackId: t1.id, start: 2, name: "C" })] },
    ],
  };
}
const find = (p: Project, name: string): Clip => {
  for (const t of p.tracks) for (const c of t.clips) if (c.name === name) return c;
  throw new Error(`no clip ${name}`);
};

describe("groupClips / ungroupClips", () => {
  it("assigns one shared group id to the grouped clips, leaving others ungrouped", () => {
    const p = project();
    const out = groupClips(p, [find(p, "A").id, find(p, "C").id]);
    const ga = find(out, "A").groupId;
    expect(ga).toBeDefined();
    expect(find(out, "C").groupId).toBe(ga);
    expect(find(out, "B").groupId).toBeUndefined();
  });

  it("is a no-op (same ref) for fewer than two clips", () => {
    const p = project();
    expect(groupClips(p, [find(p, "A").id])).toBe(p);
    expect(groupClips(p, [])).toBe(p);
  });

  it("moving a grouped clip shifts every member by the same delta, across tracks", () => {
    let p = project();
    p = groupClips(p, [find(p, "A").id, find(p, "C").id]); // A@1, C@2 grouped; B@5 free
    const out = moveClip(p, find(p, "A").id, 3); // A 1→3, delta +2
    expect(find(out, "A").start).toBe(3);
    expect(find(out, "C").start).toBe(4); // C 2 → 4 (same +2, different track)
    expect(find(out, "B").start).toBe(5); // ungrouped clip untouched
  });

  it("clamps the group move so the earliest member never goes below 0", () => {
    let p = project();
    p = groupClips(p, [find(p, "A").id, find(p, "C").id]); // earliest member is A@1
    const out = moveClip(p, find(p, "A").id, -10); // wants −11, clamped to −1
    expect(find(out, "A").start).toBe(0);
    expect(find(out, "C").start).toBe(1); // C 2 → 1, relative spacing preserved
  });

  it("ungroupClips frees the clips so they move independently again", () => {
    let p = project();
    p = groupClips(p, [find(p, "A").id, find(p, "C").id]);
    p = ungroupClips(p, [find(p, "A").id, find(p, "C").id]);
    expect(find(p, "A").groupId).toBeUndefined();
    const out = moveClip(p, find(p, "A").id, 3);
    expect(find(out, "A").start).toBe(3);
    expect(find(out, "C").start).toBe(2); // no longer follows
  });

  it("ungroupClips is a no-op (same ref) when nothing was grouped", () => {
    const p = project();
    expect(ungroupClips(p, [find(p, "A").id])).toBe(p);
  });

  it("a duplicate of a grouped clip is independent (not added to the source's group)", () => {
    let p = project();
    p = groupClips(p, [find(p, "A").id, find(p, "C").id]);
    const out = duplicateClip(p, find(p, "A").id); // copy named "A copy"
    expect(find(out, "A copy").groupId).toBeUndefined();
    expect(find(out, "A").groupId).toBeDefined(); // the original keeps its group
  });

  it("the group survives a serialize → deserialize round-trip (persisted in the project)", () => {
    let p = project();
    p = groupClips(p, [find(p, "A").id, find(p, "C").id]);
    const round = deserializeProject(serializeProject(p));
    const ga = find(round, "A").groupId;
    expect(ga).toBeDefined();
    expect(find(round, "C").groupId).toBe(ga); // both reload into the same group
    expect(find(round, "B").groupId).toBeUndefined(); // ungrouped clip stays ungrouped
  });
});
