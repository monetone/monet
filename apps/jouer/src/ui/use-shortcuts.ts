// ─────────────────────────────────────────────────────────────
// use-shortcuts.ts — global keyboard map (Unity/Photoshop-flavoured). Mounted
// once by App. Typing in a field is never intercepted.
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";
import * as cmd from "../commands";
import { store } from "../state/app";
import type { ToolId } from "../state/store";
import { fitView, frameSelection, moveToView } from "../phaser/PhaserStage";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  h: "hand",
  r: "rectangle",
  e: "ellipse",
  t: "text",
};

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? cmd.redo() : cmd.undo();
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("jouer:save"));
        return;
      }
      if (mod && key === "o") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("jouer:open"));
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        cmd.duplicateSelection();
        return;
      }
      if (mod && key === "c") {
        e.preventDefault();
        cmd.copySelection();
        return;
      }
      if (mod && key === "x") {
        e.preventDefault();
        cmd.cutSelection();
        return;
      }
      if (mod && key === "v") {
        e.preventDefault();
        e.shiftKey ? cmd.pasteAsChild() : cmd.paste();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        cmd.selectAll();
        return;
      }
      if (mod && key === "i") {
        e.preventDefault();
        cmd.invertSelection();
        return;
      }
      if (mod && e.altKey && key === "f") {
        // Unity parity: Ctrl/Cmd+Alt+F moves the selection to the view centre.
        e.preventDefault();
        moveToView();
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          const sole = store.soleSelection();
          if (sole) cmd.ungroup(sole);
        } else {
          cmd.groupSelection();
        }
        return;
      }
      // Unity parity: Cmd/Ctrl+Alt+1–9 saves the selection to a slot, Cmd/Ctrl+
      // Shift+1–9 loads it. Keyed on e.code so it's layout-independent (Alt/Shift
      // turn e.key into symbols on many layouts).
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (mod && digit && e.altKey) {
        e.preventDefault();
        cmd.saveSelectionSet(digit[1]);
        return;
      }
      if (mod && digit && e.shiftKey) {
        e.preventDefault();
        cmd.loadSelectionSet(digit[1]);
        return;
      }
      if (mod) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          store.togglePlaying();
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          cmd.deleteSelection();
          return;
        case "Escape":
          store.clearSelection();
          return;
        case "D":
          // Unity parity: Shift+D deselects all (Escape clears too).
          e.preventDefault();
          cmd.deselectAll();
          return;
        case "H":
          // Unity parity: Shift+H toggles Isolate Selection (plain 'h' = Hand).
          e.preventDefault();
          cmd.toggleIsolateSelection();
          return;
        case ",":
          // Unity parity: Step Back one frame (always, regardless of selection).
          e.preventDefault();
          cmd.stepFrame(-1);
          return;
        case ".":
          e.preventDefault();
          cmd.stepFrame(1);
          return;
        case "Home":
          e.preventDefault();
          store.setPlayhead(0);
          return;
        case "End":
          e.preventDefault();
          store.setPlayhead(store.timelineExtent());
          return;
        case "k":
        case "K": {
          const sole = store.soleSelection();
          if (sole) cmd.keyAllTransform(sole);
          return;
        }
        case "f":
        case "F":
          // Unity parity: F frames the selection, Shift+F fits the whole scene.
          if (e.shiftKey) fitView();
          else frameSelection();
          return;
        case "F2": {
          // Unity parity: F2 renames the single selected object in the Hierarchy.
          e.preventDefault();
          const sole = store.soleSelection();
          if (sole) store.setRenamingId(sole);
          return;
        }
      }

      // Arrows: nudge the selection (Shift = ×10) when something is selected,
      // otherwise scrub the playhead by a frame (Shift = 1s).
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (store.selection.length > 0) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          cmd.translateSelection(dx, dy);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const fps = store.state.project.fps || 60;
          const d = (e.shiftKey ? 1 : 1 / fps) * (e.key === "ArrowLeft" ? -1 : 1);
          store.setPlayhead(store.state.playhead + d);
        }
        return;
      }

      const tool = TOOL_KEYS[key];
      if (tool) store.setTool(tool);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
