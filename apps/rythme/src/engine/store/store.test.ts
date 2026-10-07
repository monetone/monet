import { beforeEach, describe, expect, it } from "vitest";
import { emptyProject } from "../model/factory";
import { resetIds } from "../model/ids";
import { RythmeStore } from "./store";
import {
  addMarker,
  addTrack,
  selectAll,
  setEditorMode,
  setTempo,
  setTool,
  setTrackGain,
  toggleMute,
} from "./actions";

describe("RythmeStore", () => {
  beforeEach(() => resetIds());

  it("starts clean with the given project", () => {
    const store = new RythmeStore(emptyProject("Demo", 3));
    const s = store.getState();
    expect(s.project.name).toBe("Demo");
    expect(s.mode).toBe("multitrack");
    expect(s.project.tracks).toHaveLength(3);
    expect(s.dirty).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it("hydrates project editor preferences into the current UI state", () => {
    const project = emptyProject("Prefs", 1, 48000);
    project.editorPreferences = {
      editorMode: "waveform",
      tool: "envelope",
      snap: false,
      displayTimeFormat: "samples",
      spectralMinHz: 120,
      spectralMaxHz: 12000,
      activeWorkspaceId: "custom",
      customWorkspaces: [{ id: "custom", name: "Custom", layout: { left: { size: 260, stack: [] } } }],
      keyboardShortcuts: [],
      keyboardShortcutPresets: [],
    };
    const store = new RythmeStore(project);
    expect(store.getState().mode).toBe("waveform");
    expect(store.getState().tool).toBe("envelope");
    expect(store.getState().view.snap).toBe(false);

    const replacement = emptyProject("Replacement", 1, 48000);
    replacement.editorPreferences = {
      editorMode: "multitrack",
      tool: "razor",
      snap: true,
      displayTimeFormat: "barsBeats",
      spectralMinHz: 80,
      spectralMaxHz: 18000,
      activeWorkspaceId: "default",
      customWorkspaces: [],
      keyboardShortcuts: [],
      keyboardShortcutPresets: [],
    };
    store.replaceProject(replacement, { markClean: true });
    expect(store.getState().mode).toBe("multitrack");
    expect(store.getState().tool).toBe("razor");
    expect(store.getState().view.snap).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });

  it("notifies subscribers and changes state identity on edit", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    let hits = 0;
    const off = store.subscribe(() => hits++);
    const before = store.getState();
    store.dispatch(setTrackGain(before.project.tracks[0].id, -6), { label: "Gain" });
    expect(hits).toBe(1);
    expect(store.getState()).not.toBe(before);
    expect(store.getState().project.tracks[0].gainDb).toBe(-6);
    expect(store.getState().dirty).toBe(true);
    off();
  });

  it("non-history dispatches (tool) do not mark dirty or push undo", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    store.dispatch(setTool("razor"), { history: false });
    expect(store.getState().tool).toBe("razor");
    store.dispatch(setEditorMode("waveform"), { history: false });
    expect(store.getState().mode).toBe("waveform");
    expect(store.getState().dirty).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it("undo/redo restores prior project state", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    const id = store.getState().project.tracks[0].id;
    store.dispatch(setTrackGain(id, -3), { label: "Gain -3" });
    store.dispatch(setTrackGain(id, -9), { label: "Gain -9" });
    expect(store.getState().project.tracks[0].gainDb).toBe(-9);

    store.undo();
    expect(store.getState().project.tracks[0].gainDb).toBe(-3);
    store.undo();
    expect(store.getState().project.tracks[0].gainDb).toBe(0);
    expect(store.canUndo()).toBe(false);

    store.redo();
    expect(store.getState().project.tracks[0].gainDb).toBe(-3);
  });

  it("coalesces consecutive ops sharing a key into one undo step", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    const id = store.getState().project.tracks[0].id;
    for (const v of [-1, -2, -3, -4]) {
      store.dispatch(setTrackGain(id, v), { label: "Drag", coalesceKey: "fader:" + id });
    }
    expect(store.getState().project.tracks[0].gainDb).toBe(-4);
    store.undo(); // single step back to original
    expect(store.getState().project.tracks[0].gainDb).toBe(0);
  });

  it("a new edit clears the redo stack", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    const id = store.getState().project.tracks[0].id;
    store.dispatch(setTrackGain(id, -3));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.dispatch(setTrackGain(id, -12));
    expect(store.canRedo()).toBe(false);
  });

  it("toggleMute flips and undoes", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    const id = store.getState().project.tracks[0].id;
    store.dispatch(toggleMute(id));
    expect(store.getState().project.tracks[0].mute).toBe(true);
    store.undo();
    expect(store.getState().project.tracks[0].mute).toBe(false);
  });

  it("addTrack appends and focuses the new track", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    store.dispatch(addTrack({ name: "Vox" }));
    const s = store.getState();
    expect(s.project.tracks).toHaveLength(2);
    expect(s.project.tracks[1].name).toBe("Vox");
    expect(s.activeTrackId).toBe(s.project.tracks[1].id);
  });

  it("selectAll selects every clip and a full range when there is content", () => {
    const store = new RythmeStore(emptyProject("Demo", 2));
    store.dispatch(selectAll(), { history: false });
    expect(store.getState().selection.trackIds).toHaveLength(2);
    expect(store.getState().selection.range).toBeNull(); // empty tracks ⇒ no range
  });

  it("setTempo and addMarker mutate the project and bump modified", () => {
    const store = new RythmeStore(emptyProject("Demo", 1));
    store.dispatch(setTempo(140));
    expect(store.getState().project.tempo).toBe(140);
    store.dispatch(addMarker({ time: 1.5, name: "Verse" }));
    expect(store.getState().project.markers[0].name).toBe("Verse");
  });

  it("replaceProject resets history and dirty", () => {
    const store = new RythmeStore(emptyProject("A", 1));
    store.dispatch(setTrackGain(store.getState().project.tracks[0].id, -6));
    store.replaceProject(emptyProject("B", 2), { markClean: true });
    expect(store.getState().project.name).toBe("B");
    expect(store.getState().mode).toBe("multitrack");
    expect(store.canUndo()).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });
});
