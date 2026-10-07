// ─────────────────────────────────────────────────────────────
// ui/favorite-effects — project Favorites effect-chain workflow
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, emptyProject, newClip, newEffectRack, newEffectSlot, Ops, RythmeStore, selectClips } from "../engine";
import { applyFavoriteEffectChain, saveActiveRackAsFavorite } from "./commands";

const SR = 48000;

function testBuffer(): ReturnType<typeof createAudioData> {
  const audio = createAudioData(1, 4, SR);
  audio.channels[0][0] = 0.25;
  audio.channels[0][1] = -0.5;
  audio.channels[0][2] = 0.125;
  audio.channels[0][3] = -0.25;
  return audio;
}

describe("favorite effect chains", () => {
  it("applies a saved rack chain to the selected clip", () => {
    const base = emptyProject("Favorites", 1, SR);
    const trackId = base.tracks[0].id;
    const clip = newClip(testBuffer(), { trackId, id: "clip-1" });
    const project = {
      ...Ops.addClip(base, trackId, clip),
      favoriteEffectChains: [{ id: "fav-invert", name: "Invert Favorite", steps: [{ kind: "invertPolarity", params: {} }] }],
    };
    const store = new RythmeStore(project);
    store.dispatch(selectClips([clip.id]), { history: false });

    expect(applyFavoriteEffectChain(store, "fav-invert")).toBe(true);
    const out = store.getState().project.tracks[0].clips[0].buffer.channels[0];
    expect(out[0]).toBeCloseTo(-0.25, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(-0.125, 6);
    expect(out[3]).toBeCloseTo(0.25, 6);
  });

  it("records the active track rack as a project favorite chain", () => {
    const base = emptyProject("Favorites", 1, SR);
    const slot = newEffectSlot("gain", { id: "fx-gain", name: "Trim", params: { gainDb: -6 } });
    const project = {
      ...base,
      tracks: [{ ...base.tracks[0], effectRack: newEffectRack({ slots: [slot] }) }],
    };
    const store = new RythmeStore(project);

    const id = saveActiveRackAsFavorite(store, "Dialogue Clean");
    expect(id).toMatch(/^fav-/);
    expect(store.getState().project.favoriteEffectChains).toEqual([
      { id, name: "Dialogue Clean", steps: [{ kind: "gain", name: "Trim", enabled: true, params: { gainDb: -6 } }] },
    ]);
  });
});
