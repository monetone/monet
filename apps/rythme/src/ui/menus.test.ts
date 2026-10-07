// ─────────────────────────────────────────────────────────────
// ui/menus.test — the menu bar mirrors Adobe Audition's structure
// ─────────────────────────────────────────────────────────────
// Guards the layout requirement that Rythme's top-level menu bar matches
// Audition's order/set, and that regrouping the items dropped no command.

import { describe, expect, it } from "vitest";
import { createAudioData, emptyProject, Generate, newClip, Ops, RythmeStore, saveProjectWorkspace, selectClips } from "../engine";
import { buildMenus } from "./menus";
import { WORKSPACES } from "./workspace-layout";
import { TIME_FORMATS } from "./format";

// A loose shape for a menu node (item or submenu); buildMenus returns these.
interface Node {
  id?: string;
  label?: string;
  separator?: boolean;
  checked?: boolean;
  disabled?: boolean;
  action?: () => void;
  items?: Node[];
}

const menus = () => {
  const store = new RythmeStore(emptyProject());
  return buildMenus(store, store.getState()) as Node[];
};

/** Every leaf id that carries an action, across all menus + nested submenus. */
function actionIds(nodes: Node[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.action && n.id) out.add(n.id);
    if (n.items) actionIds(n.items, out);
  }
  return out;
}

function topMenu(id: string): Node {
  const m = menus().find((x) => x.id === id);
  if (!m) throw new Error(`no top menu ${id}`);
  return m;
}

const childIds = (node: Node) => (node.items ?? []).map((c) => c.id);

describe("menu bar layout (Adobe Audition parity)", () => {
  it("has Audition's exact top-level menu order and labels", () => {
    expect(menus().map((m) => m.label)).toEqual(["File", "Edit", "Multitrack", "Clip", "Effects", "Favorites", "View", "Window", "Help"]);
  });

  it("uses stable Audition ids so the renderer stays wired", () => {
    expect(menus().map((m) => m.id)).toEqual(["file", "edit", "multitrack", "clip", "effects", "favorites", "view", "window", "help"]);
  });

  it("drops no command — every pre-regroup action id is still reachable", () => {
    const ids = actionIds(menus());
    const required = [
      // File
      "new", "open", "import", "importVideo", "importVideoAudio", "relinkVideo", "save", "export", "export24", "export32f", "exportRange", "exportPremiereXml", "exportEdl",
      "batchTracks", "batchTracksAiff", "batchRegions", "batchRegionsAiff", "batchClips", "batchClipsAiff", "batchProcessTracksNormalizeLimit", "batchProcessRegionsPodcast", "batchProcessClipsPodcast", "exportMarkers", "importMarkers",
      // Edit
      "undo", "redo", "cut", "copy", "paste", "mixPasteFull", "mixPasteInvert", "delete", "silence", "insil", "selall", "snapping", "zcInward", "zcOutward",
      // Multitrack
      "add", "play", "stop", "rtz", "loopSel", "prevMarker", "nextMarker", "markBeats", "bounceTrack", "bounceSession",
      // Clip
      "split", "duplicateClip", "splitMarkers", "mergeClips", "groupClips", "ungroupClips", "muteClip", "lockClip", "crossfade", "trim", "clipFadeIn", "clipFadeClear", "clipGainUp3", "clipGainReset", "nudgeLeft", "nudgeRight", "nudgeLeftFine", "loopX2", "loopX4", "loopOff", "matchVol", "matchLoud", "marker", "mergeMarkers",
      // Effects (representative leaves)
      "essDialogue", "essMusic", "essDuck", "capturePrint", "noiseReduction", "deEsser", "hardLimiter", "truePeakLimiter", "sidechainDuck", "geq-bassBoost", "peq-vocalClarity",
      "vocalRemove", "vocalIsolate", "swapChannels", "convReverbIr", "pitchUp1", "remix30", "lufs14", "vocalMale", "masterOpen",
      // Generate (now nested under Effects)
      "sine", "square", "white", "chirp",
      // Favorites / View
      "fav-saveActiveRack", "fav-vocalRemove", "fav-normalize", "fav-reverse", "editorModeMultitrack", "editorModeWaveform", "zin", "zout", "zoomSel", "zoomFull",
    ];
    for (const id of required) expect(ids.has(id), `missing action: ${id}`).toBe(true);
  });

  it("places clip operations under Clip and track ops under Multitrack", () => {
    expect(childIds(topMenu("clip"))).toEqual(expect.arrayContaining(["split", "splitMarkers", "mergeClips", "crossfade", "trim", "matchVol", "matchLoud", "marker"]));
    expect(childIds(topMenu("multitrack"))).toEqual(expect.arrayContaining(["add", "play", "stop", "rtz", "markBeats"]));
  });

  it("nests Generate under Effects (Audition's Effects ▸ Generate)", () => {
    const gen = (topMenu("effects").items ?? []).find((i) => i.id === "generate");
    expect(gen).toBeDefined();
    const genIds = childIds(gen!);
    expect(genIds).toEqual(expect.arrayContaining(["sine", "tones", "dtmfSignals"]));
  });

  it("Favorites lists project effect chains and applies them from the menu", () => {
    const base = emptyProject("Favorites", 1, 48000);
    const trackId = base.tracks[0].id;
    const audio = createAudioData(1, 2, 48000);
    audio.channels[0][0] = 0.25;
    audio.channels[0][1] = -0.5;
    const clip = newClip(audio, { trackId, id: "clip-fav" });
    const store = new RythmeStore({
      ...Ops.addClip(base, trackId, clip),
      favoriteEffectChains: [{ id: "clean-chain", name: "Clean Chain", steps: [{ kind: "invertPolarity", params: {} }] }],
    });
    store.dispatch(selectClips([clip.id]), { history: false });
    const fav = (buildMenus(store, store.getState()) as Node[]).find((m) => m.id === "favorites")!;
    const item = (fav.items ?? []).find((entry) => entry.id === "fav-chain-clean-chain")!;

    expect(item.label).toBe("Clean Chain");
    expect(item.disabled).toBe(false);
    item.action!();
    const out = store.getState().project.tracks[0].clips[0].buffer.channels[0];
    expect(out[0]).toBeCloseTo(-0.25, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
  });

  it("Window menu items focus their panel via the focusPanel callback (Audition's Window menu)", () => {
    const focused: string[] = [];
    const store = new RythmeStore(emptyProject());
    const m = buildMenus(store, store.getState(), { focusPanel: (id) => focused.push(id) }) as Node[];
    const win = m.find((x) => x.id === "window")!;
    // The panel items live below the Workspace submenu + a separator.
    for (const item of win.items ?? []) item.action?.();
    expect(focused).toEqual(["files", "video", "effects", "generate", "markers", "properties", "analyze", "mixer", "history"]);
  });

  it("Window ▸ Workspace switches workspace presets and resets the layout (Audition's Workspace switcher)", () => {
    const applied: string[] = [];
    let resets = 0;
    const store = new RythmeStore(emptyProject());
    const m = buildMenus(store, store.getState(), {
      applyWorkspace: (id) => applied.push(id),
      resetWorkspace: () => { resets += 1; },
    }) as Node[];
    const win = m.find((x) => x.id === "window")!;
    const ws = (win.items ?? []).find((i) => i.id === "workspace");
    expect(ws).toBeDefined();

    // The reset item resets the dock; every shipped preset item switches workspace.
    const reset = (ws!.items ?? []).find((i) => i.id === "ws-reset")!;
    reset.action!();
    expect(resets).toBe(1);

    for (const item of (ws!.items ?? []).filter((i) => WORKSPACES.some((w) => i.id === `ws-${w.id}`))) item.action?.();
    expect(applied).toEqual(WORKSPACES.map((w) => w.id));
  });

  it("Window ▸ Workspace lists project custom workspaces and management actions", () => {
    const applied: string[] = [];
    let saves = 0;
    let deletes = 0;
    const store = new RythmeStore(emptyProject());
    store.dispatch(saveProjectWorkspace({ name: "Mix Review", layout: { left: { size: 300, stack: [] } } }), { history: false });
    const m = buildMenus(store, store.getState(), {
      applyWorkspace: (id) => applied.push(id),
      saveWorkspace: () => { saves += 1; },
      deleteActiveWorkspace: () => { deletes += 1; },
    }) as Node[];
    const ws = ((m.find((x) => x.id === "window")!.items ?? []).find((i) => i.id === "workspace")!.items ?? []);
    const custom = ws.find((i) => i.id === "ws-custom-mix-review")!;
    expect(custom.label).toBe("Mix Review");
    expect(custom.checked).toBe(true);
    custom.action!();
    expect(applied).toEqual(["mix-review"]);
    ws.find((i) => i.id === "ws-save-custom")!.action!();
    ws.find((i) => i.id === "ws-delete-current")!.action!();
    expect(saves).toBe(1);
    expect(deletes).toBe(1);
  });

  it("Edit ▸ Snapping is a checkbox that reflects and toggles view.snap (Audition's Snapping)", () => {
    const store = new RythmeStore(emptyProject());
    const item = () => ((buildMenus(store, store.getState()) as Node[]).find((m) => m.id === "edit")!.items ?? []).find((i) => i.id === "snapping")!;
    expect(store.getState().view.snap).toBe(true); // default on
    expect(item().checked).toBe(true);
    item().action!(); // toggle off
    expect(store.getState().view.snap).toBe(false);
    expect(store.getState().project.editorPreferences?.snap).toBe(false);
    expect(store.getState().dirty).toBe(true);
    expect(item().checked).toBe(false);
  });

  it("Clip ▸ Mute Clip(s) is a checkbox that reflects and toggles the selected clips' mute (Audition's Mute Clip)", () => {
    const base = emptyProject("T", 1, 48000);
    const tid = base.tracks[0].id;
    const clip = newClip(Generate.sine(440, 0.1, { sampleRate: 48000, channels: 2 }), { trackId: tid });
    const store = new RythmeStore(Ops.addClip(base, tid, clip));
    store.dispatch(selectClips([clip.id]), { history: false });
    const item = () => ((buildMenus(store, store.getState()) as Node[]).find((m) => m.id === "clip")!.items ?? []).find((i) => i.id === "muteClip")!;
    expect(item().checked).toBe(false); // audible by default
    item().action!(); // mute the selected clip
    expect(store.getState().project.tracks[0].clips[0].muted).toBe(true);
    expect(item().checked).toBe(true);
  });

  it("Clip ▸ Lock in Time is a checkbox that reflects and toggles the selected clips' lock (Audition's Lock in Time)", () => {
    const base = emptyProject("T", 1, 48000);
    const tid = base.tracks[0].id;
    const clip = newClip(Generate.sine(440, 0.1, { sampleRate: 48000, channels: 2 }), { trackId: tid });
    const store = new RythmeStore(Ops.addClip(base, tid, clip));
    store.dispatch(selectClips([clip.id]), { history: false });
    const item = () => ((buildMenus(store, store.getState()) as Node[]).find((m) => m.id === "clip")!.items ?? []).find((i) => i.id === "lockClip")!;
    expect(item().checked).toBe(false); // movable by default
    item().action!(); // lock the selected clip
    expect(store.getState().project.tracks[0].clips[0].locked).toBe(true);
    expect(item().checked).toBe(true);
  });

  it("View ▸ Display Time Format lists the formats, checks the active one, and switches it (Audition's time display)", () => {
    const picked: string[] = [];
    const store = new RythmeStore(emptyProject());
    const m = buildMenus(store, store.getState(), { timeFormat: "samples", setTimeFormat: (id) => picked.push(id) }) as Node[];
    const view = m.find((x) => x.id === "view")!;
    const dtf = (view.items ?? []).find((i) => i.id === "displayTimeFormat");
    expect(dtf).toBeDefined();

    // Every Audition format is offered, in order, and only the active one is checked.
    expect((dtf!.items ?? []).map((i) => i.id)).toEqual(TIME_FORMATS.map((f) => `tf-${f.id}`));
    const checkedIds = (dtf!.items ?? []).filter((i) => i.checked).map((i) => i.id);
    expect(checkedIds).toEqual(["tf-samples"]);

    // Selecting each item switches the Display Time Format to that id.
    for (const item of dtf!.items ?? []) item.action?.();
    expect(picked).toEqual(TIME_FORMATS.map((f) => f.id));
  });

  it("View switches and checks Waveform/Multitrack editor modes (Audition's editor tabs)", () => {
    const store = new RythmeStore(emptyProject());
    const item = (id: string) => ((buildMenus(store, store.getState()) as Node[]).find((m) => m.id === "view")!.items ?? []).find((i) => i.id === id)!;

    expect(store.getState().mode).toBe("multitrack");
    expect(item("editorModeMultitrack").checked).toBe(true);
    expect(item("editorModeWaveform").checked).toBe(false);

    item("editorModeWaveform").action!();
    expect(store.getState().mode).toBe("waveform");
    expect(store.getState().project.editorPreferences?.editorMode).toBe("waveform");
    expect(store.getState().dirty).toBe(true);
    expect(item("editorModeWaveform").checked).toBe(true);
    expect(item("editorModeMultitrack").checked).toBe(false);

    item("editorModeMultitrack").action!();
    expect(store.getState().mode).toBe("multitrack");
    expect(store.getState().project.editorPreferences?.editorMode).toBe("multitrack");
  });
});
