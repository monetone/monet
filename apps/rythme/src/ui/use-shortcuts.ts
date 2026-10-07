// ─────────────────────────────────────────────────────────────
// ui/use-shortcuts — global keyboard shortcuts
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  pasteAtPlayhead,
  type RythmeStore,
  selectAll,
  setTool,
  silenceSelection,
  splitAtPlayhead,
  trimToSelection,
  type KeyboardShortcutAction,
  zoomBy,
} from "../engine";
import { returnToZero, togglePlay } from "../audio/use-playback";
import { applyNoiseReduction, captureNoisePrint, duplicateSelectedClips, NUDGE_SECONDS, nudgeSelectedClips, saveProject } from "./commands";
import { resolveKeyboardShortcut } from "./keyboard-shortcuts";

export function useShortcuts(store: RythmeStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const action = resolveKeyboardShortcut(e, store.getState().project.editorPreferences?.keyboardShortcuts);
      if (action && runShortcutAction(action, store)) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

function runShortcutAction(action: KeyboardShortcutAction, store: RythmeStore): boolean {
  switch (action) {
    case "transport.playPause":
      togglePlay(store);
      return true;
    case "transport.returnToStart":
      returnToZero(store);
      return true;
    case "clip.nudgeLeft":
      nudgeSelectedClips(store, -NUDGE_SECONDS);
      return true;
    case "clip.nudgeRight":
      nudgeSelectedClips(store, NUDGE_SECONDS);
      return true;
    case "edit.undo":
      store.undo();
      return true;
    case "edit.redo":
      store.redo();
      return true;
    case "edit.selectAll":
      store.dispatch(selectAll(), { history: false });
      return true;
    case "edit.cut":
      store.dispatch(cutSelection(), { label: "Cut" });
      return true;
    case "edit.copy":
      store.dispatch(copySelection(), { history: false });
      return true;
    case "edit.paste":
      store.dispatch(pasteAtPlayhead(false), { label: "Paste" });
      return true;
    case "edit.split":
      store.dispatch(splitAtPlayhead(), { label: "Split" });
      return true;
    case "edit.duplicate":
      duplicateSelectedClips(store);
      return true;
    case "edit.silence":
      store.dispatch(silenceSelection(), { label: "Silence" });
      return true;
    case "edit.trim":
      store.dispatch(trimToSelection(), { label: "Trim" });
      return true;
    case "edit.delete":
      store.dispatch(deleteSelection(true), { label: "Delete" });
      return true;
    case "project.save":
      saveProject(store);
      return true;
    case "effect.noiseReduction":
      applyNoiseReduction(store);
      return true;
    case "effect.captureNoisePrint":
      captureNoisePrint(store);
      return true;
    case "view.zoomIn":
      store.dispatch(zoomBy(1.5), { history: false });
      return true;
    case "view.zoomOut":
      store.dispatch(zoomBy(1 / 1.5), { history: false });
      return true;
    case "tool.select":
      store.dispatch(setTool("select"), { history: false });
      return true;
    case "tool.razor":
      store.dispatch(setTool("razor"), { history: false });
      return true;
    case "tool.marquee":
      store.dispatch(setTool("marquee"), { history: false });
      return true;
    case "tool.envelope":
      store.dispatch(setTool("envelope"), { history: false });
      return true;
    case "tool.fade":
      store.dispatch(setTool("fade"), { history: false });
      return true;
    case "tool.marker":
      store.dispatch(setTool("marker"), { history: false });
      return true;
    case "tool.hand":
      store.dispatch(setTool("hand"), { history: false });
      return true;
    case "tool.zoom":
      store.dispatch(setTool("zoom"), { history: false });
      return true;
  }
}
