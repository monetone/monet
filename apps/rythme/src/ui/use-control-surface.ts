import { useEffect } from "react";
import { setPlayhead, toggleArm, toggleMute, toggleSolo, type EditorState, type RythmeStore } from "../engine";
import { bindControlSurfaceInput, bindControlSurfaceOutput, type ControlSurfaceAction, type ControlSurfaceFeedbackSnapshot } from "../audio/control-surfaces";
import { play, returnToZero, stop, togglePlay } from "../audio/use-playback";
import { CONTROL_SURFACE_PREFERENCES_EVENT, loadControlSurfacePreferencesAsync } from "./app-preferences";
import { setMasterGainFromMixer, setTrackGainFromMixer, setTrackPanFromMixer } from "./commands";

export function useControlSurfaceBridge(store: RythmeStore): void {
  useEffect(() => {
    let disposed = false;
    let release = () => undefined as void;
    let version = 0;

    const connect = () => {
      version += 1;
      const currentVersion = version;
      release();
      release = () => undefined;
      void loadControlSurfacePreferencesAsync()
        .then((preferences) => Promise.all([
          bindControlSurfaceInput({
            enabled: preferences.enabled,
            protocol: preferences.protocol,
            inputId: preferences.inputId,
            mappings: preferences.mappings,
            onAction: (action) => applyControlSurfaceAction(store, action),
          }),
          bindControlSurfaceOutput({
            enabled: preferences.enabled,
            protocol: preferences.protocol,
            outputId: preferences.outputId,
            getSnapshot: () => controlSurfaceFeedbackSnapshot(store.getState()),
            subscribe: (listener) => store.subscribe(listener),
          }),
        ]))
        .then((releases) => {
          const nextRelease = () => releases.forEach((fn) => fn());
          if (disposed || currentVersion !== version) nextRelease();
          else release = nextRelease;
        })
        .catch((err) => console.warn("Control surface bridge unavailable", err));
    };

    connect();
    window.addEventListener(CONTROL_SURFACE_PREFERENCES_EVENT, connect);
    return () => {
      disposed = true;
      release();
      window.removeEventListener(CONTROL_SURFACE_PREFERENCES_EVENT, connect);
    };
  }, [store]);
}

function controlSurfaceFeedbackSnapshot(state: EditorState): ControlSurfaceFeedbackSnapshot {
  return {
    playing: state.transport.playing,
    masterGainDb: state.project.masterGainDb,
    tracks: state.project.tracks.slice(0, 8).map((track) => ({
      gainDb: track.gainDb,
      pan: track.pan,
      mute: track.mute,
      solo: track.solo,
      arm: track.recordArm,
    })),
  };
}

function applyControlSurfaceAction(store: RythmeStore, action: ControlSurfaceAction): void {
  switch (action.type) {
    case "play": return play(store);
    case "stop": return stop(store);
    case "togglePlay": return togglePlay(store);
    case "returnToZero": return returnToZero(store);
    case "jog": return store.dispatch(setPlayhead(store.getState().transport.playhead + action.deltaSeconds), { history: false, label: "Control surface jog" });
    case "masterGain": return setMasterGainFromMixer(store, action.gainDb);
    case "trackGain": {
      const track = store.getState().project.tracks[action.trackIndex];
      if (track) setTrackGainFromMixer(store, track.id, action.gainDb);
      return;
    }
    case "trackPan": {
      const track = store.getState().project.tracks[action.trackIndex];
      if (track) setTrackPanFromMixer(store, track.id, action.pan);
      return;
    }
    case "trackMute": {
      const track = store.getState().project.tracks[action.trackIndex];
      if (track) store.dispatch(toggleMute(track.id), { label: "Control surface mute" });
      return;
    }
    case "trackSolo": {
      const track = store.getState().project.tracks[action.trackIndex];
      if (track) store.dispatch(toggleSolo(track.id), { label: "Control surface solo" });
      return;
    }
    case "trackArm": {
      const track = store.getState().project.tracks[action.trackIndex];
      if (track) store.dispatch(toggleArm(track.id), { label: "Control surface arm" });
    }
  }
}
