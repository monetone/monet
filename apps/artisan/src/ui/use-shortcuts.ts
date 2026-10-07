// ─────────────────────────────────────────────────────────────
// ui/use-shortcuts — global keyboard shortcuts
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { isEditableTarget } from "@monet-ui/monet-react";
import type { ArtisanStore } from "../engine";
import { commands } from "../commands";
import { fileCommands } from "../io/commands";
import { shortcutToTool } from "../tools/registry";
import { handleRegisteredShortcut } from "./shortcut-registry";

export function useShortcuts(store: ArtisanStore) {
  useEffect(() => {
    const toolMap = shortcutToTool();
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (handleRegisteredShortcut(e, store)) return;

      if (mod) {
        switch (k) {
          case "z":
            e.preventDefault();
            e.shiftKey ? commands.redo(store) : commands.undo(store);
            return;
          case "y":
            e.preventDefault();
            commands.redo(store);
            return;
          case "a":
            e.preventDefault();
            if (e.altKey) commands.selectAllOnActiveArtboard(store);
            else e.shiftKey ? commands.deselectAll(store) : commands.selectAll(store);
            return;
          case "g":
            e.preventDefault();
            e.shiftKey ? commands.ungroup(store) : commands.group(store);
            return;
          case "u":
            e.preventDefault();
            commands.toggleSmartGuides(store);
            return;
          case "h":
            e.preventDefault();
            commands.toggleHideEdges(store);
            return;
          case "2":
            e.preventDefault();
            if (e.altKey && e.shiftKey) commands.lockAllArtworkAbove(store);
            else if (e.altKey) commands.unlockAll(store);
            else commands.lockSelection(store);
            return;
          case "3":
            e.preventDefault();
            e.altKey ? commands.showAll(store) : commands.hideSelection(store);
            return;
          case "5":
            e.preventDefault();
            commands.makeGuides(store); // ⌘5 — Make Guides from the selection
            return;
          case "6":
            e.preventDefault();
            commands.reselect(store);
            return;
          case "7":
            e.preventDefault();
            e.altKey ? commands.releaseClipMask(store) : commands.makeClipMask(store);
            return;
          case "j":
            e.preventDefault();
            commands.join(store);
            return;
          case "n":
            e.preventDefault();
            void fileCommands.new(store);
            return;
          case "r":
            e.preventDefault();
            commands.toggleRulers(store); // ⌘R
            return;
          case ";":
            e.preventDefault();
            commands.toggleGuides(store); // ⌘;
            return;
          case "'":
          case '"':
            // ⌘' toggles the grid, ⇧⌘' Snap to Grid. Shift+' yields '"' on a US
            // layout, so accept both key values.
            e.preventDefault();
            e.shiftKey ? commands.toggleSnapGrid(store) : commands.toggleGrid(store);
            return;
          case "8":
            e.preventDefault();
            e.altKey ? commands.releaseCompoundPath(store) : commands.makeCompoundPath(store);
            return;
          case "d":
            e.preventDefault();
            if (e.shiftKey) commands.toggleTransparencyGrid(store); // ⇧⌘D
            else commands.duplicate(store); // ⌘D
            return;
          case "s":
            e.preventDefault();
            fileCommands.save(store);
            return;
          case "o":
            e.preventDefault();
            void fileCommands.open(store);
            return;
          case "e":
            e.preventDefault();
            e.shiftKey ? void fileCommands.exportPng(store) : fileCommands.exportSvg(store);
            return;
          case "c":
            // ⌥⌘C / ⌥⇧⌘C are Illustrator's Envelope Distort Make-with-Top-Object
            // and Release; plain ⌘C stays Copy (no preventDefault, so the webview
            // still puts the selection on the system clipboard).
            if (e.altKey) {
              e.preventDefault();
              e.shiftKey ? commands.releaseEnvelope(store) : commands.makeEnvelopeTopObject(store);
              return;
            }
            commands.copy(store);
            return;
          case "x":
            commands.cut(store);
            return;
          case "v":
            if (e.altKey) {
              e.preventDefault();
              e.shiftKey ? commands.pasteOnAllArtboards(store) : commands.pasteInPlace(store);
            } else {
              commands.paste(store);
            }
            return;
          case "f":
            e.preventDefault(); // block the browser Find bar
            commands.pasteInFront(store);
            return;
          case "b":
            e.preventDefault();
            if (e.altKey) e.shiftKey ? commands.releaseBlend(store) : commands.blend(store); // ⌥⇧⌘B / ⌥⌘B
            else if (e.shiftKey) commands.toggleBoundingBox(store); // ⇧⌘B
            else commands.pasteInBack(store); // ⌘B
            return;
          case "]":
            e.preventDefault();
            if (e.altKey) commands.selectNextObject(store, "above");
            else e.shiftKey ? commands.bringToFront(store) : commands.bringForward(store);
            return;
          case "[":
            e.preventDefault();
            if (e.altKey) commands.selectNextObject(store, "below");
            else e.shiftKey ? commands.sendToBack(store) : commands.sendBackward(store);
            return;
          case "=":
          case "+":
            e.preventDefault();
            commands.zoomIn(store);
            return;
          case "-":
            e.preventDefault();
            commands.zoomOut(store);
            return;
          case "0":
            e.preventDefault();
            if (e.altKey) commands.zoomFitAll(store); // ⌥⌘0
            else commands.zoomFit(store); // ⌘0
            return;
          case "1":
            e.preventDefault();
            commands.zoomActual(store);
            return;
        }
        return;
      }

      if (k === "delete" || k === "backspace") {
        e.preventDefault();
        commands.delete(store);
        return;
      }
      if (k === "escape") {
        store.clearSelection();
        return;
      }
      // Arrow-key nudge: move the selection by the keyboard increment (Shift = 10×).
      if (k === "arrowleft" || k === "arrowright" || k === "arrowup" || k === "arrowdown") {
        const st = store.getState();
        const hasAnchors = Object.values(st.anchorSelection).some((a) => a && a.length);
        if (!st.selection.length && !hasAnchors) return;
        e.preventDefault();
        const inc = e.shiftKey ? 10 : 1;
        const dx = k === "arrowleft" ? -inc : k === "arrowright" ? inc : 0;
        const dy = k === "arrowup" ? -inc : k === "arrowdown" ? inc : 0;
        commands.nudge(store, dx, dy);
        return;
      }
      if (k === "x") {
        e.preventDefault();
        e.shiftKey ? commands.swapFillStroke(store) : commands.toggleFillStroke(store);
        return;
      }
      if (k === "d") {
        e.preventDefault();
        // Illustrator: D = default fill/stroke, ⇧D cycles Draw Normal ▸ Behind ▸ Inside.
        e.shiftKey ? commands.cycleDrawingMode(store) : commands.defaultFillStroke(store);
        return;
      }
      if (k === "/") {
        e.preventDefault();
        commands.noneFillStroke(store);
        return;
      }
      // Shift-prefixed tool shortcuts win over the plain letter (⇧E Eraser vs
      // E Free Transform); a Shift press with no ⇧-variant still picks the
      // plain tool, so ⇧+ / ⇧= keep working on layouts that need Shift.
      const toolId = (e.shiftKey && toolMap[`shift+${k}`]) || toolMap[k];
      if (toolId) {
        store.setTool(toolId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
