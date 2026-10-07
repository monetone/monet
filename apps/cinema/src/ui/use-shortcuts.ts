// ─────────────────────────────────────────────────────────────
// use-shortcuts.ts — global keyboard map (Premiere-style). Mounted once by App.
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";
import * as cmd from "../commands";
import { store } from "../state/app";
import type { ToolId } from "../state/store";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  a: "track-fwd",
  b: "ripple",
  n: "roll",
  r: "rate",
  c: "razor",
  y: "slip",
  u: "slide",
  p: "pen",
  h: "hand",
  z: "zoom",
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
      if (mod && key === "a") {
        e.preventDefault();
        cmd.selectAll();
        return;
      }
      if (mod && key === "k") {
        e.preventDefault();
        cmd.razorAtPlayhead(true);
        return;
      }
      if (mod) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          cmd.togglePlay();
          return;
        case "ArrowLeft":
          e.preventDefault();
          cmd.stepFrame(e.shiftKey ? -store.state.project.fps : -1);
          return;
        case "ArrowRight":
          e.preventDefault();
          cmd.stepFrame(e.shiftKey ? store.state.project.fps : 1);
          return;
        case "ArrowUp":
          e.preventDefault();
          cmd.goPrevEdge();
          return;
        case "ArrowDown":
          e.preventDefault();
          cmd.goNextEdge();
          return;
        case "Home":
          cmd.goToStart();
          return;
        case "End":
          cmd.goToEnd();
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          e.shiftKey ? cmd.rippleDeleteSelected() : cmd.deleteSelected();
          return;
        case "i":
        case "I":
          cmd.markIn();
          return;
        case "o":
        case "O":
          cmd.markOut();
          return;
      }

      // J / K / L shuttle.
      if (key === "k") {
        store.setRate(0);
        store.setPlaying(false);
        return;
      }
      if (key === "l") {
        store.setRate(Math.max(1, store.state.rate + 1));
        store.setPlaying(true);
        return;
      }
      if (key === "j") {
        store.setRate(Math.min(-1, (store.state.rate < 0 ? store.state.rate : 0) - 1));
        store.setPlaying(true);
        return;
      }

      // Tool hotkeys.
      const tool = TOOL_KEYS[key];
      if (tool) store.setTool(tool);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
