// #521: a recorded layer step replays on the layer that is active when the
// action plays. The recorded args are rewritten; the call itself still sees
// the id the user acted on. A width that equals the active id (newDocument)
// is not a layer id and stays a number.
import { describe, expect, it } from "vitest";
import {
  ACTIVE_LAYER_ARG,
  isSerializableArgs,
  resolvePlaybackLayerArg,
  retargetRecordedLayerArg,
} from "./actionSets";

const layers = [
  { id: 1, name: "Background" },
  { id: 4, name: "Photo" },
  { id: 9, name: "Type" },
];

describe("recorded layer targets (#521)", () => {
  it("uses one sentinel object so a live drag still collapses", () => {
    const first = retargetRecordedLayerArg("store.setLayerOpacity", [4, 40], 4, layers);
    const second = retargetRecordedLayerArg("store.setLayerOpacity", [4, 80], 4, layers);
    expect(first[0]).toBe(ACTIVE_LAYER_ARG);
    expect(second[0]).toBe(first[0]);
    expect(first[1]).toBe(40);
    expect(second[1]).toBe(80);
  });

  it("keeps a literal id when the step was not on the active layer", () => {
    expect(retargetRecordedLayerArg("store.setLayerOpacity", [1, 50], 4, layers)).toEqual([1, 50]);
  });

  it("records selectLayer by name", () => {
    expect(retargetRecordedLayerArg("store.selectLayer", [4], 9, layers)).toEqual([{ name: "Photo" }]);
    expect(retargetRecordedLayerArg("store.selectLayer", [99], 4, layers)).toEqual([99]);
  });

  it("does not rewrite a width that happens to equal the active id", () => {
    expect(retargetRecordedLayerArg("store.newDocument", [1, 100, 80], 1, layers)).toEqual([1, 100, 80]);
  });

  it("persists the sentinel, a name, and a relative offset", () => {
    expect(isSerializableArgs([ACTIVE_LAYER_ARG, 80])).toBe(true);
    expect(isSerializableArgs([{ name: "Photo" }])).toBe(true);
    expect(isSerializableArgs([{ offset: -1 }])).toBe(true);
  });
});

describe("playback layer targets (#521, #533)", () => {
  it("resolves the sentinel, a name, a relative offset, and a missing id onto the playing document", () => {
    expect(resolvePlaybackLayerArg("store.setLayerOpacity", [ACTIVE_LAYER_ARG, 80], 9, layers)).toEqual([9, 80]);
    expect(resolvePlaybackLayerArg("store.selectLayer", [{ name: "Photo" }], 9, layers)).toEqual([4]);
    expect(resolvePlaybackLayerArg("store.selectLayer", [{ name: "Gone" }], 9, layers)).toEqual([9]);
    expect(resolvePlaybackLayerArg("store.selectLayer", [{ offset: 1 }], 4, layers)).toEqual([9]);
    expect(resolvePlaybackLayerArg("store.selectLayer", [{ offset: -1 }], 4, layers)).toEqual([1]);
    expect(resolvePlaybackLayerArg("store.selectLayer", [{ offset: 5 }], 4, layers)).toEqual([4]);
    expect(resolvePlaybackLayerArg("store.mergeDown", [], 9, layers)).toEqual([9]);
    expect(resolvePlaybackLayerArg("store.mergeDown", [null], 9, layers)).toEqual([9]);
    expect(resolvePlaybackLayerArg("store.setLayerOpacity", [1, 50], 9, layers)).toEqual([1, 50]);
    expect(resolvePlaybackLayerArg("store.newDocument", [1, 100, 80], 1, layers)).toEqual([1, 100, 80]);
  });
});
