// ─────────────────────────────────────────────────────────────
// menus.ts — the Monet menu-bar definition, wired to the command layer.
// ─────────────────────────────────────────────────────────────

import * as cmd from "../commands";
import { store } from "../state/app";

export function buildMenus() {
  return [
    {
      id: "file",
      label: "File",
      items: [
        { id: "newProject", label: "New Project", shortcut: "⌘⌥N", action: () => cmd.newProject() },
        { id: "newSeq", label: "New Sequence…", shortcut: "⌘N", action: () => cmd.newSequence() },
        { id: "open", label: "Open Project…", shortcut: "⌘O", action: () => document.dispatchEvent(new CustomEvent("cinema:open")) },
        { id: "sep1", separator: true },
        { id: "import", label: "Import Media…", shortcut: "⌘I", action: () => document.dispatchEvent(new CustomEvent("cinema:import")) },
        { id: "sep2", separator: true },
        { id: "save", label: "Save Project", shortcut: "⌘S", action: () => document.dispatchEvent(new CustomEvent("cinema:save")) },
        {
          id: "export",
          label: "Export",
          items: [
            { id: "exVideo", label: "Video (MP4)…", shortcut: "⌘M", action: () => document.dispatchEvent(new CustomEvent("cinema:export-video")) },
            { id: "exFrame", label: "Frame (PNG)…", shortcut: "⇧E", action: () => document.dispatchEvent(new CustomEvent("cinema:export")) },
            { id: "exEdl", label: "EDL…", action: () => document.dispatchEvent(new CustomEvent("cinema:export-edl")) },
          ],
        },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: "Undo", shortcut: "⌘Z", action: () => cmd.undo() },
        { id: "redo", label: "Redo", shortcut: "⇧⌘Z", action: () => cmd.redo() },
        { id: "sep1", separator: true },
        { id: "duplicate", label: "Duplicate", shortcut: "⌘D", action: () => cmd.duplicateSelected() },
        { id: "delete", label: "Delete", shortcut: "⌦", action: () => cmd.deleteSelected() },
        { id: "ripple", label: "Ripple Delete", shortcut: "⇧⌦", action: () => cmd.rippleDeleteSelected() },
        { id: "sep2", separator: true },
        { id: "selectAll", label: "Select All", shortcut: "⌘A", action: () => cmd.selectAll() },
      ],
    },
    {
      id: "clip",
      label: "Clip",
      items: [
        { id: "razor", label: "Add Edit (Razor)", shortcut: "⌘K", action: () => cmd.razorAtPlayhead(true) },
        { id: "speed", label: "Speed/Duration — 50%", action: () => cmd.setSelectedSpeed(0.5) },
        { id: "speed2", label: "Speed/Duration — 200%", action: () => cmd.setSelectedSpeed(2) },
        { id: "sep1", separator: true },
        { id: "fxdis", label: "Cross Dissolve", action: () => cmd.addTransitionToSelected("cross-dissolve") },
        { id: "fxdip", label: "Dip to Black", action: () => cmd.addTransitionToSelected("dip-to-black") },
        { id: "fxwipe", label: "Wipe", action: () => cmd.addTransitionToSelected("wipe") },
      ],
    },
    {
      id: "sequence",
      label: "Sequence",
      items: [
        { id: "addV", label: "Add Video Track", action: () => cmd.addVideoTrack() },
        { id: "addA", label: "Add Audio Track", action: () => cmd.addAudioTrack() },
        { id: "sep1", separator: true },
        { id: "in", label: "Mark In", shortcut: "I", action: () => cmd.markIn() },
        { id: "out", label: "Mark Out", shortcut: "O", action: () => cmd.markOut() },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { id: "snap", label: "Snapping", checked: store.state.snapping, action: () => store.setSnapping(!store.state.snapping) },
        { id: "zoomin", label: "Zoom In", shortcut: "=", action: () => store.setZoom(store.state.pxPerFrame * 1.5) },
        { id: "zoomout", label: "Zoom Out", shortcut: "-", action: () => store.setZoom(store.state.pxPerFrame / 1.5) },
      ],
    },
  ];
}
