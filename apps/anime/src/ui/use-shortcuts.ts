// ui/use-shortcuts — global transport + edit keymap (ignored while typing).

import { useEffect } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";
import { deleteSelected, keyAllTransform, stepFrame, togglePlay } from "../commands";
import { store } from "../state/store";

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepFrame(e.shiftKey ? -10 : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          stepFrame(e.shiftKey ? 10 : 1);
          break;
        case "Home":
          e.preventDefault();
          store.setPlayhead(0);
          break;
        case "Delete":
        case "Backspace":
          if (store.getState().selection.length) {
            e.preventDefault();
            deleteSelected();
          }
          break;
        case "k":
        case "K": {
          const sel = store.getState().selection;
          if (sel.length === 1) {
            e.preventDefault();
            keyAllTransform(sel[0]);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
