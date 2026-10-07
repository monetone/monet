// ─────────────────────────────────────────────────────────────
// menus.ts — the Monet menu-bar definition, wired to the command layer. File
// I/O verbs are dispatched as DOM events the App listens for; everything else
// calls commands / the store directly.
// ─────────────────────────────────────────────────────────────

import * as cmd from "../commands";
import { store } from "../state/app";
import { activeScene, findObject, flattenObjects } from "../model/query";
import { fitView, frameSelection, moveToView } from "../phaser/PhaserStage";

const evt = (name: string) => () => document.dispatchEvent(new CustomEvent(name));

/** Grid/snap increment presets (px) offered in View ▸ Grid Size (Unity Grid and Snap). */
const GRID_SIZES = [8, 16, 24, 32, 48, 64];

/** Rotation-snap increment presets (°) offered in View ▸ Rotation Snap (Unity Grid and Snap → Rotate). */
const ROTATION_SNAPS = [5, 10, 15, 30, 45, 90];

/** Scale-snap increment presets (×) offered in View ▸ Scale Snap (Unity Grid and Snap → Scale). */
const SCALE_SNAPS = [0.1, 0.25, 0.5, 1, 2];

export function buildMenus() {
  const s = store.state;
  const sole = store.soleSelection();
  const scene = activeScene(s.project);
  const soleObj = sole ? findObject(scene, sole) : undefined;
  const objectCount = flattenObjects(scene).length;
  const hasChildSelection = s.selection.some((id) => !!findObject(scene, id)?.children?.length);
  const SLOTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return [
    {
      id: "file",
      label: "File",
      items: [
        { id: "new", label: "New Project", shortcut: "⌘⌥N", action: evt("jouer:new") },
        { id: "open", label: "Open Project…", shortcut: "⌘O", action: evt("jouer:open") },
        { id: "save", label: "Save Project…", shortcut: "⌘S", action: evt("jouer:save") },
        { id: "sep1", separator: true },
        {
          id: "export",
          label: "Export to Phaser",
          items: [
            { id: "exHtml", label: "Standalone HTML…", shortcut: "⇧⌘E", action: evt("jouer:export-html") },
            { id: "exJs", label: "Game module (.js)…", action: evt("jouer:export-js") },
          ],
        },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: "Undo", shortcut: "⌘Z", disabled: !s.canUndo, action: () => cmd.undo() },
        { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !s.canRedo, action: () => cmd.redo() },
        { id: "sep1", separator: true },
        { id: "dup", label: "Duplicate", shortcut: "⌘D", disabled: s.selection.length === 0, action: () => cmd.duplicateSelection() },
        { id: "del", label: "Delete", shortcut: "⌫", disabled: s.selection.length === 0, action: () => cmd.deleteSelection() },
        { id: "sep1b", separator: true },
        { id: "cut", label: "Cut", shortcut: "⌘X", disabled: s.selection.length === 0, action: () => cmd.cutSelection() },
        { id: "copy", label: "Copy", shortcut: "⌘C", disabled: s.selection.length === 0, action: () => cmd.copySelection() },
        { id: "paste", label: "Paste", shortcut: "⌘V", disabled: !cmd.canPaste(), action: () => cmd.paste() },
        { id: "pasteChild", label: "Paste as Child", shortcut: "⇧⌘V", disabled: !cmd.canPaste() || soleObj?.kind !== "container", action: () => cmd.pasteAsChild() },
        { id: "sepSel", separator: true },
        { id: "selectAll", label: "Select All", shortcut: "⌘A", disabled: objectCount === 0, action: () => cmd.selectAll() },
        { id: "deselectAll", label: "Deselect All", shortcut: "⇧D", disabled: s.selection.length === 0, action: () => cmd.deselectAll() },
        { id: "invertSel", label: "Invert Selection", shortcut: "⌘I", disabled: objectCount === 0, action: () => cmd.invertSelection() },
        { id: "selectChildren", label: "Select Children", disabled: !hasChildSelection, action: () => cmd.selectChildren() },
        {
          id: "saveSel",
          label: "Save Selection",
          items: SLOTS.map((n) => ({ id: "saveSel" + n, label: `Slot ${n}`, shortcut: `⌘⌥${n}`, disabled: s.selection.length === 0, action: () => cmd.saveSelectionSet(n) })),
        },
        {
          id: "loadSel",
          label: "Load Selection",
          items: SLOTS.map((n) => {
            const set = s.selectionSets[n];
            return { id: "loadSel" + n, label: set?.length ? `Slot ${n} (${set.length})` : `Slot ${n}`, shortcut: `⌘⇧${n}`, disabled: !set?.length, action: () => cmd.loadSelectionSet(n) };
          }),
        },
        { id: "sepFlip", separator: true },
        { id: "flipH", label: "Flip Horizontal", disabled: s.selection.length === 0, action: () => cmd.flipSelection("horizontal") },
        { id: "flipV", label: "Flip Vertical", disabled: s.selection.length === 0, action: () => cmd.flipSelection("vertical") },
        { id: "resetTf", label: "Reset Transform", disabled: s.selection.length === 0, action: () => cmd.resetTransform("all") },
        { id: "copyTf", label: "Copy Transform", disabled: !sole, action: () => cmd.copyTransform() },
        { id: "pasteTf", label: "Paste Transform Values", disabled: !cmd.canPasteTransform() || s.selection.length === 0, action: () => cmd.pasteTransform() },
        { id: "copyBody", label: "Copy Physics Body", disabled: !soleObj?.body, action: () => cmd.copyBody() },
        { id: "pasteBody", label: "Paste Physics Body", disabled: !cmd.canPasteBody() || s.selection.length === 0, action: () => cmd.pasteBody() },
        { id: "sep2", separator: true },
        { id: "group", label: "Group Selection", shortcut: "⌘G", disabled: s.selection.length < 1, action: () => cmd.groupSelection() },
        { id: "ungroup", label: "Ungroup", shortcut: "⇧⌘G", disabled: soleObj?.kind !== "container", action: () => sole && cmd.ungroup(sole) },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      items: [
        { id: "sprite", label: "Sprite", action: () => cmd.addObject("sprite") },
        { id: "image", label: "Image", action: () => cmd.addObject("image") },
        { id: "text", label: "Text", action: () => cmd.addObject("text") },
        { id: "rect", label: "Rectangle", action: () => cmd.addObject("rectangle") },
        { id: "ellipse", label: "Ellipse", action: () => cmd.addObject("ellipse") },
        { id: "triangle", label: "Triangle", action: () => cmd.addObject("triangle") },
        { id: "hexagon", label: "Hexagon", action: () => cmd.addObject("hexagon") },
        { id: "hexagonFlat", label: "Hexagon (Flat-Top)", action: () => cmd.addObject("hexagonFlat") },
        { id: "diamond", label: "Diamond", action: () => cmd.addObject("diamond") },
        { id: "capsule", label: "Capsule", action: () => cmd.addObject("capsule") },
        { id: "container", label: "Container", action: () => cmd.addObject("container") },
      ],
    },
    {
      id: "scene",
      label: "Scene",
      items: [
        { id: "newScene", label: "New Scene", action: () => cmd.addScene() },
        { id: "dupScene", label: "Duplicate Scene", disabled: !scene, action: () => scene && cmd.duplicateScene(scene.id) },
        { id: "delScene", label: "Delete Scene", disabled: s.project.scenes.length <= 1, action: () => scene && cmd.deleteScene(scene.id) },
      ],
    },
    {
      id: "animation",
      label: "Animation",
      items: [
        { id: "play", label: s.playing ? "Pause" : "Play", shortcut: "Space", action: () => store.togglePlaying() },
        { id: "stepBack", label: "Step Back", shortcut: ",", action: () => cmd.stepFrame(-1) },
        { id: "stepFwd", label: "Step Forward", shortcut: ".", action: () => cmd.stepFrame(1) },
        { id: "prevKey", label: "Previous Keyframe", disabled: !cmd.hasKeyframes(), action: () => cmd.goToPrevKeyframe() },
        { id: "nextKey", label: "Next Keyframe", disabled: !cmd.hasKeyframes(), action: () => cmd.goToNextKeyframe() },
        { id: "newTl", label: "New Timeline", action: () => cmd.addTimeline() },
        { id: "key", label: "Key Transform of Selection", shortcut: "K", disabled: !sole, action: () => sole && cmd.keyAllTransform(sole) },
        { id: "loop", label: "Loop Playback", checked: s.loopPlayback, action: () => store.setLoopPlayback(!s.loopPlayback) },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { id: "grid", label: "Show Grid", checked: s.showGrid, action: () => store.setShowGrid(!s.showGrid) },
        { id: "snap", label: "Snap to Grid", checked: s.snap, action: () => store.setSnap(!s.snap) },
        { id: "snapSel", label: "Snap Selection to Grid", disabled: s.selection.length === 0 || s.gridSize < 2, action: () => cmd.snapSelectionToGrid() },
        { id: "gridSize", label: "Grid Size", items: GRID_SIZES.map((n) => ({ id: "gridSize" + n, label: `${n} px`, checked: s.gridSize === n, action: () => store.setGridSize(n) })) },
        { id: "snapRot", label: "Snap Rotation of Selection", disabled: s.selection.length === 0, action: () => cmd.snapSelectionRotation() },
        { id: "rotSnap", label: "Rotation Snap", items: ROTATION_SNAPS.map((n) => ({ id: "rotSnap" + n, label: `${n}°`, checked: s.rotationSnap === n, action: () => store.setRotationSnap(n) })) },
        { id: "snapScale", label: "Snap Scale of Selection", disabled: s.selection.length === 0, action: () => cmd.snapSelectionScale() },
        { id: "scaleSnap", label: "Scale Snap", items: SCALE_SNAPS.map((n) => ({ id: "scaleSnap" + n, label: `${n}×`, checked: s.scaleSnap === n, action: () => store.setScaleSnap(n) })) },
        { id: "isolate", label: "Isolate Selection", shortcut: "⇧H", checked: s.isolatedIds !== null, disabled: s.isolatedIds === null && s.selection.length === 0, action: () => cmd.toggleIsolateSelection() },
        { id: "sep1", separator: true },
        { id: "zin", label: "Zoom In", shortcut: "+", action: () => store.setZoom(store.state.zoom * 1.25) },
        { id: "zout", label: "Zoom Out", shortcut: "-", action: () => store.setZoom(store.state.zoom / 1.25) },
        { id: "frameSel", label: "Frame Selected", shortcut: "F", disabled: s.selection.length === 0, action: () => frameSelection() },
        { id: "moveToView", label: "Move to View", shortcut: "⌥⌘F", disabled: s.selection.length === 0, action: () => moveToView() },
        { id: "lockView", label: "Lock View to Selected", checked: s.followSelection, disabled: !s.followSelection && s.selection.length === 0, action: () => cmd.toggleFollowSelection() },
        { id: "fit", label: "Fit to Window", shortcut: "⇧F", action: () => fitView() },
      ],
    },
  ];
}
